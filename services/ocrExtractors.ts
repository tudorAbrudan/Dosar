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
  expiry_date?: string;  // YYYY-MM-DD
  issue_date?: string;   // YYYY-MM-DD
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

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|valid\s*until/i);
  const issue = findDateNear(text, /eliberat|emis[aă]/i);

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

function extractTalonDoc(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  // VIN: 17 caractere
  const vin = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) meta['vin'] = vin[1]; // pentru cross-referință internă, nu afișat ca câmp UI

  // D.1 = marcă / tip
  const d1 = text.match(/D\.?1\s*[:\s]*\n?\s*([A-Z][A-Z\s\-\/]{1,40})/im);
  if (d1) {
    const parts = d1[1].trim().split(/\s*\/\s*/);
    meta['marca'] = parts[0].trim();
    if (parts[1]) meta['model'] = parts[1].trim();
  }

  // P.3 = combustibil
  const p3 = text.match(/P\.?3\s*[:\s]*\n?\s*(BENZIN[AĂÃ]?|DIESEL|ELECTRIC|HYBRID|GPL|GNC|MOTORIN[AĂÃ]?)/i)
    ?? text.match(/\b(BENZIN[AĂÃ]?|DIESEL|ELECTRIC|HYBRID|GPL|GNC|MOTORIN[AĂÃ]?)\b/i);
  if (p3) {
    const f = p3[1].toUpperCase();
    meta['combustibil'] = f.includes('BENZIN') ? 'Benzină'
      : (f.includes('MOTORIN') || f === 'DIESEL') ? 'Diesel'
      : f === 'ELECTRIC' ? 'Electric'
      : f === 'HYBRID' ? 'Hybrid'
      : p3[1];
  }

  // B = data primei înmatriculări → an fabricație
  const bField = text.match(/\bB\s*[:\s]\s*(\d{2}[.\/\-]\d{2}[.\/\-]\d{4})/i);
  if (bField) {
    const yr = bField[1].match(/\d{4}/);
    if (yr) meta['an_fabricatie'] = yr[0];
  }

  // ITP: format MM/YYYY sau MM.YYYY lângă cuvinte cheie
  let itpDate: string | undefined;
  const itpKw = text.match(
    /(?:ITP|INSPEC[TȚ]IE|RAR)[^\n]{0,30}\n?\s*(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})/i
  ) ?? text.match(
    /(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})[^\n]{0,20}(?:ITP|INSPEC[TȚ]IE|RAR)/i
  );
  if (itpKw) {
    itpDate = `${itpKw[1]}/${itpKw[2]}`;
  } else {
    // Fallback: MM/YYYY standalone (nu parte din DD.MM.YYYY)
    const mmYyyy = text.match(/(?<!\d[.\/])(0[1-9]|1[0-2])[.\/](20[2-9]\d)(?!\d)/);
    if (mmYyyy) itpDate = `${mmYyyy[1]}/${mmYyyy[2]}`;
  }

  let itpIso: string | undefined;
  if (itpDate) {
    const [mm, yyyy] = itpDate.split('/');
    const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate();
    const dd = String(lastDay).padStart(2, '0');
    itpIso = `${yyyy}-${mm}-${dd}`;
    meta['itp_expiry_date'] = `${dd}.${mm}.${yyyy}`; // ZZ.LL.AAAA
  }

  return { metadata: meta, expiry_date: itpIso };
}

// ─── CARTE AUTO (CIV) ────────────────────────────────────────────────────────

function extractCarteAuto(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const vin = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) meta['vin'] = vin[1];

  const d1 = text.match(/D\.?1\s*[:\s]*\n?\s*([A-Z][A-Z\s\-\/]{1,40})/im);
  if (d1) {
    const parts = d1[1].trim().split(/\s*\/\s*/);
    meta['marca'] = parts[0].trim();
    if (parts[1]) meta['model'] = parts[1].trim();
  }

  // B = data primei înmatriculări → an fabricație
  const bField = text.match(/\bB\s*[:\s]\s*(\d{2}[.\/\-]\d{2}[.\/\-]\d{4})/i);
  if (bField) {
    const yr = bField[1].match(/\d{4}/);
    if (yr) meta['an_fabricatie'] = yr[0];
  }

  // CIV nu expiră
  return { metadata: meta };
}

// ─── RCA ─────────────────────────────────────────────────────────────────────

