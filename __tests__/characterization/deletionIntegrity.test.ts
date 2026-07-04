/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — integritatea ștergerilor (Faza 2, review 2026-07).
 *
 * Acoperă problemele confirmate:
 *   1. FK ON: deleteMedicalRecord cascadează observațiile/thread-urile/mesajele/
 *      share-urile; deletePerson nu lasă medical_record orfan; deleteThread șterge
 *      mesajele.
 *   2. deleteDocument șterge document_pages + document_entities (fără FK) și
 *      fișierele de pe disc.
 *   3. INSERT OR REPLACE → UPSERT: import ADITIV peste un dosar medical existent
 *      NU pierde observațiile adăugate după backup (fără cascade din REPLACE).
 *   4. Migrarea one-time curăță orfanii preexistenți din era pre-FK.
 *
 * Notă asupra „roșu pe codul vechi": better-sqlite3 forțează `foreign_keys = ON`
 * în test (vezi helpers/testDb.ts), deci cascade-urile de la (1) sunt verzi și pe
 * codul vechi — bug-ul de producție era `foreign_keys` OFF, reparat de PRAGMA din
 * db.ts. Testele (1) lock-uiesc relația CASCADE ca regresie. Testele (2), (3), (4)
 * PICĂ pe codul vechi (deleteDocument nu ștergea copiii/fișierele; INSERT OR REPLACE
 * cascada la import aditiv; migrarea de cleanup nu exista).
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let FileSystem: typeof import('expo-file-system/legacy');
let deleteDocument: typeof import('@/services/documents').deleteDocument;
let deletePerson: typeof import('@/services/entities').deletePerson;
let deleteMedicalRecord: typeof import('@/services/medicalRecord').deleteMedicalRecord;
let deleteThread: typeof import('@/services/medicalChat').deleteThread;
let applyManifest: typeof import('@/services/backup').applyManifest;
let buildManifestPayload: typeof import('@/services/cloudSync').buildManifestPayload;
let applySchemaToTestDb: typeof import('../helpers/testDbSetup').applySchemaToTestDb;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    FileSystem = require('expo-file-system/legacy');
    deleteDocument = require('@/services/documents').deleteDocument;
    deletePerson = require('@/services/entities').deletePerson;
    deleteMedicalRecord = require('@/services/medicalRecord').deleteMedicalRecord;
    deleteThread = require('@/services/medicalChat').deleteThread;
    applyManifest = require('@/services/backup').applyManifest;
    buildManifestPayload = require('@/services/cloudSync').buildManifestPayload;
    applySchemaToTestDb = require('../helpers/testDbSetup').applySchemaToTestDb;
  });
});

