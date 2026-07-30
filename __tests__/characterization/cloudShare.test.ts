/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — orchestrarea `cloudShare.ts` (Increment 2: motor live).
 * Modulul nativ CloudKit e mockuit (fără cont iCloud real — vezi
 * `docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md`).
 * Logica pură de mapare are teste proprii în `cloudShareMapping.test.ts`;
 * granița de privacy în `sharing.test.ts` + `scripts/share-privacy-audit.js`.
 *
 * Acoperă deciziile de robustețe din plan:
 *   4. Upsert non-destructiv (ON CONFLICT DO UPDATE, nu INSERT OR REPLACE).
 *   3. Atomicitate token DB-level ↔ token per-zonă.
 *   Faza 1: doar owner scrie — pushLocalChange no-op / gating pe role==='owner'.
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
  putRecord: jest.fn(),
  getRecord: jest.fn(),
  shareZone: jest.fn(),
  listSharedZones: jest.fn(),
  acceptShareURL: jest.fn(),
  fetchShareInfo: jest.fn(),
  stopSharing: jest.fn(),
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
let documents: typeof import('@/services/documents');
let AsyncStorage: { setItem: jest.Mock; getItem: jest.Mock };

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    sharing = require('@/services/sharing');
    cloudShare = require('@/services/cloudShare');
    documents = require('@/services/documents');
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

beforeEach(() => {
  resetSchema();
  jest.clearAllMocks();
  mockNative.isAvailable.mockResolvedValue({ available: true, accountStatus: 'available' });
  mockNative.listSharedZones.mockResolvedValue([]);
  mockNative.fetchShareInfo.mockResolvedValue({});
  mockNative.subscribeDatabase.mockResolvedValue({ subscribed: true });
  mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: {} });
  mockNative.stopSharing.mockResolvedValue({ revoked: true });
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

// ── Seed helpers (INSERT direct — nu trecem prin services/entities.ts sau
// services/documents.ts ca să evităm lanțul lor de dependențe/side-effects). ──

