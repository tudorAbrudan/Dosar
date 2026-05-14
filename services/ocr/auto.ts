import { extractPlateNumber } from '../ocr';
import type { ExtractResult } from './types';
import { findDateNear, mmYyyyToSortKey } from './utils';
import { detectInsurer, detectInsurerFromPolicyNumber } from './insurers';

// ─── TALON (Certificat de Înmatriculare) ─────────────────────────────────────
// IMPORTANT: talonul NU expiră. expiry_date = data ITP din ștampila RAR.

export function extractTalonDoc(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  // VIN: 17 caractere alfanumerice (câmp E sau standalone)
  const vin =
    text.match(/\bE\s*[:\s]\s*([A-HJ-NPR-Z0-9]{17})\b/i) ?? text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) meta['vin'] = vin[1];

  // D.1 = marcă / tip
  const d1 = text.match(/D\.?1\s*[:\s]*\n?\s*([A-Z][A-Z \-\/]{1,40})/im);
  if (d1) {
    const parts = d1[1].trim().split(/\s*\/\s*/);
    meta['marca'] = parts[0].trim();
    if (parts[1]) meta['model'] = parts[1].trim();
  }

  // ITP — prioritate 0: "Data urmatoarei inspectii tehnice ZZ.LL.AAAA"
  let itpIso: string | undefined;

  const explicitItpMatch = text.match(
    /data\s+urm[^\d]{0,80}(0[1-9]|[12]\d|3[01])[.\/-](0[1-9]|1[0-2])[.\/-](20\d{2})/i
  );
  if (explicitItpMatch) {
    const [, dd, mm, yyyy] = explicitItpMatch;
    itpIso = `${yyyy}-${mm}-${dd}`;
    meta['itp_expiry_date'] = `${dd}.${mm}.${yyyy}`;
  } else {
    // ITP — prioritate 1/2: colectează MM/YYYY sau MM.YYYY și ia maximul.
    const allMmYyyy: { mm: string; yyyy: string }[] = [];

    const itpKwMatches = [
      ...text.matchAll(
        /(?:ITP|INSPEC[TȚ]IE|RAR)[^\n]{0,30}\n?\s*(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})/gi
      ),
      ...text.matchAll(
        /(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})\s*[^\n]{0,20}(?:ITP|INSPEC[TȚ]IE|RAR)/gi
      ),
    ];
    for (const m of itpKwMatches) {
      allMmYyyy.push({ mm: m[1], yyyy: m[2] });
    }

    if (allMmYyyy.length === 0) {
      const standalone = [...text.matchAll(/(?<!\d\.)(0[1-9]|1[0-2])[.\/](20[2-9]\d)(?!\d)/g)];
      for (const m of standalone) {
        allMmYyyy.push({ mm: m[1], yyyy: m[2] });
      }
    }

    if (allMmYyyy.length > 0) {
      const best = allMmYyyy.reduce((prev, cur) =>
        mmYyyyToSortKey(cur.mm, cur.yyyy) > mmYyyyToSortKey(prev.mm, prev.yyyy) ? cur : prev
      );
      const lastDay = new Date(parseInt(best.yyyy), parseInt(best.mm), 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      itpIso = `${best.yyyy}-${best.mm}-${dd}`;
      meta['itp_expiry_date'] = `${dd}.${best.mm}.${best.yyyy}`;
    }
  }

  return { metadata: meta, expiry_date: itpIso };
}

// ─── CARTE AUTO (CIV) ────────────────────────────────────────────────────────

/**
 * Extrage VIN (17 caractere, fără I/O/Q) dintr-un text. Tolerează spații/liniuțe
 * din OCR.
 */
export function extractVinFromText(text: string): string | null {
  const VIN_CHAR = '[A-HJ-NPR-Z0-9]';
  const VIN17 = `(?:${VIN_CHAR}[\\s\\-]?){17}`;

  const labelPatterns: RegExp[] = [
    new RegExp(
      `num[ăa]r(?:ul)?\\s*de\\s*identificare(?:\\s*al)?(?:\\s*vehiculului)?[\\s:.\\-]*(${VIN17})`,
      'i'
    ),
    new RegExp(`\\bNIV\\b[\\s:.\\-]*(${VIN17})`, 'i'),
    new RegExp(`(?:^|[\\s|])E[\\s.:]+(${VIN17})`, 'mi'),
    new RegExp(`\\bVIN\\b[\\s:.\\-]*(${VIN17})`, 'i'),
  ];

  for (const re of labelPatterns) {
    const m = text.match(re);
    if (m) {
      const clean = m[1].replace(/[\s\-]/g, '').toUpperCase();
      if (clean.length === 17) return clean;
    }
  }

  const fallback = text.match(new RegExp(`\\b(${VIN_CHAR}{17})\\b`));
  return fallback ? fallback[1].toUpperCase() : null;
}

