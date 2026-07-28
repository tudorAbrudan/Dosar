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
let AsyncStorage: { setItem: jest.Mock; getItem: jest.Mock };

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    sharing = require('@/services/sharing');
    cloudShare = require('@/services/cloudShare');
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
  mockNative.subscribeDatabase.mockResolvedValue({ subscribed: true });
  mockNative.pushRecords.mockResolvedValue({ succeeded: {}, failed: {} });
  mockNative.stopSharing.mockResolvedValue({ revoked: true });
  mockNative.fetchDatabaseChanges.mockResolvedValue({ changedZones: [], deletedZones: [], newToken: null });
  mockNative.fetchZoneChanges.mockResolvedValue({ records: [], deletedRecordNames: [], newToken: null });
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

function linkDocumentEntity(id: string, documentId: string, entityType: string, entityId: string): void {
  testDb._raw
    .prepare(`INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
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

    mockNative.listSharedZones.mockResolvedValue([{ zoneName: 'entity_vehicle_veh-1', ownerName: 'owner1' }]);
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
    insertSharedEntity({ zoneName: 'entity_vehicle_veh-6', entityType: 'vehicle', entityId: 'veh-6', role: 'owner' });

    await cloudShare.afterEntityMutation('vehicle', 'veh-6', 'delete');

    expect(mockNative.stopSharing).toHaveBeenCalledWith('entity_vehicle_veh-6');
    expect(mockNative.pushRecords).not.toHaveBeenCalled();
    expect(await sharing.getShareForEntity('vehicle', 'veh-6')).toBeNull();
  });

  it('push de delete pe document DUPĂ ce document_entities a fost deja curățat rezolvă zona din cloud_records', async () => {
    insertSharedEntity({ zoneName: 'entity_vehicle_veh-7', entityType: 'vehicle', entityId: 'veh-7', role: 'owner' });
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
    insertSharedEntity({ zoneName: 'entity_vehicle_veh-8', entityType: 'vehicle', entityId: 'veh-8', role: 'owner' });

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
      expect.objectContaining({ zoneName: 'entity_vehicle_veh-rw', scope: 'shared', ownerName: 'owner1' })
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

    mockNative.pushRecords.mockResolvedValueOnce({ succeeded: { 'doc-rw': 'tag-doc-rw' }, failed: {} });

    await cloudShare.pushLocalChange('documents', 'doc-rw', 'upsert');

    expect(mockNative.pushRecords).toHaveBeenCalledWith(
      expect.objectContaining({ zoneName: 'entity_vehicle_veh-drw', scope: 'shared', ownerName: 'owner2' })
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

    const row = await db.getFirstAsync<{ note: string }>('SELECT note FROM documents WHERE id = ?', [
      'doc-echo',
    ]);
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

    const row = await db.getFirstAsync<{ note: string }>('SELECT note FROM documents WHERE id = ?', [
      'doc-real',
    ]);
    expect(row!.note).toBe('nota noua server');
    const rec = await sharing.getCloudRecord('entity_vehicle_veh-real', 'doc-real');
    expect(rec!.change_tag).toBe('tag-new');
  });
});

describe('getShareDiagnostics — stuckCount (Faza 3 dead-letter)', () => {
  it('numără doar push-urile cu attempt_count >= 5', async () => {
    insertVehicle('veh-diag1');
    insertVehicle('veh-diag2');
    insertSharedEntity({ zoneName: 'entity_vehicle_veh-diag1', entityType: 'vehicle', entityId: 'veh-diag1', role: 'owner' });
    insertSharedEntity({ zoneName: 'entity_vehicle_veh-diag2', entityType: 'vehicle', entityId: 'veh-diag2', role: 'owner' });

    insertPendingPush({ zoneName: 'entity_vehicle_veh-diag1', recordName: 'veh-diag1', attemptCount: 5 });
    insertPendingPush({ zoneName: 'entity_vehicle_veh-diag2', recordName: 'veh-diag2', attemptCount: 6 });
    insertPendingPush({ zoneName: 'entity_vehicle_veh-diag2', recordName: 'doc-below', attemptCount: 3, kind: 'document' });

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
