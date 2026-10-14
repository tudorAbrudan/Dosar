/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — restaurarea unui backup iCloud CRIPTAT pe un telefon nou.
 *
 * Regresia (audit UX backup 2026-10-14): salt-ul și verificatorul parolei stăteau
 * doar în SecureStore-ul telefonului care a făcut backup-ul. Pe un telefon nou,
 * parola corectă primea „Criptarea nu este configurată", iar după o restaurare
 * flag-ul local de criptare rămânea oprit → următorul upload scria un manifest
 * necriptat peste fișierele criptate.
 *
 * Fluxul e cel real (processQueue → uploadManifestIfChanged → restoreFromCloud →
 * applyManifest) peste un iCloud în memorie, SecureStore și AsyncStorage în memorie.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const randomBytes = (n: number) => {
    const buf = nodeCrypto.randomBytes(n);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  return {
    getRandomBytes: jest.fn(randomBytes),
    getRandomBytesAsync: jest.fn(async (n: number) => randomBytes(n)),
    digestStringAsync: jest.fn(async (_alg: string, s: string) =>
      nodeCrypto.createHash('sha256').update(s).digest('hex')
    ),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex' },
    randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    __reset: () => store.clear(),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
      multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, store.get(k) ?? null])),
      multiSet: jest.fn(async () => undefined),
      clear: jest.fn(async () => store.clear()),
    },
    __reset: () => store.clear(),
  };
});

/** iCloud Documents în memorie: cale → conținut (utf8 sau base64, ca string). */
jest.mock('@/services/cloudStorage', () => {
  const files = new Map<string, string>();
  return {
    __files: files,
    isAvailable: jest.fn(async () => true),
    exists: jest.fn(async (p: string) => files.has(p)),
    readFile: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    }),
    writeFile: jest.fn(async (p: string, data: string) => {
      files.set(p, data);
    }),
    deleteFile: jest.fn(async (p: string) => {
      files.delete(p);
    }),
    listDir: jest.fn(async (prefix: string) =>
      Array.from(files.keys())
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length))
        .filter(k => !k.includes('/'))
    ),
    ensureParentDir: jest.fn(async () => undefined),
    fileSize: jest.fn(async (p: string) => files.get(p)?.length ?? 0),
  };
});

import type { TestDb } from '../helpers/testDb';
import type { CloudManifestMeta } from '@/types';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let cloudSync: typeof import('@/services/cloudSync');
let crypto: typeof import('@/services/cloudCrypto');
let settings: typeof import('@/services/settings');
let fs: {
  getInfoAsync: jest.Mock;
  readAsStringAsync: jest.Mock;
  writeAsStringAsync: jest.Mock;
};
let cloudFiles: Map<string, string>;
let resetSecureStore: () => void;
let resetAsyncStorage: () => void;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    cloudSync = require('@/services/cloudSync');
    crypto = require('@/services/cloudCrypto');
    settings = require('@/services/settings');
    fs = require('expo-file-system/legacy');
    cloudFiles = require('@/services/cloudStorage').__files;
    resetSecureStore = require('expo-secure-store').__reset;
    resetAsyncStorage = require('@react-native-async-storage/async-storage').__reset;
  });
});

const META = 'Dosar/manifest.meta.json';
const MANIFEST = 'Dosar/manifest.json';
const FILE_REL = 'documents/rca.jpg';
const FILE_URI = `file:///test/Documents/${FILE_REL}`;
const PLAIN_B64 = Buffer.from('poza talon').toString('base64');
const TS = '2026-01-01T00:00:00Z';

function resetLocalDb(deviceId: string): void {
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
  testDb._raw.prepare('INSERT INTO cloud_state (id, device_id) VALUES (1, ?)').run(deviceId);
}

/** Telefon nou: fără date, fără SecureStore, fără setări, sesiunea blocată. */
function newPhone(deviceId: string): void {
  resetLocalDb(deviceId);
  resetSecureStore();
  resetAsyncStorage();
  crypto.setSessionKey(null);
  fs.getInfoAsync.mockResolvedValue({ exists: false, isDirectory: false });
  fs.writeAsStringAsync.mockClear();
}

async function seedVehicleWithPhoto(): Promise<void> {
  await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
    'v-1',
    'Logan',
    TS,
  ]);
  await db.runAsync(
    `INSERT INTO documents (id, type, vehicle_id, file_path, created_at) VALUES (?, 'talon', ?, ?, ?)`,
    ['d-1', 'v-1', FILE_REL, TS]
  );
  await db.runAsync(
    'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    ['de-1', 'd-1', 'vehicle', 'v-1']
  );
}

/** Telefonul A face un backup complet (fișiere + manifest), criptat sau nu. */
async function backupFromPhoneA(password: string | null): Promise<void> {
  newPhone('device-A');
  await seedVehicleWithPhoto();
  if (password) {
    crypto.setSessionKey(await crypto.setupPassword(password));
    await settings.setCloudEncryptionEnabled(true);
  }
  fs.getInfoAsync.mockImplementation(async (uri: string) =>
    uri === FILE_URI ? { exists: true, isDirectory: false, size: 10 } : { exists: false }
  );
  fs.readAsStringAsync.mockImplementation(async (uri: string) =>
    uri === FILE_URI ? PLAIN_B64 : ''
  );
  await cloudSync.processQueue();
  expect(await cloudSync.uploadManifestIfChanged()).toBe(true);
}

