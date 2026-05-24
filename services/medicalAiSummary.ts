/**
 * Rezumat AI per document medical + extracție recomandări cu termen.
 *
 * Izolat de pipeline-ul FTS/chat per spec §8 (2026-05-24): generatorul de
 * summary rulează după ce observațiile au fost extrase și NU contribuie la
 * indexul FTS / contextul chatbot-ului. Eșecul lui nu blochează inserarea
 * observațiilor.
 *
 * Anti-halucinație by construcție:
 * - Prompt strict care interzice interpretarea clinică (vezi `SYSTEM_AI_SUMMARY`).
 * - Word guard pe `summary_md` — dacă AI strecoară termeni clinici interpretativi
 *   (vezi `FORBIDDEN_WORDS`), aruncăm rezumatul (mai bine gol decât interpretare).
 * - Validare strictă `actionable_items`: label non-gol max 80 char,
 *   `suggested_date_iso` cu format `YYYY-MM-DD` real.
 */
import { sendAiRequest } from './aiProvider';
import type { ActionableItem } from './documents';

const SYSTEM_AI_SUMMARY = `Generator rezumat document medical pentru cititor non-medic +
extractor recomandări cu termen.

REGULI STRICTE:
- NU interpretezi clinic. NU spui „risc crescut", „grav", „atenție",
  „periculos", „normal e OK", etc.
- Folosește DOAR informație EXPLICITĂ din document.
- Pentru valori out-of-range: formulare neutră „peste limita superioară X"
  sau „sub limita inferioară X". NU explica de ce e relevant.
- Pentru recomandări: copiezi sau aproape-copiezi textul medicului.
  NU rezumi, NU prioritizezi.

Format OUTPUT — JSON strict, fără markdown wrapping, fără text înainte/după:

{
  "summary_md": "<markdown text, vezi formatul de mai jos>",
  "actionable_items": [
    { "label": "<text recomandare>", "suggested_date_iso": "YYYY-MM-DD" | null }
  ]
}

Format summary_md (markdown ușor, max 200 cuvinte):

**Rezumat:** 1-2 fraze descriere obiectivă a tipului documentului.

**Recomandări:** (doar dacă există în document)
- bullet 1 (text aproape verbatim)
- bullet 2

**Valori în afara intervalului:** (doar dacă există)
- LDL: 145 mg/dL — peste limita superioară 130
- TSH: 0.3 mU/L — sub limita inferioară 0.4

Dacă nu sunt recomandări sau valori out-of-range → omiți secțiunile.
Dacă documentul nu are niciun conținut relevant → "summary_md": "".

Reguli actionable_items:
- Include un item DOAR dacă recomandarea are termen explicit ÎN TEXT.
- suggested_date_iso = calculat relativ la observed_at al documentului.
- Fără termen → NU include (rămâne doar în summary_md).
- label = text aproape verbatim, max 80 caractere.
- actionable_items poate fi [].`;

// Fraze care indică interpretare clinică din partea AI-ului.
// Substring matching pe cuvinte simple ar cauza false positives — „risc"
// apare verbatim în documente medicale legitime („factor de risc",
// „evaluare risc"), la fel „urgent" („se prezintă urgent în 24h" — citat
// din doctor). Folosim fraze multi-cuvânt care DOAR un AI interpretiv le-ar
// produce, nu un medic care scrie verbatim.
const FORBIDDEN_PHRASES = [
  'risc crescut',
  'risc moderat',
  'risc scăzut',
  'risc cardiovascular',
  'foarte grav',
  'extrem de',
  'e periculos',
  'pune în pericol',
  'situație gravă',
  'normal pentru',
  'e normal',
  'e bun',
  'e rău',
  'fără probleme',
  'totul e ok',
  'nu e nimic',
];

function containsForbiddenWords(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some(p => lower.includes(p));
}

function isValidIsoDate(s: string | null | undefined): boolean {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !isNaN(d.getTime());
}

interface AiSummaryResult {
  summary_md: string;
  actionable_items: ActionableItem[];
}

const MAX_AI_SUMMARY_OCR_LEN = 8000;
const MAX_AI_SUMMARY_TOKENS = 1000;

export async function generateAiSummary(
  ocrText: string,
  documentDate: string | null
): Promise<AiSummaryResult> {
  try {
    const userMsg = [
      documentDate ? `Data documentului (observed_at): ${documentDate}` : '',
      '',
      'Conținut document (OCR):',
      ocrText.slice(0, MAX_AI_SUMMARY_OCR_LEN),
    ]
      .filter(Boolean)
      .join('\n');

    const response = await sendAiRequest(
      [
        { role: 'system', content: SYSTEM_AI_SUMMARY },
        { role: 'user', content: userMsg },
      ],
      MAX_AI_SUMMARY_TOKENS,
      'extraction'
    );

    let parsed: AiSummaryResult;
    try {
      // Încearcă parse direct.
      parsed = JSON.parse(response) as AiSummaryResult;
    } catch {
      // Fallback: extrage primul bloc {...} (în cazul în care AI a adăugat
      // text wrapper sau ```json fence).
      const fence = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = fence ? fence[1].trim() : null;
      const match = (candidate ?? response).match(/\{[\s\S]*\}/);
      if (!match) return { summary_md: '', actionable_items: [] };
      try {
        parsed = JSON.parse(match[0]) as AiSummaryResult;
      } catch {
        return { summary_md: '', actionable_items: [] };
      }
    }

    // Word guard pe summary_md — dacă AI a strecurat termeni clinici
    // interpretativi, aruncăm rezumatul (mai bine gol decât interpretare).
    let summary_md = typeof parsed.summary_md === 'string' ? parsed.summary_md : '';
    if (summary_md && containsForbiddenWords(summary_md)) {
      console.warn('[medicalAiSummary] ai_summary contains forbidden clinical words, dropping');
      summary_md = '';
    }

    // Validare actionable_items.
    const rawItems: unknown[] = Array.isArray(parsed.actionable_items)
      ? parsed.actionable_items
      : [];
    const cleanedItems: ActionableItem[] = [];
    for (const raw of rawItems) {
      if (typeof raw !== 'object' || raw === null) continue;
      const obj = raw as { label?: unknown; suggested_date_iso?: unknown };
      if (typeof obj.label !== 'string') continue;
      const label = obj.label.trim();
      if (label.length === 0) continue;
      const iso =
        typeof obj.suggested_date_iso === 'string' || obj.suggested_date_iso === null
          ? (obj.suggested_date_iso ?? null)
          : null;
      cleanedItems.push({
        label: label.slice(0, 80),
        suggested_date_iso: isValidIsoDate(iso) ? iso : null,
      });
    }

    return {
      summary_md,
      actionable_items: cleanedItems,
    };
  } catch (e) {
    console.warn('[medicalAiSummary] generateAiSummary failed:', e);
    return { summary_md: '', actionable_items: [] };
  }
}
