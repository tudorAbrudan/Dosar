import type { ExtractResult } from './types';
import { findDateNear, firstDate } from './utils';
import { detectUtilitySupplier, isKnownUtilitySupplier } from './suppliers';

// ─── FACTURĂ ─────────────────────────────────────────────────────────────────

export function extractFactura(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. factură — diverse formate românești
  const invNr = text.match(
    /(?:factur[aă]\s*nr\.?\s*|nr\.?\s*factur[aă]\s*|invoice\s*(?:no\.?|nr\.?)\s*|seria\s+[A-Z]+\s+nr\.?\s*)([A-Z0-9\-\/]+)/i
  );
  if (invNr) {
    // OCR confundă adesea '0' cu 'o' în șiruri numerice
    meta['invoice_number'] = invNr[1]
      .trim()
      .replace(/(\d)[oO](\d)/g, '$10$2')
      .replace(/(\d)[oO]$/g, '$10');
  }

  // Furnizor — keyword explicit
  const supplierKeyword = text.match(/(?:furnizor|emitent|v[âa]nz[aă]tor)[:\s]+([^\n]{5,80})/i);
  if (supplierKeyword) {
    meta['supplier'] = supplierKeyword[1].trim().slice(0, 60);
  }
  // Verificare prin lista de furnizori cunoscuți — mai fiabil decât keyword match
  if (!meta['supplier'] || !isKnownUtilitySupplier(meta['supplier'])) {
    const known = detectUtilitySupplier(text);
    if (known) meta['supplier'] = known;
  }

  // Sumă totală — folosim ULTIMA potrivire pentru "total de plată" (evităm subtotaluri)
  const priorityPatterns = [
    /total\s*de\s*plat[aă]\s*[:\s]+(\d+[.,]\d{2})/gi,
    /sold\s*(?:de\s*)?plat[aă]\s*[:\s]+(\d+[.,]\d{2})/gi,
    /total\s*factur(?:at|are)\s*[:\s]+(\d+[.,]\d{2})/gi,
    /sum[aă]\s*total[aă]?\s*[:\s]+(\d+[.,]\d{2})/gi,
    /de\s*plat[aă]\s*[:\s]+(\d+[.,]\d{2})/gi,
  ];
  let foundAmount = false;
  for (const p of priorityPatterns) {
    const allMatches = [...text.matchAll(p)];
    if (allMatches.length > 0) {
      const last = allMatches[allMatches.length - 1];
      meta['amount'] = last[1].replace(',', '.');
      foundAmount = true;
      break;
    }
  }
  if (!foundAmount) {
    const withCurrency = text.match(/(\d+[.,]\d{2})\s*(?:RON|ron|lei|LEI|EUR)/);
    if (withCurrency) meta['amount'] = withCurrency[1].replace(',', '.');
  }

  // Scadență
  const dueKeyword =
    /scadent|termen\s*(?:de\s*)?plat|data\s*limit|limit[aă]\s*(?:de\s*)?plat|pl[aă]tibil|data\s*scaden/i;
  const due = findDateNear(text, dueKeyword, 3);
  if (due)
    meta['due_date'] = due.replace(/-/g, '.').replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$3.$2.$1');

  // Perioadă de facturare
  const periodLines = text.split('\n');
  const periodKeyword = /perioad[aă]\s*(?:de\s*)?factur/i;
  const rangePattern = /(\d{2}[.\/-]\d{2}[.\/-]\d{4})\s*[-–-]\s*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/;
  for (let pi = 0; pi < periodLines.length && !meta['period']; pi++) {
    if (periodKeyword.test(periodLines[pi])) {
      for (let pj = 0; pj <= 2; pj++) {
        const m = (periodLines[pi + pj] ?? '').match(rangePattern);
        if (m) {
          meta['period'] = `${m[1]} - ${m[2]}`;
          break;
        }
      }
    }
  }
  if (!meta['period']) {
    for (const line of periodLines) {
      if (/interval\s*de\s*timp/i.test(line)) continue;
      const m = line.match(rangePattern);
      if (m) {
        meta['period'] = `${m[1]} - ${m[2]}`;
        break;
      }
    }
  }

  const issue = findDateNear(
    text,
    /data\s*factur[ii]|data\s*emiter|data\s*document|din\s*data\s*de/i
  );

  return { metadata: meta, issue_date: issue, expiry_date: due };
}

// ─── BON CUMPĂRĂTURI ─────────────────────────────────────────────────────────

export function extractBonCumparaturi(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const store = text.match(/^([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s]{3,30})(?:\r?\n)/m);
  if (store) meta['store'] = store[1].trim();

  const total = text.match(/(?:total|suma)[:\s]+(\d+[.,]\d{2})/i);
  if (total) meta['amount'] = total[1].replace(',', '.');

  const issue = firstDate(text);

  return { metadata: meta, issue_date: issue };
}

// ─── BON PARCARE ─────────────────────────────────────────────────────────────

export function extractBonParcare(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const locPatterns = [
    /(?:parcar[ei]|parking)\s+([^\n]{5,60})/i,
    /(?:locatie|adres[aă])\s*[:\s]+([^\n]{5,60})/i,
  ];
  for (const p of locPatterns) {
    const m = text.match(p);
    if (m) {
      meta['location'] = m[1].trim();
      break;
    }
  }
  if (!meta['location']) {
    const firstLine = text.match(/^([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s\-\.]{4,40})(?:\r?\n)/m);
    if (firstLine) meta['location'] = firstLine[1].trim();
  }

  const amountPatterns = [
    /(?:total|suma\s*de\s*plat[aă]|de\s*plat[aă])\s*[:\s]+(\d+[.,]?\d*)\s*(?:RON|LEI)?/i,
    /(\d+[.,]\d{2})\s*(?:RON|LEI)/i,
  ];
  for (const p of amountPatterns) {
    const m = text.match(p);
    if (m) {
      meta['amount'] = m[1].replace(',', '.');
      break;
    }
  }

  const issue = firstDate(text);

  return { metadata: meta, issue_date: issue };
}