const ROMANIAN_INSURERS = [
  'ALLIANZ', 'GROUPAMA', 'GENERALI', 'OMNIASIG', 'UNIQA', 'ASIROM',
  'GRAWE', 'SIGNAL IDUNA', 'EUROINS', 'AXERIA', 'CITY INSURANCE',
  'METROPOLITAN', 'GARANTA', 'AXA', 'CERTASIG',
];

function detectInsurer(text: string): string | undefined {
  const tu = text.toUpperCase();
  for (const ins of ROMANIAN_INSURERS) {
    if (tu.includes(ins)) return ins;
  }
  return undefined;
}

function extractRca(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const policy = text.match(/(?:poli[tț][aă]|contract|serie[:\s]+nr\.?)\s*[:\s]+([A-Z0-9\-\/]{5,30})/i);
  if (policy) meta['policy_number'] = policy[1].trim();

  const insurer = detectInsurer(text);
  if (insurer) meta['insurer'] = insurer;

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|data\s*expir|p[âa]n[ăa]\s*la/i);
  const issue = findDateNear(text, /data\s*emit|data\s*[îi]nchei|[îi]ncepere\s*valabilitate/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── ITP ─────────────────────────────────────────────────────────────────────

function extractItp(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const station = text.match(/(?:sta[tț]ie\s*ITP|RAR|autorizat[aă])[:\s]+([^\n]{5,60})/i);
  if (station) meta['statie_itp'] = station[1].trim();

  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|urm[aă]toarea\s*inspec[tț]ie/i);
  const issue = findDateNear(text, /data\s*inspec[tț]iei?/i);

  return { metadata: meta, expiry_date: expiry, issue_date: issue };
}

// ─── VIGNETĂ ─────────────────────────────────────────────────────────────────

function extractVigneta(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const plate = extractPlateNumber(text);
  if (plate) meta['plate'] = plate;

  const period = text.match(/\b(7\s*zile|30\s*zile|90\s*zile|1\s*an|anual[aă]?)\b/i);
  if (period) meta['tip_vigneta'] = period[1].replace(/\s+/g, ' ');

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

  const suma = text.match(/(?:total\s*impozit|sum[aă]\s*de\s*plat[aă]|sum[aă]\s*anual[aă]?)[:\s]+(\d+[.,]?\d*)\s*(?:RON|LEI)/i);
  if (suma) meta['amount'] = suma[1].replace(',', '.');

  const issue = findDateNear(text, /data\s*emiter|emis/i);

  return { metadata: meta, issue_date: issue };
}

// ─── FACTURĂ ─────────────────────────────────────────────────────────────────

