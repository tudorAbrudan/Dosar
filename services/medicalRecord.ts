/**
 * CRUD pentru entitatea `medical_record` — singura entitate user-facing din app.
 *
 * Stochează identitatea pacientului (`name`, opțional `phone` / `email`) plus
 * datele dosarului medical (consent AI, observații medicale, conversații).
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
import type { MedicalRecord } from '@/types';

const MEDICAL_DOC_TYPES_SQL = `(
  'analize_medicale','reteta_medicala','scrisoare_medicala',
  'bilet_externare','imagistica','vaccin_persoana'
)`;

// Fallback sort pentru entități care nu au rând în entity_order.
const ORDER_FALLBACK = 1e18;

// TODO(medical-merge): MedicalRecordRow include phone/email din DosarMedical.
// În Dosar, schema SQLite din Task 4 nu are aceste coloane — ele trăiesc pe
// tabelul `persons` (FK person_id). Task 15 (useEntities) va reconcilia.
// Până atunci, SELECT * returnează NULL pentru coloane lipsă → comportament safe.
interface MedicalRecordRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  ai_consent_at: string | null;
  ai_consent_version: number | null;
  encryption_key_ref: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(r: MedicalRecordRow): MedicalRecord {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    ai_consent_at: r.ai_consent_at,
    ai_consent_version: r.ai_consent_version ?? 1,
    encryption_key_ref: r.encryption_key_ref,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateMedicalRecordInput {
  name: string;
  phone?: string;
  email?: string;
}

export async function createMedicalRecord(input: CreateMedicalRecordInput): Promise<MedicalRecord> {
  await ensureMedicalMasterKey();
  const id = generateId();
  const now = new Date().toISOString();
  // TODO(medical-merge): INSERT include phone/email din DosarMedical.
  // Schema Dosar (Task 4) nu are aceste coloane; are person_id în schimb.
  // Task 15 va rescrie această funcție să accepte person_id și să ignore phone/email.
  await db.runAsync(
    `INSERT INTO medical_record
       (id, name, phone, email, ai_consent_at, ai_consent_version, encryption_key_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
    [id, input.name, input.phone ?? null, input.email ?? null, MEDICAL_MASTER_KEY_REF, now, now]
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
  phone?: string | null;
  email?: string | null;
}

export async function updateMedicalRecord(
  id: string,
  patch: UpdateMedicalRecordInput
): Promise<void> {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.phone !== undefined) {
    sets.push('phone = ?');
    values.push(patch.phone ?? null);
  }
  if (patch.email !== undefined) {
    sets.push('email = ?');
    values.push(patch.email ?? null);
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

  // Documente medicale legate de acest dosar (prin document_entities).
  const docsRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(DISTINCT d.id) as c FROM documents d
     JOIN document_entities de ON de.document_id = d.id
     WHERE de.entity_type = 'medical_record' AND de.entity_id = ?
       AND d.type IN ${MEDICAL_DOC_TYPES_SQL}`,
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
