/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization tests pentru backup.ts.
 *
 * Lock-uiește comportamentul applyManifest:
 *   - Round-trip per entitate (persons, properties, vehicles, cards, animals, companies, documents)
 *   - Deduplicare la re-import (persons by name, documents by type+issue+expiry)
 *   - wipeFirst golește tabelele user-data (păstrează cloud_state/pending_uploads)
 *   - isImportInProgress flip-uiește true → false
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import { applySchemaToTestDb } from '../helpers/testDbSetup';
import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let applyManifest: typeof import('@/services/backup').applyManifest;
let isImportInProgress: typeof import('@/services/backup').isImportInProgress;
let getDocuments: typeof import('@/services/documents').getDocuments;
beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    const backup = require('@/services/backup');
    applyManifest = backup.applyManifest;
    isImportInProgress = backup.isImportInProgress;
    const documents = require('@/services/documents');
    getDocuments = documents.getDocuments;
  });
});

function resetSchema(): void {
  // Vezi nota din db.test.ts despre DELETE vs DROP — folosim DELETE pentru stabilitate.
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
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

describe('backup applyManifest — single entity round-trip', () => {
  it('imports a single person', async () => {
    await applyManifest({
      persons: [{ id: 'p1', name: 'Ana Pop', created_at: '2026-01-01' }],
    });
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM persons'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ana Pop');
  });

  it('imports a property', async () => {
    await applyManifest({
      properties: [{ id: 'pr1', name: 'Casa București', created_at: '2026-01-01' }],
    });
    expect(
      (await db.getAllAsync<{ name: string }>('SELECT name FROM properties')).map(r => r.name)
    ).toEqual(['Casa București']);
  });

  it('imports a vehicle with fuel_type and plate_number', async () => {
    await applyManifest({
      vehicles: [
        {
          id: 'v1',
          name: 'Logan',
          plate_number: 'B 123 ABC',
          fuel_type: 'gas',
          created_at: '2026-01-01',
        },
      ],
    });
    const rows = await db.getAllAsync<{
      name: string;
      plate_number: string | null;
      fuel_type: string | null;
    }>('SELECT name, plate_number, fuel_type FROM vehicles');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Logan');
    expect(rows[0].plate_number).toBe('B 123 ABC');
    expect(rows[0].fuel_type).toBe('gas');
  });

  it('imports a card', async () => {
    await applyManifest({
      cards: [
        { id: 'c1', nickname: 'Visa Personal', last4: '1234', created_at: '2026-01-01' },
      ],
    });
    const rows = await db.getAllAsync<{ nickname: string; last4: string }>(
      'SELECT nickname, last4 FROM cards'
    );
    expect(rows[0]).toEqual({ nickname: 'Visa Personal', last4: '1234' });
  });

  it('imports an animal', async () => {
    await applyManifest({
      animals: [{ id: 'a1', name: 'Rex', species: 'câine', created_at: '2026-01-01' }],
    });
    const rows = await db.getAllAsync<{ name: string; species: string }>(
      'SELECT name, species FROM animals'
    );
    expect(rows[0]).toEqual({ name: 'Rex', species: 'câine' });
  });

  it('imports a company', async () => {
    await applyManifest({
      companies: [
        { id: 'co1', name: 'SRL Demo', cui: 'RO12345', created_at: '2026-01-01' },
      ],
    });
    const rows = await db.getAllAsync<{ name: string; cui: string }>(
      'SELECT name, cui FROM companies'
    );
    expect(rows[0]).toEqual({ name: 'SRL Demo', cui: 'RO12345' });
  });

  it('imports a document', async () => {
    await applyManifest({
      documents: [
        {
          id: 'd1',
          type: 'CI',
          issue_date: '2025-01-01',
          expiry_date: '2035-01-01',
          created_at: '2026-01-01',
        },
      ],
    });
    const rows = await db.getAllAsync<{ type: string; issue_date: string; expiry_date: string }>(
      'SELECT type, issue_date, expiry_date FROM documents'
    );
    expect(rows[0]).toEqual({
      type: 'CI',
      issue_date: '2025-01-01',
      expiry_date: '2035-01-01',
    });
  });

  it('imports a custom document type', async () => {
    await applyManifest({
      customTypes: [{ id: 'ct1', name: 'Tip Custom', created_at: '2026-01-01' }],
    });
    const rows = await db.getAllAsync<{ name: string }>(
      'SELECT name FROM custom_document_types'
    );
    expect(rows[0].name).toBe('Tip Custom');
  });
});

