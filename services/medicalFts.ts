/**
 * Helpers FTS5 pentru retrieval-ul chat-ului medical.
 *
 * Politică conștientă: `chunk_text` e plaintext în FTS5 (acceptată în spec
 * §7.2: FTS5 nu poate căuta în date criptate; protejat de App Lock + sandbox).
 *
 * Schema Dosar (medical_fts):
 *   document_id UNINDEXED, medical_record_id UNINDEXED, chunk_type, chunk_text
 *
 * Observațiile NU sunt indexate în FTS — căutarea structurată pe observații
 * decriptate se face direct prin SQL pe `medical_observations` (spec §6.5).
 * FTS indexează doar documente: text OCR brut ('ocr') și rezumate AI ('summary').
 *
 * Filtrarea temporală pe documente se face post-retrieval în `medicalChat.ts`
 * prin join cu `documents.issue_date` (spec §7.2: medical_fts nu stochează date).
 *
 * Reguli pentru caller:
 * - Înainte de insert chunks pentru un document existent, apelează
 *   `deleteChunksByDocument` ca să eviți duplicate.
 * - Nu include `private_notes` în `chunk_text` — niciodată. Vezi
 *   `.claude/rules/ai-privacy.md`.
 */
import { db } from './db';
import { getMedicalFtsVersion, setMedicalFtsVersion } from './settings';

/**
 * Versiune curentă a structurii FTS5 medicale. Incrementă când schimbăm
 * structura chunks-urilor:
 *   v1: chunks pentru observații + OCR brut.
 *   v2: + chunks dedicate pentru `doc.note` (Rezumat document: ...).
 *   v3: eliminare chunks observații din FTS (spec §6.5); schema medical_fts
 *       cu document_id + chunk_type în loc de source_type + source_id.
 */
export const CURRENT_FTS_VERSION = 3;

/** Tipul unui chunk FTS: 'ocr' = text brut document, 'summary' = rezumat AI. */
export type ChunkType = 'ocr' | 'summary';

export interface ChunkInsert {
  document_id: string;
  medical_record_id: string;
  chunk_type: ChunkType;    // 'ocr' text brut SAU 'summary' rezumat AI
  chunk_text: string;
}

export async function insertChunks(chunks: ChunkInsert[]): Promise<void> {
  if (chunks.length === 0) return;
  for (const c of chunks) {
    if (!c.chunk_text || c.chunk_text.trim().length === 0) continue;
    await db.runAsync(
      `INSERT INTO medical_fts (document_id, medical_record_id, chunk_type, chunk_text)
       VALUES (?, ?, ?, ?)`,
      [c.document_id, c.medical_record_id, c.chunk_type, c.chunk_text]
    );
  }
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_fts WHERE document_id = ?', [documentId]);
}

export async function deleteChunksByRecord(recordId: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_fts WHERE medical_record_id = ?', [recordId]);
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
  document_id: string;
  chunk_type: ChunkType;
  chunk_text: string;
  rank: number;
}

export interface SearchChunksArgs {
  recordId: string;
  /** FTS5 MATCH expression (ex: `colester* OR hdl*`). */
  query: string;
  limit?: number;
}

export async function searchChunks(args: SearchChunksArgs): Promise<FtsHit[]> {
  const limit = args.limit ?? 20;
  const sql = `
    SELECT document_id, chunk_type, chunk_text, bm25(medical_fts) as rank
    FROM medical_fts
    WHERE medical_record_id = ?
      AND medical_fts MATCH ?
    ORDER BY rank LIMIT ?`;
  try {
    return await db.getAllAsync<FtsHit>(sql, [args.recordId, args.query, limit]);
  } catch (e) {
    console.warn('[medicalFts] searchChunks failed:', e);
    return [];
  }
}

/**
 * Reconstruiește FTS5 din state-ul curent al DB-ului (documente medicale).
 * Folosit după restore backup/cloud — virtual table-ul FTS NU se exportă (e
 * volatil) și trebuie regenerat.
 *
 * Observațiile NU sunt indexate (spec §6.5) — căutarea structurată pe ele
 * se face prin SQL direct cu decriptare.
 *
 * Pentru documente, indexează `ocr_text` plaintext (stocat plaintext în
 * `documents.ocr_text` — spec §7.2) și `note` (rezumat AI).
 */
export async function rebuildFtsFromExistingData(): Promise<void> {
  await db.runAsync('DELETE FROM medical_fts');

  interface DocRow {
    id: string;
    mr_id: string;
    ocr_text: string | null;
    note: string | null;
  }
  const docs = await db.getAllAsync<DocRow>(
    `SELECT DISTINCT d.id, de.entity_id AS mr_id, d.ocr_text, d.note
     FROM documents d
     JOIN document_entities de ON de.document_id = d.id AND de.entity_type = 'medical_record'
     WHERE d.type IN ('analize_medicale','reteta_medicala','scrisoare_medicala','bilet_externare','imagistica','vaccin_persoana')
       AND ((d.ocr_text IS NOT NULL AND d.ocr_text != '')
         OR (d.note IS NOT NULL AND d.note != ''))`
  );

  for (const d of docs) {
    if (d.note && d.note.trim().length > 0) {
      await insertChunks([{
        document_id: d.id,
        medical_record_id: d.mr_id,
        chunk_type: 'summary',
        chunk_text: `Rezumat document: ${d.note.trim()}`,
      }]);
    }
    if (d.ocr_text && d.ocr_text.trim().length > 0) {
      const chunks = chunkText(d.ocr_text);
      await insertChunks(chunks.map(t => ({
        document_id: d.id,
        medical_record_id: d.mr_id,
        chunk_type: 'ocr' as const,
        chunk_text: t,
      })));
    }
  }
}

/**
 * Idempotent. Rebuild FTS5 dacă versiunea stocată în settings e mai mică decât
 * `CURRENT_FTS_VERSION`. Folosit la app start după update: utilizatorii
 * existenți primesc indexul nou fără intervenție manuală. Fire-and-forget;
 * erorile sunt logate, nu propagate.
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