function resetSchema(): void {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    if (t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(() => {
  resetSchema();
  jest.clearAllMocks();
});

const TS = '2026-01-01T00:00:00Z';

async function count(
  table: string,
  where = '',
  params: (string | number | null)[] = []
): Promise<number> {
  const row = (await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ${table} ${where}`,
    params
  )) ?? { c: -1 };
  return row.c;
}

// ── Helper de seed pentru un dosar medical complet ───────────────────────────
async function seedMedicalGraph(): Promise<void> {
  await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [
    'p1',
    'Ana',
    TS,
  ]);
  await db.runAsync(
    `INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at)
     VALUES ('m1', 'p1', 'Dosar Ana', 'plaintext-v2', ?, ?)`,
    [TS, TS]
  );
  await db.runAsync(
    `INSERT INTO medical_observations
       (id, medical_record_id, name, category, confidence, created_at, updated_at)
     VALUES ('obs-1', 'm1', 'Glicemie', 'biochimie', 0.9, ?, ?)`,
    [TS, TS]
  );
  await db.runAsync(
    `INSERT INTO medical_chat_threads (id, medical_record_id, title, created_at, updated_at)
     VALUES ('t1', 'm1', 'Conversație', ?, ?)`,
    [TS, TS]
  );
  await db.runAsync(
    `INSERT INTO medical_chat_messages (id, thread_id, role, content, created_at)
     VALUES ('msg-1', 't1', 'user', 'salut', ?)`,
    [TS]
  );
  await db.runAsync(
    `INSERT INTO medical_shares
       (id, medical_record_id, created_at, expires_at, size_bytes, doc_count, obs_count)
     VALUES ('sh-1', 'm1', ?, '2030-01-01', 100, 1, 1)`,
    [TS]
  );
}

describe('FK ON — cascade la ștergere', () => {
  it('deleteMedicalRecord cascadează observații/thread-uri/mesaje/share-uri', async () => {
    await seedMedicalGraph();
    await deleteMedicalRecord('m1');
    expect(await count('medical_record')).toBe(0);
    expect(await count('medical_observations')).toBe(0);
    expect(await count('medical_chat_threads')).toBe(0);
    expect(await count('medical_chat_messages')).toBe(0);
    expect(await count('medical_shares')).toBe(0);
  });

  it('deletePerson nu lasă medical_record orfan (cascade person → dosar → copii)', async () => {
    await seedMedicalGraph();
    await deletePerson('p1');
    expect(await count('persons')).toBe(0);
    expect(await count('medical_record', 'WHERE person_id = ?', ['p1'])).toBe(0);
    expect(await count('medical_observations')).toBe(0);
    expect(await count('medical_chat_messages')).toBe(0);
  });

  it('deleteThread șterge mesajele thread-ului (cascade)', async () => {
    await seedMedicalGraph();
    await deleteThread('t1');
    expect(await count('medical_chat_threads')).toBe(0);
    expect(await count('medical_chat_messages')).toBe(0);
    // Dosarul + observațiile rămân neatinse.
    expect(await count('medical_record')).toBe(1);
    expect(await count('medical_observations')).toBe(1);
  });
});

describe('deleteDocument — copii fără FK + fișiere', () => {
  it('șterge document_pages, document_entities și fișierele de pe disc', async () => {
    await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [
      'p1',
      'Ana',
      TS,
    ]);
    await db.runAsync(
      `INSERT INTO documents (id, type, file_path, person_id, created_at)
       VALUES ('d1', 'buletin', 'documents/d1.jpg', 'p1', ?)`,
      [TS]
    );
    await db.runAsync(
      `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
       VALUES ('pg-1', 'd1', 0, 'documents/d1-p1.jpg', ?)`,
      [TS]
    );
    await db.runAsync(
      `INSERT INTO document_entities (id, document_id, entity_type, entity_id)
       VALUES ('de-1', 'd1', 'person', 'p1')`
    );

    await deleteDocument('d1');

    expect(await count('documents')).toBe(0);
    expect(await count('document_pages', 'WHERE document_id = ?', ['d1'])).toBe(0);
    expect(await count('document_entities', 'WHERE document_id = ?', ['d1'])).toBe(0);

    // Fișierele principale + pagina au fost șterse de pe disc (idempotent).
    const deleted = (FileSystem.deleteAsync as jest.Mock).mock.calls.map(c => c[0]);
    expect(deleted).toEqual(
      expect.arrayContaining([
        'file:///test/Documents/documents/d1.jpg',
        'file:///test/Documents/documents/d1-p1.jpg',
      ])
    );
  });
});

describe('import aditiv — UPSERT nu pierde copiii dosarului', () => {
  it('INSERT OR REPLACE→UPSERT pe medical_record păstrează observațiile adăugate după backup', async () => {
    // Seed: dosar cu o observație.
    await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [
      'p1',
      'Ana',
      TS,
    ]);
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at)
       VALUES ('m1', 'p1', 'Dosar Ana', 'plaintext-v2', ?, ?)`,
      [TS, TS]
    );
    await db.runAsync(
      `INSERT INTO medical_observations
         (id, medical_record_id, name, category, confidence, created_at, updated_at)
       VALUES ('obs-1', 'm1', 'Glicemie', 'biochimie', 0.9, ?, ?)`,
      [TS, TS]
    );

    // Backup „vechi" — capturat cu o singură observație.
    const payload = (await buildManifestPayload()) as unknown as Record<string, unknown>;

    // Observație adăugată DUPĂ backup (simulează date noi pe device).
    await db.runAsync(
      `INSERT INTO medical_observations
         (id, medical_record_id, name, category, confidence, created_at, updated_at)
       VALUES ('obs-2', 'm1', 'Colesterol', 'biochimie', 0.8, ?, ?)`,
      [TS, TS]
    );

    // Import ADITIV (fără wipe) al backup-ului vechi.
    await applyManifest(payload, { wipeFirst: false });

    // Cu INSERT OR REPLACE + FK ON, REPLACE pe m1 ar fi cascadat obs-2. Cu UPSERT,
    // obs-2 supraviețuiește; obs-1 rămâne (actualizat in-place).
    expect(await count('medical_record')).toBe(1);
    expect(await count('medical_observations')).toBe(2);
    expect(await count('medical_observations', 'WHERE id = ?', ['obs-2'])).toBe(1);
  });
});

describe('migrare cleanup orfani preexistenți (era pre-FK)', () => {
  it('curăță dosare/observații/remindere orfane, păstrează datele valide', () => {
    // Date valide.
    testDb._raw.exec(
      "INSERT INTO persons (id, name, created_at) VALUES ('p-valid', 'Ana', '2026-01-01')"
    );
    testDb._raw.exec(
      "INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at) VALUES ('m-valid', 'p-valid', 'Dosar', 'plaintext-v2', '2026-01-01', '2026-01-01')"
    );

    // Orfani — inserați cu FK OFF (ar fi respinși cu FK ON).
    testDb._raw.pragma('foreign_keys = OFF');
    testDb._raw.exec(
      "INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at) VALUES ('m-orphan', 'ghost-person', 'Orfan', 'plaintext-v2', '2026-01-01', '2026-01-01')"
    );
    testDb._raw.exec(
      "INSERT INTO medical_observations (id, medical_record_id, name, category, confidence, created_at, updated_at) VALUES ('obs-orphan', 'ghost-record', 'X', 'alt', 0.5, '2026-01-01', '2026-01-01')"
    );
    testDb._raw.exec(
      "INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at) VALUES ('rem-orphan', 'document_expiry', 'ghost-doc', 'X', '2030-01-01', 'derived', '2026-01-01')"
    );
    testDb._raw.pragma('foreign_keys = ON');

    // Rulează migrările reale din db.ts (inclusiv cleanup-ul orfanilor).
    applySchemaToTestDb(testDb);

    const rec = testDb._raw.prepare('SELECT id FROM medical_record').all() as { id: string }[];
    expect(rec.map(r => r.id)).toEqual(['m-valid']);
    expect(
      (testDb._raw.prepare('SELECT COUNT(*) AS c FROM medical_observations').get() as { c: number })
        .c
    ).toBe(0);
    expect(
      (testDb._raw.prepare('SELECT COUNT(*) AS c FROM reminders').get() as { c: number }).c
    ).toBe(0);
  });
});
