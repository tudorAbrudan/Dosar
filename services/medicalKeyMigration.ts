/**
 * Migrare one-time (spec 2026-06-05): datele medicale criptate AES (coloanele
 * `_enc` BLOB) sunt convertite în coloane TEXT plaintext. După conversie, cheia
 * master e ștearsă din Keychain — nu mai e nevoie de ea.
 *
 * Idempotent: dacă tabelele sunt deja în schema nouă (fără `name_enc`), skip.
 * Rândurile care nu se pot decripta (cheie lipsă pe device-ul ăsta) primesc
 * placeholder — datele reale revin la următorul restore din backup plaintext.
 *
 * `database` e injectabil pentru testare; default = singleton-ul `db`.
 */
import { db as defaultDb } from './db';
import {
  hasMedicalMasterKey,
  ensureMedicalMasterKey,
  deleteMedicalMasterKey,
  decryptFieldOrNull,
} from './medicalCrypto';

interface MinimalDb {
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  execAsync(sql: string): Promise<unknown>;
}

function toBytes(blob: unknown): Uint8Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  if (Array.isArray(blob)) return new Uint8Array(blob as number[]);
  // better-sqlite3 returnează Buffer (subclasă de Uint8Array) — acoperit mai sus
  return null;
}

async function hasColumn(database: MinimalDb, table: string, column: string): Promise<boolean> {
  const cols = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

interface OldObsRow {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  name_enc: unknown;
  value_enc: unknown;
  unit: string | null;
  ref_min_enc: unknown;
  ref_max_enc: unknown;
  observed_at: string | null;
  category: string;
  confidence: number;
  needs_review: number;
  user_corrected: number;
  created_at: string;
  updated_at: string;
}

interface OldMsgRow {
  id: string;
  thread_id: string;
  role: string;
  content_enc: unknown;
  citations_json: string | null;
  created_at: string;
}

async function migrateObservations(database: MinimalDb): Promise<void> {
  if (!(await hasColumn(database, 'medical_observations', 'name_enc'))) return;

  await database.execAsync(`
    CREATE TABLE medical_observations_plain (
      id TEXT PRIMARY KEY,
      medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
      source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      value TEXT,
      unit TEXT,
      ref_min TEXT,
      ref_max TEXT,
      observed_at TEXT,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      user_corrected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const rows = await database.getAllAsync<OldObsRow>('SELECT * FROM medical_observations');
  for (const r of rows) {
    const aad = r.medical_record_id;
    const name = (await decryptFieldOrNull(toBytes(r.name_enc), aad)) ?? '[indisponibil]';
    const value = await decryptFieldOrNull(toBytes(r.value_enc), aad);
    const refMin = await decryptFieldOrNull(toBytes(r.ref_min_enc), aad);
    const refMax = await decryptFieldOrNull(toBytes(r.ref_max_enc), aad);
    await database.runAsync(
      `INSERT INTO medical_observations_plain
         (id, medical_record_id, source_document_id, name, value, unit, ref_min, ref_max,
          observed_at, category, confidence, needs_review, user_corrected, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.medical_record_id,
        r.source_document_id,
        name,
        value,
        r.unit,
        refMin,
        refMax,
        r.observed_at,
        r.category,
        r.confidence,
        r.needs_review,
        r.user_corrected,
        r.created_at,
        r.updated_at,
      ]
    );
  }

  await database.execAsync('DROP TABLE medical_observations');
  await database.execAsync('ALTER TABLE medical_observations_plain RENAME TO medical_observations');
  await database.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_medobs_record ON medical_observations(medical_record_id);
     CREATE INDEX IF NOT EXISTS idx_medobs_observed_at ON medical_observations(observed_at);
     CREATE INDEX IF NOT EXISTS idx_medobs_category ON medical_observations(category);`
  );
}

async function migrateChatMessages(database: MinimalDb): Promise<void> {
  if (!(await hasColumn(database, 'medical_chat_messages', 'content_enc'))) return;

  await database.execAsync(`
    CREATE TABLE medical_chat_messages_plain (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES medical_chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // thread_id → medical_record_id pentru AAD
  const threadMap = new Map<string, string>();
  const threads = await database.getAllAsync<{ id: string; medical_record_id: string }>(
    'SELECT id, medical_record_id FROM medical_chat_threads'
  );
  for (const t of threads) threadMap.set(t.id, t.medical_record_id);

  const rows = await database.getAllAsync<OldMsgRow>('SELECT * FROM medical_chat_messages');
  for (const r of rows) {
    const aad = threadMap.get(r.thread_id) ?? '';
    const content =
      (await decryptFieldOrNull(toBytes(r.content_enc), aad)) ?? '[mesaj indisponibil]';
    await database.runAsync(
      `INSERT INTO medical_chat_messages_plain (id, thread_id, role, content, citations_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.id, r.thread_id, r.role, content, r.citations_json, r.created_at]
    );
  }

  await database.execAsync('DROP TABLE medical_chat_messages');
  await database.execAsync(
    'ALTER TABLE medical_chat_messages_plain RENAME TO medical_chat_messages'
  );
  await database.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_medmsg_thread ON medical_chat_messages(thread_id);'
  );
}

export async function migrateMedicalEncToPlaintext(
  database: MinimalDb = defaultDb as unknown as MinimalDb
): Promise<void> {
  const needsObs = await hasColumn(database, 'medical_observations', 'name_enc');
  const needsMsg = await hasColumn(database, 'medical_chat_messages', 'content_enc');
  if (!needsObs && !needsMsg) return;

  // Încarcă cheia dacă există (pentru decriptare); dacă lipsește, rândurile primesc placeholder.
  if (await hasMedicalMasterKey()) {
    await ensureMedicalMasterKey();
  }

  if (needsObs) await migrateObservations(database);
  if (needsMsg) await migrateChatMessages(database);

  // Cheia nu mai e necesară — datele sunt plaintext acum.
  await deleteMedicalMasterKey();
}
