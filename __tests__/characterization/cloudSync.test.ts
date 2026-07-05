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

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import { applySchemaToTestDb } from '../helpers/testDbSetup';
import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let enqueueFileUpload: typeof import('@/services/cloudSync').enqueueFileUpload;
let dequeueFileDelete: typeof import('@/services/cloudSync').dequeueFileDelete;
let buildManifestPayload: typeof import('@/services/cloudSync').buildManifestPayload;
let resolveRemoteRel: typeof import('@/services/cloudSync').resolveRemoteRel;
let reconcileRenamedFiles: typeof import('@/services/cloudSync').reconcileRenamedFiles;
let markCloudBackupForReupload: typeof import('@/services/cloudSync').markCloudBackupForReupload;
let getCloudState: typeof import('@/services/cloudSync').getCloudState;
beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    const cs = require('@/services/cloudSync');
    enqueueFileUpload = cs.enqueueFileUpload;
    dequeueFileDelete = cs.dequeueFileDelete;
    buildManifestPayload = cs.buildManifestPayload;
    resolveRemoteRel = cs.resolveRemoteRel;
    reconcileRenamedFiles = cs.reconcileRenamedFiles;
    markCloudBackupForReupload = cs.markCloudBackupForReupload;
    getCloudState = cs.getCloudState;
  });
});

function resetSchema(): void {
  // Vezi nota din db.test.ts despre DELETE vs DROP — folosim DELETE pentru stabilitate.
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

describe('cloudSync buildManifestPayload — reminders', () => {
  it('includes reminders in manifest payload', async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync(
      `INSERT OR IGNORE INTO documents (id, type, created_at) VALUES ('d-1', 'analize', '2026-01-01T00:00:00Z')`
    );
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES ('r-1', 'medical_ai', 'd-1', 'Control', '2026-07-01', 'ai', '2026-01-01T00:00:00Z')`
    );
    const payload = await buildManifestPayload();
    expect(payload.reminders).toHaveLength(1);
    expect(payload.reminders[0].id).toBe('r-1');
  });

  it('returns empty reminders array when table is empty', async () => {
    await db.runAsync('DELETE FROM reminders');
    const payload = await buildManifestPayload();
    expect(Array.isArray(payload.reminders)).toBe(true);
    expect(payload.reminders).toHaveLength(0);
  });
});

describe('cloud structured files (v4)', () => {
  it('buildManifestPayload includes a structured fileMap (version 4)', async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO vehicles (id, name, created_at) VALUES ('v-1', 'Dacia', '2026-01-01T00:00:00Z')`
    );
    await db.runAsync(
      `INSERT INTO documents (id, type, vehicle_id, file_path, created_at)
       VALUES ('d-1', 'rca', 'v-1', 'documents/a.jpg', '2026-01-01T00:00:00Z')`
    );

    const payload = await buildManifestPayload();
    expect(payload.version).toBe(4);
    expect(payload.fileMap['documents/a.jpg']).toBe('Dacia/RCA/a.jpg');
  });

  it('resolveRemoteRel falls back to flat basename for v3 manifests (empty fileMap)', () => {
    expect(resolveRemoteRel({}, 'documents/a.jpg')).toBe('a.jpg');
  });

  it('resolveRemoteRel returns the structured path for v4 manifests', () => {
    expect(resolveRemoteRel({ 'documents/a.jpg': 'Dacia/RCA/a.jpg' }, 'documents/a.jpg')).toBe(
      'Dacia/RCA/a.jpg'
    );
  });
});