function insertVehicle(id: string, fields: { name?: string; photo_uri?: string } = {}): void {
  testDb._raw
    .prepare(`INSERT INTO vehicles (id, name, photo_uri, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, fields.name ?? 'Logan', fields.photo_uri ?? null, '2026-07-01T00:00:00Z');
}

function insertDocument(
  id: string,
  fields: { type?: string; note?: string; custom_type_id?: string; file_path?: string } = {}
): void {
  testDb._raw
    .prepare(
      `INSERT INTO documents (id, type, note, custom_type_id, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fields.type ?? 'talon',
      fields.note ?? null,
      fields.custom_type_id ?? null,
      fields.file_path ?? null,
      '2026-07-01T00:00:00Z'
    );
}

function insertReminder(id: string, documentId: string): void {
  testDb._raw
    .prepare(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES (?, 'document_expiry', ?, 'Test', '2026-08-01', 'derived', ?)`
    )
    .run(id, documentId, '2026-07-01T00:00:00Z');
}

function insertSharedEntity(params: {
  zoneName: string;
  entityType: string;
  entityId: string;
  role: 'owner' | 'participant';
  ownerName?: string;
  permission?: 'read' | 'readwrite';
}): void {
  testDb._raw
    .prepare(
      `INSERT INTO shared_entities (id, entity_type, entity_id, zone_name, role, permission, owner_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `se_${params.zoneName}`,
      params.entityType,
      params.entityId,
      params.zoneName,
      params.role,
      params.permission ?? 'read',
      params.ownerName ?? null,
      '2026-07-01T00:00:00Z'
    );
}

function insertPendingPush(params: {
  zoneName: string;
  recordName: string;
  attemptCount: number;
  scope?: 'private' | 'shared';
  kind?: 'entity' | 'document';
}): void {
  testDb._raw
    .prepare(
      `INSERT INTO pending_share_pushes (zone_name, record_name, op, scope, kind, attempt_count, created_at)
       VALUES (?, ?, 'upsert', ?, ?, ?, ?)`
    )
    .run(
      params.zoneName,
      params.recordName,
      params.scope ?? 'private',
      params.kind ?? 'entity',
      params.attemptCount,
      Date.now()
    );
}

function linkDocumentEntity(
  id: string,
  documentId: string,
  entityType: string,
  entityId: string
): void {
  testDb._raw
    .prepare(
      `INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`
    )
    .run(id, documentId, entityType, entityId);
}

function insertCloudRecord(params: {
  zoneName: string;
  recordName: string;
  recordType: string;
  localTable: string;
  localId: string;
}): void {
  testDb._raw
    .prepare(
      `INSERT INTO cloud_records (id, zone_name, record_name, record_type, local_table, local_id, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `cr_${params.zoneName}_${params.recordName}`,
      params.zoneName,
      params.recordName,
      params.recordType,
      params.localTable,
      params.localId,
      '2026-07-01T00:00:00Z'
    );
}

describe('applyDocumentRow — upsert non-destructiv (decizia 4)', () => {
  it('actualizează note dar păstrează custom_type_id local și reminder-ul copil (FK CASCADE) intact', async () => {
    insertDocument('doc-1', { type: 'talon', note: 'nota veche', custom_type_id: 'custom-xyz' });
    insertReminder('rem-1', 'doc-1');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-1',
      entityType: 'vehicle',
      entityId: 'veh-1',
      role: 'participant',
      ownerName: 'owner1',
    });
    linkDocumentEntity('link-1', 'doc-1', 'vehicle', 'veh-1');

    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-1', ownerName: 'owner1' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-1', ownerName: 'owner1' }],
      deletedZones: [],
      newToken: 'db-token-1',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'doc-1',
          recordType: 'document',
          changeTag: 't1',
          fields: { type: 'talon', note: 'nota noua' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'zone-token-1',
    });

    await cloudShare.syncSharedEntities();

    const row = await db.getFirstAsync<{ note: string; custom_type_id: string | null }>(
      'SELECT note, custom_type_id FROM documents WHERE id = ?',
      ['doc-1']
    );
    expect(row!.note).toBe('nota noua');
    // INSERT OR REPLACE ar fi null-uit custom_type_id — upsert-ul non-destructiv nu-l atinge.
    expect(row!.custom_type_id).toBe('custom-xyz');

    const reminder = await db.getFirstAsync('SELECT id FROM reminders WHERE id = ?', ['rem-1']);
    expect(reminder).not.toBeNull(); // FK CASCADE nu s-a declanșat (fără DELETE+INSERT pe documents)
  });
});

describe('applyDeletions — document legat de DOUĂ zone partajate', () => {
  it('se șterge local doar când dispare din ULTIMA zonă', async () => {
    insertDocument('doc-2', { type: 'talon', file_path: 'documents/doc2.jpg' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-2',
      entityType: 'vehicle',
      entityId: 'veh-2',
      role: 'participant',
      ownerName: 'owner1',
    });
    insertSharedEntity({
      zoneName: 'entity_property_prop-2',
      entityType: 'property',
      entityId: 'prop-2',
      role: 'participant',
      ownerName: 'owner1',
    });
    linkDocumentEntity('link-2a', 'doc-2', 'vehicle', 'veh-2');
    linkDocumentEntity('link-2b', 'doc-2', 'property', 'prop-2');
    insertCloudRecord({
      zoneName: 'entity_vehicle_veh-2',
      recordName: 'doc-2',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-2',
    });
    insertCloudRecord({
      zoneName: 'entity_property_prop-2',
      recordName: 'doc-2',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-2',
    });

    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-2', ownerName: 'owner1' },
      { zoneName: 'entity_property_prop-2', ownerName: 'owner1' },
    ]);

    // Runda 1: doc dispare din zona vehiculului — mai există prin proprietate.
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-2', ownerName: 'owner1' }],
      deletedZones: [],
      newToken: 'db-t1',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [],
      deletedRecordNames: ['doc-2'],
      newToken: 'zone-t1',
    });

    await cloudShare.syncSharedEntities();

    let doc = await db.getFirstAsync('SELECT id FROM documents WHERE id = ?', ['doc-2']);
    expect(doc).not.toBeNull();
    const linkGone = await db.getFirstAsync(
      'SELECT id FROM document_entities WHERE document_id = ? AND entity_type = ?',
      ['doc-2', 'vehicle']
    );
    expect(linkGone).toBeNull();

    // Runda 2: doc dispare și din zona proprietății — ultima zonă → șters de tot.
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_property_prop-2', ownerName: 'owner1' }],
      deletedZones: [],
      newToken: 'db-t2',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [],
      deletedRecordNames: ['doc-2'],
      newToken: 'zone-t2',
    });

    await cloudShare.syncSharedEntities();

    doc = await db.getFirstAsync('SELECT id FROM documents WHERE id = ?', ['doc-2']);
    expect(doc).toBeNull();
    const cloudRec = await db.getFirstAsync(
      'SELECT id FROM cloud_records WHERE zone_name = ? AND record_name = ?',
      ['entity_property_prop-2', 'doc-2']
    );
    expect(cloudRec).toBeNull();
  });
});

describe('pullSharedChanges — atomicitate token DB-level ↔ token per-zonă', () => {
  it('nu avansează tokenul DB-level dacă o zonă din pagină eșuează, dar zona reușită și-a persistat tokenul per-zonă', async () => {
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-3',
      entityType: 'vehicle',
      entityId: 'veh-3',
      role: 'participant',
      ownerName: 'owner1',
    });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-4',
      entityType: 'vehicle',
      entityId: 'veh-4',
      role: 'participant',
      ownerName: 'owner1',
    });
    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-3', ownerName: 'owner1' },
      { zoneName: 'entity_vehicle_veh-4', ownerName: 'owner1' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [
        { zoneName: 'entity_vehicle_veh-3', ownerName: 'owner1' },
        { zoneName: 'entity_vehicle_veh-4', ownerName: 'owner1' },
      ],
      deletedZones: [],
      newToken: 'db-token-final',
    });
    mockNative.fetchZoneChanges
      .mockResolvedValueOnce({ records: [], deletedRecordNames: [], newToken: 'zone-3-token' })
      .mockRejectedValueOnce(new Error('rețea căzută'));

    await cloudShare.syncSharedEntities();

    const dbTokenCalls = AsyncStorage.setItem.mock.calls.filter(
      ([key]: [string]) => key === 'cloudkit_db_change_token_shared'
    );
    expect(dbTokenCalls).toHaveLength(0);

    expect(await sharing.getZoneChangeToken('entity_vehicle_veh-3')).toBe('zone-3-token');

    const failedShare = await sharing.getShareForEntity('vehicle', 'veh-4');
    expect(failedShare!.last_sync_error).toBe('rețea căzută');
  });
});

describe('pushLocalChange — Faza 1: doar owner scrie', () => {
  it('no-op pe entitate nepartajată — fără push, fără rând în coadă', async () => {
    insertVehicle('veh-5');
    await cloudShare.pushLocalChange('vehicles', 'veh-5', 'upsert');
    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(await sharing.getPendingSharePushes()).toHaveLength(0);
  });

  it("'delete' pe entitate owner apelează revokeEntityShare (stopSharing), nu push de delete brut", async () => {
    insertVehicle('veh-6');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-6',
      entityType: 'vehicle',
      entityId: 'veh-6',
      role: 'owner',
    });

    await cloudShare.afterEntityMutation('vehicle', 'veh-6', 'delete');

    expect(mockNative.stopSharing).toHaveBeenCalledWith('entity_vehicle_veh-6');
    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(await sharing.getShareForEntity('vehicle', 'veh-6')).toBeNull();
  });

  it('push de delete pe document DUPĂ ce document_entities a fost deja curățat rezolvă zona din cloud_records', async () => {
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-7',
      entityType: 'vehicle',
      entityId: 'veh-7',
      role: 'owner',
    });
    insertCloudRecord({
      zoneName: 'entity_vehicle_veh-7',
      recordName: 'doc-7',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-7',
    });

    mockNative.pushRecords.mockResolvedValueOnce({ succeeded: { 'doc-7': 'deleted' }, failed: {} });

    await cloudShare.pushLocalChange('documents', 'doc-7', 'delete');

    expect(mockNative.pushRecords).toHaveBeenCalledWith(
      expect.objectContaining({ zoneName: 'entity_vehicle_veh-7', deletions: ['doc-7'] })
    );
  });

  it('push de entitate trimite DOAR câmpurile whitelisted (fără photo_uri)', async () => {
    insertVehicle('veh-8', { photo_uri: 'documents/poza.jpg' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-8',
      entityType: 'vehicle',
      entityId: 'veh-8',
      role: 'owner',
    });

    mockNative.pushRecords.mockResolvedValueOnce({ succeeded: { 'veh-8': 'tag1' }, failed: {} });

    await cloudShare.pushLocalChange('vehicles', 'veh-8', 'upsert');

    const call = mockNative.pushRecords.mock.calls[0][0] as {
      records: { fields: Record<string, string> }[];
    };
    expect(call.records[0].fields.name).toBe('Logan');
    expect(call.records[0].fields.photo_uri).toBeUndefined();
  });
});

describe('pushLocalChange — Faza 2: participant readwrite push-back', () => {
  it('entitate: participant + readwrite → scope=shared + ownerName corect', async () => {
    insertVehicle('veh-rw');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-rw',
      entityType: 'vehicle',
      entityId: 'veh-rw',
      role: 'participant',
      permission: 'readwrite',
      ownerName: 'owner1',
    });

    mockNative.pushRecords.mockResolvedValueOnce({ succeeded: { 'veh-rw': 'tag-rw' }, failed: {} });

    await cloudShare.pushLocalChange('vehicles', 'veh-rw', 'upsert');

    expect(mockNative.pushRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneName: 'entity_vehicle_veh-rw',
        scope: 'shared',
        ownerName: 'owner1',
      })
    );
  });

  it('entitate: participant + read → no-op (regresie Faza 1)', async () => {
    insertVehicle('veh-ro');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-ro',
      entityType: 'vehicle',
      entityId: 'veh-ro',
      role: 'participant',
      permission: 'read',
      ownerName: 'owner1',
    });

    await cloudShare.pushLocalChange('vehicles', 'veh-ro', 'upsert');

    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(await sharing.getPendingSharePushes()).toHaveLength(0);
  });

  it('entitate: participant + readwrite + delete → no-op (decizia 2, doar owner poate șterge zona)', async () => {
    insertVehicle('veh-del');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-del',
      entityType: 'vehicle',
      entityId: 'veh-del',
      role: 'participant',
      permission: 'readwrite',
      ownerName: 'owner1',
    });

    await cloudShare.pushLocalChange('vehicles', 'veh-del', 'delete');

    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(mockNative.stopSharing).not.toHaveBeenCalled();
    expect(await sharing.getPendingSharePushes()).toHaveLength(0);
  });

  it('document: legat de zonă participant+readwrite → scope=shared + ownerName corect', async () => {
    insertDocument('doc-rw', { type: 'talon' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-drw',
      entityType: 'vehicle',
      entityId: 'veh-drw',
      role: 'participant',
      permission: 'readwrite',
      ownerName: 'owner2',
    });
    linkDocumentEntity('link-drw', 'doc-rw', 'vehicle', 'veh-drw');

    mockNative.pushRecords.mockResolvedValueOnce({
      succeeded: { 'doc-rw': 'tag-doc-rw' },
      failed: {},
    });

    await cloudShare.pushLocalChange('documents', 'doc-rw', 'upsert');

    expect(mockNative.pushRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneName: 'entity_vehicle_veh-drw',
        scope: 'shared',
        ownerName: 'owner2',
      })
    );
  });

  it('document: legat DOAR de zonă participant+read → no-op (regresie Faza 1)', async () => {
    insertDocument('doc-ro', { type: 'talon' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-dro',
      entityType: 'vehicle',
      entityId: 'veh-dro',
      role: 'participant',
      permission: 'read',
      ownerName: 'owner2',
    });
    linkDocumentEntity('link-dro', 'doc-ro', 'vehicle', 'veh-dro');

    await cloudShare.pushLocalChange('documents', 'doc-ro', 'upsert');

    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(await sharing.getPendingSharePushes()).toHaveLength(0);
  });
});

describe('pullOwnedChanges — Faza 2: owner-ul trage editările participantului din propria zonă', () => {
  it('aplică editarea participantului peste zona readwrite a owner-ului', async () => {
    insertVehicle('veh-9', { name: 'Logan' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-9',
      entityType: 'vehicle',
      entityId: 'veh-9',
      role: 'owner',
      permission: 'readwrite',
    });

    mockNative.fetchDatabaseChanges.mockImplementation(
      async (opts: { scope: 'shared' | 'private' }) => {
        if (opts.scope === 'private') {
          return {
            changedZones: [{ zoneName: 'entity_vehicle_veh-9', ownerName: null }],
            deletedZones: [],
            newToken: 'db-priv-1',
          };
        }
        return { changedZones: [], deletedZones: [], newToken: null };
      }
    );
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'veh-9',
          recordType: 'vehicle',
          changeTag: 'tag-participant-edit',
          fields: { name: 'Logan Facelift' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'zone-9-token',
    });

    await cloudShare.syncSharedEntities();

    const row = await db.getFirstAsync<{ name: string }>('SELECT name FROM vehicles WHERE id = ?', [
      'veh-9',
    ]);
    expect(row!.name).toBe('Logan Facelift');
    expect(await sharing.getZoneChangeToken('entity_vehicle_veh-9')).toBe('zone-9-token');
  });

  it('nu trage din zone read-only (owner fără readwrite pe nicio zonă → fetchZoneChanges neapelat pentru ea)', async () => {
    insertVehicle('veh-10', { name: 'Dacia' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-10',
      entityType: 'vehicle',
      entityId: 'veh-10',
      role: 'owner',
      permission: 'read',
    });

    mockNative.fetchDatabaseChanges.mockImplementation(
      async (opts: { scope: 'shared' | 'private' }) => {
        if (opts.scope === 'private') {
          return {
            changedZones: [{ zoneName: 'entity_vehicle_veh-10', ownerName: null }],
            deletedZones: [],
            newToken: 'db-priv-2',
          };
        }
        return { changedZones: [], deletedZones: [], newToken: null };
      }
    );

    await cloudShare.syncSharedEntities();

    expect(mockNative.fetchZoneChanges).not.toHaveBeenCalled();
  });
});

describe('applyFetchedRecords — supresie ecou (decizia 4/9, generalizată)', () => {
  it('nu suprascrie o editare locală mai nouă cu propriul ecou (changeTag identic)', async () => {
    insertDocument('doc-echo', { type: 'talon', note: 'nota noua locala' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-echo',
      entityType: 'vehicle',
      entityId: 'veh-echo',
      role: 'participant',
      permission: 'readwrite',
      ownerName: 'owner1',
    });
    linkDocumentEntity('link-echo', 'doc-echo', 'vehicle', 'veh-echo');
    // Bookkeeping-ul unui push anterior — server-ul confirmă ACELAȘI changeTag
    // pe care userul l-a văzut deja aplicat local (editarea a fost făcută DUPĂ).
    await sharing.upsertCloudRecord({
      zoneName: 'entity_vehicle_veh-echo',
      recordName: 'doc-echo',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-echo',
      changeTag: 'tag-current',
    });

    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-echo', ownerName: 'owner1' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-echo', ownerName: 'owner1' }],
      deletedZones: [],
      newToken: 'db-echo-token',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'doc-echo',
          recordType: 'document',
          changeTag: 'tag-current', // ecou — identic cu ce avem deja
          fields: { type: 'talon', note: 'nota veche server' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'zone-echo-token',
    });

    await cloudShare.syncSharedEntities();

    const row = await db.getFirstAsync<{ note: string }>(
      'SELECT note FROM documents WHERE id = ?',
      ['doc-echo']
    );
    expect(row!.note).toBe('nota noua locala'); // NU a fost clobber-uită de ecou
    // Tokenul de zonă tot avansează — pull-ul a rulat, doar apply-ul individual a fost skip-uit.
    expect(await sharing.getZoneChangeToken('entity_vehicle_veh-echo')).toBe('zone-echo-token');
  });

  it('aplică normal când changeTag e diferit (schimbare reală, nu ecou)', async () => {
    insertDocument('doc-real', { type: 'talon', note: 'nota veche' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-real',
      entityType: 'vehicle',
      entityId: 'veh-real',
      role: 'participant',
      permission: 'readwrite',
      ownerName: 'owner1',
    });
    linkDocumentEntity('link-real', 'doc-real', 'vehicle', 'veh-real');
    await sharing.upsertCloudRecord({
      zoneName: 'entity_vehicle_veh-real',
      recordName: 'doc-real',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-real',
      changeTag: 'tag-old',
    });

    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-real', ownerName: 'owner1' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-real', ownerName: 'owner1' }],
      deletedZones: [],
      newToken: 'db-real-token',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'doc-real',
          recordType: 'document',
          changeTag: 'tag-new',
          fields: { type: 'talon', note: 'nota noua server' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'zone-real-token',
    });

    await cloudShare.syncSharedEntities();

    const row = await db.getFirstAsync<{ note: string }>(
      'SELECT note FROM documents WHERE id = ?',
      ['doc-real']
    );
    expect(row!.note).toBe('nota noua server');
    const rec = await sharing.getCloudRecord('entity_vehicle_veh-real', 'doc-real');
    expect(rec!.change_tag).toBe('tag-new');
  });
});

describe('getShareDiagnostics — stuckCount (Faza 3 dead-letter)', () => {
  it('numără doar push-urile cu attempt_count >= 5', async () => {
    insertVehicle('veh-diag1');
    insertVehicle('veh-diag2');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-diag1',
      entityType: 'vehicle',
      entityId: 'veh-diag1',
      role: 'owner',
    });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-diag2',
      entityType: 'vehicle',
      entityId: 'veh-diag2',
      role: 'owner',
    });

    insertPendingPush({
      zoneName: 'entity_vehicle_veh-diag1',
      recordName: 'veh-diag1',
      attemptCount: 5,
    });
    insertPendingPush({
      zoneName: 'entity_vehicle_veh-diag2',
      recordName: 'veh-diag2',
      attemptCount: 6,
    });
    insertPendingPush({
      zoneName: 'entity_vehicle_veh-diag2',
      recordName: 'doc-below',
      attemptCount: 3,
      kind: 'document',
    });

    const diag = await cloudShare.getShareDiagnostics();

    expect(diag.pendingPushCount).toBe(3);
    expect(diag.stuckCount).toBe(2);
  });

  it('0 push-uri în așteptare → stuckCount 0', async () => {
    const diag = await cloudShare.getShareDiagnostics();
    expect(diag.pendingPushCount).toBe(0);
    expect(diag.stuckCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regresiile raportate pe device 2026-07-30 (versiunea 3.11.x din App Store):
// „entitatea partajată apare, dar fără documente" + „entitatea primită nu apare
// nicăieri, fără nicio eroare". Fiecare test de aici este plasa care le prinde.
// ─────────────────────────────────────────────────────────────────────────

describe('document primit prin partajare — vizibil pe ecranul entității', () => {
  it('apare în getDocumentsByEntity, deși nu are coloana legacy vehicle_id setată', async () => {
    insertVehicle('veh-recv', { name: 'Logan primit' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-recv',
      entityType: 'vehicle',
      entityId: 'veh-recv',
      role: 'participant',
      ownerName: 'owner-x',
    });
    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-recv', ownerName: 'owner-x' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-recv', ownerName: 'owner-x' }],
      deletedZones: [],
      newToken: 'db-1',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'doc-recv',
          recordType: 'document',
          changeTag: 't1',
          fields: { type: 'rca', expiry_date: '2027-01-01' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'z-1',
    });

    await cloudShare.syncSharedEntities();

    // Ecranul entității (`app/(tabs)/entitati/[id].tsx`) citește pe această cale.
    const list = await documents.getDocumentsByEntity('vehicle_id', 'veh-recv');
    expect(list.map(d => d.id)).toEqual(['doc-recv']);
  });
});

describe('pullSharedChanges — zonă acceptată în afara ferestrei tokenului DB', () => {
  it('trage o zonă fără change_token chiar dacă fetchDatabaseChanges nu o raportează', async () => {
    insertSharedEntity({
      zoneName: 'entity_person_per-late',
      entityType: 'person',
      entityId: 'per-late',
      role: 'participant',
      ownerName: 'owner-late',
    });
    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_person_per-late', ownerName: 'owner-late' },
    ]);
    // Tokenul DB-level a avansat deja peste acceptarea share-ului: nicio zonă
    // raportată ca schimbată. Fără force-fetch, entitatea nu apărea NICIODATĂ.
    mockNative.fetchDatabaseChanges.mockResolvedValue({
      changedZones: [],
      deletedZones: [],
      newToken: 'db-late',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'per-late',
          recordType: 'person',
          changeTag: 'p1',
          fields: { name: 'Ana Primită', phone: '0700' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'z-late',
    });

    await cloudShare.syncSharedEntities();

    const row = await db.getFirstAsync<{ name: string }>('SELECT name FROM persons WHERE id = ?', [
      'per-late',
    ]);
    expect(row?.name).toBe('Ana Primită');
  });

  it('nu avansează tokenul DB-level când o zonă de-a noastră nu e încă înregistrată local', async () => {
    mockNative.listSharedZones.mockResolvedValue([]); // reconcile nu o prinde încă
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-unknown', ownerName: 'owner-u' }],
      deletedZones: [],
      newToken: 'db-must-not-persist',
    });

    await cloudShare.syncSharedEntities();

    const persisted = AsyncStorage.setItem.mock.calls.filter(c => c[1] === 'db-must-not-persist');
    expect(persisted).toHaveLength(0);
  });
});

describe('applyEntityRow — entitatea primită e vizibilă în lista Entități', () => {
  it('primește un rând în entity_order (altfel se sortează după toate entitățile proprii)', async () => {
    insertSharedEntity({
      zoneName: 'entity_animal_ani-recv',
      entityType: 'animal',
      entityId: 'ani-recv',
      role: 'participant',
      ownerName: 'owner-a',
    });
    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_animal_ani-recv', ownerName: 'owner-a' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_animal_ani-recv', ownerName: 'owner-a' }],
      deletedZones: [],
      newToken: 'db-a',
    });
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'ani-recv',
          recordType: 'animal',
          changeTag: 'a1',
          fields: { name: 'Rex', species: 'câine' },
          assets: [],
        },
      ],
      deletedRecordNames: [],
      newToken: 'z-a',
    });

    await cloudShare.syncSharedEntities();

    const order = await db.getFirstAsync<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM entity_order WHERE entity_type = ? AND entity_id = ?',
      ['animal', 'ani-recv']
    );
    expect(order?.cnt).toBe(1);
  });
});

describe('shareEntity — eșecurile de push nu mai sunt tăcute', () => {
  beforeEach(() => {
    mockNative.createSharedZone.mockResolvedValue({ zoneName: 'z' });
    mockNative.shareZone.mockResolvedValue({
      shareURL: 'https://icloud.com/share/X',
      presented: true,
    });
  });

  it('entitatea picată la push → aruncă, fără invitație și fără rând de share', async () => {
    insertVehicle('veh-fail', { name: 'Duster' });
    mockNative.pushRecords.mockResolvedValue({
      succeeded: {},
      failed: { 'veh-fail': 'Cannot create new type vehicle in production schema' },
    });

    await expect(cloudShare.shareEntity('vehicle', 'veh-fail', 'read')).rejects.toThrow(
      /production schema/
    );
    expect(mockNative.shareZone).not.toHaveBeenCalled();
    expect(await sharing.getShareForEntity('vehicle', 'veh-fail')).toBeNull();
  });

  it('document picat la push → share valid, document în coada de retry + eroare pe zonă', async () => {
    insertVehicle('veh-partial', { name: 'Logan' });
    insertDocument('doc-partial', { type: 'rca' });
    linkDocumentEntity('l-partial', 'doc-partial', 'vehicle', 'veh-partial');
    mockNative.pushRecords.mockResolvedValue({
      succeeded: { 'veh-partial': 'tag-v' },
      failed: { 'doc-partial': 'Field file_page_0 not marked queryable' },
    });

    await cloudShare.shareEntity('vehicle', 'veh-partial', 'read');

    const share = await sharing.getShareForEntity('vehicle', 'veh-partial');
    expect(share).not.toBeNull();
    expect(share!.last_sync_error).toMatch(/nu s-au urcat/);
    const pending = await sharing.getPendingSharePushes();
    expect(pending.map(p => p.record_name)).toEqual(['doc-partial']);
    // Bookkeeping-ul NU pretinde că documentul e pe server.
    expect(await sharing.getCloudRecord('entity_vehicle_veh-partial', 'doc-partial')).toBeNull();
  });

  it('include în bundle documentele legate DOAR prin document_entities (multi-link)', async () => {
    insertVehicle('veh-junction', { name: 'Logan' });
    insertDocument('doc-junction', { type: 'rca' });
    linkDocumentEntity('l-junction', 'doc-junction', 'vehicle', 'veh-junction');
    mockNative.pushRecords.mockResolvedValue({
      succeeded: { 'veh-junction': 'tag-v', 'doc-junction': 'tag-d' },
      failed: {},
    });

    await cloudShare.shareEntity('vehicle', 'veh-junction', 'read');

    const pushed = mockNative.pushRecords.mock.calls[0][0].records.map(
      (r: { recordName: string }) => r.recordName
    );
    expect(pushed).toContain('doc-junction');
  });
});

describe('recordShare — permisiunea participantului nu se retrogradează', () => {
  it('un reconcile fără informație de permisiune păstrează readwrite', async () => {
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-rw',
      entityType: 'vehicle',
      entityId: 'veh-rw',
      role: 'participant',
      ownerName: 'owner-rw',
      permission: 'readwrite',
    });

    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-rw',
      zoneName: 'entity_vehicle_veh-rw',
      role: 'participant',
      ownerName: 'owner-rw',
    });

    const share = await sharing.getShareForEntity('vehicle', 'veh-rw');
    expect(share!.permission).toBe('readwrite');
  });

  it('permisiunea explicită din accept se scrie peste cea existentă', async () => {
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-up',
      entityType: 'vehicle',
      entityId: 'veh-up',
      role: 'participant',
      ownerName: 'owner-up',
      permission: 'read',
    });

    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-up',
      zoneName: 'entity_vehicle_veh-up',
      role: 'participant',
      ownerName: 'owner-up',
      permission: 'readwrite',
      shareTitle: 'Logan de la Ana',
    });

    const share = await sharing.getShareForEntity('vehicle', 'veh-up');
    expect(share!.permission).toBe('readwrite');
    expect(share!.share_title).toBe('Logan de la Ana');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Format pagini v2: fiecare pagină = CKRecord `document_page` cu câmpuri FIXE.
// Vechiul format punea asset-urile în câmpuri `file_page_<N>`, cu nume derivat
// din numărul de pagini — imposibil de publicat în schema Production, care e
// blocată: primul document cu o pagină în plus era respins integral de server.
// ─────────────────────────────────────────────────────────────────────────

function insertPage(id: string, documentId: string, order: number, filePath: string): void {
  testDb._raw
    .prepare(
      `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, documentId, order, filePath, '2026-07-01T00:00:00Z');
}

describe('push pagini — recorduri separate, fără câmpuri cu nume dinamic', () => {
  it('un document cu 2 pagini produce 3 recorduri, toate cu chei fixe', async () => {
    insertVehicle('veh-pg');
    insertDocument('doc-pg', { type: 'talon', file_path: 'documents/main.jpg' });
    insertPage('pg-a', 'doc-pg', 0, 'documents/p0.jpg');
    insertPage('pg-b', 'doc-pg', 1, 'documents/p1.jpg');
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-pg',
      entityType: 'vehicle',
      entityId: 'veh-pg',
      role: 'owner',
    });
    linkDocumentEntity('l-pg', 'doc-pg', 'vehicle', 'veh-pg');

    await cloudShare.pushLocalChange('documents', 'doc-pg', 'upsert');

    const call = mockNative.pushRecords.mock.calls[0][0];
    const names = call.records.map((r: { recordName: string }) => r.recordName);
    expect(names).toEqual(['doc-pg', 'doc-pg__p__pg-a', 'doc-pg__p__pg-b']);

    const keys = call.records.flatMap((r: { files?: { key: string }[] }) =>
      (r.files ?? []).map(f => f.key)
    );
    expect(keys).toEqual(['file_main', 'file', 'file']);
    expect(keys.some((k: string) => k.startsWith('file_page_'))).toBe(false);
  });

  it('pagină ștearsă local → tombstone pe recordul ei, documentul rămâne', async () => {
    insertVehicle('veh-del');
    insertDocument('doc-del', { type: 'talon' });
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-del',
      entityType: 'vehicle',
      entityId: 'veh-del',
      role: 'owner',
    });
    linkDocumentEntity('l-del', 'doc-del', 'vehicle', 'veh-del');
    // Pagina există pe server (bookkeeping), dar nu mai există local.
    insertCloudRecord({
      zoneName: 'entity_vehicle_veh-del',
      recordName: 'doc-del__p__pg-gone',
      recordType: 'document_page',
      localTable: 'document_pages',
      localId: 'pg-gone',
    });

    await cloudShare.pushLocalChange('documents', 'doc-del', 'upsert');

    const call = mockNative.pushRecords.mock.calls[0][0];
    expect(call.deletions).toEqual(['doc-del__p__pg-gone']);
    expect(call.records.map((r: { recordName: string }) => r.recordName)).toEqual(['doc-del']);
  });
});

