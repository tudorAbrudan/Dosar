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
import { sendAiRequest, AiContextOverflowError } from './aiProvider';
import { db } from './db';
import { extractTextFromPdfViaOcr } from './pdfOcr';
import { extractText as ocrImage } from './ocr';
import { isPdfFile } from './pdfExtractor';
import {
  getDocumentById,
  sanitizeDocumentForAI,
  setDocumentOcrText,
  setDocumentAiSummary,
  setPendingReminders,
} from './documents';
import { getAiMedicalAllowed } from './settings';
import { insertObservation, deleteObservationsBySourceDocument } from './medicalObservations';
import { insertChunks, deleteChunksByDocument, chunkText } from './medicalFts';
import { generateAiSummary } from './medicalAiSummary';

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

const SYSTEM_FISA_CONSULTATIE = `Extractor fișe de consultație medicală (ambulator/cabinet).
Pentru fiecare diagnostic, recomandare sau plan terapeutic scris explicit:
name (eticheta, ex „Diagnostic", „Recomandare", „Plan tratament"),
value (textul exact, max 200 caractere), observed_at (data consultației),
category="altele", confidence ≤ 0.7. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_BILET_TRIMITERE = `Extractor bilete de trimitere CNAS.
Pentru fiecare diagnostic, specialitate recomandată sau tip de investigație:
name (eticheta, ex „Diagnostic", „Cod ICD-10", „Specialitate trimis", „Investigație"),
value (textul exact, max 200 caractere — pentru ICD-10 doar codul, ex „I10"),
observed_at (data emiterii biletului), category="altele",
confidence ≤ 0.7. Răspunde DOAR JSON: {"observations": [...]}.`;

const SYSTEM_BY_TYPE: Partial<Record<DocumentType, string>> = {
  analize_medicale: SYSTEM_ANALIZE,
  reteta_medicala: SYSTEM_RETETA,
  vaccin_persoana: SYSTEM_VACCIN,
  scrisoare_medicala: SYSTEM_SCRISOARE,
  bilet_externare: SYSTEM_BILET,
  imagistica: SYSTEM_IMAGISTICA,
  fisa_consultatie: SYSTEM_FISA_CONSULTATIE,
  bilet_trimitere: SYSTEM_BILET_TRIMITERE,
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
 * - Document există și e atașat la un medical_record prin entity_links.
 * - `medical_record.ai_consent_at != null`.
 * - Tipul documentului are prompt mapat.
 * - OCR-ul a returnat text.
 */
/**
 * Rulează pipeline-ul de extracție pentru un document.
 *
 * @param documentId — id-ul documentului de procesat.
 * @param hintRecordId — dacă e dat, încearcă mai întâi acel dosar (folosit de
 *   batch din ecranul detail când documentul nu e încă atașat prin
 *   entity_links).
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
  //   2. entity_links → medical_record direct.
  let rec: {
    id: string;
    ai_consent_at: string | null;
  } | null = null;
  if (hintRecordId) {
    rec = await db.getFirstAsync<{
      id: string;
      ai_consent_at: string | null;
    }>('SELECT id, ai_consent_at FROM medical_record WHERE id = ?', [hintRecordId]);
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
        ai_consent_at: string | null;
      }>('SELECT id, ai_consent_at FROM medical_record WHERE id = ?', [linkedMr.entity_id]);
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
  // Observațiile NU sunt indexate în FTS (spec §6.5) — doar chunks-urile de
  // document trebuie curățate. FTS5 e virtual table (fără CASCADE) deci
  // ștergem manual.
  await deleteObservationsBySourceDocument(documentId);
  await deleteChunksByDocument(documentId);

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
    // Observațiile NU se indexează în FTS — sunt căutate direct pe
    // medical_observations cu decriptare (spec §6.5).
  }

  // Rezumat AI distilat (doc.note) — chunk concentrat, util când OCR-ul
  // brut e fragmentat sau lipsește. Public (nu e private_notes), deja merge
  // la AI prin chatbot global. Prefixat ca să-l distingă în context.
  if (safe.note && safe.note.trim().length > 0) {
    await insertChunks([
      {
        document_id: documentId,
        medical_record_id: rec.id,
        chunk_type: 'summary' as const,
        chunk_text: `Rezumat document: ${safe.note.trim()}`,
      },
    ]);
  }

  // Document chunks (text OCR brut, fără private_notes — safe e sanitizat).
  const docChunks = chunkText(truncated);
  await insertChunks(
    docChunks.map(t => ({
      document_id: documentId,
      medical_record_id: rec.id,
      chunk_type: 'ocr' as const,
      chunk_text: t,
    }))
  );

  // Generare AI summary + actionable_items (spec 2026-05-24).
  // Eșecul NU blochează — observațiile sunt deja inserate. Re-extracția
  // suprascrie automat `ai_summary` (D8). `pending_reminders_json` se setează
  // doar dacă userul nu a primit deja prompt-ul pentru acest document (D10/D13).
  try {
    const freshDoc = await getDocumentById(documentId);
    if (freshDoc) {
      const aiResult = await generateAiSummary(truncated, freshDoc.issue_date ?? null);
      await setDocumentAiSummary(documentId, aiResult.summary_md || null);

      if (!freshDoc.medical_reminders_prompted_at) {
        await setPendingReminders(
          documentId,
          aiResult.actionable_items.length > 0
            ? JSON.stringify(aiResult.actionable_items)
            : null
        );
      }
    }
  } catch (e) {
    // silent-ai-catch-ok: AI summary e un nice-to-have non-blocking — dacă
    // eșuează, observațiile sunt deja inserate (status=ok) și restul UX
    // continuă. Userul vede „Rezumat AI: gol" pe document și poate apăsa
    // „Re-extrage" pentru a re-încerca. Eroarea principală (extracție
    // observații) e deja surface-uită prin status returnat de funcție.
    console.warn('[medicalExtractor] AI summary step failed (non-blocking):', e);
  }

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
  /** Câte documente au deja observații extrase (vor fi sărite dacă `skipAlreadyExtracted`). */
  already_extracted: number;
  /** Câte documente vor fi efectiv procesate după filtrarea opts. */
  to_process: number;
  /** Păstrat pentru compat UI — întotdeauna null (fără limită zilnică). */
  remaining_today: number | null;
  /** Întotdeauna false: nu mai există provider builtin cu limită zilnică. */
  blocked_by_limit: boolean;
}

export interface BatchOptions {
  /**
   * Sare peste documentele care au cel puțin o observație inserată anterior.
   * Default `false` (re-procesează tot) — UI-ul pasează `true` pentru fluxul
   * „extrage doar documente noi" și `false` pentru „re-extrage tot".
   */
  skipAlreadyExtracted?: boolean;
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
  'bilet_externare','imagistica','vaccin_persoana','fisa_consultatie',
  'bilet_trimitere'
)`;

/**
 * Returnează ID-urile documentelor medicale care „aparțin" unui dosar:
 * documentele legate de medical_record prin junction table `document_entities`.
 */
async function getMedicalDocIds(recordId: string): Promise<string[]> {
  const rec = await db.getFirstAsync<{ id: string }>('SELECT id FROM medical_record WHERE id = ?', [
    recordId,
  ]);
  if (!rec) throw new Error('Dosarul medical nu există.');
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT DISTINCT d.id
     FROM documents d
     JOIN document_entities de ON de.document_id = d.id
     WHERE d.type IN ${MEDICAL_DOC_TYPES_SQL}
       AND de.entity_type = 'medical_record'
       AND de.entity_id = ?
     ORDER BY d.created_at ASC`,
    [recordId]
  );
  return rows.map(r => r.id);
}

export async function estimateBatch(
  recordId: string,
  opts: BatchOptions = {}
): Promise<BatchEstimate> {
  const ids = await getMedicalDocIds(recordId);
  const total = ids.length;

  // Câte docs au deja observații inserate.
  let alreadyExtracted = 0;
  let idsToProcess = ids;
  if (total > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const extractedRows = await db.getAllAsync<{ source_document_id: string }>(
      `SELECT DISTINCT source_document_id FROM medical_observations
       WHERE source_document_id IN (${placeholders})`,
      ids
    );
    const extractedSet = new Set(extractedRows.map(r => r.source_document_id));
    alreadyExtracted = extractedSet.size;
    if (opts.skipAlreadyExtracted) {
      idsToProcess = ids.filter(id => !extractedSet.has(id));
    }
  }

  // Numără câte docs (din cele care vor fi efectiv procesate) n-au OCR —
  // vor consuma 1 apel extra (AI vision fallback).
  let docsWithoutOcr = 0;
  if (idsToProcess.length > 0) {
    const placeholders = idsToProcess.map(() => '?').join(',');
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents
       WHERE id IN (${placeholders})
         AND (ocr_text IS NULL OR LENGTH(TRIM(ocr_text)) = 0)`,
      idsToProcess
    );
    docsWithoutOcr = row?.n ?? 0;
  }

  // 1 apel/doc pentru extracție medicală + 1 apel suplimentar pentru fiecare
  // doc fără OCR (fallback vision care produce textul OCR).
  const estimated = idsToProcess.length + docsWithoutOcr;

  return {
    total_documents: total,
    estimated_calls: estimated,
    already_extracted: alreadyExtracted,
    to_process: idsToProcess.length,
    remaining_today: null,
    blocked_by_limit: false,
  };
}

