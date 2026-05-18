import type { ExtractResult } from './types';
import { findDateNear } from './utils';
import { detectInsurer } from './insurers';

// ─── CERTIFICAT ÎNREGISTRARE (Firmă) ─────────────────────────────────────────

export function extractCertificatInregistrare(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // CUI / CIF — pe Certificat de Înregistrare apare ca „Cod Unic de Înregistrare:".
  // Permitem text scurt între „cod unic" și valoare (ex. „de Înregistrare").
  const cui = text.match(
    /(?:CUI|CIF|cod\s*unic(?:\s+[a-zăâîșțA-ZĂÂÎȘȚ]{2,30}){0,3})\s*:?\s*(?:RO\s*)?(\d{6,10})\b/i
  );
  if (cui) meta['cui'] = cui[1];

  // Nr. registru comerț — acceptăm atât „Nr. reg. com." cât și „Nr. de ordine în
  // registrul comerțului". Prefixe valide: J (SRL/SA/SNC), F (PFA/II/IF),
  // C (cooperative), R (regii autonome). Sufix: an de 4 cifre SAU dată completă
  // dd.mm.yyyy. Dacă trigger-ul textual nu match-uiește, fallback pe format.
  const rcTrigger = text.match(
    /(?:nr\.?\s*(?:de\s+)?ordine[^:\n]{0,40}?comer[tț]ului|nr\.?\s*reg\.?\s*com\.?|reg\.?\s*com|registr[uli]{0,3}\s*comer[tț]ului)\s*:?\s*([JFCR]\d{1,2}\/\d{1,6}\/(?:\d{1,2}\.\d{1,2}\.)?\d{2,4})/i
  );
  const rcFormat = rcTrigger
    ? null
    : text.match(/\b([JFCR]\d{1,2}\/\d{1,6}\/(?:\d{1,2}\.\d{1,2}\.)?\d{4})\b/);
  if (rcTrigger) meta['reg_com'] = rcTrigger[1];
  else if (rcFormat) meta['reg_com'] = rcFormat[1];

  // Denumire firmă / PFA — anchor pe start-of-line ca să nu mănânce text precedent;
  // permitem și newline între label și valoare (OCR poate sparge linia).
  const den = text.match(
    /(?:^|\n)\s*(?:denumire|societate|firm[aă])\s*:?\s*\n?\s*([A-ZĂÂÎȘȚ][^\n]{4,119})/i
  );
  if (den) meta['denumire'] = den[1].trim();

  const issue = findDateNear(
    text,
    /data\s*[îi]nregistr[aă]rii|data\s*eliber[aă]rii|emis|din\s+data\s+de/i
  );

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
