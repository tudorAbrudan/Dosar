/**
 * CRUD pentru `medical_observations` — câmpurile sensibile (name, value,
 * ref_min, ref_max) sunt criptate AES-GCM cu AAD = medical_record_id.
 *
 * Threshold needs_review: `confidence < 0.7` → flag pentru review user.
 *
 * Dedup la insert prin cheia compusă
 * `(medical_record_id, source_document_id, name_normalized, observed_at)`.
 * Re-extracția unui document deja procesat trebuie să cheme
 * `deleteObservationsBySourceDocument(docId)` înainte.
 */
import { db, generateId } from './db';
import {
  encryptField,
  encryptFieldOpt,
  decryptField,
  decryptFieldOpt,
  decryptFieldOrNull,
} from './medicalCrypto';
import { emit } from './events';
import type { MedicalObservation, ObservationCategory } from '@/types';

const REVIEW_THRESHOLD = 0.7;

export interface InsertObservationInput {
  medical_record_id: string;
  source_document_id: string | null;
  name: string;
  value: string | null;
  unit: string | null;
  ref_min: string | null;
  ref_max: string | null;
  observed_at: string | null;
  category: ObservationCategory;
  confidence: number;
}

interface ObservationRow {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  name_enc: Uint8Array;
  value_enc: Uint8Array | null;
  unit: string | null;
  ref_min_enc: Uint8Array | null;
  ref_max_enc: Uint8Array | null;
  observed_at: string | null;
  category: string | null;
  confidence: number;
  needs_review: number;
  user_corrected: number;
  created_at: string;
  updated_at: string;
}

function toBytes(blob: Uint8Array | ArrayBuffer | null | undefined): Uint8Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) return blob;
  return new Uint8Array(blob);
}

