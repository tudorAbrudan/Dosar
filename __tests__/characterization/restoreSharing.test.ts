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
let importState: typeof import('@/services/importState');
let sharing: typeof import('@/services/sharing');

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    backup = require('@/services/backup');
    cloudShare = require('@/services/cloudShare');
    importState = require('@/services/importState');
    sharing = require('@/services/sharing');
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
      seen.push(importState.isRestoreInProgress());
    });

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });
    expect(importState.isRestoreInProgress()).toBe(false);
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

describe('restaurare — starea registrului de partajare', () => {
  async function registerShare(
    zone: string,
    role: 'owner' | 'participant',
    entityType: string,
    entityId: string
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO shared_entities (id, entity_type, entity_id, zone_name, role, created_at, change_token)
       VALUES (?, ?, ?, ?, ?, ?, 'tok')`,
      [`se-${zone}`, entityType, entityId, zone, role, TS]
    );
    await db.runAsync(
      `INSERT INTO cloud_records (id, zone_name, record_name, record_type, local_table, local_id, change_tag)
       VALUES (?, ?, ?, 'document', 'documents', ?, 'tag-1')`,
      [`cr-${zone}`, zone, 'd-rca', 'd-rca']
    );
  }

  async function queuePush(zone: string, record: string, op: string, kind: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO pending_share_pushes (zone_name, record_name, op, scope, kind, attempt_count, created_at)
       VALUES (?, ?, ?, 'private', ?, 0, 0)`,
      [zone, record, op, kind]
    );
  }

  it('proprietarul își regăsește partajarea pe entitatea restaurată, fără reset', async () => {
    await registerShare('entity_vehicle_v-dacia', 'owner', 'vehicle', 'v-dacia');

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    const share = await sharing.getShareForEntity('vehicle', 'v-dacia');
    expect(share).not.toBeNull();
    expect(share!.last_sync_error).toBeFalsy();
    const row = testDb._raw
      .prepare('SELECT change_token FROM shared_entities WHERE zone_name = ?')
      .get('entity_vehicle_v-dacia') as { change_token: string | null };
    expect(row.change_token).toBe('tok');
    expect(
      testDb._raw.prepare('SELECT COUNT(*) AS n FROM cloud_records').get() as { n: number }
    ).toEqual({ n: 1 });
  });

  it('participantul primește un fetch complet la următorul sync', async () => {
    await registerShare('entity_vehicle_v-dacia', 'participant', 'vehicle', 'v-dacia');

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    const row = testDb._raw
      .prepare('SELECT change_token FROM shared_entities WHERE zone_name = ?')
      .get('entity_vehicle_v-dacia') as { change_token: string | null };
    expect(row.change_token).toBeNull();
    expect(
      testDb._raw.prepare('SELECT COUNT(*) AS n FROM cloud_records').get() as { n: number }
    ).toEqual({ n: 0 });
  });

  it('partajarea proprie a unei entități absente din backup e semnalată, nu revocată', async () => {
    await registerShare('entity_vehicle_v-vanduta', 'owner', 'vehicle', 'v-vanduta');

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    const row = testDb._raw
      .prepare('SELECT revoked_at, last_sync_error FROM shared_entities WHERE zone_name = ?')
      .get('entity_vehicle_v-vanduta') as { revoked_at: string | null; last_sync_error: string };
    expect(row.revoked_at).toBeNull();
    expect(row.last_sync_error).toMatch(/nu mai există pe acest telefon/);
  });

  it('coada de push păstrează doar ștergerile rândurilor care lipsesc', async () => {
    const zone = 'entity_vehicle_v-dacia';
    await registerShare(zone, 'owner', 'vehicle', 'v-dacia');
    // Editare făcută după backup, nepush-uită: rândul are acum conținutul din backup,
    // deci flush-ul ar întoarce zona (și participanții) la starea veche → scos.
    await queuePush(zone, 'd-rca', 'upsert', 'document');
    await queuePush(zone, 'd-nou-dupa-backup', 'upsert', 'document'); // lipsește → ar fi tombstone, scos
    await queuePush(zone, 'd-sters', 'delete', 'document'); // lipsește → ștergere legitimă, rămâne
    await queuePush(zone, 'v-dacia', 'upsert', 'entity'); // conținut din backup → scos

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    const left = testDb._raw
      .prepare('SELECT record_name, op FROM pending_share_pushes ORDER BY record_name')
      .all() as { record_name: string; op: string }[];
    expect(left).toEqual([{ record_name: 'd-sters', op: 'delete' }]);
  });

  it('eroarea „entitatea nu mai există" dispare când restaurarea o readuce', async () => {
    await registerShare('entity_vehicle_v-dacia', 'owner', 'vehicle', 'v-dacia');
    await backup.deleteAllUserData();
    const errorOf = () =>
      (
        testDb._raw
          .prepare('SELECT last_sync_error FROM shared_entities WHERE zone_name = ?')
          .get('entity_vehicle_v-dacia') as { last_sync_error: string | null }
      ).last_sync_error;
    expect(errorOf()).toMatch(/nu mai există pe acest telefon/);

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    expect(errorOf()).toBeNull();
  });

  it('un delete în coadă pentru un rând readus de restaurare e scos', async () => {
    await registerShare('entity_vehicle_v-dacia', 'owner', 'vehicle', 'v-dacia');
    await queuePush('entity_vehicle_v-dacia', 'd-rca', 'delete', 'document');

    await backup.applyManifest(PAYLOAD, { wipeFirst: true });

    expect(
      testDb._raw.prepare('SELECT COUNT(*) AS n FROM pending_share_pushes').get() as { n: number }
    ).toEqual({ n: 0 });
  });
});
