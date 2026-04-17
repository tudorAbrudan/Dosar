/**
 * Extractoare OCR per tip de document.
 *
 * Fiecare extractor returnează DOAR câmpurile de identificare cheie (2-5 per tip),
 * conform DOCUMENT_FIELDS din types/documentFields.ts.
 *
 * Tot textul complet al documentului se salvează separat în câmpul `ocr_text`
 * al documentului — chatbot-ul folosește acel câmp pentru a răspunde la orice întrebare.
 *
 * Cheia din `metadata` trebuie să coincidă exact cu `key` din DOCUMENT_FIELDS.
 */
import { extractPlateNumber } from './ocr';
import type { DocumentType } from '@/types';

export interface ExtractResult {
  metadata: Record<string, string>;
  expiry_date?: string; // YYYY-MM-DD
  issue_date?: string; // YYYY-MM-DD
}

// ─── Utilități ───────────────────────────────────────────────────────────────

function parseDate(s: string): string | undefined {
  const m = s.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

function findDateNear(text: string, keyword: RegExp): string | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (keyword.test(lines[i])) {
      const d = parseDate(lines[i]);
      if (d) return d;
      if (i + 1 < lines.length) {
        const d2 = parseDate(lines[i + 1]);
        if (d2) return d2;
      }
    }
  }
  return undefined;
}

function firstDate(text: string): string | undefined {
  const m = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

// ─── BULETIN ─────────────────────────────────────────────────────────────────

function extractBuletin(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const cnp = text.match(/\b([1-8]\d{12})\b/);
  if (cnp) meta['cnp'] = cnp[1];

  const series = text.match(/\b([A-Z]{2})\s*(\d{6})\b/);
  if (series) meta['series'] = `${series[1]} ${series[2]}`;

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

function extractPasaport(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. pașaport: 2 litere + 6-7 cifre
  const nr = text.match(/\b([A-Z]{2}\d{6,7})\b/);
  if (nr) meta['series'] = nr[1];

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiry/i);
  const issue = findDateNear(text, /data\s*eliber[aă]rii|eliberat|issued/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── PERMIS AUTO ─────────────────────────────────────────────────────────────

function extractPermisAuto(text: string): ExtractResult {
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

// ─── TALON (Certificat de Înmatriculare) ─────────────────────────────────────
// IMPORTANT: talonul NU expiră. expiry_date = data ITP din ștampila RAR.

/** Convertește MM/YYYY în număr comparabil (YYYYMM) pentru comparații. */
function mmYyyyToSortKey(mm: string, yyyy: string): number {
  return parseInt(yyyy) * 100 + parseInt(mm);
}

function extractTalonDoc(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  // VIN: 17 caractere alfanumerice (câmp E sau standalone)
  const vin =
    text.match(/\bE\s*[:\s]\s*([A-HJ-NPR-Z0-9]{17})\b/i) ?? text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) meta['vin'] = vin[1];

  // D.1 = marcă / tip
  // [A-Z \-\/] — fără \s, ca să nu treacă pe linia următoare (D.2)
  const d1 = text.match(/D\.?1\s*[:\s]*\n?\s*([A-Z][A-Z \-\/]{1,40})/im);
  if (d1) {
    const parts = d1[1].trim().split(/\s*\/\s*/);
    meta['marca'] = parts[0].trim();
    if (parts[1]) meta['model'] = parts[1].trim();
  }

  // ITP — prioritate 0: "Data urmatoarei inspectii tehnice ZZ.LL.AAAA"
  // Ștampila RAR din talon conține exact această frază urmată de data ZZ.LL.AAAA.
  // OCR-ul o poate sparge pe mai multe linii; [^\d]{0,80} acoperă newline-urile.
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
    // Talonul conține: data fabricației (trecut), prima înmatriculare (trecut), ștampila RAR ITP (viitor).
    const allMmYyyy: Array<{ mm: string; yyyy: string }> = [];

    // 1. Căutare lângă cuvinte cheie ITP/RAR
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

    // 2. Fallback: toate MM/YYYY standalone (nu parte din DD.MM.YYYY)
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
      meta['itp_expiry_date'] = `${dd}.${best.mm}.${best.yyyy}`; // ZZ.LL.AAAA
    }
  }

  return { metadata: meta, expiry_date: itpIso };
}

// ─── CARTE AUTO (CIV) ────────────────────────────────────────────────────────

function extractCarteAuto(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const vin =
    text.match(/\bE\s*[:\s]\s*([A-HJ-NPR-Z0-9]{17})\b/i) ?? text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) meta['vin'] = vin[1];

  // CIV nu expiră
  return { metadata: meta };
}

