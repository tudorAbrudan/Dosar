/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — fidelitatea restaurării complete (Faza 1, review 2026-07).
 *
 * Rulează fluxul REAL: seed DB → export (buildManifestPayload, funcția de export
 * cloud) → wipe + applyManifest({ wipeFirst: true }) → aserțiuni că nimic nu se
 * pierde și că rândurile își păstrează ID-urile ORIGINALE (P0 audit backup
 * 2026-10-14): partajările CloudKit și linkurile din calendar rămân legate, iar
 * entitățile cu același nume nu se mai contopesc.
 *
 * Acoperă problemele confirmate în review:
 *   1. Remap FK medicale (person_id, source_document_id, summary.document_id)
 *   2. document_entities în backup (linkuri multi + medical_record)
 *   3. private_notes + auto_delete restaurate
 *   4. Dedupe NU colapsează documente distincte la restore cu wipe
 *   5. Reminders remapate, fără dubluri, fără calendar_event_id de pe device vechi
 *
 * Pe codul de dinaintea fix-ului, aserțiunile de mai jos PICĂ (vezi raportul
 * roșu→verde din PR): dosarul medical nu e găsibil prin getMedicalRecordByPersonId,
 * observațiile/summary-urile se pierd, linkul document↔dosar medical dispare,
 * al doilea document `altul` e deduplicat, private_notes/auto_delete se pierd,
 * reminderele devin orfane sau duplicate.
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
let applyManifest: typeof import('@/services/backup').applyManifest;
let buildManifestPayload: typeof import('@/services/cloudSync').buildManifestPayload;
let getMedicalRecordByPersonId: typeof import('@/services/medicalRecord').getMedicalRecordByPersonId;
let getDocumentEntityLinks: typeof import('@/services/documents').getDocumentEntityLinks;
let fs: { getInfoAsync: jest.Mock; copyAsync: jest.Mock };

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    applyManifest = require('@/services/backup').applyManifest;
    buildManifestPayload = require('@/services/cloudSync').buildManifestPayload;
    getMedicalRecordByPersonId = require('@/services/medicalRecord').getMedicalRecordByPersonId;
    getDocumentEntityLinks = require('@/services/documents').getDocumentEntityLinks;
    fs = require('expo-file-system/legacy');
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
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

// ID-urile de pe device-ul sursă. Restaurarea cu înlocuire le păstrează; testele
// mai vechi identifică rândurile după conținut, cele noi verifică și ID-ul.
const P1 = 'old-person-1';
const P2 = 'old-person-2';
const V1 = 'old-vehicle-1';
const M1 = 'old-medrec-1';
const D_RCA = 'old-doc-rca';
const D_MED = 'old-doc-med';
const D_ALT_A = 'old-doc-alt-a';
const D_ALT_B = 'old-doc-alt-b';
const FUTURE_EXPIRY = '2030-01-01';
const TS = '2026-01-01T00:00:00Z';