describe('backup applyManifest — deduplication', () => {
  it('re-importing same persons by name does not duplicate', async () => {
    const manifest = {
      persons: [{ id: 'p1', name: 'Ana', created_at: '2026-01-01' }],
    };
    await applyManifest(manifest);
    await applyManifest(manifest);
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM persons');
    expect(rows).toHaveLength(1);
  });

  it('different persons by name are imported as separate rows', async () => {
    await applyManifest({
      persons: [
        { id: 'p1', name: 'Ana', created_at: '2026-01-01' },
        { id: 'p2', name: 'Bob', created_at: '2026-01-01' },
      ],
    });
    expect((await db.getAllAsync('SELECT id FROM persons')).length).toBe(2);
  });

  it('re-importing same documents (type+issue+expiry) does not duplicate', async () => {
    const manifest = {
      documents: [
        {
          id: 'd1',
          type: 'RCA',
          issue_date: '2026-01-01',
          expiry_date: '2027-01-01',
          created_at: '2026-01-01',
        },
      ],
    };
    await applyManifest(manifest);
    await applyManifest(manifest);
    expect((await db.getAllAsync('SELECT id FROM documents')).length).toBe(1);
  });

  it('cards dedupe by last4 + nickname', async () => {
    const manifest = {
      cards: [
        { id: 'c1', nickname: 'Visa Personal', last4: '1234', created_at: '2026-01-01' },
      ],
    };
    await applyManifest(manifest);
    await applyManifest(manifest);
    expect((await db.getAllAsync('SELECT id FROM cards')).length).toBe(1);
  });

  it('animals dedupe by name + species', async () => {
    const manifest = {
      animals: [{ id: 'a1', name: 'Rex', species: 'câine', created_at: '2026-01-01' }],
    };
    await applyManifest(manifest);
    await applyManifest(manifest);
    expect((await db.getAllAsync('SELECT id FROM animals')).length).toBe(1);
  });

  it('companies dedupe by CUI (primary key)', async () => {
    await applyManifest({
      companies: [
        { id: 'co1', name: 'SRL Vechi', cui: 'RO12345', created_at: '2026-01-01' },
      ],
    });
    await applyManifest({
      companies: [
        { id: 'co2', name: 'SRL Nou', cui: 'RO12345', created_at: '2026-01-01' },
      ],
    });
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM companies'
    );
    expect(rows).toHaveLength(1);
  });
});

describe('backup applyManifest — wipeFirst', () => {
  it('wipeFirst clears user data tables before importing', async () => {
    await applyManifest({
      persons: [{ id: 'p1', name: 'Old', created_at: '2026-01-01' }],
      vehicles: [{ id: 'v1', name: 'Old Car', created_at: '2026-01-01' }],
    });
    expect((await db.getAllAsync('SELECT id FROM persons')).length).toBe(1);
    expect((await db.getAllAsync('SELECT id FROM vehicles')).length).toBe(1);

    await applyManifest(
      {
        persons: [{ id: 'p2', name: 'New', created_at: '2026-01-01' }],
      },
      { wipeFirst: true }
    );

    const persons = await db.getAllAsync<{ name: string }>('SELECT name FROM persons');
    const vehicles = await db.getAllAsync('SELECT id FROM vehicles');
    expect(persons.map(p => p.name)).toEqual(['New']);
    expect(vehicles).toEqual([]);
  });

  it('wipeFirst preserves cloud_state and pending_uploads', async () => {
    await db.runAsync('INSERT INTO cloud_state (id, device_id) VALUES (?, ?)', 1, 'd1');
    await db.runAsync(
      'INSERT INTO pending_uploads (file_path, attempt_count, created_at) VALUES (?, ?, ?)',
      'x.jpg',
      0,
      Date.now()
    );

    await applyManifest(
      {
        persons: [{ id: 'p1', name: 'X', created_at: '2026-01-01' }],
      },
      { wipeFirst: true }
    );

    expect((await db.getAllAsync('SELECT id FROM cloud_state')).length).toBe(1);
    expect((await db.getAllAsync('SELECT file_path FROM pending_uploads')).length).toBe(1);
  });
});