/**
 * Rulează extracția pentru toate documentele medicale ale dosarului în
 * serie (nu paralel — evităm rate-limit pe provideri externi gratuiți).
 *
 * `shouldCancel` se citește înainte de fiecare document. `onProgress` e apelat
 * după fiecare document procesat (succes sau fail).
 */
export async function batchReExtract(
  recordId: string,
  onProgress?: (p: BatchProgress) => void,
  shouldCancel?: () => boolean,
  opts: BatchOptions = {}
): Promise<BatchProgress> {
  let ids = await getMedicalDocIds(recordId);
  if (opts.skipAlreadyExtracted && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const extractedRows = await db.getAllAsync<{ source_document_id: string }>(
      `SELECT DISTINCT source_document_id FROM medical_observations
       WHERE source_document_id IN (${placeholders})`,
      ids
    );
    const extractedSet = new Set(extractedRows.map(r => r.source_document_id));
    ids = ids.filter(id => !extractedSet.has(id));
  }
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
      // silent-ai-catch-ok: în batch processing, fiecare doc eșuat e
      // contorizat în progress.failed și raportat în progress.reports cu
      // mesajul de eroare. UI-ul afișează raportul prin „Vezi detalii
      // ultima extracție" (DocumenteTab). Surfacing-ul vizibil per doc
      // (Alert per item) ar fi disruptiv în batch.
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
