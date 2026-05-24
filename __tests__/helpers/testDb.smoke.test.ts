import { createTestDbInstance } from './testDb';
import { applySchemaToTestDb } from './testDbSetup';

describe('test DB infrastructure', () => {
  it('opens an in-memory DB and round-trips a simple value', () => {
    const db = createTestDbInstance();
    db._raw.exec('CREATE TABLE t (id INTEGER)');
    db._raw.prepare('INSERT INTO t VALUES (?)').run(42);
    const row = db._raw.prepare('SELECT id FROM t').get() as { id: number };
    expect(row.id).toBe(42);
    db.closeSync();
  });

  it('applySchemaToTestDb creates expected tables from db.ts', () => {
    const db = createTestDbInstance();
    applySchemaToTestDb(db);
    const tables = (
      db._raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map(r => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'persons',
        'properties',
        'vehicles',
        'cards',
        'documents',
        'animals',
        'companies',
        'custom_document_types',
        'document_pages',
        'fuel_records',
        'vehicle_maintenance_tasks',
        'entity_order',
        'cloud_state',
        'pending_uploads',
      ])
    );
  });

  it('expo-sqlite-compatible API works (runAsync + getAllAsync, positional and array params)', async () => {
    const db = createTestDbInstance();
    await db.execAsync('CREATE TABLE x (id INTEGER, name TEXT)');
    await db.runAsync('INSERT INTO x VALUES (?, ?)', 1, 'a');
    await db.runAsync('INSERT INTO x VALUES (?, ?)', [2, 'b']); // array form
    const rows = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT * FROM x ORDER BY id'
    );
    expect(rows).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
  });

  it('withTransactionAsync rolls back on error', async () => {
    const db = createTestDbInstance();
    await db.execAsync('CREATE TABLE x (id INTEGER)');
    await db.runAsync('INSERT INTO x VALUES (?)', 1);
    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO x VALUES (?)', 2);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM x');
    expect(rows.map(r => r.id)).toEqual([1]);
  });
});