describe('cloudSync markCloudBackupForReupload (re-criptare la schimbarea criptării)', () => {
  beforeEach(async () => {
    // resetSchema golește cloud_state; re-seed rândul single-row (id=1) cu un hash vechi.
    await db.runAsync(
      `INSERT INTO cloud_state (id, last_manifest_hash, device_id) VALUES (1, 'oldhash', 'dev-1')`
    );
  });

  it('invalidates the cached manifest hash so the manifest re-uploads', async () => {
    await markCloudBackupForReupload();
    const state = await getCloudState();
    // null ≠ orice hash real → uploadManifestIfChanged nu mai sare upload-ul
    // (manifest + meta.encrypted se re-urcă cu noua stare de criptare).
    expect(state.last_manifest_hash).toBeNull();
  });

  it('resets uploaded_at/attempt_count/last_error for synced rows, preserving uploaded_remote_path', async () => {
    // Fișier deja sincronizat (plaintext, urcat înainte de activarea criptării).
    await db.runAsync(
      `INSERT INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at, last_error, uploaded_remote_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'documents/a.jpg',
      2,
      Date.now(),
      Date.now(),
      'ceva vechi',
      'Dacia/RCA/a.jpg'
    );

    const changed = await markCloudBackupForReupload();
    expect(changed).toBe(1);

    const row = await db.getFirstAsync<{
      uploaded_at: number | null;
      attempt_count: number;
      last_error: string | null;
      uploaded_remote_path: string | null;
    }>(
      'SELECT uploaded_at, attempt_count, last_error, uploaded_remote_path FROM pending_uploads WHERE file_path = ?',
      ['documents/a.jpg']
    );
    // Marcat pentru re-upload: processQueue îl va re-urca criptat la ACEEAȘI cale
    // remote (suprascrie plaintext-ul), fiindcă uploaded_remote_path e păstrat.
    expect(row?.uploaded_at).toBeNull();
    expect(row?.attempt_count).toBe(0);
    expect(row?.last_error).toBeNull();
    expect(row?.uploaded_remote_path).toBe('Dacia/RCA/a.jpg');
  });

  it('leaves rows that are not yet uploaded untouched', async () => {
    await db.runAsync(
      `INSERT INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at)
       VALUES (?, ?, ?, ?)`,
      'documents/pending.jpg',
      1,
      Date.now(),
      null
    );

    const changed = await markCloudBackupForReupload();
    expect(changed).toBe(0);

    const row = await db.getFirstAsync<{ attempt_count: number; uploaded_at: number | null }>(
      'SELECT attempt_count, uploaded_at FROM pending_uploads WHERE file_path = ?',
      ['documents/pending.jpg']
    );
    // Nesincronizat → intact (processQueue oricum îl procesează normal).
    expect(row?.attempt_count).toBe(1);
    expect(row?.uploaded_at).toBeNull();
  });
});

describe('cloud rename-move reconcile', () => {
  it('re-queues a synced row whose structured target changed (uploaded_at reset to NULL)', async () => {
    // Synced file currently living at Dacia/RCA/a.jpg.
    await db.runAsync(
      `INSERT INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at, uploaded_remote_path)
       VALUES (?, ?, ?, ?, ?)`,
      'documents/a.jpg',
      0,
      Date.now(),
      Date.now(),
      'Dacia/RCA/a.jpg'
    );

    // Entity renamed Dacia → Logan: structured target differs from the real location.
    await reconcileRenamedFiles({ 'documents/a.jpg': 'Logan/RCA/a.jpg' });

    const row = await db.getFirstAsync<{
      uploaded_at: number | null;
      uploaded_remote_path: string | null;
    }>(
      'SELECT uploaded_at, uploaded_remote_path FROM pending_uploads WHERE file_path = ?',
      ['documents/a.jpg']
    );
    // Re-queued for move; old location preserved so processOne grace-deletes it.
    expect(row?.uploaded_at).toBeNull();
    expect(row?.uploaded_remote_path).toBe('Dacia/RCA/a.jpg');
  });

  it('does NOT reset a row whose structured target equals its current location', async () => {
    await db.runAsync(
      `INSERT INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at, uploaded_remote_path)
       VALUES (?, ?, ?, ?, ?)`,
      'documents/b.jpg',
      0,
      Date.now(),
      Date.now(),
      'Dacia/RCA/b.jpg'
    );

    await reconcileRenamedFiles({ 'documents/b.jpg': 'Dacia/RCA/b.jpg' });

    const row = await db.getFirstAsync<{ uploaded_at: number | null }>(
      'SELECT uploaded_at FROM pending_uploads WHERE file_path = ?',
      ['documents/b.jpg']
    );
    expect(row?.uploaded_at).not.toBeNull();
  });
});