async function seed(): Promise<void> {
  // Persoane
  await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [P1, 'Ana', TS]);
  await db.runAsync('INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)', [P2, 'Bob', TS]);
  // Vehicul
  await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
    V1,
    'Logan',
    TS,
  ]);
  // Dosar medical legat de Ana
  await db.runAsync(
    `INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'plaintext-v2', ?, ?)`,
    [M1, P1, 'Dosar Ana', TS, TS]
  );

  // Documente:
  //  - RCA (vehicul, cu expirare + private_notes + auto_delete)
  //  - Analize (medical, legat de Ana + dosar medical)
  //  - Două `altul` fără date → aceeași cheie dedupe `altul||`
  await db.runAsync(
    `INSERT INTO documents (id, type, expiry_date, vehicle_id, private_notes, auto_delete, created_at)
     VALUES (?, 'rca', ?, ?, ?, ?, ?)`,
    [D_RCA, FUTURE_EXPIRY, V1, 'CVV 1234', '30d', TS]
  );
  await db.runAsync(
    `INSERT INTO documents (id, type, person_id, private_notes, created_at)
     VALUES (?, 'analize_medicale', ?, ?, ?)`,
    [D_MED, P1, 'secret medical', TS]
  );
  await db.runAsync(
    `INSERT INTO documents (id, type, person_id, private_notes, created_at)
     VALUES (?, 'altul', ?, ?, ?)`,
    [D_ALT_A, P1, 'note-a', TS]
  );
  await db.runAsync(
    `INSERT INTO documents (id, type, person_id, private_notes, created_at)
     VALUES (?, 'altul', ?, ?, ?)`,
    [D_ALT_B, P2, 'note-b', TS]
  );

  // document_entities: linkuri multi + link către dosar medical (fără coloană legacy)
  const de = async (docId: string, type: string, entityId: string) =>
    db.runAsync(
      'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [`de-${docId}-${type}-${entityId}`, docId, type, entityId]
    );
  await de(D_RCA, 'vehicle', V1);
  await de(D_MED, 'person', P1);
  await de(D_MED, 'medical_record', M1);
  // D_ALT_A legat de DOUĂ persoane (multi-link de același tip — imposibil din coloane legacy)
  await de(D_ALT_A, 'person', P1);
  await de(D_ALT_A, 'person', P2);
  await de(D_ALT_B, 'person', P2);

  // Observații medicale (≥2) cu source_document_id = documentul de analize
  await db.runAsync(
    `INSERT INTO medical_observations
       (id, medical_record_id, source_document_id, name, value, category, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['obs-1', M1, D_MED, 'Glicemie', '95', 'biochimie', 0.9, TS, TS]
  );
  await db.runAsync(
    `INSERT INTO medical_observations
       (id, medical_record_id, source_document_id, name, value, category, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['obs-2', M1, D_MED, 'Colesterol', '180', 'biochimie', 0.8, TS, TS]
  );
  // Summary medical pentru documentul de analize
  await db.runAsync(
    `INSERT INTO medical_document_summaries (document_id, summary, generated_at, model_used)
     VALUES (?, ?, ?, ?)`,
    [D_MED, 'Rezumat analize', TS, 'test-model']
  );

  // Reminders:
  //  - document_expiry pentru RCA (dismissed) → la restore createDocument recreează
  //    unul activ; restore trebuie să-l ACTUALIZEZE (dismissed_at păstrat), nu să dubleze.
  //  - medical_ai pentru documentul de analize (person Ana).
  //  calendar_event_id vechi (device sursă) → trebuie să devină NULL la restore.
  await db.runAsync(
    `INSERT INTO reminders (id, source_type, document_id, vehicle_id, label, reminder_date, calendar_event_id, origin, created_at, dismissed_at)
     VALUES ('rem-rca', 'document_expiry', ?, ?, 'RCA', ?, 'old-cal-1', 'derived', ?, '2026-06-01')`,
    [D_RCA, V1, FUTURE_EXPIRY, TS]
  );
  await db.runAsync(
    `INSERT INTO reminders (id, source_type, document_id, person_id, label, reminder_date, calendar_event_id, origin, created_at, dismissed_at)
     VALUES ('rem-med', 'medical_ai', ?, ?, 'Control', '2026-08-01', 'old-cal-2', 'ai', ?, NULL)`,
    [D_MED, P1, TS]
  );
}

/** Rulează fluxul complet și întoarce ID-urile NOI relevante pentru aserțiuni. */
async function roundTrip(): Promise<void> {
  await seed();
  const payload = await buildManifestPayload();
  await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });
}

function docIdByType(type: string, privateNotes?: string): string | undefined {
  const rows = testDb._raw
    .prepare('SELECT id, private_notes FROM documents WHERE type = ?')
    .all(type) as { id: string; private_notes: string | null }[];
  if (privateNotes === undefined) return rows[0]?.id;
  return rows.find(r => r.private_notes === privateNotes)?.id;
}

