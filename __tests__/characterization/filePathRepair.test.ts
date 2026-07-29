/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — reparare căi de fișiere (regresie 2026-07-29).
 *
 * Simptom raportat: pozele unui document („Carte auto" — CIV Westfalia) nu se
 * mai afișau, iar „Trimite documentul la AI" eșua cu „Calling the
 * 'readAsStringAsync' function has failed → Caused by: File
 * '/var/mobile/Containers/Data/Application/<UUID>/Documents/documents/...'".
 *
 * Cauza reală, confirmată pe device (inspecție container 2026-07-29): ambele
 * `document_pages.file_path` erau RELATIVE și corecte, dar fișierele lipseau de
 * pe disc — 2 din 58 de referințe. Recuperarea a venit din fișierele orfane
 * (originalele dinainte de decupare, păstrate în `documents/`).
 *
 * Serviciul acoperă ambele moduri de eșec: căi absolute rămase din formatul
 * vechi (rescriere) ȘI fișiere efectiv lipsă (raportare, fără ștergere) —
 * lipsa raportării e motivul pentru care problema a fost invizibilă până când
 * userul a apăsat „Trimite la AI".
 *
 * Lock-uiește:
 *   1. Cale absolută din container VECHI → rescrisă la calea relativă a
 *      fișierului real de pe disc (basename identic).
 *   2. Cale absolută din containerul CURENT → normalizată la relativ (ca să nu
 *      se rupă la următoarea schimbare de container).
 *   3. Fișier care chiar lipsește → raportat, NU șters din DB (documentul și
 *      textul lui OCR rămân recuperabile dintr-un backup).
 *   4. Basename ambiguu (același nume în două foldere) → nereparat, ca să nu
 *      legăm un document de fișierul altuia.
 *   5. Poza vehiculului (`vehicles.photo_uri`) trece prin aceeași reparare.
 *   6. Idempotență: a doua rulare nu mai are ce repara.
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
let repairFilePaths: typeof import('@/services/filePathRepair').repairFilePaths;
let applySchemaToTestDb: typeof import('../helpers/testDbSetup').applySchemaToTestDb;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    FileSystem = require('expo-file-system/legacy');
    repairFilePaths = require('@/services/filePathRepair').repairFilePaths;
    applySchemaToTestDb = require('../helpers/testDbSetup').applySchemaToTestDb;
  });
  applySchemaToTestDb(testDb);
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
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

const TS = '2026-01-01T00:00:00Z';
/** UUID-ul containerului de la momentul salvării documentului (nu mai există). */
const OLD_CONTAINER =
  '/var/mobile/Containers/Data/Application/BCEED7EF-41A4-4678-A26E-86993CAFB9D1';

/** Simulează conținutul de pe disc: folder relativ → fișiere. */
function mockDisk(dirs: Record<string, string[]>): void {
  (FileSystem.readDirectoryAsync as jest.Mock).mockImplementation(async (uri: string) => {
    const rel = uri.replace('file:///test/Documents/', '').replace(/\/$/, '');
    const files = dirs[rel];
    if (!files) throw new Error(`Directory '${uri}' does not exist`);
    return files;
  });
}

async function seedDoc(id: string, filePath: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO documents (id, type, file_path, created_at, ocr_text) VALUES (?, ?, ?, ?, ?)',
    [id, 'talon', filePath, TS, 'ANVELOPE 215/70 R15C']
  );
}

beforeEach(() => {
  resetSchema();
  jest.clearAllMocks();
});

