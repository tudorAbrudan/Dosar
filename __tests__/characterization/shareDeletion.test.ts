/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * Characterization test — ștergerea unei entități partajate „și la ei"
 * (spec ../docs/superpowers/specs/2026-10-15-delete-shared-entity-design.md).
 * Modulul nativ CloudKit e mockuit, ca în `cloudShare.test.ts`.
 *
 * Owner: zona se golește (rădăcina întâi), partajarea rămâne deschisă până confirmă
 * participanții (`shareClosing.test.ts`), cel mult 30 de zile; documentele rămân la owner.
 * Participant: dispariția rădăcinii șterge entitatea și documentele legate doar de
 * ea; ieșirea din partajare vine după ce userul vede mesajul.
 */

import {
  createMockCloudKit,
  resetMockCloudKit,
  resetSchema,
  shareSeed,
} from '../helpers/shareFixtures';
import type { TestDb } from '../helpers/testDb';

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

const mockNative = createMockCloudKit();

jest.mock('@/modules/expo-cloudkit-share/src', () => mockNative);

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let seed: ReturnType<typeof shareSeed>;
let sharing: typeof import('@/services/sharing');
let cloudShare: typeof import('@/services/cloudShare');
let shareDeletion: typeof import('@/services/shareDeletion');
let shareClosing: typeof import('@/services/shareClosing');
let entities: typeof import('@/services/entities');
let importState: typeof import('@/services/importState');
let registryReset: typeof import('@/services/shareRegistryReset');
let AsyncStorage: { setItem: jest.Mock };

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    seed = shareSeed(testDb);
    sharing = require('@/services/sharing');
    cloudShare = require('@/services/cloudShare');
    shareDeletion = require('@/services/shareDeletion');
    shareClosing = require('@/services/shareClosing');
    entities = require('@/services/entities');
    importState = require('@/services/importState');
    registryReset = require('@/services/shareRegistryReset');
    AsyncStorage = require('@react-native-async-storage/async-storage').default;
  });
});

const OWNER_ZONE = 'entity_vehicle_veh-1';
const PARTICIPANT_ZONE = 'entity_vehicle_veh-2';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetSchema(testDb);
  resetMockCloudKit(mockNative);
});

// ── Owner ──

