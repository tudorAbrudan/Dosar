/**
 * Fixture-uri comune pentru testele de partajare CloudKit (ștergere / oprire /
 * confirmări): mock-ul modulului nativ și seed-uri SQL directe în DB-ul de test.
 *
 * Folosire:
 *   const mockNative = createMockCloudKit();
 *   jest.mock('@/modules/expo-cloudkit-share/src', () => mockNative);
 *   ...
 *   const seed = shareSeed(testDb);
 */
import type { TestDb } from './testDb';

export function createMockCloudKit() {
  return {
    isAvailable: jest.fn(),
    createSharedZone: jest.fn(),
    shareZone: jest.fn(),
    listSharedZones: jest.fn(),
    fetchShareInfo: jest.fn(),
    fetchShareParticipants: jest.fn(),
    deleteZone: jest.fn(),
    leaveShare: jest.fn(),
    fetchZoneChanges: jest.fn(),
    fetchDatabaseChanges: jest.fn(),
    pushRecords: jest.fn(),
    subscribeDatabase: jest.fn(),
    addRemoteChangeListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

export type MockCloudKit = ReturnType<typeof createMockCloudKit>;

/**
 * Valori implicite: cont iCloud disponibil, nimic de tras sau de trimis, un
 * participant care încă n-a ieșit (o închidere nu se încheie singură).
 */
export function resetMockCloudKit(mock: MockCloudKit): void {
  jest.clearAllMocks();
  // Valorile `…Once` nefolosite (zone excluse care nu se mai trag) nu trec în testul următor.
  mock.fetchZoneChanges.mockReset();
  mock.fetchDatabaseChanges.mockReset();
  mock.fetchShareParticipants.mockReset();
  mock.isAvailable.mockResolvedValue({ available: true, accountStatus: 'available' });
  mock.listSharedZones.mockResolvedValue([]);
  mock.fetchShareInfo.mockResolvedValue({});
  mock.fetchShareParticipants.mockResolvedValue([{ id: 'user-ana', status: 'accepted' }]);
  mock.subscribeDatabase.mockResolvedValue({ subscribed: true });
  mock.pushRecords.mockResolvedValue({ succeeded: {}, failed: {} });
  mock.deleteZone.mockResolvedValue({ deleted: true });
  mock.leaveShare.mockResolvedValue({ left: true });
  mock.fetchDatabaseChanges.mockResolvedValue({
    changedZones: [],
    deletedZones: [],
    newToken: null,
  });
  mock.fetchZoneChanges.mockResolvedValue({
    records: [],
    deletedRecordNames: [],
    newToken: null,
  });
}

export function resetSchema(testDb: TestDb): void {
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

export interface ShareSeedRow {
  zoneName: string;
  entityId: string;
  role: 'owner' | 'participant';
  ownerName?: string;
  permission?: 'read' | 'readwrite';
  deleteRequestedAt?: string;
  deleteSentAt?: string;
  stopRequestedAt?: string;
  stopSentAt?: string;
  closingParticipants?: string;
  ownerStoppedAt?: string;
}

/** Seed-uri INSERT directe (ca în `cloudShare.test.ts`), legate de DB-ul de test. */
export function shareSeed(testDb: TestDb) {
  function run(sql: string, ...params: (string | number | null)[]): void {
    testDb._raw.prepare(sql).run(...params);
  }

  return {
    run,

    insertVehicle(id: string, name = 'Dacia'): void {
      run('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', id, name, '2026-07-01');
    },

    insertPerson(id: string, name = 'Ana'): void {
      run('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', id, name, '2026-07-01');
    },

    insertDocument(id: string, vehicleId: string | null = null): void {
      run(
        'INSERT INTO documents (id, type, vehicle_id, created_at) VALUES (?, ?, ?, ?)',
        id,
        'talon',
        vehicleId,
        '2026-07-01'
      );
    },

    link(id: string, documentId: string, entityType: string, entityId: string): void {
      run(
        'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
        id,
        documentId,
        entityType,
        entityId
      );
    },

    /** Partajare pe un vehicul, titlul „Dacia". */
    insertShare(params: ShareSeedRow): void {
      run(
        `INSERT INTO shared_entities
           (id, entity_type, entity_id, zone_name, role, permission, owner_name, share_title,
            created_at, delete_requested_at, delete_sent_at, stop_requested_at, stop_sent_at,
            closing_participants, owner_stopped_at)
         VALUES (?, 'vehicle', ?, ?, ?, ?, ?, 'Dacia', ?, ?, ?, ?, ?, ?, ?)`,
        `se_${params.zoneName}`,
        params.entityId,
        params.zoneName,
        params.role,
        params.permission ?? 'read',
        params.ownerName ?? null,
        '2026-07-01',
        params.deleteRequestedAt ?? null,
        params.deleteSentAt ?? null,
        params.stopRequestedAt ?? null,
        params.stopSentAt ?? null,
        params.closingParticipants ?? null,
        params.ownerStoppedAt ?? null
      );
    },

    insertCloudRecord(zoneName: string, recordName: string, recordType: string): void {
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
    },

    insertPendingPush(
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
    },

    shareRow(zoneName: string): Record<string, string | null> {
      return testDb._raw
        .prepare('SELECT * FROM shared_entities WHERE zone_name = ?')
        .get(zoneName) as Record<string, string | null>;
    },

    pendingPushes(zoneName: string): unknown[] {
      return testDb._raw
        .prepare('SELECT id FROM pending_share_pushes WHERE zone_name = ?')
        .all(zoneName);
    },

    exists(table: string, id: string): boolean {
      return !!testDb._raw.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
    },
  };
}
