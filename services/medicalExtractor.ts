/**
 * Pipeline de extracție LLM pentru documente medicale.
 *
 *   Document → OCR text → LLM cu prompt strict → JSON → validare strictă →
 *   insert în `medical_observations` (criptat) + chunks FTS5.
 *
 * Anti-halucinație by construcție:
 * - Prompts care interzic deducerea/calculul (vezi `SYSTEM_BY_TYPE`).
 * - `validateExtraction` aruncă observațiile care nu au valoare numerică sau
 *   text whitelisted, sau cu confidence < 0.5, sau fără nume.
 * - `private_notes` niciodată în payload (folosim `sanitizeDocumentForAI`).
 * - Confidence < 0.7 → `needs_review = true` pe inserare (UI banner).
 *
 * Pentru imagistică/scrisori/bilet externare prompt-ul plafonează confidence
 * la 0.7 by default, marcând observațiile ca needs_review.
 */
import type { Document, DocumentType, ObservationCategory } from '@/types';
import {
  sendAiRequest,
  AiContextOverflowError,
  getAiConfig,
  getAiUsageToday,
  DAILY_AI_LIMIT,
} from './aiProvider';
import { db } from './db';
import { extractTextFromPdfViaOcr } from './pdfOcr';
import { extractText as ocrImage } from './ocr';
import { isPdfFile } from './pdfExtractor';
import { getDocumentById, sanitizeDocumentForAI, setDocumentOcrText } from './documents';
import { getMedicalRecordByPersonId } from './medicalRecord';
import { getAiMedicalAllowed } from './settings';
import { insertObservation, deleteObservationsBySourceDocument } from './medicalObservations';
import { insertChunks, deleteChunksBySource, chunkText, buildObservationChunk } from './medicalFts';

// ── Validators ───────────────────────────────────────────────────────────────

const VALUE_WHITELIST = new Set([
  'POZITIV',
  'NEGATIV',
  'PREZENT',
  'ABSENT',
  'NORMAL',
  'CRESCUT',
  'SCAZUT',
  'SCĂZUT',
]);

const VALID_CATEGORIES: ObservationCategory[] = [
  'hematologie',
  'biochimie',
  'lipide',
  'tiroidiene',
  'hormonal',
  'hepatice',
  'renale',
  'urinare',
  'microbiologie',
  'imunologie',
  'altele',
];

// Acceptă: "55", "5.5", "5,5", "<10", ">100", "-3.2"
const RX_NUMERIC = /^[<>]?\s*-?\d+([.,]\d+)?$/;

export interface RawObservation {
  name?: string;
  value?: string | number | null;
  unit?: string | null;
  ref_min?: string | number | null;
  ref_max?: string | number | null;
  observed_at?: string | null;
  category?: string;
  confidence?: number;
}

export interface ValidatedObservation {
  name: string;
  value: string | null;
  unit: string | null;
  ref_min: string | null;
  ref_max: string | null;
  observed_at: string | null;
  category: ObservationCategory;
  confidence: number;
}

export interface LlmResponse {
  observations: RawObservation[];
}

/**
 * Parsează un răspuns LLM care ar trebui să fie JSON cu structura
 * `{"observations": [...]}`. Tolerant la wrapping în ```json``` fence.
 * Returnează `{observations: []}` la orice eroare (nu aruncă) — pipeline-ul
 * tratează empty drept „no_data".
 */
export function parseLlmResponse(raw: string): LlmResponse {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s) as unknown;
    if (
      obj &&
      typeof obj === 'object' &&
      'observations' in obj &&
      Array.isArray((obj as { observations: unknown }).observations)
    ) {
      return { observations: (obj as LlmResponse).observations };
    }
  } catch {
    /* swallow */
  }
  return { observations: [] };
}

function isWhitelistText(v: string): boolean {
  return VALUE_WHITELIST.has(v.trim().toUpperCase());
}

