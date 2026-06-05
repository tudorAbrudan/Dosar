import Database from 'better-sqlite3';
import { migrateMedicalEncToPlaintext } from '@/services/medicalKeyMigration';

// Wrapper async minimal peste better-sqlite3 (oglindă a API-ului expo-sqlite folosit de migrare)
function makeAsyncDb(raw: Database.Database) {
  return {
    getAllAsync: async <T>(sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...(params as never[])) as T[],
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) =>
      (raw.prepare(sql).get(...(params as never[])) as T) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => {
      raw.prepare(sql).run(...(params as never[]));
    },
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
  };
}

jest.mock('@/services/medicalCrypto', () => ({
  hasMedicalMasterKey: jest.fn(async () => false),
  ensureMedicalMasterKey: jest.fn(async () => {}),
  deleteMedicalMasterKey: jest.fn(async () => {}),
  decryptFieldOrNull: jest.fn(async () => null), // fără cheie → null → fallback
}));

describe('migrateMedicalEncToPlaintext', () => {
  it('rebuilds old _enc observations table to plaintext TEXT schema', async () => {
    const raw = new Database(':memory:');
    // FK enforcement off: schema-ul de test nu creează tabelele referite
    // (documents / medical_record) — oglindă a pattern-ului din __tests__/characterization/.
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      CREATE TABLE medical_observations (
        id TEXT PRIMARY KEY, medical_record_id TEXT NOT NULL, source_document_id TEXT,
        name_enc BLOB NOT NULL, value_enc BLOB, unit TEXT, ref_min_enc BLOB, ref_max_enc BLOB,
        observed_at TEXT, category TEXT NOT NULL, confidence REAL NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0, user_corrected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE medical_chat_threads (
        id TEXT PRIMARY KEY, medical_record_id TEXT NOT NULL,
        title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE medical_chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
        content_enc BLOB NOT NULL, citations_json TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO medical_chat_threads (id, medical_record_id, title, created_at, updated_at)
        VALUES ('t1','r1','Thread','t','t');
      INSERT INTO medical_observations
        (id, medical_record_id, source_document_id, name_enc, value_enc, unit, ref_min_enc,
         ref_max_enc, observed_at, category, confidence, needs_review, user_corrected, created_at, updated_at)
        VALUES ('o1','r1',NULL, X'00', X'00', 'mg', NULL, NULL, '2026-01-01', 'altele', 0.9, 0, 0, 't','t');
      INSERT INTO medical_chat_messages (id, thread_id, role, content_enc, citations_json, created_at)
        VALUES ('m1','t1','user', X'00', NULL, 't');
    `);
    const adb = makeAsyncDb(raw);

    await migrateMedicalEncToPlaintext(adb as never);

    const obsCols = raw.prepare('PRAGMA table_info(medical_observations)').all() as {
      name: string;
    }[];
    const names = obsCols.map(c => c.name);
    expect(names).toContain('name');
    expect(names).not.toContain('name_enc');
    const obs = raw
      .prepare('SELECT name, value FROM medical_observations WHERE id = ?')
      .get('o1') as {
      name: string;
      value: string | null;
    };
    expect(obs.name).toBe('[indisponibil]');

    const msgCols = raw.prepare('PRAGMA table_info(medical_chat_messages)').all() as {
      name: string;
    }[];
    expect(msgCols.map(c => c.name)).toContain('content');
    const msg = raw.prepare('SELECT content FROM medical_chat_messages WHERE id = ?').get('m1') as {
      content: string;
    };
    expect(msg.content).toBe('[mesaj indisponibil]');
  });

  it('is a no-op when tables are already plaintext (no name_enc column)', async () => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      CREATE TABLE medical_observations (
        id TEXT PRIMARY KEY, medical_record_id TEXT NOT NULL, source_document_id TEXT,
        name TEXT NOT NULL, value TEXT, unit TEXT, ref_min TEXT, ref_max TEXT,
        observed_at TEXT, category TEXT NOT NULL, confidence REAL NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0, user_corrected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE medical_chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, citations_json TEXT, created_at TEXT NOT NULL
      );
    `);
    const adb = makeAsyncDb(raw);
    await expect(migrateMedicalEncToPlaintext(adb as never)).resolves.toBeUndefined();
  });
});
