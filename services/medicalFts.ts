/**
 * Helpers FTS5 pentru retrieval-ul chat-ului medical.
 *
 * Politică conștientă: `chunk_text` e plaintext în FTS5 (acceptată în spec
 * §7.2: FTS5 nu poate căuta în date criptate; protejat de App Lock + sandbox).
 *
 * Reguli pentru caller:
 * - Înainte de insert chunks pentru un document/observație existentă,
 *   apelează `deleteChunksBySource` ca să eviți duplicate.
 * - Nu include `private_notes` în `chunk_text` — niciodată. Vezi
 *   `.claude/rules/ai-privacy.md`.
 */
import { db } from './db';
import { decryptFieldOrNull } from './medicalCrypto';
import { getMedicalFtsVersion, setMedicalFtsVersion } from './settings';

/**
 * Versiune curentă a structurii FTS5 medicale. Incrementă când schimbăm
 * structura chunks-urilor:
 *   v1: chunks pentru observații + OCR brut.
 *   v2: + chunks dedicate pentru `doc.note` (Rezumat document: ...).
 */
export const CURRENT_FTS_VERSION = 2;

export type ChunkSource = 'document' | 'observation';

export interface ChunkInsert {
  medical_record_id: string;
  source_type: ChunkSource;
  source_id: string;
  observed_at: string | null;
  chunk_text: string;
}

export async function insertChunks(chunks: ChunkInsert[]): Promise<void> {
  if (chunks.length === 0) return;
  for (const c of chunks) {
    if (!c.chunk_text || c.chunk_text.trim().length === 0) continue;
    await db.runAsync(
      `INSERT INTO medical_chunks_fts
         (medical_record_id, source_type, source_id, observed_at, chunk_text)
       VALUES (?, ?, ?, ?, ?)`,
      [c.medical_record_id, c.source_type, c.source_id, c.observed_at, c.chunk_text]
    );
  }
}

export async function deleteChunksBySource(
  sourceType: ChunkSource,
  sourceId: string
): Promise<void> {
  await db.runAsync('DELETE FROM medical_chunks_fts WHERE source_type = ? AND source_id = ?', [
    sourceType,
    sourceId,
  ]);
}

export async function deleteChunksByRecord(recordId: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_chunks_fts WHERE medical_record_id = ?', [recordId]);
}

/**
 * Split text în chunks ~`size` char, overlap `overlap` char, prefer split la
 * `.` ca să nu rupem propoziții la jumătate. Returnează doar chunks
 * ne-vide.
 */
export function chunkText(text: string, size = 500, overlap = 100): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= size) return [trimmed];
  const chunks: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    let end = Math.min(i + size, trimmed.length);
    if (end < trimmed.length) {
      const lastDot = trimmed.lastIndexOf('.', end);
      if (lastDot > i + Math.floor(size / 2)) end = lastDot + 1;
    }
    const chunk = trimmed.slice(i, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= trimmed.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return chunks;
}

export interface FtsHit {
  source_type: ChunkSource;
  source_id: string;
  observed_at: string | null;
  chunk_text: string;
  rank: number;
}

export interface SearchChunksArgs {
  recordId: string;
  /** FTS5 MATCH expression (ex: `colester* OR hdl*`). */
  query: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export async function searchChunks(args: SearchChunksArgs): Promise<FtsHit[]> {
  const limit = args.limit ?? 20;
  const params: (string | number)[] = [args.recordId, args.query];
  let sql = `
    SELECT source_type, source_id, observed_at, chunk_text,
           bm25(medical_chunks_fts) as rank
    FROM medical_chunks_fts
    WHERE medical_record_id = ?
      AND medical_chunks_fts MATCH ?`;
  if (args.from) {
    sql += ' AND (observed_at IS NULL OR observed_at >= ?)';
    params.push(args.from);
  }
  if (args.to) {
    sql += ' AND (observed_at IS NULL OR observed_at <= ?)';
    params.push(args.to);
  }
  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);
  try {
    return await db.getAllAsync<FtsHit>(sql, params);
  } catch (e) {
    console.warn('[medicalFts] searchChunks failed:', e);
    return [];
  }
}

/**
 * Reconstruiește FTS5 din state-ul curent al DB-ului (observații + ocr_text).
 * Folosit după restore backup/cloud — virtual table-ul FTS NU se exportă (e
 * volatil) și trebuie regenerat. Decriptarea observațiilor folosește cheia
 * curentă; dacă cheia lipsește, observațiile lor sunt sărite (best-effort).
 *
 * Pentru documente, indexează `ocr_text` plaintext (este deja stocat plaintext
 * în `documents.ocr_text` — vezi spec §7.2).
 */
