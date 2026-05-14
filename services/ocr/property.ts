import type { ExtractResult } from './types';
import { findDateNear } from './utils';
import { detectInsurer } from './insurers';

// ─── PAD ─────────────────────────────────────────────────────────────────────

export function extractPad(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const policy = text.match(/(?:poli[tț][aă]|contract|nr\.?)\s*[:\s]+([A-Z0-9\-\/]{5,30})/i);
  if (policy) meta['policy_number'] = policy[1].trim();

  const insurer = detectInsurer(text);
  if (insurer) meta['insurer'] = insurer;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|data\s*expir/i);
  const issue = findDateNear(text, /data\s*emit|[îi]ncheiat/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── ACT PROPRIETATE ─────────────────────────────────────────────────────────

export function extractActProprietate(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const addr = text.match(/(?:imobil|situat|adres[aă])[:\s]+([^\n]{10,100})/i);
  if (addr) meta['adresa'] = addr[1].trim();

  const cad = text.match(/(?:nr\.?\s*cadastral|cadastral)[:\s]+(\d{5,12})/i);
  if (cad) meta['nr_cadastral'] = cad[1];

  const issue = findDateNear(text, /[îi]ncheiat|autentificat|data\s*actului/i);

  return { metadata: meta, issue_date: issue };
}

// ─── CADASTRU ────────────────────────────────────────────────────────────────

export function extractCadastru(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const nr = text.match(/(?:nr\.?\s*cadastral|num[aă]r\s*cadastral)[:\s]+(\d{5,12})/i);
  if (nr) meta['nr_cadastral'] = nr[1];

  const cf = text.match(/(?:carte\s*funciar[aă]|CF)[:\s]+(\d{5,12})/i);
  if (cf) meta['nr_carte_funciara'] = cf[1];

  const issue = findDateNear(text, /data\s*eliber[aă]rii|emis/i);
  // Extras CF valabil 30 zile
  let expiry: string | undefined;
  if (issue) {
    const d = new Date(issue);
    d.setDate(d.getDate() + 30);
    expiry = d.toISOString().slice(0, 10);
  }

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── IMPOZIT PROPRIETATE ─────────────────────────────────────────────────────

export function extractImpozitProprietate(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const suma = text.match(
    /(?:total\s*impozit|sum[aă]\s*de\s*plat[aă]|sum[aă]\s*anual[aă]?)[:\s]+(\d+[.,]?\d*)\s*(?:RON|LEI)/i
  );
  if (suma) meta['amount'] = suma[1].replace(',', '.');

  const issue = findDateNear(text, /data\s*emiter|emis/i);

  return { metadata: meta, issue_date: issue };
}
