import * as FileSystem from 'expo-file-system/legacy';
import { db, generateId } from './db';
import { computeFileHash } from './fileHash';
import { onDocumentCreated, onDocumentRenewed } from './reviewPrompt';
import * as cloudSync from './cloudSync';
import { getCloudBackupEnabled } from './settings';
import { isImportInProgress } from './backup';
import { deleteCalendarEvent } from './calendar';
import { emit } from './events';
import type { Document, DocumentPage, DocumentType, DocumentEntityLink, EntityType } from '@/types';
import { ALL_ENTITY_TYPES, MEDICAL_DOC_TYPES, NO_EXPIRY_DOC_TYPES } from '@/types';

// Detecția de duplicat folosește prefixul OCR normalizat. Sub acest prag în
// caractere (după normalizare) nu auto-flagăm — header-ele scurte au prea
// puțină informație ca să distingă documente.
const OCR_DUP_MIN_NORM_LEN = 50;
// Numărul maxim de caractere normalizate luate în considerare la comparație.
// Suficient cât să acopere header + început body, fără să balastăm cu text variabil.
const OCR_DUP_PREFIX_LEN = 500;

/**
 * Normalizează un text OCR pentru comparația de duplicat: lowercase, fără
 * diacritice, doar caractere alfanumerice și spațiu, whitespace colapsat,
 * trunchiat la primii {@link OCR_DUP_PREFIX_LEN} caractere. Folosit DOAR
 * pentru detecția duplicatelor — nu modifică OCR-ul stocat în DB.
 */
function normalizeOcrPrefix(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OCR_DUP_PREFIX_LEN);
}

/**
 * Coloana legacy din tabelul `documents` corespunzătoare fiecărui tip de entitate.
 * Convenția e `${entityType}_id` peste tot; păstrată ca Record pentru claritate
 * și pentru a documenta explicit care coloane legacy există în schemă.
 */
// check-hardcoded-entities-disable-next-cluster
const LEGACY_ENTITY_COLUMN: Record<EntityType, string | null> = {
  person: 'person_id',
  vehicle: 'vehicle_id',
  property: 'property_id',
  card: 'card_id',
  animal: 'animal_id',
  company: 'company_id',
  medical_record: null,
};

export interface CreateDocumentInput {
  type: DocumentType;
  custom_type_id?: string;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  // Legacy single-entity (backward compat — scriem și în junction table)
  person_id?: string;
  property_id?: string;
  vehicle_id?: string;
  card_id?: string;
  animal_id?: string;
  company_id?: string;
  auto_delete?: string;
  ocr_text?: string;
  metadata?: Record<string, string>;
  /** Notă privată — nu ajunge niciodată la AI. Vezi sanitizeDocumentForAI. */
  private_notes?: string;
  // Multi-entity links suplimentare
  extra_entity_links?: DocumentEntityLink[];
}

type Row = {
  id: string;
  type: string;
  custom_type_id: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
  file_path: string | null;
  person_id: string | null;
  property_id: string | null;
  vehicle_id: string | null;
  card_id: string | null;
  animal_id: string | null;
  company_id: string | null;
  auto_delete: string | null;
  ocr_text: string | null;
  metadata: string | null;
  file_hash: string | null;
  private_notes: string | null;
  main_orientation_locked: number | null;
  calendar_event_id: string | null;
  ai_summary: string | null;
  medical_reminders_prompted_at: string | null;
  pending_reminders_json: string | null;
  created_at: string;
};

type PageRow = {
  id: string;
  document_id: string;
  page_order: number;
  file_path: string;
  created_at: string;
  orientation_locked: number;
};

function mapPageRow(r: PageRow): DocumentPage {
  return {
    id: r.id,
    document_id: r.document_id,
    page_order: r.page_order,
    file_path: r.file_path,
    created_at: r.created_at,
    orientation_locked: r.orientation_locked === 1,
  };
}

// ─── Junction table helpers ───────────────────────────────────────────────────

async function getEntityLinks(documentId: string): Promise<DocumentEntityLink[]> {
  const rows = await db.getAllAsync<{ entity_type: string; entity_id: string }>(
    'SELECT entity_type, entity_id FROM document_entities WHERE document_id = ?',
    [documentId]
  );
  return rows.map(r => ({ entityType: r.entity_type as EntityType, entityId: r.entity_id }));
}

async function saveEntityLinks(documentId: string, links: DocumentEntityLink[]): Promise<void> {
  // Șterge linkurile existente
  await db.runAsync('DELETE FROM document_entities WHERE document_id = ?', [documentId]);
  // Inserează noile linkuri
  for (const link of links) {
    await db.runAsync(
      'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [generateId(), documentId, link.entityType, link.entityId]
    );
  }
}