async function rowToObs(r: ObservationRow): Promise<MedicalObservation> {
  const recordId = r.medical_record_id;
  return {
    id: r.id,
    medical_record_id: recordId,
    source_document_id: r.source_document_id,
    name: (await decryptFieldOrNull(toBytes(r.name_enc), recordId)) ?? '[indisponibil]',
    value: await decryptFieldOpt(toBytes(r.value_enc), recordId),
    unit: r.unit,
    ref_min: await decryptFieldOpt(toBytes(r.ref_min_enc), recordId),
    ref_max: await decryptFieldOpt(toBytes(r.ref_max_enc), recordId),
    observed_at: r.observed_at,
    category: (r.category ?? 'altele') as ObservationCategory,
    confidence: r.confidence,
    needs_review: r.needs_review === 1,
    user_corrected: r.user_corrected === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function insertObservation(
  input: InsertObservationInput
): Promise<MedicalObservation> {
  const id = generateId();
  const now = new Date().toISOString();
  const aad = input.medical_record_id;
  const nameEnc = await encryptField(input.name, aad);
  const valueEnc = await encryptFieldOpt(input.value, aad);
  const minEnc = await encryptFieldOpt(input.ref_min, aad);
  const maxEnc = await encryptFieldOpt(input.ref_max, aad);
  const needsReview = input.confidence < REVIEW_THRESHOLD ? 1 : 0;

  await db.runAsync(
    `INSERT INTO medical_observations
       (id, medical_record_id, source_document_id, name_enc, value_enc, unit,
        ref_min_enc, ref_max_enc, observed_at, category, confidence,
        needs_review, user_corrected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.medical_record_id,
      input.source_document_id,
      nameEnc,
      valueEnc,
      input.unit,
      minEnc,
      maxEnc,
      input.observed_at,
      input.category,
      input.confidence,
      needsReview,
      now,
      now,
    ]
  );
  emit('entities:changed');
  const reload = await getObservation(id);
  if (!reload) throw new Error('Eroare la salvarea observației medicale.');
  return reload;
}

export async function getObservation(id: string): Promise<MedicalObservation | null> {
  const row = await db.getFirstAsync<ObservationRow>(
    'SELECT * FROM medical_observations WHERE id = ?',
    [id]
  );
  if (!row) return null;
  return rowToObs(row);
}

export interface ListObservationsFilter {
  category?: ObservationCategory;
  needsReviewOnly?: boolean;
}

export async function listObservationsByRecord(
  recordId: string,
  filters?: ListObservationsFilter
): Promise<MedicalObservation[]> {
  let sql = 'SELECT * FROM medical_observations WHERE medical_record_id = ?';
  const params: (string | number)[] = [recordId];
  if (filters?.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }
  if (filters?.needsReviewOnly) {
    sql += ' AND needs_review = 1';
  }
  // SQLite ORDER BY pe coloana nullable: NULL apare la final implicit la DESC
  // (de fapt la început) — folosim CASE pentru ordine explicită.
  sql +=
    ' ORDER BY CASE WHEN observed_at IS NULL THEN 1 ELSE 0 END, observed_at DESC, created_at DESC';
  const rows = await db.getAllAsync<ObservationRow>(sql, params);
  return Promise.all(rows.map(rowToObs));
}

export async function listObservationsBySourceDocument(
  documentId: string
): Promise<MedicalObservation[]> {
  const rows = await db.getAllAsync<ObservationRow>(
    'SELECT * FROM medical_observations WHERE source_document_id = ?',
    [documentId]
  );
  return Promise.all(rows.map(rowToObs));
}

export interface UpdateObservationPatch {
  name?: string;
  value?: string | null;
  unit?: string | null;
  ref_min?: string | null;
  ref_max?: string | null;
  observed_at?: string | null;
  category?: ObservationCategory;
  confidence?: number;
  needs_review?: boolean;
  user_corrected?: boolean;
}

export async function updateObservation(id: string, patch: UpdateObservationPatch): Promise<void> {
  const existing = await getObservation(id);
  if (!existing) throw new Error('Observația medicală nu există.');
  const aad = existing.medical_record_id;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: (string | number | Uint8Array | null)[] = [];

  if (patch.name !== undefined) {
    sets.push('name_enc = ?');
    params.push(await encryptField(patch.name, aad));
  }
  if (patch.value !== undefined) {
    sets.push('value_enc = ?');
    params.push(await encryptFieldOpt(patch.value, aad));
  }
  if (patch.unit !== undefined) {
    sets.push('unit = ?');
    params.push(patch.unit);
  }
  if (patch.ref_min !== undefined) {
    sets.push('ref_min_enc = ?');
    params.push(await encryptFieldOpt(patch.ref_min, aad));
  }
  if (patch.ref_max !== undefined) {
    sets.push('ref_max_enc = ?');
    params.push(await encryptFieldOpt(patch.ref_max, aad));
  }
  if (patch.observed_at !== undefined) {
    sets.push('observed_at = ?');
    params.push(patch.observed_at);
  }
  if (patch.category !== undefined) {
    sets.push('category = ?');
    params.push(patch.category);
  }
  if (patch.confidence !== undefined) {
    sets.push('confidence = ?');
    params.push(patch.confidence);
  }
  if (patch.needs_review !== undefined) {
    sets.push('needs_review = ?');
    params.push(patch.needs_review ? 1 : 0);
  }
  if (patch.user_corrected !== undefined) {
    sets.push('user_corrected = ?');
    params.push(patch.user_corrected ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);
  await db.runAsync(`UPDATE medical_observations SET ${sets.join(', ')} WHERE id = ?`, params);
  emit('entities:changed');
}

export async function deleteObservation(id: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_observations WHERE id = ?', [id]);
  emit('entities:changed');
}

/**
 * Șterge toate observațiile asociate unui document — folosit la re-extracție
 * (re-upload același document) sau la ștergerea documentului.
 */
export async function deleteObservationsBySourceDocument(documentId: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_observations WHERE source_document_id = ?', [documentId]);
  emit('entities:changed');
}

export interface ObservationGroup {
  name: string;
  category: ObservationCategory;
  unit: string | null;
  values: {
    id: string;
    value: string | null;
    observed_at: string | null;
    needs_review: boolean;
    source_document_id: string | null;
  }[];
  ref_min: string | null;
  ref_max: string | null;
  last_observed_at: string | null;
}

/**
 * Grupare observații după nume normalizat (lowercase + trim). Decriptează totul
 * în memorie. Folosit pentru Tab Timeline din ecranul detaliu dosar.
 *
 * Ordine grupuri: după `last_observed_at` descrescător (cel mai recent primul).
 * Ordine valori în grup: după `observed_at` crescător (cronologic ascendent, ca
 * sparkline-ul să curgă de la stânga la dreapta).
 *
 * `options.includeNarrative` (default `false`): dacă `true`, include și
 * observațiile cu `category === 'altele'` (recomandări, diagnostice, plan).
 * Timeline-ul din UI vrea doar analize → default exclude narrative.
 */
export async function groupByName(
  recordId: string,
  options?: { includeNarrative?: boolean }
): Promise<ObservationGroup[]> {
  const all = await listObservationsByRecord(recordId);
  const filtered = options?.includeNarrative ? all : all.filter((o) => o.category !== 'altele');
  const map = new Map<string, ObservationGroup>();
  for (const o of filtered) {
    const key = o.name.trim().toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = {
        name: o.name,
        category: o.category,
        unit: o.unit,
        values: [],
        ref_min: o.ref_min,
        ref_max: o.ref_max,
        last_observed_at: o.observed_at,
      };
      map.set(key, g);
    }
    g.values.push({
      id: o.id,
      value: o.value,
      observed_at: o.observed_at,
      needs_review: o.needs_review,
      source_document_id: o.source_document_id,
    });
    if (o.observed_at && (!g.last_observed_at || o.observed_at > g.last_observed_at)) {
      g.last_observed_at = o.observed_at;
      g.unit = o.unit ?? g.unit;
      g.ref_min = o.ref_min ?? g.ref_min;
      g.ref_max = o.ref_max ?? g.ref_max;
    }
  }
  for (const g of map.values()) {
    g.values.sort((a, b) => (a.observed_at ?? '').localeCompare(b.observed_at ?? ''));
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.last_observed_at ?? '').localeCompare(a.last_observed_at ?? '')
  );
}

export async function countNeedsReview(recordId: string): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM medical_observations WHERE medical_record_id = ? AND needs_review = 1',
    [recordId]
  );
  return r?.c ?? 0;
}

export async function countObservations(recordId: string): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM medical_observations WHERE medical_record_id = ?',
    [recordId]
  );
  return r?.c ?? 0;
}

export interface DocumentObservationStats {
  total: number;
  needsReview: number;
}

/**
 * Returnează un Map document_id → {total, needsReview} pentru toate
 * observațiile dintr-un dosar. Folosit de UI ca indicator de status al
 * extracției per document. Câmpurile COUNT / needs_review nu sunt criptate.
 */
export async function getObservationCountsByDocument(
  recordId: string
): Promise<Map<string, DocumentObservationStats>> {
  const rows = await db.getAllAsync<{
    source_document_id: string;
    total: number;
    review: number;
  }>(
    `SELECT source_document_id, COUNT(*) AS total, SUM(needs_review) AS review
     FROM medical_observations
     WHERE medical_record_id = ? AND source_document_id IS NOT NULL
     GROUP BY source_document_id`,
    [recordId]
  );
  const map = new Map<string, DocumentObservationStats>();
  for (const r of rows) {
    map.set(r.source_document_id, { total: r.total, needsReview: r.review ?? 0 });
  }
  return map;
}

export type ObservationStatus = 'normal' | 'high' | 'low' | 'criticalHigh' | 'criticalLow' | 'unknown';

function parseNum(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const cleaned = s.replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clasifică o observație pe baza valorii și intervalului de referință.
 * Severitate: dacă valoarea depășește bound-ul cu >50% (din mărimea intervalului
 * sau, dacă lipsește un bound, din valoarea bound-ului), e `criticalHigh/Low`.
 * Altfel `high/low`. `unknown` când nu poate parsa (ex. valori
 * „pozitiv"/„negativ").
 */
export function getObservationStatus(
  value: string | null | undefined,
  refMin: string | null | undefined,
  refMax: string | null | undefined
): ObservationStatus {
  const v = parseNum(value);
  const lo = parseNum(refMin);
  const hi = parseNum(refMax);
  if (v === null) return 'unknown';
  if (lo === null && hi === null) return 'unknown';
  const rangeWidth = lo !== null && hi !== null ? Math.max(hi - lo, 1e-9) : null;

  if (hi !== null && v > hi) {
    const overshoot = v - hi;
    const ref = rangeWidth ?? hi;
    return overshoot / Math.max(ref, 1e-9) > 0.5 ? 'criticalHigh' : 'high';
  }
  if (lo !== null && v < lo) {
    const undershoot = lo - v;
    const ref = rangeWidth ?? lo;
    return undershoot / Math.max(ref, 1e-9) > 0.5 ? 'criticalLow' : 'low';
  }
  return 'normal';
}