function extractFactura(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const invNr = text.match(/(?:factur[aă]\s*nr\.?\s*|nr\.?\s*factur[aă]\s*|invoice\s*(?:no\.?|nr\.?)\s*)([A-Z0-9\-\/]+)/i);
  if (invNr) meta['invoice_number'] = invNr[1].trim();

  const supplier = text.match(/(?:furnizor|emitent|v[âa]nz[aă]tor)[:\s]+([^\n]{5,60})/i);
  if (supplier) meta['supplier'] = supplier[1].trim();

  const amountPatterns = [
    /total\s*(?:de\s*plat[aă])?\s*[:\s]+(\d+[.,]\d{2})/i,
    /sum[aă]\s*total[aă]?\s*[:\s]+(\d+[.,]\d{2})/i,
    /(\d+[.,]\d{2})\s*(?:RON|ron|lei|LEI|EUR)/,
  ];
  for (const p of amountPatterns) {
    const m = text.match(p);
    if (m) { meta['amount'] = m[1].replace(',', '.'); break; }
  }

  const issue = findDateNear(text, /data\s*factur[ii]|data\s*emiter/i);
  const due = findDateNear(text, /scaden[tț][aă]|termen\s*plat[aă]/i);

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

// ─── GARANȚIE ────────────────────────────────────────────────────────────────

function extractGarantie(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const prod = text.match(/(?:produs|denumire|articol)[:\s]+([^\n]{5,60})/i);
  if (prod) meta['product_name'] = prod[1].trim();

  const brand = text.match(/(?:marc[aă]|brand|produc[aă]tor)[:\s]+([^\n]{3,40})/i);
  if (brand) meta['brand'] = brand[1].trim();

  const serial = text.match(/(?:serial|serie|s\/n)[:\s]+([A-Z0-9\-]{5,30})/i);
  if (serial) meta['serie_produs'] = serial[1].trim();

  const issue = findDateNear(text, /data\s*achizi[tț]iei|cump[aă]rat/i);
  const expiry = findDateNear(text, /garan[tț]ie\s*p[âa]n[ăa]\s*la|valabil[ăa]?\s*p[âa]n[ăa]\s*la/i);

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────

function extractContract(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const nr = text.match(/(?:contract\s*nr\.?|nr\.?\s*contract)[:\s]+([A-Z0-9\-\/]{3,25})/i);
  if (nr) meta['contract_number'] = nr[1].trim();

  const tip = text.match(/contract\s+(?:de\s+)?([a-zăâîșț\s]{5,40})(?:\s|$)/i);
  if (tip) meta['tip_contract'] = tip[1].trim();

  const issue = findDateNear(text, /[îi]ncheiat\s*(?:ast[aă]zi|la\s*data)|data\s*semn[aă]rii/i);
  const expiry = findDateNear(text, /valabil[ăa]?\s*p[âa]n[ăa]\s*la|[îi]nceteaz[aă]/i);

  return { metadata: meta, issue_date: issue, expiry_date: expiry };
}

// ─── ABONAMENT ───────────────────────────────────────────────────────────────

function extractAbonament(text: string): ExtractResult {
  const meta: Record<string, string> = {};

  const providers = ['DIGI', 'ORANGE', 'VODAFONE', 'TELEKOM', 'RCS', 'RDS', 'COSMOTE',
    'UPC', 'NETFLIX', 'SPOTIFY', 'HBO', 'DISNEY', 'AMAZON'];
  const tu = text.toUpperCase();
  for (const p of providers) {
    if (tu.includes(p)) { meta['service_name'] = p; break; }
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

  const medic = text.match(/(?:Dr\.?|doctor|medic\s*prescriptor)[:\s.]+([A-ZĂÂÎȘȚ][a-zăâîșțA-Z\s\-\.]{3,50})/i);
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
      if (tu.includes(l)) { meta['lab'] = l; break; }
    }
  }

  const nr = text.match(/(?:nr\.?\s*buletin|nr\.?\s*raport|buletin\s*nr\.?|raport\s*nr\.?)[:\s]+([A-Z0-9\-]{3,20})/i);
  if (nr) meta['report_number'] = nr[1];

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

  const clinic = text.match(/(?:clinica|cabinet|spital)[:\s]+([^\n]{5,60})/i);
  if (clinic) meta['clinic_name'] = clinic[1].trim();

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

  const rc = text.match(/(?:nr\.?\s*reg\.?\s*com\.?|reg\.?\s*com)[:\s]+([J]\d{1,2}\/\d{4}\/\d{4})/i);
  if (rc) meta['reg_com'] = rc[1];

  const den = text.match(/(?:denumire|societate|firm[aă])[:\s]+([^\n]{5,80})/i);
  if (den) meta['denumire'] = den[1].trim();

  const issue = findDateNear(text, /data\s*[îi]nregistr[aă]rii|emis/i);

  return { metadata: meta, issue_date: issue };
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
    case 'buletin':                  return extractBuletin(text);
    case 'pasaport':                 return extractPasaport(text);
    case 'permis_auto':              return extractPermisAuto(text);
    case 'talon':                    return extractTalonDoc(text);
    case 'carte_auto':               return extractCarteAuto(text);
    case 'rca':                      return extractRca(text);
    case 'itp':                      return extractItp(text);
    case 'vigneta':                  return extractVigneta(text);
    case 'casco':                    return extractCasco(text);
    case 'pad':                      return extractPad(text);
    case 'factura':                  return extractFactura(text);
    case 'bon_cumparaturi':          return extractBonCumparaturi(text);
    case 'garantie':                 return extractGarantie(text);
    case 'contract':                 return extractContract(text);
    case 'act_proprietate':          return extractActProprietate(text);
    case 'cadastru':                 return extractCadastru(text);
    case 'impozit_proprietate':      return extractImpozitProprietate(text);
    case 'abonament':                return extractAbonament(text);
    case 'stingator_incendiu':       return extractStingator(text);
    case 'reteta_medicala':          return extractReteta(text);
    case 'analize_medicale':         return extractAnalize(text);
    case 'vaccin_animal':            return extractVaccinAnimal(text);
    case 'deparazitare':             return extractDeparazitare(text);
    case 'vizita_vet':               return extractVizitaVet(text);
    case 'certificat_inregistrare':  return extractCertificatInregistrare(text);
    default:                         return extractGeneric(text);
  }
}