function cloudMeta(): CloudManifestMeta {
  return JSON.parse(cloudFiles.get(META) as string) as CloudManifestMeta;
}

beforeEach(() => {
  cloudFiles.clear();
});

describe('backup criptat — restaurare pe telefon nou', () => {
  it('meta.json conține salt-ul și verificatorul parolei', async () => {
    await backupFromPhoneA('parola-buna');
    const meta = cloudMeta();
    expect(meta.encrypted).toBe(true);
    expect(meta.encryption).toEqual(await crypto.getEncryptionParams());
    // Manifestul în sine e criptat.
    expect(() => JSON.parse(cloudFiles.get(MANIFEST) as string)).toThrow();
  });

  it('cere parola, o verifică din meta și restaurează datele și fișierele', async () => {
    await backupFromPhoneA('parola-buna');
    newPhone('device-B');

    await expect(cloudSync.restoreFromCloud()).rejects.toBeInstanceOf(crypto.PasswordRequiredError);
    await expect(cloudSync.unlockCloudBackupKey('parola-gresita')).rejects.toThrow(
      'Parolă incorectă'
    );
    const key = await cloudSync.unlockCloudBackupKey('parola-buna');
    // Deblocarea singură nu schimbă nimic pe telefon (restaurarea poate fi anulată).
    expect(crypto.isSessionUnlocked()).toBe(false);
    expect(await crypto.isConfigured()).toBe(false);

    await cloudSync.restoreFromCloud(undefined, key);

    const vehicles = await db.getAllAsync<{ name: string }>('SELECT name FROM vehicles');
    expect(vehicles.map(v => v.name)).toEqual(['Logan']);
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(FILE_URI, PLAIN_B64, expect.anything());
  });

  it('după restaurare telefonul continuă backup-ul criptat cu aceeași parolă', async () => {
    await backupFromPhoneA('parola-buna');
    const params = cloudMeta().encryption;
    newPhone('device-B');
    const key = await cloudSync.unlockCloudBackupKey('parola-buna');
    await cloudSync.restoreFromCloud(undefined, key);

    expect(await settings.getCloudEncryptionEnabled()).toBe(true);
    expect(crypto.isSessionUnlocked()).toBe(true);
    expect(await crypto.getEncryptionParams()).toEqual(params);
    // După o repornire, parola se poate introduce local (fără meta).
    await expect(crypto.unlockWithPassword('parola-buna')).resolves.toHaveLength(32);

    await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
      'v-2',
      'Dacia',
      TS,
    ]);
    expect(await cloudSync.uploadManifestIfChanged()).toBe(true);
    const meta = cloudMeta();
    expect(meta.encrypted).toBe(true);
    expect(meta.encryption).toEqual(params);
    const plain = await crypto.decryptString(cloudFiles.get(MANIFEST) as string, key);
    expect((JSON.parse(plain) as { vehicles: unknown[] }).vehicles).toHaveLength(2);
  });

  it('nu folosește cheia de sesiune a unei alte parole: cere parola backup-ului', async () => {
    await backupFromPhoneA('parola-telefon-a');
    newPhone('device-B');
    crypto.setSessionKey(await crypto.setupPassword('parola-telefon-b'));

    await expect(cloudSync.restoreFromCloud()).rejects.toBeInstanceOf(crypto.PasswordRequiredError);
    await expect(cloudSync.estimateRestoreSize()).rejects.toBeInstanceOf(
      crypto.PasswordRequiredError
    );
  });

  it('un backup necriptat oprește flag-ul local de criptare', async () => {
    await backupFromPhoneA(null);
    newPhone('device-B');
    await settings.setCloudEncryptionEnabled(true);

    await cloudSync.restoreFromCloud();

    expect(await settings.getCloudEncryptionEnabled()).toBe(false);
    expect(await db.getAllAsync('SELECT id FROM vehicles')).toHaveLength(1);
  });
});

describe('backup criptat — meta vechi, fără parametri', () => {
  async function stripEncryptionFromMeta(): Promise<void> {
    const { encryption: _drop, ...legacy } = cloudMeta();
    cloudFiles.set(META, JSON.stringify(legacy));
  }

  /** Aplicația repornită (sesiune blocată) intră în fundal: upload-ul cere parola. */
  async function backgroundWithLockedSession(): Promise<void> {
    crypto.setSessionKey(null);
    await expect(cloudSync.uploadManifestIfChanged()).rejects.toBeInstanceOf(
      crypto.PasswordRequiredError
    );
  }

  it('telefonul care a făcut backup-ul completează meta fără să ceară parola', async () => {
    await backupFromPhoneA('parola-buna');
    const params = await crypto.getEncryptionParams();
    await stripEncryptionFromMeta();

    await backgroundWithLockedSession();

    expect(cloudMeta().encryption).toEqual(params);
  });

  it('nu completează meta scris de alt telefon', async () => {
    await backupFromPhoneA('parola-buna');
    await stripEncryptionFromMeta();
    testDb._raw.prepare("UPDATE cloud_state SET device_id = 'device-C' WHERE id = 1").run();

    await backgroundWithLockedSession();

    expect(cloudMeta().encryption).toBeUndefined();
  });

  it('pe un telefon nou explică de ce backup-ul vechi nu se poate deschide', async () => {
    await backupFromPhoneA('parola-buna');
    await stripEncryptionFromMeta();
    newPhone('device-B');

    await expect(cloudSync.unlockCloudBackupKey('parola-buna')).rejects.toThrow(
      /versiune mai veche/
    );
  });
});