describe('restore round-trip — fidelity', () => {
  beforeEach(async () => {
    await roundTrip();
  });

  it('nu pierde niciun document (dedupe dezactivat la wipeFirst)', () => {
    const count = (
      testDb._raw.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }
    ).c;
    expect(count).toBe(4);
    // Cele două `altul` distincte supraviețuiesc amândouă.
    const altul = testDb._raw
      .prepare('SELECT private_notes FROM documents WHERE type = ? ORDER BY private_notes')
      .all('altul') as { private_notes: string | null }[];
    expect(altul.map(r => r.private_notes)).toEqual(['note-a', 'note-b']);
  });

  it('restaurează private_notes și auto_delete pe documente', () => {
    const rca = testDb._raw
      .prepare('SELECT private_notes, auto_delete FROM documents WHERE type = ?')
      .get('rca') as { private_notes: string | null; auto_delete: string | null };
    expect(rca.private_notes).toBe('CVV 1234');
    expect(rca.auto_delete).toBe('30d');
    const med = testDb._raw
      .prepare('SELECT private_notes FROM documents WHERE type = ?')
      .get('analize_medicale') as { private_notes: string | null };
    expect(med.private_notes).toBe('secret medical');
  });

  it('dosarul medical e găsibil prin getMedicalRecordByPersonId pe person_id-ul original', async () => {
    const ana = testDb._raw.prepare('SELECT id FROM persons WHERE name = ?').get('Ana') as {
      id: string;
    };
    expect(ana.id).toBe(P1);
    const record = await getMedicalRecordByPersonId(ana.id);
    expect(record).not.toBeNull();
    expect(record!.name).toBe('Dosar Ana');
  });

  it('observațiile arată spre NOUL document de analize (source_document_id remapat)', () => {
    const newMedDoc = docIdByType('analize_medicale')!;
    const obs = testDb._raw
      .prepare('SELECT source_document_id FROM medical_observations ORDER BY id')
      .all() as { source_document_id: string | null }[];
    expect(obs).toHaveLength(2);
    for (const o of obs) {
      expect(o.source_document_id).toBe(newMedDoc);
    }
  });

  it('summary-ul medical arată spre NOUL document de analize (document_id remapat)', () => {
    const newMedDoc = docIdByType('analize_medicale')!;
    const summaries = testDb._raw
      .prepare('SELECT document_id, summary FROM medical_document_summaries')
      .all() as { document_id: string; summary: string }[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0].document_id).toBe(newMedDoc);
    expect(summaries[0].summary).toBe('Rezumat analize');
  });

  it('linkul document↔dosar medical e păstrat (document_entities restaurat)', async () => {
    const newMedDoc = docIdByType('analize_medicale')!;
    const newRecord = testDb._raw.prepare('SELECT id FROM medical_record LIMIT 1').get() as {
      id: string;
    };
    const links = await getDocumentEntityLinks(newMedDoc);
    const medLink = links.find(l => l.entityType === 'medical_record');
    expect(medLink).toBeDefined();
    expect(medLink!.entityId).toBe(newRecord.id);
  });

  it('multi-link de același tip e păstrat (document `altul` legat de 2 persoane)', async () => {
    const newAltA = docIdByType('altul', 'note-a')!;
    const links = await getDocumentEntityLinks(newAltA);
    const personLinks = links.filter(l => l.entityType === 'person');
    expect(personLinks).toHaveLength(2);
  });

  it('reminders: fără dubluri, fără orfani, dismissed_at păstrat, calendar_event_id NULL', () => {
    const allReminders = testDb._raw
      .prepare(
        'SELECT id, source_type, document_id, calendar_event_id, dismissed_at FROM reminders'
      )
      .all() as {
      id: string;
      source_type: string;
      document_id: string | null;
      calendar_event_id: string | null;
      dismissed_at: string | null;
    }[];

    const docIds = new Set(
      (testDb._raw.prepare('SELECT id FROM documents').all() as { id: string }[]).map(r => r.id)
    );
    // Niciun reminder cu document_id inexistent (orfan nenavigabil).
    for (const r of allReminders) {
      if (r.document_id !== null) {
        expect(docIds.has(r.document_id)).toBe(true);
      }
      // calendar_event_id de pe device vechi nu se propagă.
      expect(r.calendar_event_id).toBeNull();
    }

    // Un singur reminder document_expiry (fără dublarea celui auto-creat de createDocument).
    const expiry = allReminders.filter(r => r.source_type === 'document_expiry');
    expect(expiry).toHaveLength(1);
    expect(expiry[0].dismissed_at).toBe('2026-06-01');

    // Reminderul medical_ai e restaurat.
    const medAi = allReminders.filter(r => r.source_type === 'medical_ai');
    expect(medAi).toHaveLength(1);
    const newMedDoc = docIdByType('analize_medicale')!;
    expect(medAi[0].document_id).toBe(newMedDoc);
  });
});

