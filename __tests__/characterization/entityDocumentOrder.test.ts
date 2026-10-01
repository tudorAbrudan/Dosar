/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Ordinea manuală a documentelor dintr-o entitate (drag & drop, 2026-10-01).
 *  - setEntityDocumentOrder → getDocumentsByEntity respectă ordinea (și pentru documente
 *    legate doar prin coloana legacy, fără rând în document_entities)
 *  - documentele noi (fără sort_order) apar primele
 *  - ordinea e per entitate (altă entitate a aceluiași document nu e afectată)
 *  - ordinea supraviețuiește export → wipe → restore
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
let getDocumentsByEntity: typeof import('@/services/documents').getDocumentsByEntity;
let setEntityDocumentOrder: typeof import('@/services/documents').setEntityDocumentOrder;
let applyManifest: typeof import('@/services/backup').applyManifest;
let buildManifestPayload: typeof import('@/services/cloudSync').buildManifestPayload;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    const docs = require('@/services/documents');
    getDocumentsByEntity = docs.getDocumentsByEntity;
    setEntityDocumentOrder = docs.setEntityDocumentOrder;
    applyManifest = require('@/services/backup').applyManifest;
    buildManifestPayload = require('@/services/cloudSync').buildManifestPayload;
  });
});

function resetSchema(): void {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_') || t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* shadow tables FTS */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}
beforeEach(resetSchema);

const TS = '2026-01-01T00:00:00Z';

async function seed(): Promise<void> {
  await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [
    'p1',
    'Ana',
    TS,
  ]);
  await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [
    'p2',
    'Bob',
    TS,
  ]);
  // Trei documente legate de Ana DOAR prin coloana legacy; data emiterii dă ordinea implicită.
  for (const [id, type, issued] of [
    ['d1', 'buletin', '2026-03-01'],
    ['d2', 'pasaport', '2026-02-01'],
    ['d3', 'permis_auto', '2026-01-01'],
  ]) {
    await db.runAsync(
      'INSERT INTO documents (id, type, person_id, issue_date, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, type, 'p1', issued, TS]
    );
  }
}

const ids = (docs: { id: string }[]): string[] => docs.map(d => d.id);

describe('ordinea documentelor dintr-o entitate', () => {
  it('fără reordonare: ordinea implicită (data emiterii, descrescător)', async () => {
    await seed();
    expect(ids(await getDocumentsByEntity('person_id', 'p1'))).toEqual(['d1', 'd2', 'd3']);
  });

  it('respectă ordinea manuală, inclusiv pentru legături doar legacy', async () => {
    await seed();
    await setEntityDocumentOrder('person', 'p1', ['d3', 'd1', 'd2']);
    expect(ids(await getDocumentsByEntity('person_id', 'p1'))).toEqual(['d3', 'd1', 'd2']);
  });

  it('un document nou (fără sort_order) apare primul', async () => {
    await seed();
    await setEntityDocumentOrder('person', 'p1', ['d3', 'd1', 'd2']);
    await db.runAsync(
      'INSERT INTO documents (id, type, person_id, issue_date, created_at) VALUES (?, ?, ?, ?, ?)',
      ['d4', 'talon', 'p1', '2020-01-01', TS]
    );
    expect(ids(await getDocumentsByEntity('person_id', 'p1'))[0]).toBe('d4');
  });

  it('ordinea e per entitate', async () => {
    await seed();
    await db.runAsync(
      'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      ['l1', 'd1', 'person', 'p2']
    );
    await db.runAsync(
      'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      ['l2', 'd2', 'person', 'p2']
    );
    await setEntityDocumentOrder('person', 'p1', ['d3', 'd2', 'd1']);
    expect(ids(await getDocumentsByEntity('person_id', 'p2'))).toEqual(['d1', 'd2']);
  });

  it('ordinea supraviețuiește export → wipe → restore', async () => {
    await seed();
    await setEntityDocumentOrder('person', 'p1', ['d3', 'd1', 'd2']);
    const payload = await buildManifestPayload();
    await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });
    const person = testDb._raw.prepare("SELECT id FROM persons WHERE name = 'Ana'").get() as {
      id: string;
    };
    const restored = await getDocumentsByEntity('person_id', person.id);
    expect(restored.map(d => d.type)).toEqual(['permis_auto', 'buletin', 'pasaport']);
  });
});