describe('backup applyManifest — medical AI fields round-trip', () => {
  it('imports ai_summary, medical_reminders_prompted_at, pending_reminders_json on documents', async () => {
    const remindersJson = JSON.stringify([
      { label: 'control glicemie', suggested_date_iso: '2026-08-24' },
    ]);

    await applyManifest({
      documents: [
        {
          id: 'doc-1',
          type: 'analize_medicale',
          issue_date: '2026-05-24',
          expiry_date: null,
          created_at: '2026-05-24T00:00:00Z',
          ai_summary: '**Rezumat:** test',
          medical_reminders_prompted_at: '2026-05-24T10:00:00Z',
          pending_reminders_json: remindersJson,
        },
      ],
    });

    const row = testDb._raw
      .prepare(
        'SELECT ai_summary, medical_reminders_prompted_at, pending_reminders_json FROM documents WHERE type = ? AND issue_date = ?'
      )
      .get('analize_medicale', '2026-05-24') as {
      ai_summary: string | null;
      medical_reminders_prompted_at: string | null;
      pending_reminders_json: string | null;
    } | undefined;

    expect(row).toBeDefined();
    expect(row!.ai_summary).toBe('**Rezumat:** test');
    expect(row!.medical_reminders_prompted_at).toBe('2026-05-24T10:00:00Z');
    expect(JSON.parse(row!.pending_reminders_json as string)).toEqual([
      { label: 'control glicemie', suggested_date_iso: '2026-08-24' },
    ]);
  });

  it('exports the 3 medical AI fields via getDocuments (export side of round-trip)', async () => {
    // Seed: insert document directly cu cele 3 câmpuri populate.
    const remindersJson = JSON.stringify([
      { label: 'control', suggested_date_iso: '2026-08-24' },
    ]);
    testDb._raw
      .prepare(
        `INSERT INTO documents (id, type, issue_date, expiry_date, created_at,
                                ai_summary, medical_reminders_prompted_at, pending_reminders_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'doc-export',
        'analize_medicale',
        '2026-05-24',
        null,
        '2026-05-24T00:00:00Z',
        '**Rezumat:** export-test',
        '2026-05-24T10:00:00Z',
        remindersJson
      );

    // Export-side: `getDocuments()` e sursa pe care exportBackup + buildManifestPayload
    // o folosesc. Verificăm că cele 3 câmpuri sunt surfaced prin mapRow.
    const allDocs = await getDocuments();
    const doc = allDocs.find((d: { id: string }) => d.id === 'doc-export');
    expect(doc).toBeDefined();
    expect(doc!.ai_summary).toBe('**Rezumat:** export-test');
    expect(doc!.medical_reminders_prompted_at).toBe('2026-05-24T10:00:00Z');
    expect(doc!.pending_reminders_json).toBe(remindersJson);
  });

  it('round-trip: export via getDocuments → applyManifest preserves all 3 fields', async () => {
    const remindersJson = JSON.stringify([
      { label: 'reevaluare TSH', suggested_date_iso: '2026-11-24' },
    ]);

    // Seed-uim documentul direct în DB cu cele 3 câmpuri populate.
    testDb._raw
      .prepare(
        `INSERT INTO documents (id, type, issue_date, expiry_date, created_at,
                                ai_summary, medical_reminders_prompted_at, pending_reminders_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'doc-rt',
        'analize_medicale',
        '2026-05-24',
        null,
        '2026-05-24T00:00:00Z',
        '**Rezumat:** roundtrip',
        '2026-05-24T10:00:00Z',
        remindersJson
      );

    // Simulăm export-ul: citim documentele cum o face exportBackup / buildManifestPayload.
    const exportedDocs = await getDocuments();
    expect(exportedDocs.find((d: { id: string }) => d.id === 'doc-rt')).toBeDefined();

    // Wipe + reimport prin applyManifest cu payload-ul construit din export.
    await applyManifest({ documents: exportedDocs }, { wipeFirst: true });

    const row = testDb._raw
      .prepare(
        'SELECT ai_summary, medical_reminders_prompted_at, pending_reminders_json FROM documents WHERE type = ? AND issue_date = ?'
      )
      .get('analize_medicale', '2026-05-24') as {
      ai_summary: string | null;
      medical_reminders_prompted_at: string | null;
      pending_reminders_json: string | null;
    } | undefined;

    expect(row).toBeDefined();
    expect(row!.ai_summary).toBe('**Rezumat:** roundtrip');
    expect(row!.medical_reminders_prompted_at).toBe('2026-05-24T10:00:00Z');
    expect(JSON.parse(row!.pending_reminders_json as string)).toEqual([
      { label: 'reevaluare TSH', suggested_date_iso: '2026-11-24' },
    ]);
  });
});

describe('backup isImportInProgress', () => {
  it('returns false outside of applyManifest call', () => {
    expect(isImportInProgress()).toBe(false);
  });

  it('returns false after applyManifest completes', async () => {
    await applyManifest({
      persons: [{ id: 'p1', name: 'X', created_at: '2026-01-01' }],
    });
    expect(isImportInProgress()).toBe(false);
  });

  it('flips to true during applyManifest (verified via promise inspection)', async () => {
    expect(isImportInProgress()).toBe(false);
    const promise = applyManifest({
      persons: [{ id: 'p1', name: 'X', created_at: '2026-01-01' }],
    });
    // Right after kicking off async work, _importInProgress is set synchronously
    expect(isImportInProgress()).toBe(true);
    await promise;
    expect(isImportInProgress()).toBe(false);
  });
});
