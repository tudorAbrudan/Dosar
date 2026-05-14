import type { ExtractResult } from './types';
import { findDateNear } from './utils';
import { detectInsurer } from './insurers';

// ─── CERTIFICAT ÎNREGISTRARE (Firmă) ─────────────────────────────────────────

export function extractCertificatInregistrare(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const cui = text.match(/(?:CUI|CIF|cod\s*unic)[:\s]+(?:RO\s*)?(\d{6,10})/i);
  if (cui) meta['cui'] = cui[1];

  const rc = text.match(
    /(?:nr\.?\s*reg\.?\s*com\.?|reg\.?\s*com)[:\s]+([J]\d{1,2}\/\d{4}\/\d{4})/i
  );
  if (rc) meta['reg_com'] = rc[1];

  const den = text.match(/(?:denumire|societate|firm[aă])[:\s]+([^\n]{5,80})/i);
  if (den) meta['denumire'] = den[1].trim();

  const issue = findDateNear(text, /data\s*[îi]nregistr[aă]rii|emis/i);

  return { metadata: meta, issue_date: issue };
}

// ─── AUTORIZAȚIE ACTIVITATE ───────────────────────────────────────────────────

export function extractAutorizatieActivitate(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const tipMatch =
    text.match(/(?:tip\s*autorizatie|tip\s*autoriza[tț]ie|autorizatie\s+de)[:\s]+([^\n]{5,60})/i) ??
    text.match(/\b(sanitar[aă]|ISU|mediu|construire|func[tț]ionare)\b/i);
  if (tipMatch) meta['tip_autorizatie'] = tipMatch[1].trim();

  const nrMatch = text.match(
    /(?:nr\.?\s*autorizatie|nr\.?\s*autoriza[tț]ie|autoriza[tț]ie\s*nr\.?)[:\s]+([A-Z0-9\/\-]{3,25})/i
  );
  if (nrMatch) meta['numar_autorizatie'] = nrMatch[1].trim();

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expir[aă]/i);
  const issue = findDateNear(text, /data\s*eliber[aă]rii|emis[aă]?/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── ACT CONSTITUTIV ─────────────────────────────────────────────────────────

export function extractActConstitutiv(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const denMatch = text.match(/(?:denumire|societate|firm[aă])[:\s]+([^\n]{5,80})/i);
  if (denMatch) meta['denumire'] = denMatch[1].trim();

  const formMatch = text.match(
    /\b(S\.?R\.?L\.?|S\.?A\.?|P\.?F\.?A\.?|I\.?I\.?|I\.?F\.?|R\.?A\.?)\b/i
  );
  if (formMatch) meta['legal_form'] = formMatch[1].replace(/\./g, '').toUpperCase();

  const issue = findDateNear(text, /[îi]ncheiat|autentificat|data\s*actului/i);

  return { metadata: meta, issue_date: issue };
}

// ─── CERTIFICAT TVA ──────────────────────────────────────────────────────────

export function extractCertificatTva(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const codMatch = text.match(/(?:cod\s*TVA|CIF)[:\s]+(RO\s*\d{6,10}|\d{6,10})/i);
  if (codMatch) meta['cod_tva'] = codMatch[1].replace(/\s/g, '');

  const denMatch = text.match(/(?:denumire|societate|contribuabil)[:\s]+([^\n]{5,80})/i);
  if (denMatch) meta['denumire'] = denMatch[1].trim();

  const issue = findDateNear(text, /data\s*[îi]nregistr[aă]rii|emis/i);

  return { metadata: meta, issue_date: issue };
}

// ─── ASIGURARE PROFESIONALĂ ───────────────────────────────────────────────────

export function extractAsigurareProf(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const policy = text.match(/(?:poli[tț][aă]|contract|nr\.?)\s*[:\s]+([A-Z0-9\-\/]{5,30})/i);
  if (policy) meta['policy_number'] = policy[1].trim();

  const insurer = detectInsurer(text);
  if (insurer) meta['insurer'] = insurer;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|data\s*expir/i);
  const issue = findDateNear(text, /data\s*emit|[îi]ncheiat/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}
