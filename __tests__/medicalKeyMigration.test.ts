import Database from 'better-sqlite3';

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

// Creează schema VECHE (_enc) + un rând observație + un rând mesaj, cu thread pentru AAD.
// FK enforcement off: schema-ul de test nu creează tabelele referite (documents /
// medical_record) — oglindă a pattern-ului din __tests__/characterization/.
function seedOldSchema(raw: Database.Database) {
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
}

type MigrateFn = (database?: unknown) => Promise<void>;

// Încarcă modulul de migrare cu un mock specific pentru medicalCrypto, izolat în
// propriul registry (jest.isolateModules) ca să nu se contamineze între describe-uri.
function loadMigration(cryptoMock: Record<string, unknown>): MigrateFn {
  let fn: MigrateFn;
  jest.isolateModules(() => {
    jest.doMock('@/services/medicalCrypto', () => cryptoMock);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fn = require('@/services/medicalKeyMigration').migrateMedicalEncToPlaintext;
  });
  return fn!;
}

describe('migrateMedicalEncToPlaintext — no key (placeholder path)', () => {
  // Fără cheie → decryptFieldOrNull întoarce null → fallback la placeholder.
  const migrateMedicalEncToPlaintext = loadMigration({
    hasMedicalMasterKey: jest.fn(async () => false),
    ensureMedicalMasterKey: jest.fn(async () => {}),
    deleteMedicalMasterKey: jest.fn(async () => {}),
    decryptFieldOrNull: jest.fn(async () => null),
  });

  it('rebuilds old _enc observations table to plaintext TEXT schema', async () => {
    const raw = new Database(':memory:');
    seedOldSchema(raw);
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

  it('recovers from an orphan _plain table left by an interrupted run (re-entrant)', async () => {
    const raw = new Database(':memory:');
    seedOldSchema(raw);
    // Simulează un run anterior întrerupt după CREATE dar înainte de DROP+RENAME:
    // tabelul `_plain` orfan rămâne. Fără DROP TABLE IF EXISTS, CREATE-ul re-rulat
    // ar arunca „table already exists" și migrarea s-ar bloca permanent.
    raw.exec('CREATE TABLE medical_observations_plain (id TEXT PRIMARY KEY);');
    const adb = makeAsyncDb(raw);

    await expect(migrateMedicalEncToPlaintext(adb as never)).resolves.toBeUndefined();

    const obsCols = raw.prepare('PRAGMA table_info(medical_observations)').all() as {
      name: string;
    }[];
    const names = obsCols.map(c => c.name);
    expect(names).toContain('name');
    expect(names).not.toContain('name_enc');
  });
});

describe('migrateMedicalEncToPlaintext — with key (real decryption)', () => {
  // Cheie prezentă → decryptFieldOrNull întoarce plaintext real (nu placeholder).
  const migrateMedicalEncToPlaintext = loadMigration({
    hasMedicalMasterKey: jest.fn(async () => true),
    ensureMedicalMasterKey: jest.fn(async () => {}),
    deleteMedicalMasterKey: jest.fn(async () => {}),
    decryptFieldOrNull: jest.fn(async (bytes: Uint8Array | null) => (bytes ? 'DECRYPTED' : null)),
  });

  it('writes decrypted plaintext and copies non-encrypted columns verbatim', async () => {
    const raw = new Database(':memory:');
    seedOldSchema(raw);
    const adb = makeAsyncDb(raw);

    await migrateMedicalEncToPlaintext(adb as never);

    const obs = raw
      .prepare(
        'SELECT name, value, unit, category, confidence, created_at FROM medical_observations WHERE id = ?'
      )
      .get('o1') as {
      name: string;
      value: string | null;
      unit: string | null;
      category: string;
      confidence: number;
      created_at: string;
    };
    // name_enc avea bytes (X'00') → decriptat la 'DECRYPTED', NU placeholder.
    expect(obs.name).toBe('DECRYPTED');
    // value_enc avea bytes (X'00') → decriptat la 'DECRYPTED'.
    expect(obs.value).toBe('DECRYPTED');
    // Coloane non-criptate: copiate verbatim.
    expect(obs.unit).toBe('mg');
    expect(obs.category).toBe('altele');
    expect(obs.confidence).toBe(0.9);
    expect(obs.created_at).toBe('t');

    // Mesajul chat: content_enc avea bytes → decriptat.
    const msg = raw.prepare('SELECT content FROM medical_chat_messages WHERE id = ?').get('m1') as {
      content: string;
    };
    expect(msg.content).toBe('DECRYPTED');
  });

  it('yields NULL (not a placeholder) for a NULL optional encrypted blob', async () => {
    const raw = new Database(':memory:');
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
      INSERT INTO medical_observations
        (id, medical_record_id, source_document_id, name_enc, value_enc, unit, ref_min_enc,
         ref_max_enc, observed_at, category, confidence, needs_review, user_corrected, created_at, updated_at)
        VALUES ('o1','r1',NULL, X'00', NULL, 'mg', NULL, NULL, '2026-01-01', 'altele', 0.9, 0, 0, 't','t');
    `);
    const adb = makeAsyncDb(raw);

    await migrateMedicalEncToPlaintext(adb as never);

    const obs = raw
      .prepare('SELECT name, value FROM medical_observations WHERE id = ?')
      .get('o1') as {
      name: string;
      value: string | null;
    };
    expect(obs.name).toBe('DECRYPTED');
    // value_enc era NULL → toBytes(null) → null → decryptFieldOrNull întoarce null → value NULL (nu placeholder).
    expect(obs.value).toBeNull();
  });
});
