import { extractPlateNumber } from '../ocr';
import type { ExtractResult } from './types';
import { findDateNear } from './utils';

// ─── STINGĂTOR INCENDIU ──────────────────────────────────────────────────────

export function extractStingator(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const serie = text.match(/(?:serie|nr\.?\s*serie|s\/n)[:\s]+([A-Z0-9\-]{4,20})/i);
  if (serie) meta['serie'] = serie[1].trim();

  const expiry = findDateNear(text, /urm[aă]toarea\s*verificare|valabil[ăa]?\s*p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(text, /data\s*verific[aă]rii|verificat\s*la/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── GENERIC FALLBACK ────────────────────────────────────────────────────────

export function extractGeneric(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiră/i);
  const issue = findDateNear(text, /eliberat|emis|data\s*emit/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}
