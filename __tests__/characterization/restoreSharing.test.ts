/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — restaurarea și partajarea CloudKit.
 *
 * Restaurarea cu înlocuire păstrează ID-urile originale, deci rândurile ei se
 * potrivesc cu registrul de partajare. Dacă restaurarea s-ar suprapune cu un sync
 * sau i-ar împinge mutațiile în zone, starea veche din backup ar suprascrie datele
 * mai noi din zonă (la un participant cu drept de editare: datele owner-ului), iar
 * un pull în timpul wipe-ului ar lovi rândurile pe care restaurarea le reinserează.
 *
 * Hook-urile de push (`pushEntityToShare` / `pushDocumentToShare`) pornesc printr-un
 * `import()` dinamic, care nu rulează în Jest; garda lor sincronă e păzită de
 * `scripts/restore-share-isolation-audit.js`. Aici fixăm flag-ul și sincronizarea.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

const mockNative = {
  isAvailable: jest.fn(),
  fetchDatabaseChanges: jest.fn(),
  fetchZoneChanges: jest.fn(),
  listSharedZones: jest.fn(),
  pushRecords: jest.fn(),
  subscribeDatabase: jest.fn(),
};
jest.mock('@/modules/expo-cloudkit-share/src', () => mockNative);

const mockOnRestoreSuccess = jest.fn(async () => undefined);
jest.mock('@/services/reviewPrompt', () => ({
  onRestoreSuccess: mockOnRestoreSuccess,
  onDocumentCreated: jest.fn(async () => undefined),
  onDocumentRenewed: jest.fn(async () => undefined),
}));

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let backup: typeof import('@/services/backup');
let cloudShare: typeof import('@/services/cloudShare');

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    backup = require('@/services/backup');
    cloudShare = require('@/services/cloudShare');
  });
});

beforeEach(() => {
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
  jest.clearAllMocks();
  mockNative.isAvailable.mockResolvedValue({ available: false });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
}

const TS = '2026-01-01T00:00:00Z';
const PAYLOAD = {
  version: 4,
  vehicles: [{ id: 'v-dacia', name: 'Dacia', created_at: TS }],
  documents: [{ id: 'd-rca', type: 'rca', vehicle_id: 'v-dacia', created_at: TS }],
};

describe('restaurare și partajare', () => {
  it('flag-ul de restaurare e activ doar în timpul restaurării cu înlocuire', async () => {
    const seen: boolean[] = [];
    mockOnRestoreSuccess.mockImplementation(async () => {
      seen.push(backup.isRestoreInProgress());
    });

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });
    expect(backup.isRestoreInProgress()).toBe(false);
    await backup.applyManifest(PAYLOAD);

    // [restaurare, import aditiv]: doar restaurarea oprește push-urile spre zone.
    expect(seen).toEqual([true, false]);
  });

  it('un sync de partajare nu pornește cât rulează un import', async () => {
    mockOnRestoreSuccess.mockImplementation(async () => {
      await cloudShare.syncSharedEntities();
    });

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });
    await backup.applyManifest(PAYLOAD);

    expect(mockNative.isAvailable).not.toHaveBeenCalled();
  });

  it('restaurarea așteaptă sync-ul de partajare deja în curs înainte de wipe', async () => {
    let release!: () => void;
    mockNative.isAvailable.mockImplementation(
      () => new Promise(resolve => (release = () => resolve({ available: false })))
    );
    const sync = cloudShare.syncSharedEntities();
    let restored = false;
    const restore = backup.applyManifest(PAYLOAD, { wipeFirst: true }).then(() => {
      restored = true;
    });

    await settle();
    expect(restored).toBe(false);
    expect(await db.getAllAsync('SELECT id FROM vehicles')).toHaveLength(0);

    release();
    await sync;
    await restore;
    expect(restored).toBe(true);
    expect(await db.getAllAsync('SELECT id FROM vehicles')).toHaveLength(1);
  });
});
