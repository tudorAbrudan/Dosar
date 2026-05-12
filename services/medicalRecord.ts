/**
 * CRUD pentru entitatea `medical_record` (1:1 cu Person).
 *
 * Notă: tabelul are constraint UNIQUE pe person_id — un al doilea
 * `createMedicalRecord` pentru aceeași persoană aruncă din SQLite.
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
import { emit } from './events';
import type { MedicalRecord } from '@/types';

const MEDICAL_DOC_TYPES_SQL = `(
  'analize_medicale','reteta_medicala','scrisoare_medicala',
  'bilet_externare','imagistica','vaccin_persoana'
)`;

interface MedicalRecordRow {
  id: string;
  person_id: string;
  name: string;
  ai_consent_at: string | null;
  ai_consent_version: number | null;
  encryption_key_ref: string;
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
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateMedicalRecordInput {
  person_id: string;
  name: string;
}

export async function createMedicalRecord(input: CreateMedicalRecordInput): Promise<MedicalRecord> {
  await ensureMedicalMasterKey();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO medical_record
       (id, person_id, name, ai_consent_at, ai_consent_version, encryption_key_ref, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 1, ?, ?, ?)`,
    [id, input.person_id, input.name, MEDICAL_MASTER_KEY_REF, now, now]
  );
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

export async function getMedicalRecordByPersonId(personId: string): Promise<MedicalRecord | null> {
  const row = await db.getFirstAsync<MedicalRecordRow>(
    'SELECT * FROM medical_record WHERE person_id = ?',
    [personId]
  );
  return row ? rowToRecord(row) : null;
}

export async function listMedicalRecords(): Promise<MedicalRecord[]> {
  const rows = await db.getAllAsync<MedicalRecordRow>(
    'SELECT * FROM medical_record ORDER BY updated_at DESC'
  );
  return rows.map(rowToRecord);
}

export async function updateMedicalRecord(id: string, patch: { name?: string }): Promise<void> {
  const now = new Date().toISOString();
  if (patch.name !== undefined) {
    await db.runAsync('UPDATE medical_record SET name = ?, updated_at = ? WHERE id = ?', [
      patch.name,
      now,
      id,
    ]);
  }
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
  await db.runAsync('DELETE FROM medical_record WHERE id = ?', [id]);
  emit('entities:changed');
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

  const rec = await getMedicalRecord(id);
  let docsTotal = 0;
  if (rec) {
    const docsRow = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM documents
       WHERE person_id = ? AND type IN ${MEDICAL_DOC_TYPES_SQL}`,
      [rec.person_id]
    );
    docsTotal = docsRow?.c ?? 0;
  }

  return {
    observations_total: obsTotalRow?.c ?? 0,
    observations_needs_review: obsReviewRow?.c ?? 0,
    documents_total: docsTotal,
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
