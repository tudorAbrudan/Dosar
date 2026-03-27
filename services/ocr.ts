import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { DocumentType } from '@/types';

export interface OcrResult {
  text: string; // tot textul extras
  blocks: string[]; // blocuri separate de text
}

/**
 * Extrage text dintr-o imagine locală.
 * @param imageUri - URI local (file:// sau path direct)
 */
export async function extractText(imageUri: string): Promise<OcrResult> {
  const result = await TextRecognition.recognize(imageUri);
  const blocks = result.blocks.map(b => b.text).filter(t => t.trim().length > 0);
  return {
    text: result.text,
    blocks,
  };
}

/**
 * Extrage ultimele 4 cifre și data de expirare dintr-un text (pentru carduri).
 * Returnează { last4, expiry } sau null dacă nu găsește.
 */
export function extractCardInfo(text: string): { last4?: string; expiry?: string } {
  const result: { last4?: string; expiry?: string } = {};

  // Ultimele 4 cifre (pattern: 4 cifre consecutive, de obicei la final de grup)
  const cardPattern = /\b(\d{4})\s*$/m;
  const cardMatch = text.match(cardPattern);
  if (cardMatch) result.last4 = cardMatch[1];

  // Data expirare format MM/YY sau MM/YYYY
  const expiryPattern = /\b(0[1-9]|1[0-2])\s*[\/\-]\s*(\d{2,4})\b/;
  const expiryMatch = text.match(expiryPattern);
  if (expiryMatch) result.expiry = `${expiryMatch[1]}/${expiryMatch[2].slice(-2)}`;

  return result;
}

export interface FuelInfo {
  liters?: number;
  km?: number;
  price?: number;
  date?: string;  // AAAA-LL-ZZ dacă găsit
}

/**
 * Extrage informații dintr-un bon de motorină (OCR text).
 * Detectează litri, km total (odometru), prețul total și data.
 */