describe('owner — „Șterge și la ei"', () => {
  function seedOwnerShare(): void {
    seed.insertVehicle('veh-1');
    seed.insertDocument('doc-1', 'veh-1');
    seed.link('l-1', 'doc-1', 'vehicle', 'veh-1');
    seed.insertShare({ zoneName: OWNER_ZONE, entityId: 'veh-1', role: 'owner' });
    seed.insertCloudRecord(OWNER_ZONE, 'veh-1', 'vehicle');
    seed.insertCloudRecord(OWNER_ZONE, 'doc-1', 'document');
    seed.insertCloudRecord(OWNER_ZONE, 'doc-1__p__pg-1', 'document_page');
  }

  it('golește zona cu rădăcina prima, nu revocă, iar documentele rămân la owner', async () => {
    seedOwnerShare();
    // Un push mai vechi pentru document: rămâne înaintea rădăcinii în coadă.
    seed.insertPendingPush(OWNER_ZONE, 'doc-1', 'upsert', 'document', 'private', 0);

    await cloudShare.deleteEntityShareEverywhere('vehicle', 'veh-1');
    await entities.deleteVehicle('veh-1');
    await importState.waitForShareSyncIdle();

    expect(mockNative.deleteZone).not.toHaveBeenCalled();
    expect(mockNative.pushRecords).toHaveBeenCalledTimes(1);
    const { deletions, scope } = mockNative.pushRecords.mock.calls[0][0];
    expect(scope).toBe('private');
    expect(deletions[0]).toBe('veh-1');
    expect(deletions).toEqual(expect.arrayContaining(['doc-1', 'doc-1__p__pg-1']));

    const row = seed.shareRow(OWNER_ZONE);
    expect(row.delete_requested_at).not.toBeNull();
    expect(row.delete_sent_at).not.toBeNull();
    expect(row.revoked_at).toBeNull();
    expect(seed.exists('vehicles', 'veh-1')).toBe(false);
    expect(seed.exists('documents', 'doc-1')).toBe(true);
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).toBeNull();
    expect(await sharing.getSharedEntities()).toHaveLength(0);
    expect(await shareClosing.getClosingShares()).toHaveLength(1);
  });

  it('fără confirmare de la server, termenul de închidere nu începe', async () => {
    seedOwnerShare();
    mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: { 'veh-1': 'offline' } });

    await cloudShare.deleteEntityShareEverywhere('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();

    expect(seed.shareRow(OWNER_ZONE).delete_sent_at).toBeNull();
  });

  it('închide zona după 30 de zile de la confirmare, nu mai devreme', async () => {
    const old = new Date(Date.now() - 31 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - 5 * DAY_MS).toISOString();
    seed.insertShare({
      zoneName: OWNER_ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: old,
      deleteSentAt: old,
    });
    seed.insertShare({
      zoneName: 'entity_vehicle_veh-3',
      entityId: 'veh-3',
      role: 'owner',
      deleteRequestedAt: recent,
      deleteSentAt: recent,
    });
    // Cerută demult, dar ștergerea n-a ajuns încă pe server (owner offline).
    seed.insertShare({
      zoneName: 'entity_vehicle_veh-4',
      entityId: 'veh-4',
      role: 'owner',
      deleteRequestedAt: old,
    });
    seed.insertCloudRecord(OWNER_ZONE, 'doc-1', 'document');

    await cloudShare.syncSharedEntities();

    expect(mockNative.deleteZone).toHaveBeenCalledTimes(1);
    expect(mockNative.deleteZone).toHaveBeenCalledWith(OWNER_ZONE);
    expect(seed.shareRow(OWNER_ZONE).revoked_at).not.toBeNull();
    expect(
      testDb._raw.prepare('SELECT id FROM cloud_records WHERE zone_name = ?').get(OWNER_ZONE)
    ).toBeUndefined();
    expect(seed.shareRow('entity_vehicle_veh-3').revoked_at).toBeNull();
    expect(seed.shareRow('entity_vehicle_veh-4').revoked_at).toBeNull();
  });

  it('repartajarea unei entități readuse de o restaurare închide întâi zona veche', async () => {
    const now = new Date().toISOString();
    seed.insertVehicle('veh-1');
    seed.insertShare({
      zoneName: OWNER_ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: now,
      deleteSentAt: now,
    });
    mockNative.createSharedZone.mockResolvedValue({ zoneName: OWNER_ZONE });
    mockNative.pushRecords.mockResolvedValue({ succeeded: { 'veh-1': 'tag-1' }, failed: {} });
    mockNative.shareZone.mockResolvedValue({ shareURL: 'https://www.icloud.com/share/x' });

    await cloudShare.shareEntity('vehicle', 'veh-1');

    expect(mockNative.deleteZone).toHaveBeenCalledWith(OWNER_ZONE);
    expect(mockNative.deleteZone.mock.invocationCallOrder[0]).toBeLessThan(
      mockNative.createSharedZone.mock.invocationCallOrder[0]
    );
    const row = seed.shareRow(OWNER_ZONE);
    expect(row.revoked_at).toBeNull();
    expect(row.delete_requested_at).toBeNull();
    expect(row.delete_sent_at).toBeNull();
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).not.toBeNull();
  });

  it('restaurarea păstrează ștergerile netrimise ale zonei golite, deși documentul e local', async () => {
    seed.insertDocument('doc-1');
    seed.insertDocument('doc-9');
    seed.insertShare({
      zoneName: OWNER_ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: new Date().toISOString(),
    });
    seed.insertShare({ zoneName: 'entity_vehicle_veh-9', entityId: 'veh-9', role: 'owner' });
    seed.insertPendingPush(OWNER_ZONE, 'doc-1', 'delete', 'document');
    seed.insertPendingPush('entity_vehicle_veh-9', 'doc-9', 'delete', 'document');

    await registryReset.resetShareStateAfterWipe();

    const left = testDb._raw
      .prepare('SELECT zone_name, record_name FROM pending_share_pushes')
      .all() as { zone_name: string; record_name: string }[];
    expect(left).toEqual([{ zone_name: OWNER_ZONE, record_name: 'doc-1' }]);
    expect(seed.shareRow(OWNER_ZONE).last_sync_error).toBeNull();
  });
});

// ── Participant ──

