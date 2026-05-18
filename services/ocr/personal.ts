import { extractDobFromCnp } from '../ocr';
import type { ExtractResult } from './types';
import { findDateNear } from './utils';

// ─── BULETIN ─────────────────────────────────────────────────────────────────

export function extractBuletin(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const cnp = text.match(/\b([1-8]\d{12})\b/);
  if (cnp) {
    meta['cnp'] = cnp[1];
    const dob = extractDobFromCnp(cnp[1]);
    if (dob) {
      const [y, m, d] = dob.split('-');
      meta['birth_date'] = `${d}.${m}.${y}`;
    }
  }

  const series = text.match(/\b([A-Z]{2})\s*(\d{6})\b/);
  if (series) meta['series'] = `${series[1]} ${series[2]}`;

  // Adresă domiciliu (pe unele CI-uri apare pe față sau verso)
  const addrByKeyword = text.match(/(?:domiciliu|adres[aă])\s*:?\s*\n?\s*(.{10,120})/i);
  if (addrByKeyword) {
    meta['address'] = addrByKeyword[1].trim().replace(/\s+/g, ' ');
  } else {
    const addrInline = text.match(
      /\b(?:str\.|strada|b-dul|bulevardul?|calea|aleea|bd\.)\s+[A-ZĂÂÎȘȚ][^\n]{5,80}/i
    );
    if (addrInline) meta['address'] = addrInline[0].trim().replace(/\s+/g, ' ');
  }

  // Format specific CI română: "07.07.16-28.09.2026" (emisiune YY – expirare YYYY)
  let expiry: string | undefined;
  let issue: string | undefined;
  const validityRange = text.match(
    /(\d{2})[.\/-](\d{2})[.\/-](\d{2})\s*[-–]\s*(\d{2})[.\/-](\d{2})[.\/-](\d{4})/
  );
  if (validityRange) {
    const issueYearShort = parseInt(validityRange[3], 10);
    const issueYear = issueYearShort < 50 ? 2000 + issueYearShort : 1900 + issueYearShort;
    issue = `${issueYear}-${validityRange[2]}-${validityRange[1]}`;
    expiry = `${validityRange[6]}-${validityRange[5]}-${validityRange[4]}`;
  } else {
    expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|valid\s*until/i);
    issue = findDateNear(text, /eliberat|emis[aă]/i);
  }

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── PAȘAPORT ────────────────────────────────────────────────────────────────

export function extractPasaport(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. pașaport: 2 litere + 6-7 cifre
  const nr = text.match(/\b([A-Z]{2}\d{6,7})\b/);
  if (nr) meta['series'] = nr[1];

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiry/i);
  const issue = findDateNear(text, /data\s*eliber[aă]rii|eliberat|issued/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── CERTIFICAT DE BOTEZ ─────────────────────────────────────────────────────

/**
 * Certificat de botez — formular bisericesc cu spații completate de mână.
 * OCR-ul prinde textul tipărit (labelurile) și parțial scrisul de mână.
 * Strategia: ancore pe label-uri tipărite + capturare lacomă până la următorul label.
 */
export function extractCertificatBotez(text: string): ExtractResult {
  const meta: Record<string, string> = {};
  // Colapsăm whitespace-ul multiplu (inclusiv newline-uri) ca să tolerăm OCR
  // care rupe textul certificatului pe linii arbitrare între labeluri.
  const collapsed = text.replace(/\s+/g, ' ');

  // baptism_date: după „în ziua de" și înainte de „s-a săvârșit"
  const baptismDate = collapsed.match(
    /[îi]n\s+ziua\s+de\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})[^a-z]{0,40}s[-\s]*a\s+s[aă]v[âa]r[șs]it/i
  );
  if (baptismDate) meta['baptism_date'] = baptismDate[1];

  // subject_name: după „fiului/fiicei" până la „a(l) d-lui"
  const subject = collapsed.match(/fiului\s*\/?\s*fiicei\s+(.{3,80}?)\s+a\s*\(?l\)?\s*d[-\s]*lui/i);
  if (subject) meta['subject_name'] = subject[1].trim().replace(/\.+/g, '').trim();

  // baptism_name: după „primind din botez numele" până la „asistând"
  const baptismName = collapsed.match(/primind\s+din\s+botez\s+numele\s+(.{2,60}?)\s+asist[âa]nd/i);
  if (baptismName) meta['baptism_name'] = baptismName[1].trim().replace(/\.+/g, '').trim();

  // godparents: după „asistând ca naș(i)" până la „domiciliat" sau „str."
  const godparents = collapsed.match(
    /asist[âa]nd\s+ca\s+na[sș]i?\s+(.{3,120}?)\s+(?:domicili[ai]t|str\.|nr\.)/i
  );
  if (godparents) meta['godparents'] = godparents[1].trim().replace(/\.+/g, '').trim();

  // church: combină hramul (între ghilimele) cu localitatea
  const churchName = collapsed.match(/(?:Parohia\s+Bisericii[^"„]*["„]([^"”]{3,60})["”])/i);
  const churchLocality = collapsed.match(/din\s+localitatea\s+([A-ZĂÂÎȘȚa-zăâîșț\-]{3,40})/i);
  if (churchName || churchLocality) {
    const parts = [
      churchName ? churchName[1].trim() : null,
      churchLocality ? churchLocality[1].trim() : null,
    ].filter(Boolean);
    if (parts.length > 0) meta['church'] = parts.join(', ');
  }

  // issue_date: după „Drept care s-a eliberat acest certificat astăzi"
  const issue =
    findDateNear(text, /drept\s+care\s+s[-\s]*a\s+eliberat|data\s+eliber[aă]rii/i) ??
    // fallback: ultima dată din text (uneori e doar lângă „PAROH")
    (() => {
      const dates = [...collapsed.matchAll(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/g)];
      if (dates.length === 0) return undefined;
      const last = dates[dates.length - 1];
      return `${last[3]}-${last[2]}-${last[1]}`;
    })();

  return { metadata: meta, issue_date: issue };
}

// ─── PERMIS AUTO ─────────────────────────────────────────────────────────────

export function extractPermisAuto(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Număr permis: 8 cifre
  const nr = text.match(/\b(\d{8})\b/);
  if (nr) meta['series'] = nr[1];

  // Categorii
  const catPattern = /\b(A2|A1|B1|BE|C1E|CE|D1E|DE|C1|D1|Tr|Tb|Tv|[ABCDT])\b/g;
  const cats = [...new Set([...text.matchAll(catPattern)].map(m => m[1]))];
  if (cats.length > 0) meta['categories'] = cats.join(', ');

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(text, /data\s*eliber[aă]rii|eliberat/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}