function buildEntityLinksFromInput(input: {
  person_id?: string;
  property_id?: string;
  vehicle_id?: string;
  card_id?: string;
  animal_id?: string;
  company_id?: string;
  extra_entity_links?: DocumentEntityLink[];
}): DocumentEntityLink[] {
  const links: DocumentEntityLink[] = [];
  for (const entityType of ALL_ENTITY_TYPES) {
    const entityId = input[`${entityType}_id` as keyof typeof input];
    if (typeof entityId === 'string' && entityId) {
      links.push({ entityType, entityId });
    }
  }
  // Adaugă linkuri extra (fără duplicate)
  for (const extra of input.extra_entity_links ?? []) {
    const exists = links.some(
      l => l.entityType === extra.entityType && l.entityId === extra.entityId
    );
    if (!exists) links.push(extra);
  }
  return links;
}

function mapRow(r: Row, pages?: DocumentPage[]): Document {
  const type = r.type as DocumentType;
  // Defense-in-depth: chiar dacă o coloană DB are valoare stale (cod vechi care
  // a scris fără gate, AI cu hallucination pe permanent docs, import dintr-un
  // backup vechi), nu expunem niciodată `expiry_date` pentru tipuri care nu
  // expiră real (certificat naștere/căsătorie/botez, diplome, acte proprietate,
  // documente medicale snapshot, bonuri, vizite vet). Filtrul aici acoperă
  // automat Expirări, Home, notificări, calendar — fără să modificăm DB.
  const expiryDate =
    r.expiry_date && !NO_EXPIRY_DOC_TYPES.has(type) ? r.expiry_date : undefined;
  return {
    id: r.id,
    main_orientation_locked: r.main_orientation_locked === 1,
    type,
    custom_type_id: r.custom_type_id ?? undefined,
    issue_date: r.issue_date ?? undefined,
    expiry_date: expiryDate,
    note: r.note ?? undefined,
    file_path: r.file_path ?? undefined,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, string>) : undefined,
    pages: pages ?? [],
    person_id: r.person_id ?? undefined,
    property_id: r.property_id ?? undefined,
    vehicle_id: r.vehicle_id ?? undefined,
    card_id: r.card_id ?? undefined,
    animal_id: r.animal_id ?? undefined,
    company_id: r.company_id ?? undefined,
    auto_delete: r.auto_delete ?? undefined,
    ocr_text: r.ocr_text ?? undefined,
    file_hash: r.file_hash ?? undefined,
    private_notes: r.private_notes ?? undefined,
    calendar_event_id: r.calendar_event_id ?? undefined,
    ai_summary: r.ai_summary ?? undefined,
    medical_reminders_prompted_at: r.medical_reminders_prompted_at ?? undefined,
    pending_reminders_json: r.pending_reminders_json ?? undefined,
    created_at: r.created_at,
  };
}

/**
 * Îndepărtează câmpurile private înainte de trimiterea către AI.
 * ORICE flux care construiește context pentru un LLM extern (chatbot, OCR
 * LLM, clasificare, sumarizare) TREBUIE să treacă documentele prin această
 * funcție. Vezi `.claude/rules/ai-privacy.md`.
 */
export function sanitizeDocumentForAI(doc: Document): Document {
  if (doc.private_notes === undefined) return doc;
  const { private_notes: _private, ...rest } = doc;
  return rest;
}

/**
 * Variantă de `getDocuments()` garantată fără date private.
 * Folosește-o în locul `getDocuments()` pentru orice pipeline care trimite
 * date la un model extern.
 */
export async function getDocumentsForAI(): Promise<Document[]> {
  const all = await getDocuments();
  return all.map(sanitizeDocumentForAI);
}

async function loadPages(documentId: string): Promise<DocumentPage[]> {
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM document_pages WHERE document_id = ? ORDER BY page_order ASC',
    [documentId]
  );
  return rows.map(mapPageRow);
}

export async function getDocuments(): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM documents ORDER BY created_at DESC');
  return rows.map(r => mapRow(r));
}

export async function getDocumentsExpiringIn(days: number): Promise<Document[]> {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM documents WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date ASC',
    [from, to]
  );
  return rows.map(r => mapRow(r));
}

export async function applyAutoDelete(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM documents WHERE auto_delete IS NOT NULL',
    []
  );
  let deleted = 0;
  for (const row of rows) {
    const rule = row.auto_delete;
    if (!rule) continue;
    let shouldDelete = false;
    if (rule === 'expiry') {
      shouldDelete = !!row.expiry_date && row.expiry_date < today;
    } else {
      const match = rule.match(/^(\d+)d$/);
      if (match) {
        const days = parseInt(match[1], 10);
        const deleteAfter = new Date(row.created_at);
        deleteAfter.setDate(deleteAfter.getDate() + days);
        shouldDelete = deleteAfter.toISOString().slice(0, 10) <= today;
      }
    }
    if (shouldDelete) {
      await deleteDocument(row.id);
      deleted++;
    }
  }
  return deleted;
}