function coerceValue(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Validează un array de observații crude din LLM și produce observații
 * gata pentru insert. Drop rules:
 *
 * - `name` lipsă sau gol → drop
 * - `confidence < 0.5` → drop
 * - `analize_medicale` fără `value` → drop (cere valoare numerică sau whitelisted)
 * - `analize_medicale` cu value non-numeric non-whitelisted → drop
 * - Categorie necunoscută → coerce la `'altele'`
 * - `observed_at` lipsă → fallback la `issueDate`
 */
export function validateExtraction(
  raw: RawObservation[],
  docType: DocumentType,
  issueDate: string | null
): ValidatedObservation[] {
  const out: ValidatedObservation[] = [];
  for (const r of raw) {
    if (!r.name || String(r.name).trim() === '') continue;
    const conf = typeof r.confidence === 'number' ? r.confidence : 0;
    if (conf < 0.5) continue;

    const value = coerceValue(r.value);
    if (docType === 'analize_medicale') {
      if (value == null) continue;
      if (!RX_NUMERIC.test(value) && !isWhitelistText(value)) continue;
    }

    const cat: ObservationCategory = VALID_CATEGORIES.includes(r.category as ObservationCategory)
      ? (r.category as ObservationCategory)
      : 'altele';

    out.push({
      name: String(r.name).trim(),
      value,
      unit: r.unit ?? null,
      ref_min: r.ref_min != null ? String(r.ref_min) : null,
      ref_max: r.ref_max != null ? String(r.ref_max) : null,
      observed_at: r.observed_at ?? issueDate ?? null,
      category: cat,
      confidence: conf,
    });
  }
  return out;
}

// ── Prompts per tip document ─────────────────────────────────────────────────

const SYSTEM_ANALIZE = `Ești un extractor de date din analize medicale românești.
EXTRAGI doar ce e SCRIS EXPLICIT în text. Nu deduci. Nu calculezi.
Nu interpretezi clinic. Nu inventezi unități sau intervale dacă nu apar.

Pentru fiecare analiză găsită, returnezi un obiect JSON cu:
- name: numele exact (ex: "HDL colesterol", "TSH", "Hemoglobină glicată")
- value: valoarea numerică exactă, ca string
- unit: unitatea, dacă apare ("mg/dL", "mmol/L", "%"...)
- ref_min: limita inferioară a intervalului de referință
- ref_max: limita superioară
- observed_at: data analizei format YYYY-MM-DD (caută "Data prelevării", "Data recoltării")
- category: una din [hematologie, biochimie, lipide, tiroidiene, hormonal, hepatice, renale, urinare, microbiologie, imunologie, altele]
- confidence: 0.0-1.0, cât de sigur ești că ai citit corect

Răspunde DOAR JSON valid: {"observations": [...]}.
Dacă textul nu e o analiză sau nu poți extrage nimic clar, răspunde {"observations": []}.`;

const SYSTEM_RETETA = `Ești un extractor de rețete medicale românești.
EXTRAGI doar ce e SCRIS EXPLICIT. Nu interpretezi clinic.

Pentru fiecare medicament: name (denumire + concentrație, ex „Concor 5mg"),
value (doza/frecvență/durată scurt, ex „1 tb/zi, 30 zile"), unit (null),
observed_at (data rețetei YYYY-MM-DD), category="altele", confidence 0.0-1.0.
Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_VACCIN = `Extractor vaccinuri români.
Pentru fiecare vaccin: name (denumire/tip vaccin), value (lot sau doza dacă apare,
altfel null), observed_at (data vaccinării YYYY-MM-DD), category="altele",
confidence 0.0-1.0. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_SCRISOARE = `Extractor scrisori/concluzii medicale.
Nu interpretezi clinic. Pentru fiecare diagnostic/recomandare scrisă:
name (eticheta scurtă, ex „Diagnostic principal", „Recomandare"),
value (textul exact al diagnosticului/recomandării, max 200 caractere),
observed_at (data documentului), category="altele",
confidence ≤ 0.7. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_BILET = `Extractor bilete de externare.
Pentru fiecare diagnostic, perioadă internare sau recomandare:
name (eticheta), value (text scurt 200 char), observed_at, category="altele",
confidence ≤ 0.7. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_IMAGISTICA = `Extractor concluzii imagistică (RMN/CT/Ecografie).
Pentru fiecare concluzie majoră: name (regiune/organ + tip examen),
value (concluzia textuală scurtă, max 200 char), observed_at (data examenului),
category="altele", confidence ≤ 0.7. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_BY_TYPE: Partial<Record<DocumentType, string>> = {
  analize_medicale: SYSTEM_ANALIZE,
  reteta_medicala: SYSTEM_RETETA,
  vaccin_persoana: SYSTEM_VACCIN,
  scrisoare_medicala: SYSTEM_SCRISOARE,
  bilet_externare: SYSTEM_BILET,
  imagistica: SYSTEM_IMAGISTICA,
};

export function getSystemPromptForType(docType: DocumentType): string | null {
  return SYSTEM_BY_TYPE[docType] ?? null;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

const MAX_OCR_LEN = 8000;
const MAX_TOKENS_RESPONSE = 1500;

export type ExtractionStatus =
  | 'ok'
  | 'no_data'
  | 'failed'
  | 'too_large'
  | 'ai_unavailable'
  | 'unsupported_type'
  | 'no_record'
  | 'no_consent';

export interface ExtractionResult {
  status: ExtractionStatus;
  inserted: number;
  needs_review: number;
  /** Detalii diagnostice pentru afișare in-app (fără acces la Xcode). */
  debug?: {
    ocr_len: number;
    /** Primele ~400 char din OCR-ul trimis la AI — să vedem ce a văzut. */
    ocr_sample?: string;
    llm_raw_obs?: number;
    llm_response_sample?: string;
  };
}

async function ocrFromDocument(doc: Document): Promise<string> {
  if (doc.ocr_text && doc.ocr_text.trim().length > 0) return doc.ocr_text;
  const path = doc.file_path;
  if (!path) return '';

  // 1. Încearcă OCR on-device (rapid, gratis, fără AI).
  let text = '';
  try {
    if (isPdfFile(path)) {
      text = await extractTextFromPdfViaOcr(path);
    } else {
      const result = await ocrImage(path);
      text = (result?.text ?? '').toString();
    }
  } catch (e) {
    console.warn('[medicalExtractor] OCR on-device a eșuat:', e);
  }

  // 2. Dacă on-device OCR n-a returnat nimic util, fallback la AI vision.
  // Scenariul tipic: PDF scan slab calibrat, imagine zgomotoasă, scris de mână.
  // AI vision e mai bun pentru aceste cazuri (consumă 1 apel AI/doc dar e
  // o singură dată — textul se persistă pentru rulări viitoare).
  if (text.trim().length === 0) {
    try {
      const { extractFieldsWithLlm } = await import('./ocrLlmExtractor');
      const { renderPdfFirstPageForVision } = await import('./pdfOcr');
      const { toFileUri } = await import('./fileUtils');
      const FileSystem = await import('expo-file-system/legacy');

      let imageBase64: string | undefined;
      if (isPdfFile(path)) {
        imageBase64 = (await renderPdfFirstPageForVision(toFileUri(path))) ?? undefined;
      } else {
        imageBase64 = await FileSystem.readAsStringAsync(toFileUri(path), {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      if (imageBase64) {
        const extracted = await extractFieldsWithLlm(doc.type, '', imageBase64);
        if (extracted.ocr_text && extracted.ocr_text.trim().length > 0) {
          text = extracted.ocr_text.trim();
          console.warn(
            `[medicalExtractor] doc ${doc.id} — fallback AI vision a produs ${text.length} char OCR`
          );
        }
      }
    } catch (e) {
      console.warn('[medicalExtractor] fallback AI vision a eșuat:', e);
    }
  }

  // 3. Persistă textul OCR — pentru rulări viitoare evităm fallback-ul AI și
  // utilizatorul poate vedea/edita „Text complet (OCR)" în detaliul docului.
  if (text.trim().length > 0) {
    try {
      await setDocumentOcrText(doc.id, text);
    } catch (e) {
      console.warn('[medicalExtractor] persist OCR failed:', e);
    }
  }
  return text;
}

/**
 * Rulează pipeline-ul complet pentru un document. Idempotent: ștergerea
 * observațiilor și chunks-urilor vechi se face înainte de re-insert.
 *
 * Pre-condiții pentru status='ok':
 * - Document există și are `person_id`.
 * - Există `medical_record` pentru `person_id`.
 * - `medical_record.ai_consent_at != null`.
 * - Tipul documentului are prompt mapat.
 * - OCR-ul a returnat text.
 */
/**
 * Rulează pipeline-ul de extracție pentru un document.
 *
 * @param documentId — id-ul documentului de procesat.
 * @param hintRecordId — dacă e dat, încearcă mai întâi acel dosar (folosit de
 *   batch din ecranul detail când documentul nu are person_id setat dar e
 *   legat de dosar prin entity_links).
 */
export async function extractFromDocument(
  documentId: string,
  hintRecordId?: string
): Promise<ExtractionResult> {
  const doc = await getDocumentById(documentId);
  const empty: ExtractionResult = { status: 'no_data', inserted: 0, needs_review: 0 };
  if (!doc) return empty;

  // Strategie rezolvare medical_record:
  //   1. Hint (din batch caller) — sigur că dosarul există.
  //   2. doc.person_id (legacy column).
  //   3. entity_links → medical_record direct.
  //   4. entity_links → person → medical_record.
  let rec = null;
  if (hintRecordId) {
    rec = await db.getFirstAsync<{
      id: string;
      person_id: string;
      ai_consent_at: string | null;
    }>('SELECT id, person_id, ai_consent_at FROM medical_record WHERE id = ?', [hintRecordId]);
  }
  if (!rec && doc.person_id) {
    rec = await getMedicalRecordByPersonId(doc.person_id);
  }
  if (!rec) {
    // entity_links direct la medical_record
    const linkedMr = await db.getFirstAsync<{
      entity_id: string;
    }>(
      `SELECT entity_id FROM document_entities
       WHERE document_id = ? AND entity_type = 'medical_record' LIMIT 1`,
      [documentId]
    );
    if (linkedMr) {
      rec = await db.getFirstAsync<{
        id: string;
        person_id: string;
        ai_consent_at: string | null;
      }>('SELECT id, person_id, ai_consent_at FROM medical_record WHERE id = ?', [
        linkedMr.entity_id,
      ]);
    }
  }
  if (!rec) {
    // entity_links la person → caut dosarul de pe persoană
    const linkedPerson = await db.getFirstAsync<{ entity_id: string }>(
      `SELECT entity_id FROM document_entities
       WHERE document_id = ? AND entity_type = 'person' LIMIT 1`,
      [documentId]
    );
    if (linkedPerson) {
      rec = await getMedicalRecordByPersonId(linkedPerson.entity_id);
    }
  }
  if (!rec) return { status: 'no_record', inserted: 0, needs_review: 0 };
  if (!rec.ai_consent_at) return { status: 'no_consent', inserted: 0, needs_review: 0 };

  // Override global: dacă userul a dezactivat AI medical din Setări, sărim
  // extracția chiar dacă dosarul are consent acordat.
  const globallyAllowed = await getAiMedicalAllowed();
  if (!globallyAllowed) return { status: 'no_consent', inserted: 0, needs_review: 0 };

  const system = getSystemPromptForType(doc.type);
  if (!system) return { status: 'unsupported_type', inserted: 0, needs_review: 0 };

  const text = (await ocrFromDocument(doc)).trim();
  if (!text) {
    console.warn(`[medicalExtractor] doc ${doc.id} (${doc.type}) — OCR text gol, skip`);
    return {
      status: 'no_data',
      inserted: 0,
      needs_review: 0,
      debug: { ocr_len: 0 },
    };
  }
  console.warn(
    `[medicalExtractor] doc ${doc.id} (${doc.type}) — OCR ${text.length} char, calling AI...`
  );

  // sanitizeDocumentForAI elimină private_notes — folosim doar câmpurile sigure.
  const safe = sanitizeDocumentForAI(doc);
  const truncated = text.slice(0, MAX_OCR_LEN);
  const userMsg = [
    `Tip document: ${safe.type}`,
    `Data documentului: ${safe.issue_date ?? 'necunoscută'}`,
    'Text OCR:',
    '---',
    truncated,
    '---',
  ].join('\n');

  let response: string;
  try {
    response = await sendAiRequest(
      [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      MAX_TOKENS_RESPONSE,
      'extraction'
    );
  } catch (e) {
    if (e instanceof AiContextOverflowError) {
      try {
        response = await sendAiRequest(
          [
            { role: 'system', content: system },
            { role: 'user', content: userMsg.slice(0, 4000) },
          ],
          MAX_TOKENS_RESPONSE,
          'extraction'
        );
      } catch {
        return { status: 'too_large', inserted: 0, needs_review: 0 };
      }
    } else {
      console.warn('[medicalExtractor] AI call failed:', e);
      return {
        status: 'failed',
        inserted: 0,
        needs_review: 0,
        debug: {
          ocr_len: text.length,
          llm_response_sample: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  const parsed = parseLlmResponse(response);
  const valid = validateExtraction(parsed.observations, doc.type, doc.issue_date ?? null);
  console.warn(
    `[medicalExtractor] doc ${doc.id} — LLM raw=${parsed.observations.length} valid=${valid.length}`
  );
  if (parsed.observations.length > 0 && valid.length === 0) {
    console.warn(
      `[medicalExtractor] doc ${doc.id} — LLM a returnat ${parsed.observations.length} obs dar toate au fost respinse de validare. Sample raw:`,
      JSON.stringify(parsed.observations[0])
    );
  }
  if (parsed.observations.length === 0) {
    console.warn(`[medicalExtractor] doc ${doc.id} — LLM raw response:`, response.slice(0, 400));
  }

  // Idempotent: șterge orice extracție anterioară pentru acest document.
  // FTS5 e virtual table (fără CASCADE), deci ștergem manual chunks-urile
  // observațiilor înainte să ștergem observațiile, ca să evităm chunks orfane.
  const oldObsIds = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM medical_observations WHERE source_document_id = ?',
    [documentId]
  );
  for (const o of oldObsIds) {
    await deleteChunksBySource('observation', o.id);
  }
  await deleteObservationsBySourceDocument(documentId);
  await deleteChunksBySource('document', documentId);

  let inserted = 0;
  let needsReview = 0;
  for (const v of valid) {
    const obs = await insertObservation({
      medical_record_id: rec.id,
      source_document_id: documentId,
      name: v.name,
      value: v.value,
      unit: v.unit,
      ref_min: v.ref_min,
      ref_max: v.ref_max,
      observed_at: v.observed_at,
      category: v.category,
      confidence: v.confidence,
    });
    inserted++;
    if (obs.needs_review) needsReview++;
    await deleteChunksBySource('observation', obs.id);
    await insertChunks([
      {
        medical_record_id: rec.id,
        source_type: 'observation',
        source_id: obs.id,
        observed_at: obs.observed_at,
        chunk_text: buildObservationChunk({
          name: v.name,
          value: v.value,
          unit: v.unit,
          ref_min: v.ref_min,
          ref_max: v.ref_max,
          category: v.category,
          observed_at: v.observed_at,
        }),
      },
    ]);
  }

  // Rezumat AI distilat (doc.note) — chunk concentrat, util când OCR-ul
  // brut e fragmentat sau lipsește. Public (nu e private_notes), deja merge
  // la AI prin chatbot global. Prefixat ca să-l distingă în context.
  if (safe.note && safe.note.trim().length > 0) {
    await insertChunks([
      {
        medical_record_id: rec.id,
        source_type: 'document' as const,
        source_id: documentId,
        observed_at: doc.issue_date ?? null,
        chunk_text: `Rezumat document: ${safe.note.trim()}`,
      },
    ]);
  }

  // Document chunks (text OCR brut, fără private_notes — safe e sanitizat).
  const docChunks = chunkText(truncated);
  await insertChunks(
    docChunks.map(t => ({
      medical_record_id: rec.id,
      source_type: 'document' as const,
      source_id: documentId,
      observed_at: doc.issue_date ?? null,
      chunk_text: t,
    }))
  );

  return {
    status: valid.length === 0 ? 'no_data' : 'ok',
    inserted,
    needs_review: needsReview,
    debug: {
      ocr_len: text.length,
      ocr_sample: text.slice(0, 400),
      llm_raw_obs: parsed.observations.length,
      llm_response_sample: response.slice(0, 300),
    },
  };
}

/**
 * Fire-and-forget. Folosit din `addDocument` post-insert: extracția nu trebuie
 * să blocheze UX-ul de salvare. Erorile sunt logate, nu propagate.
 */
export function extractAsync(documentId: string): void {
  setTimeout(() => {
    extractFromDocument(documentId).catch(e => {
      console.warn('[medicalExtractor] background extraction failed:', e);
    });
  }, 0);
}

// ── Batch re-extracție ───────────────────────────────────────────────────────

export interface BatchEstimate {
  total_documents: number;
  estimated_calls: number;
  /** null = provider extern, fără limită zilnică. */
  remaining_today: number | null;
  /** True dacă provider builtin și nu sunt suficiente apeluri rămase. */
  blocked_by_limit: boolean;
}

export interface BatchDocReport {
  documentId: string;
  status: ExtractionStatus;
  inserted: number;
  ocr_len?: number;
  ocr_sample?: string;
  llm_raw_obs?: number;
  llm_response_sample?: string;
}

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
  /** Total observații nou inserate în toate documentele procesate. */
  inserted: number;
  /** Documente care n-au produs nicio observație (status no_data / unsupported). */
  noData: number;
  /** Documente fără text OCR (nu s-a putut apela LLM). */
  noOcr: number;
  /** Documente blocate de consent / dosar lipsă / override global OFF. */
  noConsent: number;
  /** Mesaj detaliat pentru UI — ce s-a întâmplat la fiecare document. */
  log: string[];
  /** Raport per document — folosit pentru modal diagnostic in-app. */
  reports: BatchDocReport[];
}

const MEDICAL_DOC_TYPES_SQL = `(
  'analize_medicale','reteta_medicala','scrisoare_medicala',
  'bilet_externare','imagistica','vaccin_persoana'
)`;

async function getRemainingBuiltinCalls(): Promise<number | null> {
  try {
    const cfg = await getAiConfig();
    if (cfg.type !== 'builtin') return null;
    const used = await getAiUsageToday();
    return Math.max(0, DAILY_AI_LIMIT - used);
  } catch {
    return null;
  }
}

/**
 * Returnează ID-urile documentelor medicale care „aparțin" unui dosar:
 *   - legate explicit de medical_record prin entity_links, SAU
 *   - legate de persoana dosarului prin entity_links, SAU
 *   - cu coloana legacy person_id setată la persoana dosarului.
 *
 * Folosit de estimateBatch + batchReExtract — acoperă scenariile când
 * documentul a fost asociat manual fără a fi setat person_id.
 */
async function getMedicalDocIds(recordId: string): Promise<string[]> {
  const rec = await db.getFirstAsync<{ person_id: string }>(
    'SELECT person_id FROM medical_record WHERE id = ?',
    [recordId]
  );
  if (!rec) throw new Error('Dosarul medical nu există.');
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT DISTINCT d.id
     FROM documents d
     LEFT JOIN document_entities de ON de.document_id = d.id
     WHERE d.type IN ${MEDICAL_DOC_TYPES_SQL}
       AND (
         (de.entity_type = 'medical_record' AND de.entity_id = ?)
         OR (de.entity_type = 'person' AND de.entity_id = ?)
         OR d.person_id = ?
       )
     ORDER BY d.created_at ASC`,
    [recordId, rec.person_id, rec.person_id]
  );
  return rows.map(r => r.id);
}

