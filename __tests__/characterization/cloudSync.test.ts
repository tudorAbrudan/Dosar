/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization tests pentru cloudSync.ts.
 *
 * Lock-uiește comportamentul cozii de upload (pending_uploads):
 *   - enqueueFileUpload e idempotent (ON CONFLICT)
 *   - re-enqueue resetează attempt_count și uploaded_at (recovery la re-try)
 *   - dequeueFileDelete elimină din pending_uploads
 *   - guard pe filePath empty (no-op)
 *   - paths diferite produc rânduri separate
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
import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let enqueueFileUpload: typeof import('@/services/cloudSync').enqueueFileUpload;
let dequeueFileDelete: typeof import('@/services/cloudSync').dequeueFileDelete;
beforeAll(() => {
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    const cs = require('@/services/cloudSync');
    enqueueFileUpload = cs.enqueueFileUpload;
    dequeueFileDelete = cs.dequeueFileDelete;
  });
});

function resetSchema(): void {
  const tables = testDb._raw
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index')")
    .all() as { name: string; type: string }[];
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
      /* virtual tables */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
  applySchemaToTestDb(testDb);
}

beforeEach(resetSchema);

describe('cloudSync enqueueFileUpload', () => {
  it('inserts a new row in pending_uploads', async () => {
    await enqueueFileUpload('docs/a.jpg');
    const rows = await db.getAllAsync<{ file_path: string; attempt_count: number }>(
      'SELECT file_path, attempt_count FROM pending_uploads'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ file_path: 'docs/a.jpg', attempt_count: 0 });
  });

  it('is idempotent per file_path — multiple enqueues produce 1 row', async () => {
    await enqueueFileUpload('docs/a.jpg');
    await enqueueFileUpload('docs/a.jpg');
    await enqueueFileUpload('docs/a.jpg');
    const rows = await db.getAllAsync('SELECT * FROM pending_uploads');
    expect(rows).toHaveLength(1);
  });

  it('different file_paths produce separate rows', async () => {
    await enqueueFileUpload('docs/a.jpg');
    await enqueueFileUpload('docs/b.jpg');
    await enqueueFileUpload('docs/c.jpg');
    const rows = await db.getAllAsync<{ file_path: string }>(
      'SELECT file_path FROM pending_uploads ORDER BY file_path'
    );
    expect(rows.map(r => r.file_path)).toEqual(['docs/a.jpg', 'docs/b.jpg', 'docs/c.jpg']);
  });

  it('re-enqueue resets attempt_count and uploaded_at', async () => {
    // Insert with attempt_count=3 and uploaded_at set (simulate prior upload)
    await db.runAsync(
      `INSERT INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at, last_error)
       VALUES (?, ?, ?, ?, ?)`,
      'docs/a.jpg',
      3,
      Date.now(),
      Date.now(),
      'previous error'
    );
    await enqueueFileUpload('docs/a.jpg');
    const row = await db.getFirstAsync<{
      attempt_count: number;
      uploaded_at: number | null;
      last_error: string | null;
    }>('SELECT attempt_count, uploaded_at, last_error FROM pending_uploads WHERE file_path = ?', [
      'docs/a.jpg',
    ]);
    expect(row?.attempt_count).toBe(0);
    expect(row?.uploaded_at).toBeNull();
    expect(row?.last_error).toBeNull();
  });

  it('guards against empty filePath (no-op)', async () => {
    await enqueueFileUpload('');
    const rows = await db.getAllAsync('SELECT * FROM pending_uploads');
    expect(rows).toHaveLength(0);
  });
});

describe('cloudSync dequeueFileDelete', () => {
  it('removes the file from pending_uploads', async () => {
    await enqueueFileUpload('docs/a.jpg');
    await enqueueFileUpload('docs/b.jpg');
    await dequeueFileDelete('docs/a.jpg');
    const rows = await db.getAllAsync<{ file_path: string }>(
      'SELECT file_path FROM pending_uploads'
    );
    expect(rows.map(r => r.file_path)).toEqual(['docs/b.jpg']);
  });

  it('is a no-op for a file that was never enqueued', async () => {
    await expect(dequeueFileDelete('docs/never.jpg')).resolves.toBeUndefined();
    expect((await db.getAllAsync('SELECT * FROM pending_uploads')).length).toBe(0);
  });

  it('guards against empty filePath (no-op)', async () => {
    await enqueueFileUpload('docs/a.jpg');
    await dequeueFileDelete('');
    expect((await db.getAllAsync('SELECT * FROM pending_uploads')).length).toBe(1);
  });
});

describe('cloudSync pending_uploads created_at tracking', () => {
  it('records created_at as Date.now() in milliseconds', async () => {
    const before = Date.now();
    await enqueueFileUpload('docs/x.jpg');
    const after = Date.now();
    const row = await db.getFirstAsync<{ created_at: number }>(
      'SELECT created_at FROM pending_uploads WHERE file_path = ?',
      ['docs/x.jpg']
    );
    expect(row).not.toBeNull();
    expect(row!.created_at).toBeGreaterThanOrEqual(before);
    expect(row!.created_at).toBeLessThanOrEqual(after);
  });
});