describe('pull pagini — record `document_page` → rând în document_pages', () => {
  beforeEach(() => {
    insertSharedEntity({
      zoneName: 'entity_vehicle_veh-in',
      entityType: 'vehicle',
      entityId: 'veh-in',
      role: 'participant',
      ownerName: 'owner-in',
    });
    mockNative.listSharedZones.mockResolvedValue([
      { zoneName: 'entity_vehicle_veh-in', ownerName: 'owner-in' },
    ]);
    mockNative.fetchDatabaseChanges.mockResolvedValueOnce({
      changedZones: [{ zoneName: 'entity_vehicle_veh-in', ownerName: 'owner-in' }],
      deletedZones: [],
      newToken: 'db-in',
    });
  });

  it('aplică pagina primită, chiar dacă vine înaintea documentului ei', async () => {
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [
        {
          recordName: 'doc-in__p__pg-1',
          recordType: 'document_page',
          changeTag: 'p1',
          fields: { document_id: 'doc-in', page_order: '2' },
          assets: [{ key: 'file', path: '/tmp/ck/p1.jpg' }],
        },
        {
          recordName: 'doc-in',
          recordType: 'document',
          changeTag: 'd1',
          fields: { type: 'talon' },
          assets: [{ key: 'file_main', path: '/tmp/ck/main.jpg' }],
        },
      ],
      deletedRecordNames: [],
      newToken: 'z-in',
    });

    await cloudShare.syncSharedEntities();

    const page = await db.getFirstAsync<{
      document_id: string;
      page_order: number;
      file_path: string;
    }>('SELECT document_id, page_order, file_path FROM document_pages WHERE id = ?', [
      'doc-in__p__pg-1',
    ]);
    expect(page?.document_id).toBe('doc-in');
    expect(page?.page_order).toBe(2);
    expect(page?.file_path).toContain('shared/entity_vehicle_veh-in/');
  });

  it('ștergerea unei pagini pe server nu atinge documentul-părinte', async () => {
    insertDocument('doc-keep', { type: 'talon' });
    insertPage('doc-keep__p__pg-x', 'doc-keep', 0, 'shared/z/pg-x.jpg');
    linkDocumentEntity('l-keep', 'doc-keep', 'vehicle', 'veh-in');
    mockNative.fetchZoneChanges.mockResolvedValueOnce({
      records: [],
      deletedRecordNames: ['doc-keep__p__pg-x'],
      newToken: 'z-in2',
    });

    await cloudShare.syncSharedEntities();

    const page = await db.getFirstAsync('SELECT id FROM document_pages WHERE id = ?', [
      'doc-keep__p__pg-x',
    ]);
    expect(page).toBeNull();
    const doc = await db.getFirstAsync('SELECT id FROM documents WHERE id = ?', ['doc-keep']);
    expect(doc).not.toBeNull();
  });
});