export function extractFuelInfo(text: string): FuelInfo {
  const result: FuelInfo = {};
  const normalized = text.replace(/,/g, '.');  // normalizează virgulă → punct

  // Litri: "50.23 L", "50.23l", "Cantitate: 50.23", "50.23 litri"
  const litersPatterns = [
    /(\d+\.?\d*)\s*[Ll](?:itri?)?(?:\b|$)/,
    /[Cc]antitate\s*:?\s*(\d+\.?\d*)/,
    /[Qq]uantity\s*:?\s*(\d+\.?\d*)/,
  ];
  for (const p of litersPatterns) {
    const m = normalized.match(p);
    if (m) { result.liters = parseFloat(m[1]); break; }
  }

  // Preț total: "250.50 RON", "Total: 250.50", "Suma: 250.50 lei"
  const pricePatterns = [
    /[Tt]otal\s*:?\s*(\d+\.?\d*)/,
    /[Ss]uma\s*:?\s*(\d+\.?\d*)/,
    /(\d+\.?\d*)\s*(?:RON|ron|lei|LEI)/,
  ];
  for (const p of pricePatterns) {
    const m = normalized.match(p);
    if (m) { result.price = parseFloat(m[1]); break; }
  }

  // KM odometru: "KM: 125430", "km 125430", număr de 5-6 cifre precedat de km/KM
  const kmPatterns = [
    /[Kk][Mm]\s*:?\s*(\d{5,6})/,
    /[Oo]dometru\s*:?\s*(\d{5,6})/,
    /(\d{5,6})\s*[Kk][Mm]/,
  ];
  for (const p of kmPatterns) {
    const m = normalized.match(p);
    if (m) { result.km = parseInt(m[1], 10); break; }
  }

  // Data: DD.MM.YYYY sau DD/MM/YYYY → convertit la AAAA-LL-ZZ
  const datePattern = /(\d{2})[.\/](\d{2})[.\/](\d{4})/;
  const dateMatch = text.match(datePattern);
  if (dateMatch) {
    result.date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  return result;
}

export interface InvoiceInfo {
  invoice_number?: string;
  supplier?: string;
  amount?: string;
  due_date?: string;
}

export function extractInvoiceInfo(text: string): InvoiceInfo {
  const result: InvoiceInfo = {};

  // Nr. factură: "Nr." sau "Factura nr." sau "Invoice"
  const invoiceMatch = text.match(/(?:factur[aă]\s*nr\.?\s*|nr\.?\s*factur[aă]\s*|invoice\s*(?:no\.?|nr\.?)\s*)([A-Z0-9\-\/]+)/i);
  if (invoiceMatch) result.invoice_number = invoiceMatch[1].trim();

  // Sumă total
  const amountPatterns = [
    /[Tt]otal\s*(?:de\s*plat[aă])?\s*:?\s*(\d+[.,]\d{2})/,
    /[Ss]uma\s*:?\s*(\d+[.,]\d{2})/,
    /(\d+[.,]\d{2})\s*(?:RON|ron|lei|LEI)/,
  ];
  for (const p of amountPatterns) {
    const m = text.match(p);
    if (m) { result.amount = m[1].replace(',', '.'); break; }
  }

  // Scadentă: "Scadentă la", "Data scadenței"
  const dueDatePatterns = [/scaden[tț][aă]\s*(?:la\s*)?(\d{2}[.\/-]\d{2}[.\/-]\d{4})/i];
  for (const p of dueDatePatterns) {
    const m = text.match(p);
    if (m) {
      const parts = m[1].match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
      if (parts) result.due_date = `${parts[3]}-${parts[2]}-${parts[1]}`;
      break;
    }
  }

  return result;
}

export function extractPlateNumber(text: string): string | undefined {
  // Format RO: BB-12-ABC, B-123-ABC, B 123 ABC
  const plateMatch = text.match(/\b([A-Z]{1,2})\s*[-]?\s*(\d{2,3})\s*[-]?\s*([A-Z]{1,3})\b/);
  if (plateMatch) return `${plateMatch[1]}-${plateMatch[2]}-${plateMatch[3]}`;
  return undefined;
}

export interface TalonInfo {
  plate?: string;
  vin?: string;
  marca?: string;
  model?: string;
  an_fabricatie?: string;
  data_prima_inmatriculare?: string;
  combustibil?: string;
  capacitate_cilindrica?: string;
  putere_kw?: string;
  culoare?: string;
  nr_locuri?: string;
  masa_totala?: string;
  norma_euro?: string;
  proprietar?: string;
  itp_expiry_date?: string;  // format MM/YYYY, din ștampila RAR
  itp_expiry_iso?: string;   // format YYYY-MM-DD pentru câmpul expiry_date
}

/**
 * Extrage câmpuri specifice din textul OCR al unui talon auto românesc.
 * Talonul RO are coduri standardizate: E=VIN, P.1=cilindree, P.2=kW, P.3=combustibil,
 * R=culoare, S.1=locuri, F.2=masă, D.1=marcă, B=prima înmatriculare, C.1.1/C.2.1=proprietar.
 * Data expirare ITP apare ca ștampilă RAR în format MM/YYYY sau MM.YYYY.
 */
export function extractTalonInfo(text: string): TalonInfo {
  const r: TalonInfo = {};

  // Nr. înmatriculare
  r.plate = extractPlateNumber(text);

  // VIN: 17 caractere alfanumerice (fără I, O, Q — dar OCR poate introduce erori)
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)
    ?? text.match(/\bE\s*[:\s]\s*([A-Z0-9]{17})\b/i);
  if (vinMatch) r.vin = vinMatch[1];

  // Marcă și model — câmp D.1 conține "MARCA / TIP" sau doar marca
  const d1Match = text.match(/D\.?1\s*[:\s]*\n?\s*([A-Z][A-Z\s\-\/]{1,40})/im);
  if (d1Match) {
    const parts = d1Match[1].trim().split(/\s*\/\s*/);
    r.marca = parts[0]?.trim();
    if (parts[1]) r.model = parts[1].trim();
  }
  // Fallback model din J.2
  if (!r.model) {
    const j2Match = text.match(/J\.?2\s*[:\s]*\n?\s*([A-Z0-9][A-Z0-9\s\-]{1,20})/im);
    if (j2Match) r.model = j2Match[1].trim();
  }

  // Capacitate cilindrică — câmp P.1 (cm³)
  const ccMatch = text.match(/P\.?1\s*[:\s]\s*(\d{3,5})/i)
    ?? text.match(/(\d{3,5})\s*cm.?3/i);
  if (ccMatch) r.capacitate_cilindrica = ccMatch[1];

  // Putere maximă — câmp P.2 (kW)
  const kwMatch = text.match(/P\.?2\s*[:\s]\s*(\d{2,4})/i)
    ?? text.match(/(\d{2,4})\s*kW/i);
  if (kwMatch) r.putere_kw = kwMatch[1];

  // Combustibil — câmp P.3
  const fuelMatch = text.match(/P\.?3\s*[:\s]*\n?\s*(BENZIN[AĂÃ]?|DIESEL|ELECTRIC|HYBRID|GPL|GNC|CNG|LPG|MOTORIN[AĂÃ]?)/i)
    ?? text.match(/\b(BENZIN[AĂÃ]?|DIESEL|ELECTRIC|HYBRID|GPL|GNC|MOTORIN[AĂÃ]?)\b/i);
  if (fuelMatch) {
    const f = fuelMatch[1].toUpperCase();
    r.combustibil = f.startsWith('BENZIN') ? 'Benzină'
      : f.startsWith('MOTORIN') || f === 'DIESEL' ? 'Diesel'
      : f === 'ELECTRIC' ? 'Electric'
      : f === 'HYBRID' ? 'Hybrid'
      : f;
  }

  // Culoare — câmp R
  const colorMatch = text.match(/\bR\s+([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s]{2,20})(?:\r?\n|$)/m);
  if (colorMatch) r.culoare = colorMatch[1].trim();

  // Nr. locuri șezut — câmp S.1
  const seatsMatch = text.match(/S\.?1\s*[:\s]\s*(\d{1,2})/i);
  if (seatsMatch) r.nr_locuri = seatsMatch[1];

  // Masă maximă autorizată — câmp F.2 (kg)
  const weightMatch = text.match(/F\.?2\s*[:\s]\s*(\d{3,5})/i);
  if (weightMatch) r.masa_totala = weightMatch[1];

  // Normă Euro — câmp V.7 sau text "EURO N"
  const euroMatch = text.match(/V\.?7\s*[:\s]*\n?\s*(EURO\s*[0-9IVX]+)/i)
    ?? text.match(/\b(EURO\s*[0-9IVX]+)\b/i);
  if (euroMatch) r.norma_euro = euroMatch[1].replace(/\s+/, ' ');

  // Data primei înmatriculări — câmp B (DD.MM.YYYY)
  const firstRegMatch = text.match(/\bB\s*[:\s]\s*(\d{2}[.\/\-]\d{2}[.\/\-]\d{4})/i);
  if (firstRegMatch) {
    r.data_prima_inmatriculare = firstRegMatch[1];
    const yearMatch = firstRegMatch[1].match(/\d{4}/);
    if (yearMatch) r.an_fabricatie = yearMatch[0];
  }

  // Proprietar — câmp C.1.1 (persoană fizică) sau C.2.1 (persoană juridică)
  const ownerMatch = text.match(/C\.?1\.?1\s*[:\s]*\n?\s*([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s\-]{2,50})/im)
    ?? text.match(/C\.?2\.?1\s*[:\s]*\n?\s*([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s\-]{2,50})/im);
  if (ownerMatch) r.proprietar = ownerMatch[1].trim();

  // Data expirare ITP — ștampila RAR, format MM/YYYY sau MM.YYYY
  // Căutare lângă cuvinte cheie: ITP, INSPECȚIE, RAR
  const itpKwMatch = text.match(
    /(?:ITP|INSPEC[TȚ]IE|RAR)[^\n]*\n?\s*(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})/i
  ) ?? text.match(
    /(0[1-9]|1[0-2])\s*[.\/\s]\s*(20\d{2})\s*(?:ITP|INSPEC[TȚ]IE|RAR)/i
  );
  if (itpKwMatch) {
    r.itp_expiry_date = `${itpKwMatch[1]}/${itpKwMatch[2]}`;
  } else {
    // Fallback: format MM/YYYY sau MM.YYYY standalone (nu parte dintr-o dată completă)
    // Evităm DD.MM.YYYY prin negative lookbehind
    const mmYyyyMatch = text.match(/(?<!\d\.)(0[1-9]|1[0-2])[.\/](20[2-9]\d)(?!\d)/);
    if (mmYyyyMatch) r.itp_expiry_date = `${mmYyyyMatch[1]}/${mmYyyyMatch[2]}`;
  }

  // Convertim itp_expiry_date (MM/YYYY) → YYYY-MM-DD (ultima zi a lunii)
  if (r.itp_expiry_date) {
    const [mm, yyyy] = r.itp_expiry_date.split('/');
    const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate();
    r.itp_expiry_iso = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
  }

  return r;
}