export async function getAllDocumentsWithExpiry(): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM documents WHERE expiry_date IS NOT NULL ORDER BY expiry_date ASC'
  );
  return rows.map(r => mapRow(r));
}

export async function getDocumentById(id: string): Promise<Document | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!row) return null;
  const pages = await loadPages(id);
  return mapRow(row, pages);
}

export async function getDocumentsByEntity(
  kind: 'person_id' | 'property_id' | 'vehicle_id' | 'card_id' | 'animal_id' | 'company_id',
  id: string
): Promise<Document[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM documents WHERE ${kind} = ? ORDER BY created_at DESC`,
    [id]
  );
  return rows.map(r => mapRow(r));
}

/**
 * Extrage placa și VIN-ul pentru fiecare vehicul, din documentele atașate
 * (talon sau carte_auto). Folosit pentru a îmbogăți contextul AI cu identificatori
 * tehnici, ca matching-ul să funcționeze chiar și când în textul OCR apare
 * doar placa sau VIN-ul (nu numele vehiculului).
 */
export async function getVehicleIdentifiers(): Promise<
  Map<string, { plate?: string; vin?: string }>
> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM documents
     WHERE vehicle_id IS NOT NULL
       AND (type = 'talon' OR type = 'carte_auto')
     ORDER BY created_at DESC`
  );

  const map = new Map<string, { plate?: string; vin?: string }>();
  for (const r of rows) {
    if (!r.vehicle_id || !r.metadata) continue;
    let meta: Record<string, string>;
    try {
      meta = JSON.parse(r.metadata);
    } catch {
      continue;
    }
    const existing = map.get(r.vehicle_id) ?? {};
    if (!existing.plate && typeof meta.plate === 'string' && meta.plate.trim()) {
      existing.plate = meta.plate.trim();
    }
    if (!existing.vin && typeof meta.vin === 'string' && meta.vin.trim()) {
      existing.vin = meta.vin.trim();
    }
    map.set(r.vehicle_id, existing);
  }
  return map;
}

/**
 * Fire-and-forget: extrage observații medicale dintr-un document nou creat.
 * Condiții (toate trebuie îndeplinite):
 *   1. doc.type ∈ MEDICAL_DOC_TYPES
 *   2. toggle global AI medical ON (settings)
 *   3. documentul e legat la un medical_record (direct via entity_links sau
 *      indirect via legacyPersonId → getMedicalRecordByPersonId)
 *   4. dosarul medical are ai_consent_at setat
 *
 * Dynamic imports → evită circular dep (medicalExtractor → documents).
 * Spec §6.3.
 */
async function triggerMedicalExtraction(
  documentId: string,
  entityLinks: DocumentEntityLink[],
  legacyPersonId: string | null
): Promise<void> {
  try {
    const { getAiMedicalAllowed } = await import('./settings');
    if (!(await getAiMedicalAllowed())) return;

    const { getMedicalRecord, getMedicalRecordByPersonId } = await import('./medicalRecord');

    let recordId: string | null = null;
    const direct = entityLinks.find(l => l.entityType === 'medical_record');
    if (direct) {
      recordId = direct.entityId;
    } else if (legacyPersonId) {
      const r = await getMedicalRecordByPersonId(legacyPersonId);
      recordId = r?.id ?? null;
    }
    if (!recordId) return;

    const rec = await getMedicalRecord(recordId);
    if (!rec || !rec.ai_consent_at) return;

    const { extractAsync } = await import('./medicalExtractor');
    extractAsync(documentId);
  } catch (e) {
    console.warn('[documents] medical extraction trigger failed:', e);
  }
}