// ─── RCA ─────────────────────────────────────────────────────────────────────

const ROMANIAN_INSURERS = [
  'ALLIANZ',
  'GROUPAMA',
  'GENERALI',
  'OMNIASIG',
  'UNIQA',
  'ASIROM',
  'GRAWE',
  'SIGNAL IDUNA',
  'EUROINS',
  'AXERIA',
  'CITY INSURANCE',
  'METROPOLITAN',
  'GARANTA',
  'AXA',
  'CERTASIG',
];

// Prefixe distincte din nr. de poliță → asigurator
// Permite identificarea asiguratorului chiar când fontul e garbled
const POLICY_PREFIX_TO_INSURER: Array<[RegExp, string]> = [
  [/^RO\/?32V/i, 'Groupama'],
  [/^RO\/?0[17]/i, 'Allianz'],
  [/^RO\/?AA/i, 'Allianz'],
  [/^RO\/?GR/i, 'Grawe'],
  [/^RO\/?UN/i, 'Uniqa'],
  [/^RO\/?AS/i, 'Asirom'],
  [/^RO\/?OM/i, 'Omniasig'],
  [/^RO\/?GN/i, 'Generali'],
  [/^RO\/?EU/i, 'Euroins'],
  [/^RO\/?AX/i, 'Axeria'],
  [/^PAD/i, 'Pool-ul de Asigurare'],
];

function detectInsurer(text: string): string | undefined {
  const tu = text.toUpperCase();
  for (const ins of ROMANIAN_INSURERS) {
    if (tu.includes(ins)) return ins;
  }
  return undefined;
}

function detectInsurerFromPolicyNumber(policyNumber: string): string | undefined {
  for (const [pattern, name] of POLICY_PREFIX_TO_INSURER) {
    if (pattern.test(policyNumber)) return name;
  }
  return undefined;
}

