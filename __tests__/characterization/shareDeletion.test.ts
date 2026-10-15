/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — ștergerea unei entități partajate „și la ei"
 * (spec ../docs/superpowers/specs/2026-10-15-delete-shared-entity-design.md).
 * Modulul nativ CloudKit e mockuit, ca în `cloudShare.test.ts`.
 *
 * Owner: zona se golește (rădăcina întâi), partajarea rămâne deschisă 30 de zile de
 * la confirmarea ștergerii, documentele rămân la owner.
 * Participant: dispariția rădăcinii șterge entitatea și documentele legate doar de
 * ea; ieșirea din partajare vine după ce userul vede mesajul.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

const mockNative = {
  isAvailable: jest.fn(),
  createSharedZone: jest.fn(),
  shareZone: jest.fn(),
  listSharedZones: jest.fn(),
  fetchShareInfo: jest.fn(),
  stopSharing: jest.fn(),
  deleteZone: jest.fn(),
  leaveShare: jest.fn(),
  fetchZoneChanges: jest.fn(),
  fetchDatabaseChanges: jest.fn(),
  pushRecords: jest.fn(),
  subscribeDatabase: jest.fn(),
  addRemoteChangeListener: jest.fn(() => ({ remove: jest.fn() })),
};

jest.mock('@/modules/expo-cloudkit-share/src', () => mockNative);

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let sharing: typeof import('@/services/sharing');
let cloudShare: typeof import('@/services/cloudShare');
let shareDeletion: typeof import('@/services/shareDeletion');
let entities: typeof import('@/services/entities');
let importState: typeof import('@/services/importState');
let registryReset: typeof import('@/services/shareRegistryReset');
let AsyncStorage: { setItem: jest.Mock };

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    sharing = require('@/services/sharing');
    cloudShare = require('@/services/cloudShare');
    shareDeletion = require('@/services/shareDeletion');
    entities = require('@/services/entities');
    importState = require('@/services/importState');
    registryReset = require('@/services/shareRegistryReset');
    AsyncStorage = require('@react-native-async-storage/async-storage').default;
  });
});

function resetSchema(): void {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    if (t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* virtual/shadow tables */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

const OWNER_ZONE = 'entity_vehicle_veh-1';
const PARTICIPANT_ZONE = 'entity_vehicle_veh-2';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetSchema();
  jest.clearAllMocks();
  // Valorile `…Once` nefolosite (zone excluse care nu se mai trag) nu trec în testul următor.
  mockNative.fetchZoneChanges.mockReset();
  mockNative.fetchDatabaseChanges.mockReset();
  mockNative.isAvailable.mockResolvedValue({ available: true, accountStatus: 'available' });
  mockNative.listSharedZones.mockResolvedValue([]);
  mockNative.fetchShareInfo.mockResolvedValue({});
  mockNative.subscribeDatabase.mockResolvedValue({ subscribed: true });
  mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: {} });
  mockNative.stopSharing.mockResolvedValue({ revoked: true });
  mockNative.deleteZone.mockResolvedValue({ deleted: true });
  mockNative.leaveShare.mockResolvedValue({ left: true });
  mockNative.fetchDatabaseChanges.mockResolvedValue({
    changedZones: [],
    deletedZones: [],
    newToken: null,
  });
  mockNative.fetchZoneChanges.mockResolvedValue({
    records: [],
    deletedRecordNames: [],
    newToken: null,
  });
});

// ── Seed helpers (INSERT direct, ca în cloudShare.test.ts). ──

function run(sql: string, ...params: (string | number | null)[]): void {
  testDb._raw.prepare(sql).run(...params);
}

function insertVehicle(id: string, name = 'Dacia'): void {
  run('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', id, name, '2026-07-01');
}

function insertPerson(id: string, name = 'Ana'): void {
  run('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', id, name, '2026-07-01');
}

function insertDocument(id: string, vehicleId: string | null = null): void {
  run(
    'INSERT INTO documents (id, type, vehicle_id, created_at) VALUES (?, ?, ?, ?)',
    id,
    'talon',
    vehicleId,
    '2026-07-01'
  );
}

function link(id: string, documentId: string, entityType: string, entityId: string): void {
  run(
    'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    id,
    documentId,
    entityType,
    entityId
  );
}

function insertShare(params: {
  zoneName: string;
  entityId: string;
  role: 'owner' | 'participant';
  ownerName?: string;
  permission?: 'read' | 'readwrite';
  deleteRequestedAt?: string;
  deleteSentAt?: string;
}): void {
  run(
    `INSERT INTO shared_entities
       (id, entity_type, entity_id, zone_name, role, permission, owner_name, share_title,
        created_at, delete_requested_at, delete_sent_at)
     VALUES (?, 'vehicle', ?, ?, ?, ?, ?, 'Dacia', ?, ?, ?)`,
    `se_${params.zoneName}`,
    params.entityId,
    params.zoneName,
    params.role,
    params.permission ?? 'read',
    params.ownerName ?? null,
    '2026-07-01',
    params.deleteRequestedAt ?? null,
    params.deleteSentAt ?? null
  );
}