describe('participant — owner-ul a șters entitatea', () => {
  function seedParticipant(): void {
    seed.insertVehicle('veh-2');
    seed.insertPerson('per-2');
    seed.insertShare({
      zoneName: PARTICIPANT_ZONE,
      entityId: 'veh-2',
      role: 'participant',
      ownerName: 'owner1',
      permission: 'readwrite',
    });
    // doc-a: primit prin partajare, legat doar de vehicul.
    seed.insertDocument('doc-a', 'veh-2');
    seed.link('doc-a_shlink', 'doc-a', 'vehicle', 'veh-2');
    // doc-b: legat și de o persoană proprie a participantului.
    seed.insertDocument('doc-b', 'veh-2');
    seed.link('doc-b_shlink', 'doc-b', 'vehicle', 'veh-2');
    seed.link('doc-b_per', 'doc-b', 'person', 'per-2');
    seed.insertCloudRecord(PARTICIPANT_ZONE, 'veh-2', 'vehicle');
    seed.insertCloudRecord(PARTICIPANT_ZONE, 'doc-a', 'document');
    seed.insertCloudRecord(PARTICIPANT_ZONE, 'doc-b', 'document');
    // Editare offline a entității, încă netrimisă.
    seed.insertPendingPush(PARTICIPANT_ZONE, 'veh-2', 'upsert', 'entity', 'shared');

    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: PARTICIPANT_ZONE, ownerName: 'owner1' },
    ]);
  }

  function zoneReports(deletedRecordNames: string[], dbToken: string): void {
    mockNative.fetchDatabaseChanges.mockImplementation(
      async (opts: { scope: 'shared' | 'private' }) =>
        opts.scope === 'shared'
          ? {
              changedZones: [{ zoneName: PARTICIPANT_ZONE, ownerName: 'owner1' }],
              deletedZones: [],
              newToken: dbToken,
            }
          : { changedZones: [], deletedZones: [], newToken: null }
    );
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [],
      deletedRecordNames,
      newToken: 'zone-token',
    });
  }

  it('șterge entitatea și documentele legate doar de ea; restul rămân, dezlegate', async () => {
    seedParticipant();
    // Participantul împinge editarea offline, dar owner-ul a șters deja rădăcina.
    mockNative.pushRecords.mockResolvedValue({
      succeeded: {},
      failed: { 'veh-2': 'record-missing' },
    });
    zoneReports(['doc-a', 'veh-2', 'doc-b'], 'db-1');

    await cloudShare.syncSharedEntities();

    // Push-ul participantului pentru rădăcină e doar actualizare, niciodată creare.
    expect(mockNative.pushRecords.mock.calls[0][0].records[0]).toMatchObject({
      recordName: 'veh-2',
      mustExist: true,
    });
    expect(seed.exists('vehicles', 'veh-2')).toBe(false);
    expect(seed.exists('documents', 'doc-a')).toBe(false);
    expect(seed.exists('documents', 'doc-b')).toBe(true);
    expect(seed.exists('document_entities', 'doc-b_shlink')).toBe(false);
    expect(seed.exists('document_entities', 'doc-b_per')).toBe(true);

    expect(seed.shareRow(PARTICIPANT_ZONE).owner_deleted_at).not.toBeNull();
    expect(
      testDb._raw
        .prepare('SELECT id FROM pending_share_pushes WHERE zone_name = ?')
        .get(PARTICIPANT_ZONE)
    ).toBeUndefined();
    expect(mockNative.leaveShare).not.toHaveBeenCalled();
    expect(await shareDeletion.getUnseenOwnerDeletions()).toHaveLength(1);
    expect(await sharing.getSharedEntities()).toHaveLength(0);
  });

  it('zona încă vizibilă nu e re-anunțată ca primită și nu blochează tokenul', async () => {
    seedParticipant();
    zoneReports(['veh-2'], 'db-1');
    await cloudShare.syncSharedEntities();
    await cloudShare.takeReceivedShareNotices();

    // Sync-ul următor: zona e încă în listSharedZones și raportată ca schimbată.
    zoneReports([], 'db-2');
    await cloudShare.syncSharedEntities();

    expect(await cloudShare.takeReceivedShareNotices()).toEqual([]);
    expect(seed.shareRow(PARTICIPANT_ZONE).owner_deleted_at).not.toBeNull();
    const dbTokenWrites = AsyncStorage.setItem.mock.calls.filter(
      ([key, value]) => key === 'cloudkit_db_change_token_shared' && value === 'db-2'
    );
    expect(dbTokenWrites).toHaveLength(1);
  });

  it('până vede mesajul, o entitate readusă (restaurare) se curăță din nou', async () => {
    seedParticipant();
    zoneReports(['veh-2'], 'db-1');
    await cloudShare.syncSharedEntities();

    seed.insertVehicle('veh-2');
    await cloudShare.syncSharedEntities();

    expect(seed.exists('vehicles', 'veh-2')).toBe(false);
  });

  it('după mesaj iese din partajare; offline, reîncearcă la sync-ul următor', async () => {
    seedParticipant();
    zoneReports(['veh-2'], 'db-1');
    await cloudShare.syncSharedEntities();

    mockNative.leaveShare.mockRejectedValueOnce(new Error('offline'));
    await shareClosing.acknowledgeOwnerDeletion(PARTICIPANT_ZONE);

    expect(await shareDeletion.getUnseenOwnerDeletions()).toHaveLength(0);
    expect(seed.shareRow(PARTICIPANT_ZONE).revoked_at).toBeNull();

    await cloudShare.syncSharedEntities();

    expect(mockNative.leaveShare).toHaveBeenLastCalledWith({
      zoneName: PARTICIPANT_ZONE,
      ownerName: 'owner1',
    });
    expect(seed.shareRow(PARTICIPANT_ZONE).revoked_at).not.toBeNull();
    // După ce userul a văzut mesajul, o entitate readusă nu mai e atinsă.
    seed.insertVehicle('veh-2');
    await cloudShare.syncSharedEntities();
    expect(seed.exists('vehicles', 'veh-2')).toBe(true);
  });
});

describe('friendlyCloudKitMessage', () => {
  it('telefonul fără cont iCloud primește mesajul în română, nu eroarea CloudKit brută', () => {
    expect(
      cloudShare.friendlyCloudKitMessage(
        new Error('This request requires an authenticated account')
      )
    ).toBe('Conectează-te la iCloud pentru a partaja.');
  });
});