describe('restore round-trip — compatibilitate manifest vechi (fără document_entities)', () => {
  it('nu aruncă și reconstruiește linkurile din coloanele legacy', async () => {
    await seed();
    const payload = (await buildManifestPayload()) as unknown as Record<string, unknown>;
    // Simulează un manifest generat de o versiune veche a app-ului.
    delete payload.documentEntities;

    await expect(applyManifest(payload, { wipeFirst: true })).resolves.toBeDefined();

    // Documentele se restaurează; linkul legacy (person pe analize) se reconstruiește.
    const newMedDoc = docIdByType('analize_medicale')!;
    const links = await getDocumentEntityLinks(newMedDoc);
    expect(links.some(l => l.entityType === 'person')).toBe(true);
  });
});

describe('restaurarea păstrează entitățile distincte cu același nume', () => {
  it('două vehicule „Dacia" rămân două, fiecare cu documentul lui', async () => {
    await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
      'v-dacia-a',
      'Dacia',
      TS,
    ]);
    await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [
      'v-dacia-b',
      'Dacia',
      TS,
    ]);
    for (const [docId, vehicleId] of [
      ['d-rca-a', 'v-dacia-a'],
      ['d-rca-b', 'v-dacia-b'],
    ]) {
      await db.runAsync(
        `INSERT INTO documents (id, type, vehicle_id, note, created_at) VALUES (?, 'rca', ?, ?, ?)`,
        [docId, vehicleId, docId, TS]
      );
      await db.runAsync(
        'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
        [`de-${docId}`, docId, 'vehicle', vehicleId]
      );
    }
    const payload = await buildManifestPayload();

    await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });

    const vehicles = testDb._raw
      .prepare('SELECT id FROM vehicles WHERE name = ? ORDER BY id')
      .all('Dacia') as { id: string }[];
    expect(vehicles.map(v => v.id)).toEqual(['v-dacia-a', 'v-dacia-b']);
    const links = testDb._raw
      .prepare(
        `SELECT d.note AS note, de.entity_id AS vehicle FROM documents d
         JOIN document_entities de ON de.document_id = d.id AND de.entity_type = 'vehicle'
         ORDER BY d.note`
      )
      .all() as { note: string; vehicle: string }[];
    expect(links).toEqual([
      { note: 'd-rca-a', vehicle: 'v-dacia-a' },
      { note: 'd-rca-b', vehicle: 'v-dacia-b' },
    ]);
  });

  it('două tipuri personalizate cu același nume rămân două', async () => {
    await db.runAsync('INSERT INTO custom_document_types (id, name, created_at) VALUES (?, ?, ?)', [
      'ct-a',
      'Garanție',
      TS,
    ]);
    await db.runAsync('INSERT INTO custom_document_types (id, name, created_at) VALUES (?, ?, ?)', [
      'ct-b',
      'Garanție',
      TS,
    ]);
    const payload = await buildManifestPayload();

    await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });

    const types = testDb._raw.prepare('SELECT id FROM custom_document_types ORDER BY id').all() as {
      id: string;
    }[];
    expect(types.map(t => t.id)).toEqual(['ct-a', 'ct-b']);
  });

  it('un ID duplicat în manifest păstrează doar prima apariție, fără să piardă rânduri', async () => {
    const payload = {
      version: 4,
      persons: [
        { id: 'p-dup', name: 'Ana', created_at: TS },
        { id: 'p-dup', name: 'Bob', created_at: TS },
        { name: 'Fără ID', created_at: TS },
      ],
    };

    const result = await applyManifest(payload, { wipeFirst: true });

    expect(result.errors).toEqual([]);
    const persons = testDb._raw.prepare('SELECT id, name FROM persons ORDER BY name').all() as {
      id: string;
      name: string;
    }[];
    expect(persons).toHaveLength(3);
    expect(persons.find(p => p.name === 'Ana')!.id).toBe('p-dup');
    expect(persons.find(p => p.name === 'Bob')!.id).not.toBe('p-dup');
  });
});

