/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — ordinea documentelor după data emiterii.
 *
 * getDocuments() și getDocumentsByEntity() ordonează: documentele cu issue_date
 * primele (desc), cele fără issue_date la coadă, created_at DESC ca tiebreaker.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let getDocuments: typeof import('@/services/documents').getDocuments;
let getDocumentsByEntity: typeof import('@/services/documents').getDocumentsByEntity;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    const documents = require('@/services/documents');
    getDocuments = documents.getDocuments;
    getDocumentsByEntity = documents.getDocumentsByEntity;
  });
});

function resetSchema(): void {
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
      /* virtual/shadow tables */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

function insertDoc(
  id: string,
  issueDate: string | null,
  createdAt: string,
  vehicleId: string | null = null
): void {
  testDb._raw
    .prepare(
      `INSERT INTO documents (id, type, issue_date, expiry_date, created_at, vehicle_id)
       VALUES (?, 'factura', ?, NULL, ?, ?)`
    )
    .run(id, issueDate, createdAt, vehicleId);
}

describe('getDocuments — ordine după issue_date', () => {
  it('issue_date are prioritate peste created_at; fără-dată la coadă; created_at tiebreaker', async () => {
    // B emis mai recent dar creat ÎNAINTE de A → B tot înaintea lui A (issue_date primar).
    insertDoc('B', '2026-06-01', '2026-01-01T00:00:00Z');
    insertDoc('A', '2026-05-01', '2026-02-01T00:00:00Z');
    // C, D fără issue_date → la coadă, între ele created_at DESC (D 04 înaintea lui C 03).
    insertDoc('C', null, '2026-03-01T00:00:00Z');
    insertDoc('D', '', '2026-04-01T00:00:00Z');

    const ids = (await getDocuments()).map(d => d.id);
    expect(ids).toEqual(['B', 'A', 'D', 'C']);
  });
});

describe('getDocumentsByEntity — aceeași ordine', () => {
  it('ordonează documentele unei entități după issue_date desc, fără-dată la coadă', async () => {
    insertDoc('v-late', '2026-06-01', '2026-01-01T00:00:00Z', 'veh1');
    insertDoc('v-early', '2026-03-01', '2026-02-01T00:00:00Z', 'veh1');
    insertDoc('v-none', null, '2026-05-01T00:00:00Z', 'veh1');

    const ids = (await getDocumentsByEntity('vehicle_id', 'veh1')).map(d => d.id);
    expect(ids).toEqual(['v-late', 'v-early', 'v-none']);
  });
});
