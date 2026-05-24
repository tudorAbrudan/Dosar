/**
 * CRUD pentru entitatea `medical_record` — singura entitate user-facing din app.
 *
 * Stochează numele dosarului + FK la persoană (person_id) plus datele dosarului
 * medical (consent AI, observații medicale, conversații). Relație 1:1 strictă
 * cu tabelul `persons` (UNIQUE constraint pe person_id).
 *
 * Consent AI:
 * - `ai_consent_at` = ISO timestamp setat la primul accept din modalul de consent.
 * - `ai_consent_version` permite re-prompt la schimbarea textului legal.
 *
 * Decryption note: niciun câmp din `medical_record` nu e criptat. Datele
 * sensibile sunt în `medical_observations` și `medical_chat_messages`.
 */
import { db, generateId } from './db';
import { ensureMedicalMasterKey, MEDICAL_MASTER_KEY_REF } from './medicalCrypto';
import { assignNextOrder, removeOrder } from './entityOrder';
import { emit } from './events';
import { getPendingReminders, type ActionableItem } from './documents';
import type { MedicalRecord, Person } from '@/types';

const MEDICAL_DOC_TYPES_SQL = `(
  'analize_medicale','reteta_medicala','scrisoare_medicala',
  'bilet_externare','imagistica','vaccin_persoana','fisa_consultatie',
  'bilet_trimitere'
)`;

// Fallback sort pentru entități care nu au rând în entity_order.
const ORDER_FALLBACK = 1e18;

