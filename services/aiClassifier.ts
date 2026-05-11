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
  const top3: ClassifyCandidate[] = [];
  for (const item of top3Raw) {
    if (top3.length >= 3) break;
    if (!item || typeof item !== 'object') continue;
    const t = (item as Record<string, unknown>).type;
    const c = (item as Record<string, unknown>).confidence;
    if (!isValidType(t)) continue;
    top3.push({ type: t as DocumentType, confidence: clamp01(c) });
  }

  return {
    type,
    confidence,
    top3,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
  };
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
- Dacă nu ești deloc sigur, folosește "altul" cu confidence mic`;
}

/**
 * Clasifică un document înainte de extragerea câmpurilor.
 * Folosește vision când imageBase64 e furnizat, altfel text-only.
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
