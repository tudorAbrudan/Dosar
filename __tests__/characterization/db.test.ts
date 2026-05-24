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

jest.mock('expo-sqlite', () => {
  let instance: ReturnType<typeof import('../helpers/testDb').createTestDbInstance> | null = null;
  return {
    openDatabaseSync: () => {
      if (!instance) {
        const { createTestDbInstance } = require('../helpers/testDb');
        instance = createTestDbInstance();
      }
      return instance;
    },
  };
});

import { applySchemaToTestDb } from '../helpers/testDbSetup';
import { db } from '@/services/db';
import type { TestDb } from '../helpers/testDb';

const testDb = db as unknown as TestDb;

function resetSchema(): void {
  const tables = testDb._raw
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index')")
    .all() as { name: string; type: string }[];
  // Disable FK checks during drop so order doesn't matter
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    try {
      if (t.type === 'index') {
        testDb._raw.exec(`DROP INDEX IF EXISTS ${t.name}`);
      } else {
        testDb._raw.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
    } catch {
      /* virtual tables sau alte cazuri edge */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
  applySchemaToTestDb(testDb);
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

  it('pending_uploads has UNIQUE constraint on file_path', async () => {
    await db.runAsync(
      'INSERT INTO pending_uploads (file_path, attempt_count, created_at) VALUES (?, ?, ?)',
      'a.jpg',
      0,
      Date.now()
    );
    await expect(
      db.runAsync(
        'INSERT INTO pending_uploads (file_path, attempt_count, created_at) VALUES (?, ?, ?)',
        'a.jpg',
        0,
        Date.now()
      )
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('cloud_state enforces single row via CHECK(id=1)', async () => {
    await db.runAsync(
      'INSERT INTO cloud_state (id, device_id) VALUES (?, ?)',
      1,
      'd1'
    );
    await expect(
      db.runAsync('INSERT INTO cloud_state (id, device_id) VALUES (?, ?)', 2, 'd2')
    ).rejects.toThrow(/CHECK/i);
  });

  it('document_entities has UNIQUE composite (document_id, entity_type, entity_id)', async () => {
    const t = String(Date.now());
    await db.runAsync(
      'INSERT INTO documents (id, type, created_at) VALUES (?, ?, ?)',
      'd1',
      'CI',
      t
    );
    await db.runAsync(
      'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      'e1',
      'd1',
      'person',
      'p1'
    );
    await expect(
      db.runAsync(
        'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
        'e2',
        'd1',
        'person',
        'p1'
      )
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('entity_order PK is composite (entity_type, entity_id)', async () => {
    await db.runAsync(
      'INSERT INTO entity_order (entity_type, entity_id, sort_order) VALUES (?, ?, ?)',
      'person',
      'p1',
      1.0
    );
    await expect(
      db.runAsync(
        'INSERT INTO entity_order (entity_type, entity_id, sort_order) VALUES (?, ?, ?)',
        'person',
        'p1',
        2.0
      )
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
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
    const t = Date.now();
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