interface MedicalRecordRow {
  id: string;
  person_id: string;
  name: string;
  ai_consent_at: string | null;
  ai_consent_version: number | null;
  encryption_key_ref: string;
  blood_group: string | null;
  allergies: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(r: MedicalRecordRow): MedicalRecord {
  return {
    id: r.id,
    person_id: r.person_id,
    name: r.name,
    ai_consent_at: r.ai_consent_at,
    ai_consent_version: r.ai_consent_version ?? 1,
    encryption_key_ref: r.encryption_key_ref,
    blood_group: r.blood_group ?? undefined,
    allergies: r.allergies ?? undefined,
    emergency_contact_name: r.emergency_contact_name ?? undefined,
    emergency_contact_phone: r.emergency_contact_phone ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateMedicalRecordInput {
  person_id: string;
  name: string;
  blood_group?: string;
  allergies?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

export async function createMedicalRecord(input: CreateMedicalRecordInput): Promise<MedicalRecord> {
  await ensureMedicalMasterKey();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO medical_record
       (id, person_id, name, ai_consent_at, ai_consent_version, encryption_key_ref,
        blood_group, allergies, emergency_contact_name, emergency_contact_phone,
        created_at, updated_at)
     VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.person_id, input.name, MEDICAL_MASTER_KEY_REF,
      input.blood_group ?? null,
      input.allergies ?? null,
      input.emergency_contact_name ?? null,
      input.emergency_contact_phone ?? null,
      now, now,
    ]
  );
  await assignNextOrder('medical_record', id);
  emit('entities:changed');
  const row = await db.getFirstAsync<MedicalRecordRow>(
    'SELECT * FROM medical_record WHERE id = ?',
    [id]
  );
  if (!row) throw new Error('Eroare la crearea dosarului medical.');
  return rowToRecord(row);
}

export async function getMedicalRecord(id: string): Promise<MedicalRecord | null> {
  const row = await db.getFirstAsync<MedicalRecordRow>(
    'SELECT * FROM medical_record WHERE id = ?',
    [id]
  );
  return row ? rowToRecord(row) : null;
}

/**
 * Caută dosarul medical asociat unei persoane. Datorită constrângerii UNIQUE pe
 * `person_id`, relația e 1:1 — returnează null dacă nu există încă un dosar.
 * Folosit de `useEntities.resolveEntityName` (Task 15) și de
 * `documents.addDocument` la triggering medicalExtractor (Task 20).
 */
export async function getMedicalRecordByPersonId(personId: string): Promise<MedicalRecord | null> {
  const row = await db.getFirstAsync<MedicalRecordRow>(
    `SELECT * FROM medical_record WHERE person_id = ? LIMIT 1`,
    [personId]
  );
  return row ? rowToRecord(row) : null;
}

export async function listMedicalRecords(): Promise<MedicalRecord[]> {
  const rows = await db.getAllAsync<MedicalRecordRow>(
    `SELECT m.* FROM medical_record m
     LEFT JOIN entity_order eo ON eo.entity_type = 'medical_record' AND eo.entity_id = m.id
     ORDER BY COALESCE(eo.sort_order, ?) ASC, m.updated_at DESC`,
    [ORDER_FALLBACK]
  );
  return rows.map(rowToRecord);
}

export interface UpdateMedicalRecordInput {
  name?: string;
  person_id?: string;
  blood_group?: string | null;
  allergies?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

export async function updateMedicalRecord(
  id: string,
  patch: UpdateMedicalRecordInput
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.person_id !== undefined) {
    sets.push('person_id = ?');
    values.push(patch.person_id);
  }
  if (patch.blood_group !== undefined) {
    sets.push('blood_group = ?');
    values.push(patch.blood_group ?? null);
  }
  if (patch.allergies !== undefined) {
    sets.push('allergies = ?');
    values.push(patch.allergies ?? null);
  }
  if (patch.emergency_contact_name !== undefined) {
    sets.push('emergency_contact_name = ?');
    values.push(patch.emergency_contact_name ?? null);
  }
  if (patch.emergency_contact_phone !== undefined) {
    sets.push('emergency_contact_phone = ?');
    values.push(patch.emergency_contact_phone ?? null);
  }
  if (sets.length === 0) return;
  const now = new Date().toISOString();
  sets.push('updated_at = ?');
  values.push(now);
  values.push(id);
  await db.runAsync(`UPDATE medical_record SET ${sets.join(', ')} WHERE id = ?`, values);
  emit('entities:changed');
}

/**
 * Acceptă consimțământul AI medical pentru un dosar. Setează `ai_consent_at`
 * la timestamp-ul curent. `ai_consent_version` rămâne (e setat la create cu
 * versiunea curentă a textului legal).
 */
export async function setAiConsent(id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE medical_record SET ai_consent_at = ?, updated_at = ? WHERE id = ?', [
    now,
    now,
    id,
  ]);
  emit('entities:changed');
}

/**
 * Retrage consimțământul AI. Resetează `ai_consent_at` la NULL. NU șterge
 * datele existente (observații, conversații) — userul le poate șterge separat.
 */
export async function revokeAiConsent(id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE medical_record SET ai_consent_at = NULL, updated_at = ? WHERE id = ?', [
    now,
    id,
  ]);
  emit('entities:changed');
}

/**
 * Șterge dosarul. Cascade pe medical_observations, medical_chat_threads și
 * medical_chat_messages prin FOREIGN KEY ON DELETE CASCADE. NU șterge cheia
 * master AES (alte dosare ar putea o folosi încă).
 */
export async function deleteMedicalRecord(id: string): Promise<void> {
  // Cascade pe junction: FK ON DELETE pe document_entities nu există în schema,
  // deci ștergem manual înainte de DELETE pe medical_record. Altfel ar rămâne
  // legături orfan care apar ca UUID-uri în UI.
  await db.runAsync(
    "DELETE FROM document_entities WHERE entity_type = 'medical_record' AND entity_id = ?",
    [id]
  );
  await db.runAsync('DELETE FROM medical_record WHERE id = ?', [id]);
  await removeOrder('medical_record', id);
  emit('entities:changed');
  emit('links:changed');
  emit('documents:changed');
}

export interface MedicalRecordStats {
  observations_total: number;
  observations_needs_review: number;
  documents_total: number;
  threads_total: number;
}