function extractRca(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. poliță — pattern extins:
  // 1. "poliță/contract nr. X"
  // 2. Format românesc standalone: RO/XX/... sau RO32V... (Groupama), fără prefix obligatoriu
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

function extractItp(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|urm[aă]toarea\s*inspec[tț]ie/i);
  const issue = findDateNear(text, /data\s*inspec[tț]iei?/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── VIGNETĂ ─────────────────────────────────────────────────────────────────

function extractVigneta(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiră/i);
  const issue = findDateNear(text, /data\s*emit|data\s*[îi]nregistr[aă]rii/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── CASCO ───────────────────────────────────────────────────────────────────

function extractCasco(text: string): ExtractResult {
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

// ─── PAD ─────────────────────────────────────────────────────────────────────

function extractPad(text: string): ExtractResult {
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

function extractActProprietate(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const addr = text.match(/(?:imobil|situat|adres[aă])[:\s]+([^\n]{10,100})/i);
  if (addr) meta['adresa'] = addr[1].trim();

  const cad = text.match(/(?:nr\.?\s*cadastral|cadastral)[:\s]+(\d{5,12})/i);
  if (cad) meta['nr_cadastral'] = cad[1];

  const issue = findDateNear(text, /[îi]ncheiat|autentificat|data\s*actului/i);

  return { metadata: meta, issue_date: issue };
}

// ─── CADASTRU ────────────────────────────────────────────────────────────────

function extractCadastru(text: string): ExtractResult {
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

function extractImpozitProprietate(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const suma = text.match(
    /(?:total\s*impozit|sum[aă]\s*de\s*plat[aă]|sum[aă]\s*anual[aă]?)[:\s]+(\d+[.,]?\d*)\s*(?:RON|LEI)/i
  );
  if (suma) meta['amount'] = suma[1].replace(',', '.');

  const issue = findDateNear(text, /data\s*emiter|emis/i);

  return { metadata: meta, issue_date: issue };
}

// ─── FACTURĂ ─────────────────────────────────────────────────────────────────

// Furnizori români cunoscuți de utilități
const ROMANIAN_UTILITY_SUPPLIERS = [
  'E.ON Energie',
  'E.ON',
  'Engie Romania',
  'Engie',
  'Electrica Furnizare',
  'Electrica',
  'CEZ Vânzare',
  'CEZ',
  'Enel Energie',
  'Enel',
  'Digi Communications',
  'Digi',
  'RCS&RDS',
  'RCS & RDS',
  'Vodafone Romania',
  'Vodafone',
  'Orange Romania',
  'Orange',
  'Telekom Romania',
  'Telekom',
  'UPC Romania',
  'UPC',
  'Apă Nova',
  'Apa Nova',
  'Apa Canal',
  'Aquatim',
  'Distrigaz',
  'Romgaz',
  'Transgaz',
  'Hidroelectrica',
  'DEER',
  'Delgaz Grid',
  'Termoenergetica',
  'RADET',
];

function detectUtilitySupplier(text: string): string | undefined {
  const tu = text.toUpperCase();
  for (const s of ROMANIAN_UTILITY_SUPPLIERS) {
    if (tu.includes(s.toUpperCase())) return s;
  }
  return undefined;
}

function extractFactura(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Nr. factură — diverse formate românești
  const invNr = text.match(
    /(?:factur[aă]\s*nr\.?\s*|nr\.?\s*factur[aă]\s*|invoice\s*(?:no\.?|nr\.?)\s*|seria\s+[A-Z]+\s+nr\.?\s*)([A-Z0-9\-\/]+)/i
  );
  if (invNr) meta['invoice_number'] = invNr[1].trim();

  // Furnizor — mai întâi keyword explicit, apoi detectare din lista de furnizori cunoscuți
  const supplierKeyword = text.match(
    /(?:furnizor|emitent|v[âa]nz[aă]tor|operator|prestat)[:\s]+([^\n]{5,80})/i
  );
  if (supplierKeyword) {
    meta['supplier'] = supplierKeyword[1].trim().slice(0, 60);
  } else {
    const known = detectUtilitySupplier(text);
    if (known) meta['supplier'] = known;
  }

  // Sumă totală — prioritate: "total de plată" > "sold de plată" > "total facturat" > sumă + monedă
  // Folosim ULTIMA potrivire pentru "total de plată" (evităm subtotaluri intermediare)
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
      // Luăm ultima potrivire — e mai probabil totalul final
      const last = allMatches[allMatches.length - 1];
      meta['amount'] = last[1].replace(',', '.');
      foundAmount = true;
      break;
    }
  }
  if (!foundAmount) {
    // Fallback: prima sumă cu monedă explicită
    const withCurrency = text.match(/(\d+[.,]\d{2})\s*(?:RON|ron|lei|LEI|EUR)/);
    if (withCurrency) meta['amount'] = withCurrency[1].replace(',', '.');
  }

  // Scadență
  const due = findDateNear(
    text,
    /scaden[tț][aă]|termen\s*(?:de\s*)?plat[aă]|data\s*limit[aă]/i
  );
  if (due) meta['due_date'] = due.replace(/-/g, '.').replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$3.$2.$1');

  // Perioadă de facturare
  const periodMatch = text.match(
    /perioad[aă]\s*(?:de\s*)?factur[aă]?[:\s]+([^\n]{10,40})/i
  );
  if (periodMatch) {
    meta['period'] = periodMatch[1].trim();
  } else {
    // Fallback: două date de forma DD.MM.YYYY - DD.MM.YYYY pe aceeași linie
    const rangeLine = text.match(
      /(\d{2}[.\/-]\d{2}[.\/-]\d{4})\s*[-–]\s*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/
    );
    if (rangeLine) meta['period'] = `${rangeLine[1]} - ${rangeLine[2]}`;
  }

  const issue = findDateNear(text, /data\s*factur[ii]|data\s*emiter|data\s*document/i);

  return { metadata: meta, issue_date: issue, expiry_date: due };
}

// ─── BON CUMPĂRĂTURI ─────────────────────────────────────────────────────────

function extractBonCumparaturi(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const store = text.match(/^([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s]{3,30})(?:\r?\n)/m);
  if (store) meta['store'] = store[1].trim();

  const total = text.match(/(?:total|suma)[:\s]+(\d+[.,]\d{2})/i);
  if (total) meta['amount'] = total[1].replace(',', '.');

  const issue = firstDate(text);

  return { metadata: meta, issue_date: issue };
}

// ─── BON PARCARE ─────────────────────────────────────────────────────────────

function extractBonParcare(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Locație: caută numele parcării sau adresa lângă cuvintele cheie
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
  // Fallback: primul rând ALL CAPS ca nume parcare
  if (!meta['location']) {
    const firstLine = text.match(/^([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s\-\.]{4,40})(?:\r?\n)/m);
    if (firstLine) meta['location'] = firstLine[1].trim();
  }

  // Sumă totală
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

function extractGarantie(text: string): ExtractResult {
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

function extractContract(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const tip = text.match(/contract\s+(?:de\s+)?([a-zăâîșț\s]{5,40})(?:\s|$)/i);
  if (tip) meta['tip_contract'] = tip[1].trim();

  const issue = findDateNear(text, /[îi]ncheiat\s*(?:ast[aă]zi|la\s*data)|data\s*semn[aă]rii/i);
  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|[îi]nceteaz[aă]/i);

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── ABONAMENT ───────────────────────────────────────────────────────────────

function extractAbonament(text: string): ExtractResult {
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

// ─── REȚETĂ MEDICALĂ ─────────────────────────────────────────────────────────

function extractReteta(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const medic = text.match(
    /(?:Dr\.?|doctor|medic\s*prescriptor)[:\s.]+([A-ZĂÂÎȘȚ][a-zăâîșțA-Z\s\-\.]{3,50})/i
  );
  if (medic) meta['doctor'] = medic[1].trim();

  // Medicament: după "Rp:" sau "1." sau primul rând cu doze
  const med = text.match(/(?:Rp[:\s]|^\s*1\.[:\s])([^\n]{10,80})/im);
  if (med) meta['medication_1'] = med[1].trim();

  const issue = findDateNear(text, /data\s*prescri[ep]|data\s*emiter/i) ?? firstDate(text);
  // Rețetă expiră: 30 zile standard, 90 zile boli cronice
  let expiry: string | undefined;
  if (issue) {
    const d = new Date(issue);
    const isCronic = /cronic|permanent|DCI\s+nr\.?\s*3/i.test(text);
    d.setDate(d.getDate() + (isCronic ? 90 : 30));
    expiry = d.toISOString().slice(0, 10);
  }

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── ANALIZE MEDICALE ────────────────────────────────────────────────────────

function extractAnalize(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const lab = text.match(/(?:laborator|clinica|spital)[:\s]+([^\n]{5,60})/i);
  if (lab) meta['lab'] = lab[1].trim();
  else {
    // Detectare automată laboratoare cunoscute
    const knownLabs = ['SYNEVO', 'MEDLIFE', 'REGINA MARIA', 'MEDICOVER', 'BIOCLINICA', 'PONDERAS'];
    const tu = text.toUpperCase();
    for (const l of knownLabs) {
      if (tu.includes(l)) {
        meta['lab'] = l;
        break;
      }
    }
  }

  const issue = findDateNear(text, /data\s*(?:recolt|eliber|rezult)/i) ?? firstDate(text);

  return { metadata: meta, issue_date: issue };
}

// ─── VACCIN ANIMAL ───────────────────────────────────────────────────────────

function extractVaccinAnimal(text: string): ExtractResult {
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

function extractDeparazitare(text: string): ExtractResult {
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

function extractVizitaVet(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const vet = text.match(/(?:Dr\.?|medic\s*veterinar)[:\s.]+([A-ZĂÂÎȘȚ][a-zăâîșț\s\-\.]{3,50})/i);
  if (vet) meta['vet_name'] = vet[1].trim();

  const issue = findDateNear(text, /data\s*consult[aă]rii|data\s*viz/i) ?? firstDate(text);

  return { metadata: meta, issue_date: issue };
}

// ─── STINGĂTOR INCENDIU ──────────────────────────────────────────────────────

function extractStingator(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const serie = text.match(/(?:serie|nr\.?\s*serie|s\/n)[:\s]+([A-Z0-9\-]{4,20})/i);
  if (serie) meta['serie'] = serie[1].trim();

  const expiry = findDateNear(text, /urm[aă]toarea\s*verificare|valabil[ăa]?\s*p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(text, /data\s*verific[aă]rii|verificat\s*la/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── CERTIFICAT ÎNREGISTRARE (Firmă) ─────────────────────────────────────────

function extractCertificatInregistrare(text: string): ExtractResult {
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

// ─── CARD ────────────────────────────────────────────────────────────────────

function extractCard(text: string): ExtractResult {
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

function extractBilet(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  // Categorie: avion, tren, concert, meci etc.
  const catMatch = text.match(
    /\b(avion|zbor|flight|tren|autobuz|concert|spectacol|meci|festival|teatru|film)\b/i
  );
  if (catMatch)
    meta['categorie'] = catMatch[1].charAt(0).toUpperCase() + catMatch[1].slice(1).toLowerCase();

  // Locație / rută
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

  // Eveniment / nr. zbor / artist
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

// ─── AUTORIZAȚIE ACTIVITATE ───────────────────────────────────────────────────

function extractAutorizatieActivitate(text: string): ExtractResult {
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

function extractActConstitutiv(text: string): ExtractResult {
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

function extractCertificatTva(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const codMatch = text.match(/(?:cod\s*TVA|CIF)[:\s]+(RO\s*\d{6,10}|\d{6,10})/i);
  if (codMatch) meta['cod_tva'] = codMatch[1].replace(/\s/g, '');

  const denMatch = text.match(/(?:denumire|societate|contribuabil)[:\s]+([^\n]{5,80})/i);
  if (denMatch) meta['denumire'] = denMatch[1].trim();

  const issue = findDateNear(text, /data\s*[îi]nregistr[aă]rii|emis/i);

  return { metadata: meta, issue_date: issue };
}

// ─── ASIGURARE PROFESIONALĂ ───────────────────────────────────────────────────

function extractAsigurareProf(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const policy = text.match(/(?:poli[tț][aă]|contract|nr\.?)\s*[:\s]+([A-Z0-9\-\/]{5,30})/i);
  if (policy) meta['policy_number'] = policy[1].trim();

  const insurer = detectInsurer(text);
  if (insurer) meta['insurer'] = insurer;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|data\s*expir/i);
  const issue = findDateNear(text, /data\s*emit|[îi]ncheiat/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── GENERIC FALLBACK ────────────────────────────────────────────────────────

function extractGeneric(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|expiră/i);
  const issue = findDateNear(text, /eliberat|emis|data\s*emit/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── DISPATCHER ──────────────────────────────────────────────────────────────

export function extractFieldsForType(type: DocumentType | string, text: string): ExtractResult {
  switch (type) {
    case 'buletin':
      return extractBuletin(text);
    case 'pasaport':
      return extractPasaport(text);
    case 'permis_auto':
      return extractPermisAuto(text);
    case 'talon':
      return extractTalonDoc(text);
    case 'carte_auto':
      return extractCarteAuto(text);
    case 'rca':
      return extractRca(text);
    case 'itp':
      return extractItp(text);
    case 'vigneta':
      return extractVigneta(text);
    case 'casco':
      return extractCasco(text);
    case 'pad':
      return extractPad(text);
    case 'factura':
      return extractFactura(text);
    case 'bon_cumparaturi':
      return extractBonCumparaturi(text);
    case 'bon_parcare':
      return extractBonParcare(text);
    case 'garantie':
      return extractGarantie(text);
    case 'contract':
      return extractContract(text);
    case 'act_proprietate':
      return extractActProprietate(text);
    case 'cadastru':
      return extractCadastru(text);
    case 'impozit_proprietate':
      return extractImpozitProprietate(text);
    case 'abonament':
      return extractAbonament(text);
    case 'stingator_incendiu':
      return extractStingator(text);
    case 'reteta_medicala':
      return extractReteta(text);
    case 'analize_medicale':
      return extractAnalize(text);
    case 'vaccin_animal':
      return extractVaccinAnimal(text);
    case 'deparazitare':
      return extractDeparazitare(text);
    case 'vizita_vet':
      return extractVizitaVet(text);
    case 'card':
      return extractCard(text);
    case 'bilet':
      return extractBilet(text);
    case 'certificat_inregistrare':
      return extractCertificatInregistrare(text);
    case 'autorizatie_activitate':
      return extractAutorizatieActivitate(text);
    case 'act_constitutiv':
      return extractActConstitutiv(text);
    case 'certificat_tva':
      return extractCertificatTva(text);
    case 'asigurare_profesionala':
      return extractAsigurareProf(text);
    default:
      return extractGeneric(text);
  }
}