function insertCloudRecord(zoneName: string, recordName: string, recordType: string): void {
  run(
    `INSERT INTO cloud_records (id, zone_name, record_name, record_type, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    `cr_${zoneName}_${recordName}`,
    zoneName,
    recordName,
    recordType,
    recordType === 'document' ? 'documents' : recordType,
    recordName
  );
}

function insertPendingPush(
  zoneName: string,
  recordName: string,
  op: 'upsert' | 'delete',
  kind: 'entity' | 'document',
  scope: 'private' | 'shared' = 'private',
  createdAt = 1
): void {
  run(
    `INSERT INTO pending_share_pushes (zone_name, record_name, op, scope, kind, attempt_count, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    zoneName,
    recordName,
    op,
    scope,
    kind,
    createdAt
  );
}

function shareRow(zoneName: string): Record<string, string | null> {
  return testDb._raw
    .prepare('SELECT * FROM shared_entities WHERE zone_name = ?')
    .get(zoneName) as Record<string, string | null>;
}

function exists(table: string, id: string): boolean {
  return !!testDb._raw.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
}

// ── Owner ──

describe('owner — „Șterge și la ei"', () => {
  function seedOwnerShare(): void {
    insertVehicle('veh-1');
    insertDocument('doc-1', 'veh-1');
    link('l-1', 'doc-1', 'vehicle', 'veh-1');
    insertShare({ zoneName: OWNER_ZONE, entityId: 'veh-1', role: 'owner' });
    insertCloudRecord(OWNER_ZONE, 'veh-1', 'vehicle');
    insertCloudRecord(OWNER_ZONE, 'doc-1', 'document');
    insertCloudRecord(OWNER_ZONE, 'doc-1__p__pg-1', 'document_page');
  }

  it('golește zona cu rădăcina prima, nu revocă, iar documentele rămân la owner', async () => {
    seedOwnerShare();
    // Un push mai vechi pentru document: rămâne înaintea rădăcinii în coadă.
    insertPendingPush(OWNER_ZONE, 'doc-1', 'upsert', 'document', 'private', 0);

    await cloudShare.deleteEntityShareEverywhere('vehicle', 'veh-1');
    await entities.deleteVehicle('veh-1');
    await importState.waitForShareSyncIdle();

    expect(mockNative.stopSharing).not.toHaveBeenCalled();
    expect(mockNative.pushRecords).toHaveBeenCalledTimes(1);
    const { deletions, scope } = mockNative.pushRecords.mock.calls[0][0];
    expect(scope).toBe('private');
    expect(deletions[0]).toBe('veh-1');
    expect(deletions).toEqual(expect.arrayContaining(['doc-1', 'doc-1__p__pg-1']));

    const row = shareRow(OWNER_ZONE);
    expect(row.delete_requested_at).not.toBeNull();
    expect(row.delete_sent_at).not.toBeNull();
    expect(row.revoked_at).toBeNull();
    expect(exists('vehicles', 'veh-1')).toBe(false);
    expect(exists('documents', 'doc-1')).toBe(true);
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).toBeNull();
    expect(await sharing.getSharedEntities()).toHaveLength(0);
    expect(await shareDeletion.getShareTeardowns()).toHaveLength(1);
  });

  it('fără confirmare de la server, termenul de închidere nu începe', async () => {
    seedOwnerShare();
    mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: { 'veh-1': 'offline' } });

    await cloudShare.deleteEntityShareEverywhere('vehicle', 'veh-1');
    await importState.waitForShareSyncIdle();

    expect(shareRow(OWNER_ZONE).delete_sent_at).toBeNull();
  });

  it('închide zona după 30 de zile de la confirmare, nu mai devreme', async () => {
    const old = new Date(Date.now() - 31 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - 5 * DAY_MS).toISOString();
    insertShare({
      zoneName: OWNER_ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: old,
      deleteSentAt: old,
    });
    insertShare({
      zoneName: 'entity_vehicle_veh-3',
      entityId: 'veh-3',
      role: 'owner',
      deleteRequestedAt: recent,
      deleteSentAt: recent,
    });
    // Cerută demult, dar ștergerea n-a ajuns încă pe server (owner offline).
    insertShare({
      zoneName: 'entity_vehicle_veh-4',
      entityId: 'veh-4',
      role: 'owner',
      deleteRequestedAt: old,
    });
    insertCloudRecord(OWNER_ZONE, 'doc-1', 'document');

    await cloudShare.syncSharedEntities();

    expect(mockNative.deleteZone).toHaveBeenCalledTimes(1);
    expect(mockNative.deleteZone).toHaveBeenCalledWith(OWNER_ZONE);
    expect(shareRow(OWNER_ZONE).revoked_at).not.toBeNull();
    expect(
      testDb._raw.prepare('SELECT id FROM cloud_records WHERE zone_name = ?').get(OWNER_ZONE)
    ).toBeUndefined();
    expect(shareRow('entity_vehicle_veh-3').revoked_at).toBeNull();
    expect(shareRow('entity_vehicle_veh-4').revoked_at).toBeNull();
  });

  it('repartajarea unei entități readuse de o restaurare închide întâi zona veche', async () => {
    const now = new Date().toISOString();
    insertVehicle('veh-1');
    insertShare({
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
    const row = shareRow(OWNER_ZONE);
    expect(row.revoked_at).toBeNull();
    expect(row.delete_requested_at).toBeNull();
    expect(row.delete_sent_at).toBeNull();
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).not.toBeNull();
  });

  it('restaurarea păstrează ștergerile netrimise ale zonei golite, deși documentul e local', async () => {
    insertDocument('doc-1');
    insertDocument('doc-9');
    insertShare({
      zoneName: OWNER_ZONE,
      entityId: 'veh-1',
      role: 'owner',
      deleteRequestedAt: new Date().toISOString(),
    });
    insertShare({ zoneName: 'entity_vehicle_veh-9', entityId: 'veh-9', role: 'owner' });
    insertPendingPush(OWNER_ZONE, 'doc-1', 'delete', 'document');
    insertPendingPush('entity_vehicle_veh-9', 'doc-9', 'delete', 'document');

    await registryReset.resetShareStateAfterWipe();

    const left = testDb._raw
      .prepare('SELECT zone_name, record_name FROM pending_share_pushes')
      .all() as { zone_name: string; record_name: string }[];
    expect(left).toEqual([{ zone_name: OWNER_ZONE, record_name: 'doc-1' }]);
    expect(shareRow(OWNER_ZONE).last_sync_error).toBeNull();
  });
});

