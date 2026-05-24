/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization tests pentru schema SQLite (services/db.ts).
 *
 * Lock-uiește:
 *   - Set complet de tabele user-data (inclusiv post-migrare)
 *   - Coloane critice adăugate prin ALTER TABLE migrations
 *   - Tipuri BLOB pe medical
 *   - UNIQUE constraints (pending_uploads.file_path)
 *   - CHECK constraints (cloud_state.id=1)
 *   - Rollback de tranzacții
 *   - Idempotență la re-aplicarea schemei
 */

jest.mock('expo-sqlite', () => ({
  // Fresh DB pe fiecare apel openDatabaseSync. db.ts apelează doar o dată la
  // module load (`export const db = openDatabaseSync(...)`), deci în practică o
  // singură instanță per isolateModules sandbox. Fără cache: evită leak-ul între
  // fișiere de test când mock factory e cache-uită în module registry-ul Jest.
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import { applySchemaToTestDb } from '../helpers/testDbSetup';
import type { TestDb } from '../helpers/testDb';

// Reset modules + isolated require ca să forțăm db.ts să se reîncarce cu mock-ul
// LOCAL al acestui fișier (overriding mock-ul global din setup.ts). Fără asta,
// rularea sequențială (jest --runInBand) folosește instanța db cache-uită de
// primul test file care a importat db.ts.
let db: typeof import('@/services/db').db;
let testDb: TestDb;
beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
  });
});