export async function getMedicalRecordStats(id: string): Promise<MedicalRecordStats> {
  const obsTotalRow = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM medical_observations WHERE medical_record_id = ?',
    [id]
  );
  const obsReviewRow = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM medical_observations WHERE medical_record_id = ? AND needs_review = 1',
    [id]
  );
  const threadsRow = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM medical_chat_threads WHERE medical_record_id = ?',
    [id]
  );

  // Toate documentele legate la acest dosar — inclusiv tipuri non-medicale
  // (custom, altul) pe care userul le-a atașat manual ca relevante medical.
  // Chat-ul medical le caută; contorul reflectă această realitate.
  const docsRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(DISTINCT d.id) as c FROM documents d
     JOIN document_entities de ON de.document_id = d.id
     WHERE de.entity_type = 'medical_record' AND de.entity_id = ?`,
    [id]
  );

  return {
    observations_total: obsTotalRow?.c ?? 0,
    observations_needs_review: obsReviewRow?.c ?? 0,
    documents_total: docsRow?.c ?? 0,
    threads_total: threadsRow?.c ?? 0,
  };
}

/**
 * True dacă dosarul are AI consent activ. False altfel (consent revocat sau
 * niciodată acordat).
 */
export async function hasActiveAiConsent(id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ ai_consent_at: string | null }>(
    'SELECT ai_consent_at FROM medical_record WHERE id = ?',
    [id]
  );
  return row?.ai_consent_at != null;
}

/**
 * Persoane care au documente medicale (tip ∈ MEDICAL_DOC_TYPES) atașate
 * direct prin person_id legacy, fără medical_record asociat. Folosit pentru
 * banner-ul „Migrează la dosar medical" din Home (vezi MigrateOrphansWizard).
 */
export async function findPersonsWithOrphanMedicalDocs(): Promise<Person[]> {
  return db.getAllAsync<Person>(`
    SELECT DISTINCT p.* FROM persons p
    JOIN documents d ON d.person_id = p.id
    WHERE d.type IN ${MEDICAL_DOC_TYPES_SQL}
      AND NOT EXISTS (SELECT 1 FROM medical_record m WHERE m.person_id = p.id)
    ORDER BY p.name COLLATE NOCASE ASC
  `);
}

export interface PendingReminderDoc {
  documentId: string;
  items: ActionableItem[];
}

/**
 * Returnează documentele legate de un dosar medical care au `pending_reminders_json`
 * populat ȘI `medical_reminders_prompted_at IS NULL` ȘI cel puțin un item cu
 * `suggested_date_iso >= today` (D14 — past dates filtrate complet).
 *
 * Folosit de UI-ul de dosar medical (`entitati/medical/[id]`) la mount pentru a
 * decide dacă deschide `MedicalRemindersModal`.
 */
export async function getDocumentsWithPendingReminders(
  recordId: string
): Promise<PendingReminderDoc[]> {
  const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const rows = await db.getAllAsync<{
    document_id: string;
    pending_reminders_json: string | null;
    medical_reminders_prompted_at: string | null;
  }>(
    `SELECT d.id AS document_id, d.pending_reminders_json, d.medical_reminders_prompted_at
     FROM documents d
     JOIN document_entities de ON de.document_id = d.id
     WHERE de.entity_type = 'medical_record'
       AND de.entity_id = ?
       AND d.pending_reminders_json IS NOT NULL
       AND d.medical_reminders_prompted_at IS NULL`,
    [recordId]
  );

  const result: PendingReminderDoc[] = [];
  for (const r of rows) {
    const items = await getPendingReminders(r.document_id);
    const future = items.filter(
      i => i.suggested_date_iso !== null && i.suggested_date_iso >= todayIso
    );
    if (future.length > 0) {
      result.push({ documentId: r.document_id, items: future });
    }
  }
  return result;
}