export function extractCarteAuto(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const vin = extractVinFromText(text);
  if (vin) meta['vin'] = vin;

  // CIV nu expiră și nu conține placa (placa e doar pe talon).
  return { metadata: meta };
}

// ─── RCA ─────────────────────────────────────────────────────────────────────

export function extractRca(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. poliță — pattern extins:
  const policyPatterns = [
    /(?:poli[tț][aă]|contract|serie[:\s]+nr\.?)\s*[:\s]+([A-Z0-9][A-Z0-9\-\/]{4,35})/i,
    /\b(RO\/?[A-Z0-9]{2,6}[A-Z0-9\-\/]{3,25})\b/,
  ];
  for (const p of policyPatterns) {
    const m = text.match(p);
    if (m) {
      meta['policy_number'] = m[1].trim();
      break;
    }
  }

  // Asigurator — mai întâi din text, fallback din nr. poliță
  const insurerFromText = detectInsurer(text);
  if (insurerFromText) {
    meta['insurer'] = insurerFromText;
  } else if (meta['policy_number']) {
    const insurerFromPolicy = detectInsurerFromPolicyNumber(meta['policy_number']);
    if (insurerFromPolicy) meta['insurer'] = insurerFromPolicy;
  }

  // Nr. înmatriculare
  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  // Marcă / model vehicul
  const marcaModelPatterns = [
    /(?:marc[aă](?:\s*\/\s*model)?|tip\s*vehicul|autoturism)\s*[:\s]+([A-Z][A-Za-zĂÂÎȘȚăâîșț0-9\s\-]{2,30})/i,
    /(?:marca)\s*[:\s]+([A-Z][A-Za-z\s\-]{2,20})/i,
  ];
  for (const p of marcaModelPatterns) {
    const m = text.match(p);
    if (m) {
      meta['marca_model'] = m[1].trim().slice(0, 40);
      break;
    }
  }

  // Prima de asigurare — caută suma totală de plată
  const primaPatterns = [
    /prim[aă]\s*(?:de\s*asigurare|total[aă])?\s*[:\s]+(\d+[.,]\d{2})/i,
    /total\s*(?:de\s*plat[aă])?\s*[:\s]+(\d+[.,]\d{2})\s*(?:RON|ron|lei)/i,
    /de\s*plat[aă]\s*[:\s]+(\d+[.,]\d{2})/i,
  ];
  for (const p of primaPatterns) {
    const m = text.match(p);
    if (m) {
      meta['prima'] = m[1].replace(',', '.');
      break;
    }
  }

  // Date validitate
  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|data\s*expir|p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(
    text,
    /data\s*emit|data\s*[îi]nchei|[îi]ncepere\s*valabilitate|valabil\s*de\s*la|[îi]ncepere\s*risc/i
  );

  // valid_from ca string afișabil ZZ.LL.AAAA
  if (issue) {
    meta['valid_from'] = issue.replace(/-/g, '.').replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$3.$2.$1');
  }

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── ITP ─────────────────────────────────────────────────────────────────────

export function extractItp(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|urm[aă]toarea\s*inspec[tț]ie/i);
  const issue = findDateNear(text, /data\s*inspec[tț]iei?/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── VIGNETĂ ─────────────────────────────────────────────────────────────────

export function extractVigneta(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiră/i);
  const issue = findDateNear(text, /data\s*emit|data\s*[îi]nregistr[aă]rii/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── CASCO ───────────────────────────────────────────────────────────────────

export function extractCasco(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const policy = text.match(/(?:poli[tț][aă]|contract|nr\.?)\s*[:\s]+([A-Z0-9\-\/]{5,30})/i);
  if (policy) meta['policy_number'] = policy[1].trim();

  const insurer = detectInsurer(text);
  if (insurer) meta['insurer'] = insurer;

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|perioad[aă].*la/i);
  const issue = findDateNear(text, /data\s*emit|[îi]ncepere/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}