describe('repairFilePaths', () => {
  it('rescrie calea absolută dintr-un container vechi la calea relativă reală', async () => {
    mockDisk({ documents: ['doc_1753000000000.jpg'], vehicles: [] });
    await seedDoc('d1', `${OLD_CONTAINER}/Documents/documents/doc_1753000000000.jpg`);

    const report = await repairFilePaths();

    expect(report.repaired).toBe(1);
    expect(report.missing).toBe(0);
    const row = await db.getFirstAsync<{ file_path: string }>(
      'SELECT file_path FROM documents WHERE id = ?',
      ['d1']
    );
    expect(row?.file_path).toBe('documents/doc_1753000000000.jpg');
  });

  it('normalizează la relativ o cale absolută din containerul curent', async () => {
    mockDisk({ documents: ['doc_2.jpg'], vehicles: [] });
    await seedDoc('d1', 'file:///test/Documents/documents/doc_2.jpg');

    const report = await repairFilePaths();

    expect(report.repaired).toBe(1);
    const row = await db.getFirstAsync<{ file_path: string }>(
      'SELECT file_path FROM documents WHERE id = ?',
      ['d1']
    );
    expect(row?.file_path).toBe('documents/doc_2.jpg');
  });

  it('raportează fișierele chiar lipsă FĂRĂ să șteargă documentul', async () => {
    mockDisk({ documents: [], vehicles: [] });
    await seedDoc('d1', 'documents/doc_disparut.jpg');

    const report = await repairFilePaths();

    expect(report.missing).toBe(1);
    expect(report.repaired).toBe(0);
    expect(report.missingSamples).toContain('doc_disparut.jpg');
    const row = await db.getFirstAsync<{ file_path: string; ocr_text: string }>(
      'SELECT file_path, ocr_text FROM documents WHERE id = ?',
      ['d1']
    );
    expect(row?.file_path).toBe('documents/doc_disparut.jpg');
    expect(row?.ocr_text).toContain('ANVELOPE');
  });

  it('nu repară când basename-ul e ambiguu (același nume în două foldere)', async () => {
    mockDisk({ documents: ['dubla.jpg'], vehicles: ['dubla.jpg'] });
    await seedDoc('d1', `${OLD_CONTAINER}/Documents/documents/dubla.jpg`);

    const report = await repairFilePaths();

    expect(report.repaired).toBe(0);
    expect(report.missing).toBe(1);
  });

  it('repară și paginile documentului și poza vehiculului', async () => {
    mockDisk({ documents: ['doc_p1.jpg'], vehicles: ['v1.jpg'] });
    await seedDoc('d1', 'documents/doc_p1.jpg');
    await db.runAsync(
      'INSERT INTO document_pages (id, document_id, page_order, file_path, created_at) VALUES (?, ?, ?, ?, ?)',
      ['pg1', 'd1', 1, `${OLD_CONTAINER}/Documents/documents/doc_p1.jpg`, TS]
    );
    await db.runAsync(
      'INSERT INTO vehicles (id, name, photo_uri, created_at) VALUES (?, ?, ?, ?)',
      ['v1', 'Westfalia', `${OLD_CONTAINER}/Documents/vehicles/v1.jpg`, TS]
    );

    const report = await repairFilePaths();

    expect(report.missing).toBe(0);
    const page = await db.getFirstAsync<{ file_path: string }>(
      'SELECT file_path FROM document_pages WHERE id = ?',
      ['pg1']
    );
    const vehicle = await db.getFirstAsync<{ photo_uri: string }>(
      'SELECT photo_uri FROM vehicles WHERE id = ?',
      ['v1']
    );
    expect(page?.file_path).toBe('documents/doc_p1.jpg');
    expect(vehicle?.photo_uri).toBe('vehicles/v1.jpg');
  });

  it('numără fișierele orfane fără să le atingă (sursa de recuperare 2026-07-29)', async () => {
    mockDisk({
      documents: ['doc_folosit.jpg', 'doc_orfan_1.jpg', 'doc_orfan_2.jpg'],
      vehicles: [],
    });
    await seedDoc('d1', 'documents/doc_folosit.jpg');

    const report = await repairFilePaths();

    expect(report.orphans).toBe(2);
    expect(report.missing).toBe(0);
    expect(report.repaired).toBe(0);
  });

  it('e idempotentă — a doua rulare nu mai are ce repara', async () => {
    mockDisk({ documents: ['doc_3.jpg'], vehicles: [] });
    await seedDoc('d1', `${OLD_CONTAINER}/Documents/documents/doc_3.jpg`);

    const first = await repairFilePaths();
    const second = await repairFilePaths();

    expect(first.repaired).toBe(1);
    expect(second.repaired).toBe(0);
    expect(second.missing).toBe(0);
    expect(second.scanned).toBe(1);
  });
});
