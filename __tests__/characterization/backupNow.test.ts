/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — „Backup acum" întoarce ce s-a întâmplat de fapt.
 *
 * Regresia (audit UX backup 2026-10-14): `backupNow()` nu întorcea nimic, iar
 * ecranul citea `cloud.status` / `cloud.error` din render-ul de dinainte de apăsare.
 * Un eșec — inclusiv „parolă necesară" — afișa „Backup finalizat.".
 *
 * Fluxul real (processQueue → uploadManifestIfChanged → maybeSnapshot) peste un
 * iCloud în memorie.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));
jest.mock('expo-crypto', () => require('../helpers/memoryMocks').nodeExpoCrypto());
jest.mock('expo-secure-store', () => require('../helpers/memoryMocks').memorySecureStore());
jest.mock('@react-native-async-storage/async-storage', () =>
  require('../helpers/memoryMocks').memoryAsyncStorage()
);
jest.mock('@/services/cloudStorage', () => require('../helpers/memoryMocks').memoryCloudStorage());

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let runBackupNow: typeof import('@/services/cloud/backupNow').runBackupNow;
let cloudSyncModule: typeof import('@/services/cloudSync');
let crypto: typeof import('@/services/cloudCrypto');
let settings: typeof import('@/services/settings');
let cloud: {
  __files: Map<string, string>;
  isAvailable: jest.Mock;
  writeFile: jest.Mock;
};
let fs: { getInfoAsync: jest.Mock; readAsStringAsync: jest.Mock };
let resetSecureStore: () => void;
let resetAsyncStorage: () => void;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    runBackupNow = require('@/services/cloud/backupNow').runBackupNow;
    cloudSyncModule = require('@/services/cloudSync');
    crypto = require('@/services/cloudCrypto');
    settings = require('@/services/settings');
    cloud = require('@/services/cloudStorage');
    fs = require('expo-file-system/legacy');
    resetSecureStore = require('expo-secure-store').__reset;
    resetAsyncStorage = require('@react-native-async-storage/async-storage').__reset;
  });
});

const META = 'Dosar/manifest.meta.json';
const MANIFEST = 'Dosar/manifest.json';
const ON_DISK = 'documents/talon.jpg';
const MISSING = 'documents/rca.jpg';
const TS = '2026-01-01T00:00:00Z';

beforeEach(async () => {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_') || t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
  testDb._raw.prepare("INSERT INTO cloud_state (id, device_id) VALUES (1, 'device-A')").run();

  cloud.__files.clear();
  cloud.isAvailable.mockResolvedValue(true);
  cloud.writeFile.mockImplementation(async (p: string, data: string) => {
    cloud.__files.set(p, data);
  });
  resetSecureStore();
  resetAsyncStorage();
  crypto.setSessionKey(null);
  fs.getInfoAsync.mockImplementation(async (uri: string) =>
    uri.endsWith(ON_DISK) ? { exists: true, isDirectory: false, size: 10 } : { exists: false }
  );
  fs.readAsStringAsync.mockResolvedValue(Buffer.from('poza').toString('base64'));

  await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
    'v-1',
    'Logan',
    TS,
  ]);
});

async function addDocument(id: string, filePath: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO documents (id, type, vehicle_id, file_path, created_at) VALUES (?, 'talon', 'v-1', ?, ?)`,
    [id, filePath, TS]
  );
}

describe('runBackupNow', () => {
  it('raportează succes doar când fișierele și manifestul sunt în iCloud', async () => {
    await addDocument('d-1', ON_DISK);

    const result = await runBackupNow();

    expect(result).toEqual({
      ok: true,
      failedFiles: 0,
      error: null,
      passwordRequired: false,
      quotaExceeded: false,
    });
    expect(cloud.__files.has(MANIFEST)).toBe(true);
    expect(cloud.__files.has(META)).toBe(true);
  });

  it('un fișier care nu a putut fi urcat face backup-ul incomplet, nu reușit', async () => {
    await addDocument('d-1', ON_DISK);
    await addDocument('d-2', MISSING);

    const result = await runBackupNow();

    expect(result.ok).toBe(false);
    expect(result.failedFiles).toBe(1);
    expect(result.error).toBeNull();
    // Restul backup-ului a ajuns totuși în iCloud.
    expect(cloud.__files.has(MANIFEST)).toBe(true);
  });

  it('backup criptat cu sesiunea blocată: cere parola și nu consumă încercările fișierelor', async () => {
    await addDocument('d-1', ON_DISK);
    await crypto.setupPassword('parola-buna');
    await settings.setCloudEncryptionEnabled(true);
    await db.runAsync(
      'INSERT INTO pending_uploads (file_path, attempt_count, created_at) VALUES (?, 0, ?)',
      [ON_DISK, Date.now()]
    );

    const result = await runBackupNow();

    expect(result.ok).toBe(false);
    expect(result.passwordRequired).toBe(true);
    expect(result.error).toMatch(/Parolă/);
    expect(cloud.__files.size).toBe(0);
    const row = await db.getFirstAsync<{ attempt_count: number }>(
      'SELECT attempt_count FROM pending_uploads WHERE file_path = ?',
      [ON_DISK]
    );
    expect(row?.attempt_count).toBe(0);
  });

  it('iCloud indisponibil nu e raportat ca succes', async () => {
    cloud.isAvailable.mockResolvedValue(false);

    const result = await runBackupNow();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/iCloud nu este disponibil/);
  });

  it('iCloud plin: eroare + semnal pentru banner', async () => {
    await addDocument('d-1', ON_DISK);
    cloud.writeFile.mockRejectedValue(new Error('NSFileWriteOutOfSpaceError'));

    const result = await runBackupNow();

    expect(result.ok).toBe(false);
    expect(result.quotaExceeded).toBe(true);
    expect(result.error).toMatch(/spațiu/);
  });
});

describe('uploadManifestIfChanged — dedup după conținut', () => {
  it('un al doilea upload fără modificări nu re-urcă manifestul', async () => {
    const { uploadManifestIfChanged } = cloudSyncModule;
    expect(await uploadManifestIfChanged()).toBe(true);
    await new Promise(r => setTimeout(r, 5)); // altă oră în exportDate

    expect(await uploadManifestIfChanged()).toBe(false);

    await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
      'v-2',
      'Dacia',
      TS,
    ]);
    expect(await uploadManifestIfChanged()).toBe(true);
  });
});