export interface DocumentInfo {
  cnp?: string;          // 13 cifre
  expiry_date?: string;  // format AAAA-LL-ZZ
  issue_date?: string;   // format AAAA-LL-ZZ
  series?: string;       // seria documentului (ex. "RR 123456", "RT123456")
  name?: string;         // NUME + PRENUME concatenate
  rawText?: string;      // textul brut pentru debugging
}

interface MrzData {
  dob?: string;       // AAAA-LL-ZZ
  expiry?: string;    // AAAA-LL-ZZ
  documentNumber?: string;
}

function parseMrz(text: string): MrzData {
  const result: MrzData = {};

  // Convertire YYMMDD → AAAA-LL-ZZ
  function mrzDateToIso(yymmdd: string): string {
    const yy = parseInt(yymmdd.slice(0, 2), 10);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    // Heuristică: dacă yy > 50 → 1900s, altfel 2000s
    // (buletine emise acum au expiry max 2031–2035, deci yy=31..35 → 2000s)
    const year = yy > 50 ? 1900 + yy : 2000 + yy;
    return `${year}-${mm}-${dd}`;
  }

  // MRZ: linii de 20+ caractere conținând doar litere mari, cifre și '<'
  const mrzLines = text.split('\n')
    .map(l => l.replace(/\s/g, ''))
    .filter(l => /^[A-Z0-9<]{20,}$/.test(l));

  for (const line of mrzLines) {
    // Pattern MRZ linia 2: YYMMDD urmat de cifră check, gen M/F/<, YYMMDD urmat de cifră check
    const mrzMatch = line.match(/(\d{6})[0-9M]([MF<])(\d{6})[0-9]/);
    if (mrzMatch) {
      result.dob = mrzDateToIso(mrzMatch[1]);
      result.expiry = mrzDateToIso(mrzMatch[3]);
      break;
    }

    // Fallback: 2+ secvențe de 6 cifre în linie MRZ → probabil DOB și expiry
    const dateMatches = [...line.matchAll(/(\d{6})/g)];
    if (dateMatches.length >= 2) {
      for (const m of dateMatches) {
        const mm = parseInt(m[1].slice(2, 4), 10);
        if (mm >= 1 && mm <= 12) {
          if (!result.dob) {
            result.dob = mrzDateToIso(m[1]);
          } else if (!result.expiry) {
            result.expiry = mrzDateToIso(m[1]);
            break;
          }
        }
      }
      if (result.dob && result.expiry) break;
    }
  }

  return result;
}