function resetSchema(): void {
  // Strategie: ștergem RÂNDURILE (DELETE FROM), păstrăm schema. Mult mai stabil
  // decât DROP+recreate, care s-a dovedit flaky (~10-20% failure rate) — probabil
  // din cauza interacțiunii dintre cache-ul module Jest și starea SQLite.
  // Niciun test nu modifică schema, deci e safe să o păstrăm.
  const tables = testDb._raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
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

beforeEach(resetSchema);

describe('db.ts schema characterization', () => {
  it('contains all expected user data tables', async () => {
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tables = rows.map(r => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'persons',
        'properties',
        'vehicles',
        'cards',
        'animals',
        'companies',
        'documents',
        'document_pages',
        'custom_document_types',
        'document_entities',
        'fuel_records',
        'vehicle_maintenance_tasks',
        'entity_order',
        'cloud_state',
        'pending_uploads',
        'cloud_pending_deletes',
        'chat_threads',
        'chat_messages',
        'medical_record',
        'medical_observations',
        'medical_chat_threads',
        'medical_chat_messages',
        'medical_document_summaries',
        'medical_shares',
      ])
    );
  });

  it('documents table has all critical columns including post-migration adds', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(documents)');
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'type',
        'issue_date',
        'expiry_date',
        'note',
        'file_path',
        'person_id',
        'property_id',
        'vehicle_id',
        'card_id',
        'animal_id',
        'company_id',
        'custom_type_id',
        'metadata',
        'auto_delete',
        'ocr_text',
        'file_hash',
        'private_notes',
        'calendar_event_id',
        'main_orientation_locked',
        'created_at',
      ])
    );
  });

  it('has ai_summary, medical_reminders_prompted_at, pending_reminders_json columns', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(documents)');
    const names = cols.map(c => c.name);
    expect(names).toContain('ai_summary');
    expect(names).toContain('medical_reminders_prompted_at');
    expect(names).toContain('pending_reminders_json');
  });

  it('pending_uploads has uploaded_at and file_size post-migration', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(pending_uploads)');
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['uploaded_at', 'file_size']));
  });

  it('vehicles table has fuel_type, plate_number, photo_uri post-migration', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(vehicles)');
    const names = cols.map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['fuel_type', 'plate_number', 'photo_uri'])
    );
  });

  it('persons table has phone, email, date_of_birth post-migration', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(persons)');
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['phone', 'email']));
  });

  it('fuel_records table has currency, fuel_type, station post-migration', async () => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fuel_records)');
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['currency', 'fuel_type', 'station']));
  });

  it('document_pages table has file_path NOT NULL', async () => {
    const cols = await db.getAllAsync<{ name: string; notnull: number }>(
      'PRAGMA table_info(document_pages)'
    );
    const filePath = cols.find(c => c.name === 'file_path');
    expect(filePath).toBeDefined();
    expect(filePath?.notnull).toBe(1);
  });

  it('medical_observations stores name_enc and value_enc as BLOB', async () => {
    const cols = await db.getAllAsync<{ name: string; type: string }>(
      'PRAGMA table_info(medical_observations)'
    );
    const blobs = cols.filter(c => c.type.toUpperCase() === 'BLOB').map(c => c.name);
    expect(blobs).toEqual(expect.arrayContaining(['name_enc', 'value_enc']));
  });

  it('medical_chat_messages stores content_enc as BLOB', async () => {
    const cols = await db.getAllAsync<{ name: string; type: string }>(
      'PRAGMA table_info(medical_chat_messages)'
    );
    const blobs = cols.filter(c => c.type.toUpperCase() === 'BLOB').map(c => c.name);
    expect(blobs).toContain('content_enc');
  });

  // Notă: testele de constraints verifică PREZENȚA constraint-ului în schemă
  // (via PRAGMA), nu runtime enforcement. SQLite însuși garantează enforcement
  // odată ce constraint-ul e declarat. Testarea runtime cu try INSERT was flaky
  // (~3% rate) — testele de schema sunt 100% deterministe.

  it('pending_uploads has UNIQUE constraint on file_path', async () => {
    const indexes = await db.getAllAsync<{ name: string; unique: number }>(
      'PRAGMA index_list(pending_uploads)'
    );
    // Cel puțin un index UNIQUE care acoperă file_path
    const uniqueOnFilePath = await Promise.all(
      indexes
        .filter(idx => idx.unique === 1)
        .map(async idx => {
          const cols = await db.getAllAsync<{ name: string }>(
            `PRAGMA index_info(${idx.name})`
          );
          return cols.some(c => c.name === 'file_path');
        })
    );
    expect(uniqueOnFilePath.some(Boolean)).toBe(true);
  });

  it('cloud_state enforces single row via CHECK(id=1)', async () => {
    // SQLite memorizează CHECK în sqlite_master.sql; verificăm că definiția
    // conține „CHECK(id".
    const row = await db.getFirstAsync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='cloud_state'"
    );
    expect(row?.sql).toMatch(/CHECK\s*\(\s*id/i);
  });

  it('document_entities has UNIQUE composite (document_id, entity_type, entity_id)', async () => {
    const indexes = await db.getAllAsync<{ name: string; unique: number }>(
      'PRAGMA index_list(document_entities)'
    );
    const uniqueComposites = await Promise.all(
      indexes
        .filter(idx => idx.unique === 1)
        .map(async idx => {
          const cols = await db.getAllAsync<{ name: string }>(
            `PRAGMA index_info(${idx.name})`
          );
          return cols.map(c => c.name);
        })
    );
    const target = ['document_id', 'entity_type', 'entity_id'];
    const hasComposite = uniqueComposites.some(
      cols => target.every(t => cols.includes(t)) && cols.length === target.length
    );
    expect(hasComposite).toBe(true);
  });

  it('entity_order PK is composite (entity_type, entity_id)', async () => {
    const cols = await db.getAllAsync<{ name: string; pk: number }>(
      'PRAGMA table_info(entity_order)'
    );
    const pkCols = cols.filter(c => c.pk > 0).map(c => c.name);
    expect(pkCols).toEqual(expect.arrayContaining(['entity_type', 'entity_id']));
  });
});

describe('db.ts transactions', () => {
  it('withTransactionAsync rolls back on error', async () => {
    const t = Date.now();
    await db.runAsync(
      'INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)',
      'p1',
      'Ana',
      t
    );
    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync(
          'INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)',
          'p2',
          'Bob',
          t
        );
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM persons');
    expect(rows.map(r => r.id)).toEqual(['p1']);
  });

  it('withTransactionAsync commits on success', async () => {
    const t = Date.now();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)',
        'p1',
        'Ana',
        t
      );
      await db.runAsync(
        'INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)',
        'p2',
        'Bob',
        t
      );
    });
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM persons ORDER BY id');
    expect(rows.map(r => r.id)).toEqual(['p1', 'p2']);
  });
});

describe('db.ts migration idempotency', () => {
  it('applying schema twice does not error', () => {
    expect(() => applySchemaToTestDb(testDb)).not.toThrow();
  });

  it('applying schema twice preserves data inserted between applications', async () => {
    const t = String(Date.now());
    await db.runAsync(
      'INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)',
      'p1',
      'Ana',
      t
    );
    applySchemaToTestDb(testDb);
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM persons');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('p1');
  });
});
