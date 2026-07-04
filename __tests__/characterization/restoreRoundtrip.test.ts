/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — fidelitatea restaurării complete (Faza 1, review 2026-07).
 *
 * Rulează fluxul REAL: seed DB → export (buildManifestPayload, funcția de export
 * cloud) → wipe + applyManifest({ wipeFirst: true }) → aserțiuni că nimic nu se
 * pierde și că toate FK-urile arată spre ID-urile NOI (regenerate la restore).
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

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    applyManifest = require('@/services/backup').applyManifest;
    buildManifestPayload = require('@/services/cloudSync').buildManifestPayload;
    getMedicalRecordByPersonId = require('@/services/medicalRecord').getMedicalRecordByPersonId;
    getDocumentEntityLinks = require('@/services/documents').getDocumentEntityLinks;
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
      /* shadow tables FTS, virtual */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

// ID-uri „vechi" (de pe device-ul sursă). La restore cu wipe, entitățile primesc
// ID-uri NOI — aserțiunile identifică rândurile după conținut, nu după ID.
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
  await db.runAsync('INSERT INTO vehicles (id, name, created_at) VALUES (?, ?, ?)', [V1, 'Logan', TS]);
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

  it('dosarul medical e găsibil prin getMedicalRecordByPersonId pe NOUL person_id', async () => {
    const newAna = testDb._raw.prepare('SELECT id FROM persons WHERE name = ?').get('Ana') as {
      id: string;
    };
    const record = await getMedicalRecordByPersonId(newAna.id);
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
    const newRecord = testDb._raw
      .prepare('SELECT id FROM medical_record LIMIT 1')
      .get() as { id: string };
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
      .prepare('SELECT id, source_type, document_id, calendar_event_id, dismissed_at FROM reminders')
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

    await expect(
      applyManifest(payload, { wipeFirst: true })
    ).resolves.toBeDefined();

    // Documentele se restaurează; linkul legacy (person pe analize) se reconstruiește.
    const newMedDoc = docIdByType('analize_medicale')!;
    const links = await getDocumentEntityLinks(newMedDoc);
    expect(links.some(l => l.entityType === 'person')).toBe(true);
  });
});