export async function rebuildFtsFromExistingData(): Promise<void> {
  await db.runAsync('DELETE FROM medical_chunks_fts');

  // 1) Observații
  interface ObsRow {
    id: string;
    medical_record_id: string;
    name_enc: Uint8Array | null;
    value_enc: Uint8Array | null;
    unit: string | null;
    ref_min_enc: Uint8Array | null;
    ref_max_enc: Uint8Array | null;
    observed_at: string | null;
    category: string | null;
  }
  const obs = await db.getAllAsync<ObsRow>('SELECT * FROM medical_observations');
  const toBytes = (v: Uint8Array | ArrayBuffer | null) =>
    v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : null;
  for (const r of obs) {
    const aad = r.medical_record_id;
    const name = await decryptFieldOrNull(toBytes(r.name_enc), aad);
    if (!name) continue;
    const value = await decryptFieldOrNull(toBytes(r.value_enc), aad);
    const refMin = await decryptFieldOrNull(toBytes(r.ref_min_enc), aad);
    const refMax = await decryptFieldOrNull(toBytes(r.ref_max_enc), aad);
    const chunk = buildObservationChunk({
      name,
      value,
      unit: r.unit,
      ref_min: refMin,
      ref_max: refMax,
      category: r.category ?? 'altele',
      observed_at: r.observed_at,
    });
    await insertChunks([
      {
        medical_record_id: aad,
        source_type: 'observation',
        source_id: r.id,
        observed_at: r.observed_at,
        chunk_text: chunk,
      },
    ]);
  }

  // 2) Document OCR + rezumat AI (`note`). Plaintext, deja stocat. Doar
  //    documente medicale legate de o persoană cu medical_record activ.
  interface DocRow {
    id: string;
    mr_id: string;
    issue_date: string | null;
    ocr_text: string | null;
    note: string | null;
  }
  const docs = await db.getAllAsync<DocRow>(
    `SELECT d.id, m.id AS mr_id, d.issue_date, d.ocr_text, d.note
     FROM documents d
     JOIN medical_record m ON m.person_id = d.person_id
     WHERE d.type IN ('analize_medicale','reteta_medicala','scrisoare_medicala','bilet_externare','imagistica','vaccin_persoana')
       AND ((d.ocr_text IS NOT NULL AND d.ocr_text != '')
         OR (d.note IS NOT NULL AND d.note != ''))`
  );
  for (const d of docs) {
    if (d.note && d.note.trim().length > 0) {
      await insertChunks([
        {
          medical_record_id: d.mr_id,
          source_type: 'document' as const,
          source_id: d.id,
          observed_at: d.issue_date ?? null,
          chunk_text: `Rezumat document: ${d.note.trim()}`,
        },
      ]);
    }
    if (d.ocr_text && d.ocr_text.trim().length > 0) {
      const chunks = chunkText(d.ocr_text);
      await insertChunks(
        chunks.map(t => ({
          medical_record_id: d.mr_id,
          source_type: 'document' as const,
          source_id: d.id,
          observed_at: d.issue_date ?? null,
          chunk_text: t,
        }))
      );
    }
  }
}

/**
 * Construiește chunk_text canonic pentru o observație extrasă. Format:
 * `{nume} {valoare} {unitate} [{ref_min}-{ref_max}] {categorie} {data}`.
 * Folosit la indexarea observațiilor în FTS5 după extracție/update.
 */
export function buildObservationChunk(opts: {
  name: string;
  value: string | null;
  unit: string | null;
  ref_min: string | null;
  ref_max: string | null;
  category: string;
  observed_at: string | null;
}): string {
  const parts: string[] = [opts.name];
  if (opts.value) parts.push(opts.value);
  if (opts.unit) parts.push(opts.unit);
  if (opts.ref_min || opts.ref_max) {
    parts.push(`[${opts.ref_min ?? '?'}-${opts.ref_max ?? '?'}]`);
  }
  parts.push(opts.category);
  if (opts.observed_at) parts.push(opts.observed_at);
  return parts.join(' ');
}

/**
 * Idempotent. Rebuild FTS5 dacă versiunea stocată în settings e mai mică decât
 * `CURRENT_FTS_VERSION`. Folosit la app start după update: utilizatorii
 * existenți cu chunks indexate fără `doc.note` primesc indexul nou fără să
 * apese „Re-extrage". Fire-and-forget; erorile sunt logate, nu propagate.
 */
export async function ensureFtsIndexUpToDate(): Promise<void> {
  try {
    const stored = await getMedicalFtsVersion();
    if (stored >= CURRENT_FTS_VERSION) return;
    await rebuildFtsFromExistingData();
    await setMedicalFtsVersion(CURRENT_FTS_VERSION);
  } catch (e) {
    console.warn('[medicalFts] ensureFtsIndexUpToDate failed:', e);
  }
}