export async function createDocument(input: CreateDocumentInput): Promise<Document> {
  const id = generateId();
  const created_at = new Date().toISOString();

  let file_hash: string | null = null;
  if (input.file_path) {
    const abs = `${FileSystem.documentDirectory}${input.file_path}`;
    file_hash = await computeFileHash(abs);
  }

  await db.runAsync(
    `INSERT INTO documents (id, type, custom_type_id, issue_date, expiry_date, note, file_path, person_id, property_id, vehicle_id, card_id, animal_id, company_id, metadata, auto_delete, ocr_text, file_hash, private_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.type,
      input.custom_type_id ?? null,
      input.issue_date ?? null,
      input.expiry_date ?? null,
      input.note ?? null,
      input.file_path ?? null,
      input.person_id ?? null,
      input.property_id ?? null,
      input.vehicle_id ?? null,
      input.card_id ?? null,
      input.animal_id ?? null,
      input.company_id ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.auto_delete ?? null,
      input.ocr_text != null ? input.ocr_text.trim() : null,
      file_hash,
      input.private_notes ?? null,
      created_at,
    ]
  );

  // Salvează în junction table
  const entityLinks = buildEntityLinksFromInput(input);
  if (entityLinks.length > 0) {
    await saveEntityLinks(id, entityLinks);
  }

  // Medical extractor trigger — async, non-blocking. Spec §6.3.
  // Conditions: doc type ∈ MEDICAL_DOC_TYPES + linked to a medical_record
  // (via entity_links) + global AI medical consent ON + per-record AI consent given.
  if ((MEDICAL_DOC_TYPES as ReadonlySet<string>).has(input.type)) {
    void triggerMedicalExtraction(id, entityLinks, input.person_id ?? null);
  } else if (entityLinks.some(l => l.entityType === 'medical_record')) {
    // Tip non-medical (`custom`, `altul`, etc.) atașat manual la un dosar
    // medical → indexează în FTS pentru chat medical, fără extracție per-type
    // (custom/altul nu au prompt AI specific). Vezi `indexDocumentForMedicalChat`.
    void import('./medicalFts').then(m => m.indexDocumentForMedicalChat(id)).catch(() => {});
  }

  try {
    const row = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM documents');
    await onDocumentCreated(row?.cnt ?? 0);
  } catch {
    // Trigger review opțional — nu blochează crearea documentului.
  }

  if (input.file_path) {
    const cloudEnabled = await getCloudBackupEnabled();
    if (cloudEnabled && !isImportInProgress()) {
      await cloudSync.enqueueFileUpload(input.file_path);
      cloudSync.processQueue().catch(() => {
        /* fire and forget */
      });
    }
  }

  emit('documents:changed');
  emit('links:changed');

  return {
    id,
    main_orientation_locked: false,
    type: input.type,
    custom_type_id: input.custom_type_id,
    issue_date: input.issue_date,
    expiry_date: input.expiry_date,
    note: input.note,
    file_path: input.file_path,
    metadata: input.metadata,
    person_id: input.person_id,
    property_id: input.property_id,
    vehicle_id: input.vehicle_id,
    card_id: input.card_id,
    animal_id: input.animal_id,
    company_id: input.company_id,
    auto_delete: input.auto_delete,
    ocr_text: input.ocr_text,
    file_hash: file_hash ?? undefined,
    private_notes: input.private_notes,
    entity_links: entityLinks,
    created_at,
  };
}

export async function setDocumentOcrText(id: string, ocrText: string): Promise<void> {
  await db.runAsync('UPDATE documents SET ocr_text = ? WHERE id = ?', [ocrText.trim(), id]);
  emit('documents:changed');
}

/**
 * Setează / șterge ID-ul evenimentului din calendar asociat documentului.
 * Folosit pentru dedupe + silent update reminder de expirare (sau bilet).
 */
export async function setDocumentCalendarEventId(
  id: string,
  eventId: string | null
): Promise<void> {
  await db.runAsync('UPDATE documents SET calendar_event_id = ? WHERE id = ?', [eventId, id]);
  emit('documents:changed');
}

export async function deleteDocument(id: string): Promise<void> {
  const mainRow = await db.getFirstAsync<{
    file_path: string | null;
    calendar_event_id: string | null;
  }>('SELECT file_path, calendar_event_id FROM documents WHERE id = ?', [id]);
  const pageRows = await db.getAllAsync<{ file_path: string | null }>(
    'SELECT file_path FROM document_pages WHERE document_id = ?',
    [id]
  );
  const deletedFilePaths: string[] = [];
  if (mainRow?.file_path) deletedFilePaths.push(mainRow.file_path);
  for (const row of pageRows) {
    if (row.file_path) deletedFilePaths.push(row.file_path);
  }

  // Șterge evenimentul de calendar asociat (dacă există) ÎNAINTE de DELETE-ul din DB,
  // ca să nu rămână orphan în Calendar.app. Operație silentă — eșecul nu blochează
  // ștergerea documentului (ex. permisiune calendar revocată ulterior).
  if (mainRow?.calendar_event_id) {
    await deleteCalendarEvent(mainRow.calendar_event_id);
  }

  await db.runAsync('DELETE FROM documents WHERE id = ?', [id]);

  if (deletedFilePaths.length > 0) {
    const cloudEnabled = await getCloudBackupEnabled();
    if (cloudEnabled) {
      for (const path of deletedFilePaths) {
        await cloudSync.dequeueFileDelete(path);
      }
    }
  }

  emit('documents:changed');
  emit('links:changed');
}

export interface UpdateDocumentInput {
  type: DocumentType;
  custom_type_id?: string;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  animal_id?: string;
  auto_delete?: string;
  metadata?: Record<string, string>;
  ocr_text?: string;
  /** Notă privată — nu ajunge niciodată la AI. Vezi sanitizeDocumentForAI. */
  private_notes?: string;
  // Pentru update multi-entity: dacă prezent, rescrie junction table
  entity_links?: DocumentEntityLink[];
}

export async function updateDocument(id: string, input: UpdateDocumentInput): Promise<void> {
  const prev = await db.getFirstAsync<{ expiry_date: string | null }>(
    'SELECT expiry_date FROM documents WHERE id = ?',
    [id]
  );
  const oldExpiry = prev?.expiry_date ?? null;

  // UPDATE parțial: atinge doar coloanele prezente explicit în `input`.
  // Distincția key-prezentă-cu-undefined vs key-lipsă e făcută prin `in`:
  //   { note: undefined } → clear note (SET note = NULL)
  //   {} (fără cheie note) → note rămâne neschimbat
  // Asta previne wipe accidental al ocr_text / metadata / private_notes când
  // caller-ul nu vrea să le atingă.
  const sets: string[] = ['type = ?'];
  const values: (string | number | null)[] = [input.type];
  if ('custom_type_id' in input) {
    sets.push('custom_type_id = ?');
    values.push(input.custom_type_id ?? null);
  }
  if ('issue_date' in input) {
    sets.push('issue_date = ?');
    values.push(input.issue_date ?? null);
  }
  if ('expiry_date' in input) {
    sets.push('expiry_date = ?');
    values.push(input.expiry_date ?? null);
  }
  if ('note' in input) {
    sets.push('note = ?');
    values.push(input.note ?? null);
  }
  if ('file_path' in input) {
    sets.push('file_path = ?');
    values.push(input.file_path ?? null);
  }
  if ('animal_id' in input) {
    sets.push('animal_id = ?');
    values.push(input.animal_id ?? null);
  }
  if ('metadata' in input) {
    sets.push('metadata = ?');
    values.push(input.metadata ? JSON.stringify(input.metadata) : null);
  }
  if ('auto_delete' in input) {
    sets.push('auto_delete = ?');
    values.push(input.auto_delete ?? null);
  }
  if ('ocr_text' in input) {
    sets.push('ocr_text = ?');
    values.push(input.ocr_text ?? null);
  }
  if ('private_notes' in input) {
    sets.push('private_notes = ?');
    values.push(input.private_notes ?? null);
  }
  values.push(id);
  await db.runAsync(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, values);

  if (oldExpiry && input.expiry_date && oldExpiry !== input.expiry_date) {
    try {
      await onDocumentRenewed({ oldExpiry, newExpiry: input.expiry_date });
    } catch {
      // Trigger review opțional.
    }
  }

  // Actualizează junction table dacă s-au trimis linkuri explicite
  if (input.entity_links !== undefined) {
    await saveEntityLinks(id, input.entity_links);
    // Sincronizăm și coloanele legacy pentru compat
    const personId = input.entity_links.find(l => l.entityType === 'person')?.entityId ?? null;
    const vehicleId = input.entity_links.find(l => l.entityType === 'vehicle')?.entityId ?? null;
    const propertyId = input.entity_links.find(l => l.entityType === 'property')?.entityId ?? null;
    const cardId = input.entity_links.find(l => l.entityType === 'card')?.entityId ?? null;
    const animalId = input.entity_links.find(l => l.entityType === 'animal')?.entityId ?? null;
    const companyId = input.entity_links.find(l => l.entityType === 'company')?.entityId ?? null;
    await db.runAsync(
      'UPDATE documents SET person_id=?, vehicle_id=?, property_id=?, card_id=?, animal_id=?, company_id=? WHERE id=?',
      [personId, vehicleId, propertyId, cardId, animalId, companyId, id]
    );
    emit('links:changed');
  }

  emit('documents:changed');
}

export async function linkDocumentToEntity(
  id: string,
  entity: {
    person_id?: string;
    property_id?: string;
    vehicle_id?: string;
    card_id?: string;
    animal_id?: string;
    company_id?: string;
  }
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET person_id=?, property_id=?, vehicle_id=?, card_id=?, animal_id=?, company_id=? WHERE id=?',
    [
      entity.person_id ?? null,
      entity.property_id ?? null,
      entity.vehicle_id ?? null,
      entity.card_id ?? null,
      entity.animal_id ?? null,
      entity.company_id ?? null,
      id,
    ]
  );
  // Sincronizăm și junction table
  const links = buildEntityLinksFromInput(entity);
  await saveEntityLinks(id, links);
  emit('documents:changed');
  emit('links:changed');
}

export async function addEntityLinkToDocument(
  documentId: string,
  link: DocumentEntityLink
): Promise<void> {
  // Verificăm dacă linkul există deja
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM document_entities WHERE document_id = ? AND entity_type = ? AND entity_id = ?',
    [documentId, link.entityType, link.entityId]
  );
  if (existing) return;

  await db.runAsync(
    'INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    [generateId(), documentId, link.entityType, link.entityId]
  );
  // Actualizăm și coloana legacy dacă e prima entitate de acel tip.
  const col = LEGACY_ENTITY_COLUMN[link.entityType];
  if (col) {
    const current = await db.getFirstAsync<Record<string, string | null>>(
      `SELECT ${col} FROM documents WHERE id = ?`,
      [documentId]
    );
    if (current && current[col] === null) {
      await db.runAsync(`UPDATE documents SET ${col} = ? WHERE id = ?`, [
        link.entityId,
        documentId,
      ]);
    }
  }
  // Dacă linkul nou e către un dosar medical, indexează în FTS pentru chat
  // medical. Necesar pentru tipuri non-medicale (custom, altul) — tipurile
  // medicale standard sunt deja indexate prin medicalExtractor.extractAsync.
  // Apelul e idempotent: rescrie chunks-urile pentru toate dosarele legate.
  if (link.entityType === 'medical_record') {
    void import('./medicalFts').then(m => m.indexDocumentForMedicalChat(documentId)).catch(() => {});
    // Simetrie cu createDocument: asocierea la un dosar medical declanșează
    // extracția observațiilor în background. Guard-uit intern de toggle AI
    // medical + ai_consent_at pe dosar. Idempotent (șterge observațiile vechi
    // pe acest document înainte de re-insert).
    void triggerMedicalExtraction(documentId, [link], null);
  }
  emit('documents:changed');
  emit('links:changed');
}

export async function removeEntityLinkFromDocument(
  documentId: string,
  link: DocumentEntityLink
): Promise<void> {
  await db.runAsync(
    'DELETE FROM document_entities WHERE document_id = ? AND entity_type = ? AND entity_id = ?',
    [documentId, link.entityType, link.entityId]
  );
  // Actualizăm coloana legacy cu primul link rămas (sau null).
  const col = LEGACY_ENTITY_COLUMN[link.entityType];
  if (col) {
    const remaining = await db.getFirstAsync<{ entity_id: string } | null>(
      'SELECT entity_id FROM document_entities WHERE document_id = ? AND entity_type = ? LIMIT 1',
      [documentId, link.entityType]
    );
    await db.runAsync(`UPDATE documents SET ${col} = ? WHERE id = ?`, [
      remaining?.entity_id ?? null,
      documentId,
    ]);
  }
  // Dacă se șterge un link către dosar medical, re-index ca să elimine chunks
  // pentru dosarul respectiv. `indexDocumentForMedicalChat` curăță tot și
  // reinsereazã doar pentru dosarele rămase legate.
  if (link.entityType === 'medical_record') {
    void import('./medicalFts').then(m => m.indexDocumentForMedicalChat(documentId)).catch(() => {});
  }
  emit('documents:changed');
  emit('links:changed');
}

export async function getDocumentEntityLinks(documentId: string): Promise<DocumentEntityLink[]> {
  return getEntityLinks(documentId);
}

export async function addDocumentPage(documentId: string, filePath: string): Promise<string> {
  const maxOrder = await db.getFirstAsync<{ max: number | null }>(
    'SELECT MAX(page_order) as max FROM document_pages WHERE document_id = ?',
    [documentId]
  );
  const nextOrder = (maxOrder?.max ?? -1) + 1;
  const pageId = generateId();
  await db.runAsync(
    'INSERT INTO document_pages (id, document_id, page_order, file_path, created_at) VALUES (?, ?, ?, ?, ?)',
    [pageId, documentId, nextOrder, filePath, new Date().toISOString()]
  );

  if (filePath) {
    const cloudEnabled = await getCloudBackupEnabled();
    if (cloudEnabled && !isImportInProgress()) {
      await cloudSync.enqueueFileUpload(filePath);
      cloudSync.processQueue().catch(() => {
        /* fire and forget */
      });
    }
  }

  emit('documents:changed');
  return pageId;
}

export async function removeDocumentPage(pageId: string): Promise<void> {
  await db.runAsync('DELETE FROM document_pages WHERE id = ?', [pageId]);
  emit('documents:changed');
}

export async function reorderDocumentPages(
  documentId: string,
  orderedPageIds: string[]
): Promise<void> {
  for (let i = 0; i < orderedPageIds.length; i++) {
    await db.runAsync('UPDATE document_pages SET page_order = ? WHERE id = ? AND document_id = ?', [
      i,
      orderedPageIds[i],
      documentId,
    ]);
  }
  emit('documents:changed');
}

// Reordonează TOATE fișierele unui document (inclusiv pagina principală din file_path).
// orderedFilePaths = toate căile în noua ordine; primul devine noul file_path principal.
export async function reorderAllDocumentFiles(
  documentId: string,
  orderedFilePaths: string[]
): Promise<void> {
  if (orderedFilePaths.length === 0) return;
  const [newMain, ...rest] = orderedFilePaths;
  await db.runAsync('UPDATE documents SET file_path = ? WHERE id = ?', [newMain, documentId]);
  await db.runAsync('DELETE FROM document_pages WHERE document_id = ?', [documentId]);
  for (let i = 0; i < rest.length; i++) {
    await db.runAsync(
      'INSERT INTO document_pages (id, document_id, page_order, file_path, created_at) VALUES (?, ?, ?, ?, ?)',
      [generateId(), documentId, i, rest[i], new Date().toISOString()]
    );
  }
  emit('documents:changed');
}

/**
 * Caută un document existent care ar putea fi duplicatul celui în curs de adăugare.
 *
 * Criteriu unic, bazat pe conținut: dacă primii ~500 de caractere ai OCR-ului
 * (normalizați — lowercase, fără diacritice, doar alfanumeric și spațiu)
 * coincid cu un document existent care împarte cel puțin o entitate, e duplicat.
 *
 * Tip-ul, `custom_type_id` și `issue_date` nu mai sunt folosite ca semnal —
 * același conținut scanat poate fi etichetat diferit de user, iar două
 * documente distincte (ex. 2 seturi de analize din aceeași zi) au tip + dată
 * identice dar conținut OCR diferit.
 *
 * Fără OCR pe documentul nou (sub {@link OCR_DUP_MIN_NORM_LEN} caractere
 * normalizate) → returnăm null. Nu avem destulă informație ca să fim siguri.
 */
export async function findDuplicateDocument(
  entityLinks: DocumentEntityLink[],
  ocrText: string | undefined
): Promise<Document | null> {
  if (entityLinks.length === 0) return null;

  const newPrefix = normalizeOcrPrefix(ocrText);
  if (newPrefix.length < OCR_DUP_MIN_NORM_LEN) return null;

  const seen = new Set<string>();
  for (const link of entityLinks) {
    const rows = await db.getAllAsync<Row>(
      `SELECT d.* FROM documents d
       WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 0
       AND EXISTS (
         SELECT 1 FROM document_entities de
         WHERE de.document_id = d.id
         AND de.entity_type = ?
         AND de.entity_id = ?
       )
       ORDER BY d.created_at ASC`,
      [link.entityType, link.entityId]
    );
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (normalizeOcrPrefix(r.ocr_text) === newPrefix) {
        return mapRow(r);
      }
    }
  }
  return null;
}

export interface DocumentDuplicates {
  /** Alte documente cu fișier identic (același SHA-256). Certitudine. */
  byHash: Document[];
  /**
   * Alte documente cu același prefix OCR normalizat + cel puțin o entitate
   * comună. Conținutul scanat coincide chiar dacă userul a clasificat documentele
   * diferit; semnal puternic de duplicat real.
   */
  byOcrPrefix: Document[];
}

/**
 * Returnează documente care par a fi duplicate pentru `docId`.
 * Nu include documentul curent. Nu deduplică între `byHash` și `byOcrPrefix`
 * — un document poate apărea în ambele (e util să știi de ce e flaggat).
 */
export async function findDuplicatesOfDocument(docId: string): Promise<DocumentDuplicates> {
  const current = await getDocumentById(docId);
  if (!current) return { byHash: [], byOcrPrefix: [] };

  // ── byHash ── fișier identic bit-cu-bit
  let byHash: Document[] = [];
  if (current.file_hash) {
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM documents WHERE file_hash = ? AND id != ? ORDER BY created_at ASC',
      [current.file_hash, docId]
    );
    byHash = rows.map(r => mapRow(r));
  }

  // ── byOcrPrefix ── conținut OCR similar + cel puțin o entitate comună.
  // Independent de tip/dată: dacă primii ~500 de caractere normalizați coincid,
  // e același document indiferent cum a fost clasificat de user.
  const currentPrefix = normalizeOcrPrefix(current.ocr_text);
  const links = await getEntityLinks(docId);
  const byOcrPrefix: Document[] = [];

  if (currentPrefix.length >= OCR_DUP_MIN_NORM_LEN && links.length > 0) {
    const seen = new Set<string>();
    for (const link of links) {
      const rows = await db.getAllAsync<Row>(
        `SELECT d.* FROM documents d
         WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 0
         AND d.id != ?
         AND EXISTS (
           SELECT 1 FROM document_entities de
           WHERE de.document_id = d.id
           AND de.entity_type = ?
           AND de.entity_id = ?
         )
         ORDER BY d.created_at ASC`,
        [docId, link.entityType, link.entityId]
      );
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        if (normalizeOcrPrefix(r.ocr_text) === currentPrefix) {
          seen.add(r.id);
          byOcrPrefix.push(mapRow(r));
        }
      }
    }
  }

  return { byHash, byOcrPrefix };
}

export async function findFileDuplicates(): Promise<Document[][]> {
  const hashes = await db.getAllAsync<{ file_hash: string }>(
    `SELECT file_hash FROM documents
     WHERE file_hash IS NOT NULL
     GROUP BY file_hash
     HAVING COUNT(*) > 1`
  );
  const groups: Document[][] = [];
  for (const { file_hash } of hashes) {
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM documents WHERE file_hash = ? ORDER BY created_at ASC',
      [file_hash]
    );
    if (rows.length > 1) groups.push(rows.map(r => mapRow(r)));
  }
  return groups;
}

export async function backfillFileHashes(): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; file_path: string }>(
    'SELECT id, file_path FROM documents WHERE file_hash IS NULL AND file_path IS NOT NULL'
  );
  for (const row of rows) {
    const abs = `${FileSystem.documentDirectory}${row.file_path}`;
    const hash = await computeFileHash(abs);
    if (hash) {
      await db.runAsync('UPDATE documents SET file_hash = ? WHERE id = ?', [hash, row.id]);
    }
  }
}

export async function getAllDocumentPages(): Promise<DocumentPage[]> {
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM document_pages ORDER BY document_id, page_order ASC'
  );
  return rows.map(mapPageRow);
}

/**
 * Marchează o pagină ca având orientarea fixată manual de utilizator.
 * Odată setat, OCR-ul nu mai încearcă auto-rotire pe acea pagină.
 */
export async function lockPageOrientation(pageId: string): Promise<void> {
  await db.runAsync('UPDATE document_pages SET orientation_locked = 1 WHERE id = ?', [pageId]);
}

/**
 * Echivalentul lui lockPageOrientation pentru pagina principală a unui document
 * (doc.file_path), care nu are rând în document_pages.
 */
export async function lockMainOrientation(documentId: string): Promise<void> {
  await db.runAsync('UPDATE documents SET main_orientation_locked = 1 WHERE id = ?', [documentId]);
}

/**
 * Setează `ai_summary` pe document. NU intră în FTS / chat (spec 2026-05-24 §8).
 * Apelat de `medicalExtractor` după generare AI; suprascris la re-extracție.
 */
export async function setDocumentAiSummary(
  documentId: string,
  summary: string | null
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET ai_summary = ? WHERE id = ?',
    [summary, documentId]
  );
  emit('entities:changed');
}

/**
 * Marchează că userul a primit modalul de calendar reminders pentru acest document
 * (indiferent dacă a adăugat sau a sărit). Blochează re-prompt (spec D10).
 */
export async function setMedicalRemindersPromptedAt(
  documentId: string,
  iso: string
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET medical_reminders_prompted_at = ? WHERE id = ?',
    [iso, documentId]
  );
  emit('entities:changed');
}

/**
 * Setează JSON-ul tranzitoriu cu `actionable_items` pentru modal (D13).
 * `null` la închiderea modalului.
 */
export async function setPendingReminders(
  documentId: string,
  json: string | null
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET pending_reminders_json = ? WHERE id = ?',
    [json, documentId]
  );
  emit('entities:changed');
}

export interface ActionableItem {
  label: string;
  suggested_date_iso: string | null;
}

/**
 * Citește și parsează `pending_reminders_json`. Returnează [] la null sau JSON invalid.
 */
export async function getPendingReminders(documentId: string): Promise<ActionableItem[]> {
  const row = await db.getFirstAsync<{ pending_reminders_json: string | null }>(
    'SELECT pending_reminders_json FROM documents WHERE id = ?',
    [documentId]
  );
  if (!row?.pending_reminders_json) return [];
  try {
    const parsed = JSON.parse(row.pending_reminders_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i): i is ActionableItem => {
      if (typeof i !== 'object' || i === null) return false;
      const item = i as { label?: unknown; suggested_date_iso?: unknown };
      if (typeof item.label !== 'string') return false;
      if (item.suggested_date_iso !== null && typeof item.suggested_date_iso !== 'string') return false;
      return true;
    });
  } catch {
    return [];
  }
}