// ─── GARANȚIE ────────────────────────────────────────────────────────────────

export function extractGarantie(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const prod = text.match(/(?:produs|denumire|articol)[:\s]+([^\n]{5,60})/i);
  if (prod) meta['product_name'] = prod[1].trim();

  const serial = text.match(/(?:serial|serie|s\/n)[:\s]+([A-Z0-9\-]{5,30})/i);
  if (serial) meta['serie_produs'] = serial[1].trim();

  const issue = findDateNear(text, /data\s*achizi[tț]iei|cump[aă]rat/i);
  const expiry = findDateNear(
    text,
    /garan[tț]ie\s*p[âa]n[ăa]\s*la|valabil[ăa]?\s*p[âa]n[ăa]\s*la/i
  );

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────

export function extractContract(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const tip = text.match(/contract\s+(?:de\s+)?([a-zăâîșț\s]{5,40})(?:\s|$)/i);
  if (tip) meta['tip_contract'] = tip[1].trim();

  const issue = findDateNear(text, /[îi]ncheiat\s*(?:ast[aă]zi|la\s*data)|data\s*semn[aă]rii/i);
  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|[îi]nceteaz[aă]/i);

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── ABONAMENT ───────────────────────────────────────────────────────────────

export function extractAbonament(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const providers = [
    'DIGI',
    'ORANGE',
    'VODAFONE',
    'TELEKOM',
    'RCS',
    'RDS',
    'COSMOTE',
    'UPC',
    'NETFLIX',
    'SPOTIFY',
    'HBO',
    'DISNEY',
    'AMAZON',
  ];
  const tu = text.toUpperCase();
  for (const p of providers) {
    if (tu.includes(p)) {
      meta['service_name'] = p;
      break;
    }
  }
  if (!meta['service_name']) {
    const service = text.match(/(?:serviciu|furnizor|abonament)[:\s]+([^\n]{5,40})/i);
    if (service) meta['service_name'] = service[1].trim();
  }

  const amount = text.match(/(?:suma|valoare|tarif|pret)[:\s]+(\d+[.,]\d{2})\s*(?:RON|EUR|USD)/i);
  if (amount) meta['amount'] = amount[1].replace(',', '.');

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expir[aă]/i);

  return { metadata: meta, expiry_date: expiry };
}

// ─── CARD ────────────────────────────────────────────────────────────────────

export function extractCard(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Ultimele 4 cifre: ultimul grup de 4 cifre (de pe card)
  const last4 = text.match(/\b(\d{4})\s*$/m);
  if (last4) meta['last4'] = last4[1];

  // Bancă emitentă
  const banks = [
    'BCR',
    'BRD',
    'BT',
    'ING',
    'REVOLUT',
    'RAIFFEISEN',
    'UNICREDIT',
    'CEC',
    'ALPHA',
    'GARANTI',
    'OTP',
  ];
  const tu = text.toUpperCase();
  for (const b of banks) {
    if (tu.includes(b)) {
      meta['bank'] = b;
      break;
    }
  }
  if (!meta['bank']) {
    const bankMatch = text.match(/(?:emis\s*de|banca?|bank)[:\s]+([^\n]{3,40})/i);
    if (bankMatch) meta['bank'] = bankMatch[1].trim();
  }

  // Data expirare card: MM/YY sau MM/YYYY
  const expiryMatch = text.match(/\b(0[1-9]|1[0-2])\s*\/\s*(\d{2,4})\b/);
  let expiry: string | undefined;
  if (expiryMatch) {
    const yy = expiryMatch[2].length === 2 ? `20${expiryMatch[2]}` : expiryMatch[2];
    const lastDay = new Date(parseInt(yy), parseInt(expiryMatch[1]), 0).getDate();
    expiry = `${yy}-${expiryMatch[1]}-${String(lastDay).padStart(2, '0')}`;
  }

  return { metadata: meta, expiry_date: expiry };
}

// ─── BILET ───────────────────────────────────────────────────────────────────

export function extractBilet(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const catMatch = text.match(
    /\b(avion|zbor|flight|tren|autobuz|concert|spectacol|meci|festival|teatru|film)\b/i
  );
  if (catMatch)
    meta['categorie'] = catMatch[1].charAt(0).toUpperCase() + catMatch[1].slice(1).toLowerCase();

  const venuePatterns = [
    /(?:rut[aă]|de\s*la|from)[:\s]+([^\n]{5,60})/i,
    /(?:arena|stadion|sala|venue|loc[aț]ie)[:\s]+([^\n]{5,60})/i,
  ];
  for (const p of venuePatterns) {
    const m = text.match(p);
    if (m) {
      meta['venue'] = m[1].trim();
      break;
    }
  }

  const eventPatterns = [
    /(?:zbor|flight|nr\.?\s*zbor)[:\s]+([A-Z0-9\s]{2,20})/i,
    /(?:eveniment|artist|spectacol|tren\s*nr\.?)[:\s]+([^\n]{5,60})/i,
  ];
  for (const p of eventPatterns) {
    const m = text.match(p);
    if (m) {
      meta['eveniment_artist'] = m[1].trim();
      break;
    }
  }

  // Data evenimentului = expiry
  const issue = firstDate(text);
  return { metadata: meta, expiry_date: issue, issue_date: issue };
}