export async function estimateBatch(recordId: string): Promise<BatchEstimate> {
  const ids = await getMedicalDocIds(recordId);
  const remaining = await getRemainingBuiltinCalls();
  const total = ids.length;

  // Numără câte docs n-au OCR — vor consuma 1 apel extra (AI vision fallback).
  let docsWithoutOcr = 0;
  if (total > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents
       WHERE id IN (${placeholders})
         AND (ocr_text IS NULL OR LENGTH(TRIM(ocr_text)) = 0)`,
      ids
    );
    docsWithoutOcr = row?.n ?? 0;
  }

  // 1 apel/doc pentru extracție medicală + 1 apel suplimentar pentru fiecare
  // doc fără OCR (fallback vision care produce textul OCR).
  const estimated = total + docsWithoutOcr;

  return {
    total_documents: total,
    estimated_calls: estimated,
    remaining_today: remaining,
    blocked_by_limit: remaining != null && estimated > remaining,
  };
}

/**
 * Rulează extracția pentru toate documentele medicale ale dosarului în
 * serie (nu paralel — evităm rate-limit pe Mistral builtin).
 *
 * `shouldCancel` se citește înainte de fiecare document. `onProgress` e apelat
 * după fiecare document procesat (succes sau fail).
 *
 * NU verifică limita zilnică în interior — caller-ul trebuie să cheme
 * `estimateBatch` și să blocheze pornirea dacă `blocked_by_limit = true`.
 */
export async function batchReExtract(
  recordId: string,
  onProgress?: (p: BatchProgress) => void,
  shouldCancel?: () => boolean
): Promise<BatchProgress> {
  const ids = await getMedicalDocIds(recordId);
  const progress: BatchProgress = {
    total: ids.length,
    done: 0,
    failed: 0,
    cancelled: false,
    inserted: 0,
    noData: 0,
    noOcr: 0,
    noConsent: 0,
    log: [],
    reports: [],
  };
  for (const id of ids) {
    if (shouldCancel?.()) {
      progress.cancelled = true;
      break;
    }
    try {
      const r = await extractFromDocument(id, recordId);
      progress.inserted += r.inserted;
      if (r.status === 'failed' || r.status === 'too_large') progress.failed++;
      else if (r.status === 'no_data') progress.noData++;
      else if (r.status === 'no_consent') progress.noConsent++;
      else if (r.status === 'no_record') progress.noConsent++;
      else if (r.status === 'unsupported_type') progress.noData++;
      progress.log.push(`${id.slice(0, 8)}: ${r.status} (+${r.inserted} obs)`);
      progress.reports.push({
        documentId: id,
        status: r.status,
        inserted: r.inserted,
        ocr_len: r.debug?.ocr_len,
        ocr_sample: r.debug?.ocr_sample,
        llm_raw_obs: r.debug?.llm_raw_obs,
        llm_response_sample: r.debug?.llm_response_sample,
      });
      console.warn(`[medicalExtractor.batch] ${id} → ${r.status}, +${r.inserted} obs`);
    } catch (e) {
      console.warn('[medicalExtractor] batch item failed:', e);
      progress.failed++;
      progress.reports.push({
        documentId: id,
        status: 'failed',
        inserted: 0,
        llm_response_sample: e instanceof Error ? e.message : String(e),
      });
    }
    progress.done++;
    onProgress?.(progress);
  }
  return progress;
}
