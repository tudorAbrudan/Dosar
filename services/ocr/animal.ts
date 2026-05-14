import type { ExtractResult } from './types';
import { findDateNear, firstDate } from './utils';

// ─── VACCIN ANIMAL ───────────────────────────────────────────────────────────

export function extractVaccinAnimal(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const tip = text.match(/(?:vaccin|vaccinare\s*[îi]mpotriva)[:\s]+([^\n]{5,60})/i);
  if (tip) meta['vaccine_type'] = tip[1].trim();

  const vet = text.match(/(?:Dr\.?|medic\s*veterinar)[:\s.]+([A-ZĂÂÎȘȚ][a-zăâîșț\s\-\.]{3,50})/i);
  if (vet) meta['vet_name'] = vet[1].trim();

  const expiry = findDateNear(text, /valabil|revaccinare|urm[aă]toarea/i);
  const issue = findDateNear(text, /data\s*vaccin[aă]r|administrat/i) ?? firstDate(text);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── DEPARAZITARE ────────────────────────────────────────────────────────────

export function extractDeparazitare(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const tip = text.match(/(?:intern[aă]|extern[aă]|ambele)[:\s]*/i);
  if (tip) meta['treatment_type'] = tip[0].trim();
  else if (/intern/i.test(text)) meta['treatment_type'] = 'Internă';
  else if (/extern/i.test(text)) meta['treatment_type'] = 'Externă';

  const prod = text.match(/(?:produs|tratament|antiparazitar)[:\s]+([^\n]{5,60})/i);
  if (prod) meta['product_name'] = prod[1].trim();

  const expiry = findDateNear(text, /urm[aă]toarea|p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(text, /data\s*(?:administr|tratament)/i) ?? firstDate(text);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── VIZITĂ VET ──────────────────────────────────────────────────────────────

export function extractVizitaVet(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const vet = text.match(/(?:Dr\.?|medic\s*veterinar)[:\s.]+([A-ZĂÂÎȘȚ][a-zăâîșț\s\-\.]{3,50})/i);
  if (vet) meta['vet_name'] = vet[1].trim();

  const issue = findDateNear(text, /data\s*consult[aă]rii|data\s*viz/i) ?? firstDate(text);

  return { metadata: meta, issue_date: issue };
}
