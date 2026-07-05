/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — getDocumentsForAI() exclude documentele medicale.
 *
 * Garanție GDPR: chatbot-ul general (singurul consumator al getDocumentsForAI)
 * nu primește niciun document medical. Vezi
 * docs/superpowers/specs/2026-06-04-exclude-medical-from-general-chat-design.md
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
let getDocumentsForAI: typeof import('@/services/documents').getDocumentsForAI;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    getDocumentsForAI = require('@/services/documents').getDocumentsForAI;
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

function insertDoc(id: string, type: string, note: string): void {
  testDb._raw
    .prepare(
      `INSERT INTO documents (id, type, issue_date, expiry_date, created_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, type, '2026-05-24', null, '2026-05-24T00:00:00Z', note);
}

describe('getDocumentsForAI — excludere documente medicale', () => {
  it('exclude un document medical și păstrează unul non-medical', async () => {
    insertDoc('doc-medical', 'analize_medicale', 'Glucoză: 95 mg/dL (ref: 70-99)');
    insertDoc('doc-factura', 'factura', 'Furnizor: E.ON, Total: 225 RON');

    const docs = await getDocumentsForAI();
    const ids = docs.map(d => d.id);

    expect(ids).toContain('doc-factura');
    expect(ids).not.toContain('doc-medical');
    expect(JSON.stringify(docs)).not.toContain('Glucoză');
  });

  it('exclude TOATE tipurile din MEDICAL_DOC_TYPES', async () => {
    const { MEDICAL_DOC_TYPES } = require('@/types');
    let i = 0;
    for (const t of MEDICAL_DOC_TYPES) insertDoc(`med-${i++}`, t, 'date clinice');
    insertDoc('non-med', 'buletin', 'CI');

    const docs = await getDocumentsForAI();
    const types = new Set(docs.map(d => d.type));
    for (const t of MEDICAL_DOC_TYPES) expect(types.has(t)).toBe(false);
    expect(docs.map(d => d.id)).toContain('non-med');
  });

  it('exclude documentele non-medicale ca tip dar legate de un dosar medical', async () => {
    insertDoc('doc-altul-medical', 'altul', 'Radiografie veche, adusă de acasă');
    insertDoc('doc-altul-liber', 'altul', 'Chitanță parcare');
    testDb._raw
      .prepare(
        `INSERT INTO persons (id, name, created_at) VALUES ('pers-1', 'Ana', '2026-05-24T00:00:00Z')`
      )
      .run();
    testDb._raw
      .prepare(
        `INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at)
         VALUES ('mr-1', 'pers-1', 'Ana', 'key-ref-1', '2026-05-24T00:00:00Z', '2026-05-24T00:00:00Z')`
      )
      .run();
    testDb._raw
      .prepare(
        `INSERT INTO document_entities (id, document_id, entity_type, entity_id)
         VALUES ('link-1', 'doc-altul-medical', 'medical_record', 'mr-1')`
      )
      .run();

    const docs = await getDocumentsForAI();
    const ids = docs.map(d => d.id);

    expect(ids).toContain('doc-altul-liber');
    expect(ids).not.toContain('doc-altul-medical');
    expect(JSON.stringify(docs)).not.toContain('Radiografie');
  });

  it('scoate private_notes de pe documentele non-medicale rămase', async () => {
    testDb._raw
      .prepare(
        `INSERT INTO documents (id, type, issue_date, expiry_date, created_at, note, private_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('doc-priv', 'factura', '2026-05-24', null, '2026-05-24T00:00:00Z', 'notă publică', 'CVV_SECRET_123');

    const docs = await getDocumentsForAI();
    const doc = docs.find(d => d.id === 'doc-priv');
    expect(doc).toBeDefined();
    expect(doc!.private_notes).toBeUndefined();
    expect(JSON.stringify(docs)).not.toContain('CVV_SECRET_123');
  });
});
