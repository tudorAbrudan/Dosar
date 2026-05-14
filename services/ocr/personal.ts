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