describe('restaurarea păstrează ID-urile documentelor, paginilor și pozelor', () => {
  it('documentele își păstrează ID-ul, iar tot ce le referă arată spre el', async () => {
    await roundTrip();

    const docIds = (
      testDb._raw.prepare('SELECT id FROM documents ORDER BY id').all() as { id: string }[]
    ).map(r => r.id);
    expect(docIds).toEqual([D_ALT_A, D_ALT_B, D_MED, D_RCA].sort());
    const obs = testDb._raw
      .prepare('SELECT DISTINCT source_document_id AS d FROM medical_observations')
      .all() as { d: string }[];
    expect(obs).toEqual([{ d: D_MED }]);
    const summary = testDb._raw
      .prepare('SELECT document_id AS d FROM medical_document_summaries')
      .get() as { d: string };
    expect(summary.d).toBe(D_MED);
    const medAi = testDb._raw
      .prepare("SELECT document_id AS d FROM reminders WHERE source_type = 'medical_ai'")
      .get() as { d: string };
    expect(medAi.d).toBe(D_MED);
    const altLinks = (await getDocumentEntityLinks(D_ALT_A))
      .filter(l => l.entityType === 'person')
      .map(l => l.entityId)
      .sort();
    expect(altLinks).toEqual([P1, P2].sort());
  });

  it('paginile își păstrează ID-ul, inclusiv formatul de participant `<doc>__p__<pagină>`', async () => {
    await db.runAsync(
      `INSERT INTO documents (id, type, file_path, created_at) VALUES ('d-x', 'altul', 'documents/x.jpg', ?)`,
      [TS]
    );
    await db.runAsync(
      `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
       VALUES ('pg-1', 'd-x', 0, 'documents/x-p1.jpg', ?), ('d-x__p__pg-2', 'd-x', 1, 'shared/z/x-p2.jpg', ?)`,
      [TS, TS]
    );
    const payload = await buildManifestPayload();

    await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });

    const pages = testDb._raw
      .prepare('SELECT id, page_order FROM document_pages ORDER BY page_order')
      .all() as { id: string; page_order: number }[];
    expect(pages).toEqual([
      { id: 'pg-1', page_order: 0 },
      { id: 'd-x__p__pg-2', page_order: 1 },
    ]);
  });

  it('poza vehiculului rămâne la calea ei, fără o copie nouă', async () => {
    await db.runAsync(
      `INSERT INTO vehicles (id, name, photo_uri, created_at) VALUES ('v-foto', 'Logan', 'vehicles/v-foto.jpg', ?)`,
      [TS]
    );
    const payload = await buildManifestPayload();
    fs.getInfoAsync.mockImplementation(async (uri: string) => ({
      exists: uri.endsWith('vehicles/v-foto.jpg'),
      isDirectory: false,
    }));
    fs.copyAsync.mockClear();

    try {
      await applyManifest(payload as unknown as Record<string, unknown>, { wipeFirst: true });
    } finally {
      fs.getInfoAsync.mockResolvedValue({ exists: false, isDirectory: false });
    }

    const v = testDb._raw.prepare('SELECT id, photo_uri FROM vehicles').get() as {
      id: string;
      photo_uri: string | null;
    };
    expect(v).toEqual({ id: 'v-foto', photo_uri: 'vehicles/v-foto.jpg' });
    expect(fs.copyAsync).not.toHaveBeenCalled();
  });
});
