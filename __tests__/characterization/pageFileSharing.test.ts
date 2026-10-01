/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Regresie permis (2026-05 → raportat 2026-10-01): două pagini ale aceluiași document
 * împărțeau ACELAȘI fișier (`doc_${Date.now()}.jpg` în aceeași milisecundă). Efect:
 * pagina apărea de 2 ori, ștergerea/rotirea uneia o afecta pe cealaltă.
 *
 * Plase:
 *   1. uniqueDocFilename nu produce coliziuni.
 *   2. addDocumentPage e idempotent pe același fișier.
 *   3. removeDocumentPage NU șterge de pe disc un fișier încă referit.
 *   4. getDocumentById autorepară paginile care împart un fișier (copie proprie).
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
let FileSystem: typeof import('expo-file-system/legacy');
let addDocumentPage: typeof import('@/services/documents').addDocumentPage;
let removeDocumentPage: typeof import('@/services/documents').removeDocumentPage;
let getDocumentById: typeof import('@/services/documents').getDocumentById;
let uniqueDocFilename: typeof import('@/services/documentPageStorage').uniqueDocFilename;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    FileSystem = require('expo-file-system/legacy');
    const docs = require('@/services/documents');
    addDocumentPage = docs.addDocumentPage;
    removeDocumentPage = docs.removeDocumentPage;
    getDocumentById = docs.getDocumentById;
    uniqueDocFilename = require('@/services/documentPageStorage').uniqueDocFilename;
  });
});

beforeEach(() => {
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of ['document_pages', 'documents']) testDb._raw.exec(`DELETE FROM ${t}`);
  testDb._raw.pragma('foreign_keys = ON');
  jest.clearAllMocks();
});

const TS = '2026-01-01T00:00:00Z';
async function seedDoc(): Promise<void> {
  await db.runAsync(
    `INSERT INTO documents (id, type, file_path, created_at) VALUES ('d1', 'permis_auto', 'documents/main.jpg', ?)`,
    [TS]
  );
}
async function seedSharedPages(): Promise<void> {
  await seedDoc();
  for (const [id, order] of [
    ['p2', 0],
    ['p3', 1],
  ] as const) {
    await db.runAsync(
      `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at) VALUES (?, 'd1', ?, 'documents/shared.jpg', ?)`,
      [id, order, TS]
    );
  }
}

describe('uniqueDocFilename', () => {
  it('nu produce coliziuni în aceeași milisecundă', () => {
    const names = new Set(Array.from({ length: 500 }, () => uniqueDocFilename('jpg')));
    expect(names.size).toBe(500);
  });
});

describe('addDocumentPage', () => {
  it('e idempotent pe același fișier', async () => {
    await seedDoc();
    const a = await addDocumentPage('d1', 'documents/x.jpg');
    const b = await addDocumentPage('d1', 'documents/x.jpg');
    expect(b).toBe(a);
    const n = testDb._raw.prepare('SELECT COUNT(*) n FROM document_pages').get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('removeDocumentPage', () => {
  it('nu șterge fișierul de pe disc cât mai e referit de altă pagină', async () => {
    await seedSharedPages();
    await removeDocumentPage('p2');
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    const left = testDb._raw.prepare('SELECT id FROM document_pages').all() as { id: string }[];
    expect(left.map(r => r.id)).toEqual(['p3']);
  });

  it('șterge fișierul când ultima referință dispare', async () => {
    await seedDoc();
    const id = await addDocumentPage('d1', 'documents/solo.jpg');
    await removeDocumentPage(id);
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  });
});

describe('autoreparare pagini care împart un fișier', () => {
  it('fiecare pagină ajunge cu fișier propriu (copiat)', async () => {
    await seedSharedPages();
    const doc = await getDocumentById('d1');
    const paths = (doc?.pages ?? []).map(p => p.file_path);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    expect(FileSystem.copyAsync).toHaveBeenCalledTimes(1);
  });
});