// ── Participant ──

describe('participant — owner-ul a șters entitatea', () => {
  function seedParticipant(): void {
    insertVehicle('veh-2');
    insertPerson('per-2');
    insertShare({
      zoneName: PARTICIPANT_ZONE,
      entityId: 'veh-2',
      role: 'participant',
      ownerName: 'owner1',
      permission: 'readwrite',
    });
    // doc-a: primit prin partajare, legat doar de vehicul.
    insertDocument('doc-a', 'veh-2');
    link('doc-a_shlink', 'doc-a', 'vehicle', 'veh-2');
    // doc-b: legat și de o persoană proprie a participantului.
    insertDocument('doc-b', 'veh-2');
    link('doc-b_shlink', 'doc-b', 'vehicle', 'veh-2');
    link('doc-b_per', 'doc-b', 'person', 'per-2');
    insertCloudRecord(PARTICIPANT_ZONE, 'veh-2', 'vehicle');
    insertCloudRecord(PARTICIPANT_ZONE, 'doc-a', 'document');
    insertCloudRecord(PARTICIPANT_ZONE, 'doc-b', 'document');
    // Editare offline a entității, încă netrimisă.
    insertPendingPush(PARTICIPANT_ZONE, 'veh-2', 'upsert', 'entity', 'shared');

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
    expect(exists('vehicles', 'veh-2')).toBe(false);
    expect(exists('documents', 'doc-a')).toBe(false);
    expect(exists('documents', 'doc-b')).toBe(true);
    expect(exists('document_entities', 'doc-b_shlink')).toBe(false);
    expect(exists('document_entities', 'doc-b_per')).toBe(true);

    expect(shareRow(PARTICIPANT_ZONE).owner_deleted_at).not.toBeNull();
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
    expect(shareRow(PARTICIPANT_ZONE).owner_deleted_at).not.toBeNull();
    const dbTokenWrites = AsyncStorage.setItem.mock.calls.filter(
      ([key, value]) => key === 'cloudkit_db_change_token_shared' && value === 'db-2'
    );
    expect(dbTokenWrites).toHaveLength(1);
  });

  it('până vede mesajul, o entitate readusă (restaurare) se curăță din nou', async () => {
    seedParticipant();
    zoneReports(['veh-2'], 'db-1');
    await cloudShare.syncSharedEntities();

    insertVehicle('veh-2');
    await cloudShare.syncSharedEntities();

    expect(exists('vehicles', 'veh-2')).toBe(false);
  });

  it('după mesaj iese din partajare; offline, reîncearcă la sync-ul următor', async () => {
    seedParticipant();
    zoneReports(['veh-2'], 'db-1');
    await cloudShare.syncSharedEntities();

    mockNative.leaveShare.mockRejectedValueOnce(new Error('offline'));
    await cloudShare.acknowledgeOwnerDeletion(PARTICIPANT_ZONE);

    expect(await shareDeletion.getUnseenOwnerDeletions()).toHaveLength(0);
    expect(shareRow(PARTICIPANT_ZONE).revoked_at).toBeNull();

    await cloudShare.syncSharedEntities();

    expect(mockNative.leaveShare).toHaveBeenLastCalledWith({
      zoneName: PARTICIPANT_ZONE,
      ownerName: 'owner1',
    });
    expect(shareRow(PARTICIPANT_ZONE).revoked_at).not.toBeNull();
    // După ce userul a văzut mesajul, o entitate readusă nu mai e atinsă.
    insertVehicle('veh-2');
    await cloudShare.syncSharedEntities();
    expect(exists('vehicles', 'veh-2')).toBe(true);
  });
});