/**
 * Extrage informații din text OCR al unui document românesc (buletin, pașaport, etc.)
 */
export function extractDocumentInfo(text: string): DocumentInfo {
  const result: DocumentInfo = { rawText: text };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Parsare MRZ — sursă de adevăr pentru DOB și expiry pe buletin
  const mrz = parseMrz(text);
  // Pre-populăm expiry din MRZ dacă disponibil
  if (mrz.expiry) result.expiry_date = mrz.expiry;

  // CNP: exact 13 cifre consecutive
  const cnpMatch = text.match(/\b([1-9]\d{12})\b/);
  if (cnpMatch) result.cnp = cnpMatch[1];

  // Date format: DD.MM.YYYY sau DD/MM/YYYY → conversie la AAAA-LL-ZZ
  function parseDate(s: string): string | undefined {
    const m = s.match(/(\d{2})[.\/\-](\d{2})[.\/\-](\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return undefined;
  }

  // Data expirare: "Valabilă până la", "Valabil până la", "Valid until", "Expiry", "EXPIRY DATE"
  // (keywords au prioritate față de MRZ — mai precis pe alte doc-uri)
  const expiryKeywords = /valabil[ăa]\s+p[âa]n[ăa]\s+la|valid\s+until|expiry\s+date?|exp[.:]/i;
  for (let i = 0; i < lines.length; i++) {
    if (expiryKeywords.test(lines[i])) {
      const dateOnSame = parseDate(lines[i]);
      if (dateOnSame) { result.expiry_date = dateOnSame; break; }
      if (i + 1 < lines.length) {
        const dateNext = parseDate(lines[i + 1]);
        if (dateNext) { result.expiry_date = dateNext; break; }
      }
    }
  }
  // Fallback: dacă nu s-a găsit expiry prin keywords și nici MRZ, ia ULTIMA dată din document
  if (!result.expiry_date) {
    const allDates = [...text.matchAll(/(\d{2})[.\/\-](\d{2})[.\/\-](\d{4})/g)];
    if (allDates.length > 0) {
      const last = allDates[allDates.length - 1];
      result.expiry_date = `${last[3]}-${last[2]}-${last[1]}`;
    }
  }

  // Data emitere: "Eliberat la", "Data emiterii", "Date of issue"
  const issueKeywords = /eliberat\s+la|data\s+emiterii?|date\s+of\s+issue/i;
  for (let i = 0; i < lines.length; i++) {
    if (issueKeywords.test(lines[i])) {
      const dateOnSame = parseDate(lines[i]);
      if (dateOnSame) { result.issue_date = dateOnSame; break; }
      if (i + 1 < lines.length) {
        const dateNext = parseDate(lines[i + 1]);
        if (dateNext) { result.issue_date = dateNext; break; }
      }
    }
  }
  // Fallback îmbunătățit: dacă avem 3 date (DOB, emitere, expirare),
  // excludem expiry și DOB din MRZ și luăm cea mai recentă dată rămasă
  if (!result.issue_date) {
    const allDates = [...text.matchAll(/(\d{2})[.\/\-](\d{2})[.\/\-](\d{4})/g)];
    const parsedDates = allDates.map(m => `${m[3]}-${m[2]}-${m[1]}`);
    const uniqueDates = [...new Set(parsedDates)].sort();
    // Exclude expiry și DOB din MRZ
    const candidates = uniqueDates.filter(d =>
      d !== result.expiry_date &&
      d !== mrz.dob
    );
    if (candidates.length > 0) {
      // Ia cea mai recentă dată dintre candidați (probabil data emiterii)
      result.issue_date = candidates[candidates.length - 1];
    } else if (uniqueDates.length >= 2) {
      // Fallback final: penultima dată (diferită de expiry)
      const nonExpiry = uniqueDates.filter(d => d !== result.expiry_date);
      if (nonExpiry.length > 0) result.issue_date = nonExpiry[nonExpiry.length - 1];
    }
  }

  // Seria documentului: "RR 123456", "XB123456", "IF 123456" etc.
  // Pattern: 2 litere mari + spațiu opțional + 6 cifre
  const seriesMatch = text.match(/\b([A-Z]{2})\s*(\d{6})\b/);
  if (seriesMatch) result.series = `${seriesMatch[1]} ${seriesMatch[2]}`;

  // Nume: caută linii cu text ALL CAPS de minim 3 caractere, ignorând cuvinte comune
  const ignoredWords = new Set(['ROMANIA', 'ROMÂNÂ', 'CARTE', 'IDENTITATE', 'BULETIN', 'CNP', 'SERIA', 'NR', 'SEX', 'MF', 'M', 'F']);
  const capsLines = lines.filter(l => {
    const words = l.split(/\s+/);
    return words.length >= 1 &&
      words.every(w => /^[A-ZĂÂÎȘȚ\-]+$/.test(w)) &&
      l.length >= 4 &&
      !ignoredWords.has(l.toUpperCase().trim()) &&
      !/^\d+$/.test(l);
  });
  // Primele 1-2 linii ALL CAPS care nu sunt CNP/serie sunt probabil Nume + Prenume
  const nameLines = capsLines.filter(l => !/\d/.test(l)).slice(0, 2);
  if (nameLines.length > 0) result.name = nameLines.join(' ');

  return result;
}

/**
 * Detectează tipul documentului din textul OCR.
 * Returnează tipul detectat sau null dacă nu e sigur.
 */
export function detectDocumentType(text: string): DocumentType | null {
  const t = text.toLowerCase();

  if (/carte de identitate|buletin de identitate|c\.i\.|identity card/.test(t)) return 'buletin';
  if (/pa[sş]aport|passport/.test(t)) return 'pasaport';
  if (/permis de conducere|driving licen[sc]e/.test(t)) return 'permis_auto';
  if (/asigurare.*obligatorie|r\.c\.a\.|asigurare rca|\brca\b/.test(t)) return 'rca';
  if (/\bcasco\b/.test(t)) return 'casco';
  if (/inspec[tț]ie tehnic[aă]|inspec[tț]ie periodic[aă]|\bitp\b/.test(t)) return 'itp';
  if (/vignet[aă]|rovinieta/.test(t)) return 'vigneta';
  if (/carte de identitate a vehiculului|\bciv\b/.test(t)) return 'carte_auto';
  if (/\btalon\b|certificat de [îi]nmatriculare/.test(t)) return 'talon';
  if (/act de proprietate|contract de v[âa]nzare[\-\s]cump[aă]rare/.test(t)) return 'act_proprietate';
  if (/num[aă]r cadastral|extras de carte funciar[aă]/.test(t)) return 'cadastru';
  if (/asigurare.*dezastre|politi[aă] pad|\bpad\b/.test(t)) return 'pad';
  if (/factur[aă]|invoice/.test(t)) return 'factura';
  if (/impozit.*proprietate|tax.*property/.test(t)) return 'impozit_proprietate';
  if (/contract/.test(t)) return 'contract';
  if (/garantie|garan[tț]ie|warranty|certificat de garan[tț]ie/.test(t)) return 'garantie';
  if (/re[tț]et[aă] medical[aă]|re[tț]et[aă]/.test(t)) return 'reteta_medicala';
  if (/analize|laborator|rezultate.*analize/.test(t)) return 'analize_medicale';
  if (/bon fiscal|chitant[aă]|receipt/.test(t)) return 'bon_cumparaturi';
  if (/bilet|ticket|boarding pass/.test(t)) return 'bilet';
  if (/abonament|subscri/.test(t)) return 'abonament';
  if (/stingator|extinctor/.test(t)) return 'stingator_incendiu';
  if (/vaccin|vaccinare/.test(t)) return 'vaccin_animal';
  if (/deparazitare|antiparazitar/.test(t)) return 'deparazitare';
  if (/consultat|veterinar|clinica veterinara/.test(t)) return 'vizita_vet';

  return null;
}

/**
 * Formatează toate informațiile extrase din OCR ca text pentru câmpul descriere/notă.
 */
export function formatOcrSummary(text: string, info: DocumentInfo): string {
  const parts: string[] = [];
  if (info.name) parts.push(`Nume: ${info.name}`);
  if (info.cnp) parts.push(`CNP: ${info.cnp}`);
  if (info.series) parts.push(`Seria: ${info.series}`);
  if (info.issue_date) parts.push(`Emis: ${info.issue_date}`);
  if (info.expiry_date) parts.push(`Expiră: ${info.expiry_date}`);
  // Fallback: dacă nu avem date structurate, pune text brut filtrat (fără linii MRZ)
  if (parts.length === 0 && text.trim()) {
    const clean = text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2 && !/^[A-Z0-9<]{10,}$/.test(l.replace(/\s/g, '')))
      .join(' ')
      .trim()
      .slice(0, 200);
    if (clean) parts.push(clean);
  }
  return parts.join(' | ');
}
