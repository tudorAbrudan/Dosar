import { sendAiRequest, sendAiRequestWithImage } from './aiProvider';
import { buildClassifierCatalog } from './aiTypeRegistry';
import type { DocumentType } from '@/types';
import { STANDARD_DOC_TYPES } from '@/types';

const MAX_OCR_CHARS = 2500;

export interface ClassifyCandidate {
  type: DocumentType;
  confidence: number;
}

export interface ClassifyResult {
  type: DocumentType;
  confidence: number;
  top3: ClassifyCandidate[];
  reasoning?: string;
}

const VALID_TYPES = new Set<DocumentType>(STANDARD_DOC_TYPES);

function clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function isValidType(v: unknown): v is DocumentType {
  return typeof v === 'string' && VALID_TYPES.has(v as DocumentType);
}

const MAX_REASONING_CHARS = 300;

/**
 * Parsează răspunsul AI brut într-un ClassifyResult.
 *
 * Niciodată nu aruncă; pe orice problemă de parsare returnează
 * `{ type: 'altul', confidence: 0, top3: [] }`.
 *
 * Robustețe:
 * - acceptă JSON în mijlocul textului (prose-wrapped)
 * - filtrează tipuri invalide din `top3` (necunoscute pentru app)
 * - dedup top3 după tip
 * - sortează top3 descrescător după confidence
 * - dacă top3 e gol dar avem un `type` valid, îl auto-populează ca primary
 * - tronchează `reasoning` la MAX_REASONING_CHARS ca să nu sufoce UI-ul
 */
export function parseClassifyResponse(raw: string): ClassifyResult {
  const fallback: ClassifyResult = { type: 'altul', confidence: 0, top3: [] };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;

  const obj = parsed as Record<string, unknown>;
  const type = isValidType(obj.type) ? (obj.type as DocumentType) : 'altul';
  const confidence = clamp01(obj.confidence);

  const top3Raw = Array.isArray(obj.top3) ? obj.top3 : [];
  const seen = new Set<DocumentType>();
  const top3: ClassifyCandidate[] = [];
  for (const item of top3Raw) {
    if (!item || typeof item !== 'object') continue;
    const t = (item as Record<string, unknown>).type;
    const c = (item as Record<string, unknown>).confidence;
    if (!isValidType(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    top3.push({ type: t, confidence: clamp01(c) });
  }
  top3.sort((a, b) => b.confidence - a.confidence);
  if (top3.length === 0 && type !== 'altul') {
    top3.push({ type, confidence });
    seen.add(type);
  }
  const trimmedTop3 = top3.slice(0, 3);

  const reasoningRaw = typeof obj.reasoning === 'string' ? obj.reasoning : undefined;
  const reasoning = reasoningRaw ? reasoningRaw.slice(0, MAX_REASONING_CHARS) : undefined;

  return { type, confidence, top3: trimmedTop3, reasoning };
}

function buildPrompt(ocrText: string, candidates: DocumentType[]): string {
  const catalog = buildClassifierCatalog(candidates);
  const text = ocrText.trim().slice(0, MAX_OCR_CHARS);
  const textSection = text ? `\nText OCR (referință secundară):\n---\n${text}\n---\n` : '';

  return `Identifică tipul acestui document românesc dintr-o listă de tipuri candidate.

Tipuri candidate (folosește EXACT id-ul, în ghilimele):
${catalog}
${textSection}
Returnează DOAR JSON valid, fără text suplimentar:
{
  "type": "<id_tip>",
  "confidence": 0.0–1.0,
  "top3": [
    { "type": "<id_tip>", "confidence": 0.0–1.0 }
  ],
  "reasoning": "1–2 propoziții cu motivul"
}

Reguli:
- "type" trebuie să fie EXACT unul din id-urile listate mai sus (ex. "pad", "rca", "asigurare_personala")
- confidence reflectă cât de sigur ești că documentul e de acel tip
- top3 conține cei mai probabili 3 candidați în ordine descrescătoare a confidence-ului
- Dacă nu ești deloc sigur, folosește "altul" cu confidence mic
- PRIORITATE TITLU vs MENȚIUNI ADMINISTRATIVE: titlul documentului (apare ca antet central, ex „SCRISOARE MEDICALĂ", „CONTRACT", „BILET DE EXTERNARE", „FACTURĂ", „FIȘĂ DE CONSULTAȚIE") are PRIORITATE absolută față de keyword-uri răzlețe din antet care sunt doar referințe administrative (ex „Contract / convenție Nr X" lângă „CAS"/„CNAS" e un număr de contract servicii medicale, NU înseamnă că documentul e tip „contract"). Dacă apar amândouă, alege tipul indicat de titlul central + conținutul documentului (părți/clauze pentru contract real vs diagnostic/recomandări pentru scrisoare medicală).`;
}

/**
 * Clasifică un document înainte de extragerea câmpurilor.
 * Folosește vision când `imageBase64` e furnizat, altfel text-only.
 *
 * @throws Eroare de transport (rețea/AI provider) — apelantul afișează
 * fallback UI (ex. Alert + tip default) și continuă fluxul.
 */
export async function classifyDocument(
  ocrText: string,
  imageBase64?: string,
  candidateTypes?: DocumentType[]
): Promise<ClassifyResult> {
  const candidates = (candidateTypes ?? STANDARD_DOC_TYPES).filter(
    t => t !== 'altul' && t !== 'custom'
  );
  if (candidates.length === 0) {
    return { type: 'altul', confidence: 0, top3: [] };
  }

  const systemPrompt =
    'Ești un expert în clasificarea documentelor românești. Returnezi EXCLUSIV JSON valid cu tipul și confidence-ul.';
  const userPrompt = buildPrompt(ocrText, candidates);

  let response: string;
  if (imageBase64) {
    response = await sendAiRequestWithImage(
      systemPrompt,
      userPrompt,
      imageBase64,
      'image/jpeg',
      500
    );
  } else {
    response = await sendAiRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      400,
      'extraction'
    );
  }

  return parseClassifyResponse(response);
}
