import { getPersons, getProperties, getVehicles, getCards, getAnimals } from './entities';
// `getDocumentsForAI` strips private_notes. NU folosi `getDocuments` aici —
// vezi `.claude/rules/ai-privacy.md`.
import { getDocumentsForAI } from './documents';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, Document, Vehicle, EntityType } from '@/types';
import { buildAppKnowledge } from './appKnowledge';
import { sendAiRequest } from './aiProvider';
import type { AiMessage } from './aiProvider';
import { getFuelRecords, computeFuelStats } from './fuel';
import { getMaintenanceTasks, computeTaskStatus, getCurrentKm } from './maintenance';
import { getVisibleEntityTypes } from './settings';
import { getTransactions, getCategoryBreakdown, type CategoryBreakdownItem } from './transactions';
import { getCategories } from './categories';
import { getFinancialAccounts } from './financialAccounts';
import type { CategoryKey } from '@/types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Filtrare context ─────────────────────────────────────────────────────────

/**
 * Extrage ID-urile entităților menționate din prefixul adăugat de chat.tsx.
 * Format: "[Context mențiuni: @Nume = Tip (ID: abc123), ...]"
 */
function extractMentionedIds(text: string): Set<string> {
  const ids = new Set<string>();
  const prefixMatch = text.match(/^\[Context mențiuni: ([^\]]+)\]/);
  if (!prefixMatch) return ids;
  const matches = prefixMatch[1].matchAll(/\(ID: ([^)]+)\)/g);
  for (const m of matches) ids.add(m[1]);
  return ids;
}

/**
 * Mapare cuvinte cheie din limbaj natural → tipuri de documente.
 * Normalizat la lowercase fără diacritice pentru matching robust.
 */
const KEYWORD_TO_TYPES: Array<{ keywords: string[]; types: DocumentType[] }> = [
  { keywords: ['buletin', 'ci', 'carte identitate', 'identitate'], types: ['buletin'] },
  { keywords: ['pasaport', 'pașaport', 'passport'], types: ['pasaport'] },
  { keywords: ['permis', 'sofer', 'șofer'], types: ['permis_auto'] },
  { keywords: ['talon', 'inmatriculare', 'înmatriculare'], types: ['talon'] },
  { keywords: ['carte auto', 'civ'], types: ['carte_auto'] },
  { keywords: ['rca', 'asigurare obligatorie', 'asigurare auto'], types: ['rca'] },
  { keywords: ['casco'], types: ['casco'] },
  { keywords: ['itp', 'inspectie tehnica', 'inspecție tehnică'], types: ['itp'] },
  { keywords: ['vigneta', 'vignetă', 'rovinieta'], types: ['vigneta'] },
  { keywords: ['factura', 'factură', 'invoice'], types: ['factura'] },
  { keywords: ['contract'], types: ['contract'] },
  { keywords: ['garantie', 'garanție', 'warranty'], types: ['garantie'] },
  { keywords: ['reteta', 'rețetă', 'prescriptie', 'prescripție'], types: ['reteta_medicala'] },
  { keywords: ['analize', 'laborator', 'rezultate'], types: ['analize_medicale'] },
  { keywords: ['pad', 'asigurare locuinta', 'asigurare locuință'], types: ['pad'] },
  { keywords: ['vaccin', 'vaccinare'], types: ['vaccin_animal'] },
  { keywords: ['deparazitare', 'antiparazitar'], types: ['deparazitare'] },
  { keywords: ['veterinar', 'vet', 'consultatie', 'consultație'], types: ['vizita_vet'] },
  { keywords: ['bilet', 'zbor', 'avion', 'tren', 'concert'], types: ['bilet'] },
  { keywords: ['abonament'], types: ['abonament'] },
  { keywords: ['impozit'], types: ['impozit_proprietate'] },
  { keywords: ['act proprietate', 'proprietate'], types: ['act_proprietate'] },
  { keywords: ['cadastru'], types: ['cadastru'] },
  { keywords: ['bon', 'chitanta', 'chitanță'], types: ['bon_cumparaturi', 'bon_parcare'] },
  { keywords: ['stingator', 'stingător'], types: ['stingator_incendiu'] },
  {
    keywords: ['expira', 'expiră', 'expirare', 'scadenta', 'scadență', 'valabil'],
    types: [],
  }, // special: returnează toate documentele cu dată expirare
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Cuvinte comune care nu ajută la căutare
const STOP_WORDS = new Set([
  'ce',
  'care',
  'cum',
  'cand',
  'când',
  'unde',
  'de',
  'la',
  'in',
  'în',
  'pe',
  'cu',
  'și',
  'si',
  'sau',
  'dar',
  'ca',
  'sa',
  'să',
  'nu',
  'este',
  'e',
  'are',
  'am',
  'al',
  'ale',
  'ai',
  'un',
  'o',
  'unei',
  'unui',
  'mi',
  'îmi',
  'imi',
  'iti',
  'îți',
  'mai',
  'fi',
  'fii',
  'fost',
  'fi',
  'pot',
  'poti',
  'poți',
  'vrea',
  'vreau',
  'imi',
  'spune',
  'spui',
  'arata',
  'arată',
  'gaseste',
  'găsește',
  'cauta',
  'caută',
]);

/**
 * Extrage termeni de căutare semnificativi din mesajul userului.
 * Elimină prefixul de mențiuni, stop words și cuvinte prea scurte.
 */
function extractSearchTerms(message: string): string[] {
  const clean = message.replace(/^\[Context mențiuni:[^\]]*\]\n?/, '');
  const norm = normalize(clean);
  return norm
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Găsește documentele ale căror OCR conține termenii de căutare.
 * Caută în OCR-ul COMPLET, nu în versiunea trunchiată.
 * Returnează un Set cu ID-urile documentelor relevante.
 */
function findDocsByOcrSearch(docs: Document[], searchTerms: string[]): Set<string> {
  if (searchTerms.length === 0) return new Set();
  const matched = new Set<string>();
  for (const doc of docs) {
    if (!doc.ocr_text) continue;
    const ocrNorm = normalize(doc.ocr_text);
    if (searchTerms.some(term => ocrNorm.includes(term))) {
      matched.add(doc.id);
    }
  }
  return matched;
}

// ─── Detecție domeniu pentru context vehicule ────────────────────────────────
//
// Pentru a evita umflarea contextului cu date despre carburant/mentenanță/km
// pentru toate vehiculele de fiecare dată, detectăm intenția mesajului și
// includem doar secțiunile relevante.

type VehicleDomain = 'fuel' | 'maintenance' | 'km';

const KEYWORD_TO_DOMAIN: Array<{ keywords: string[]; domain: VehicleDomain }> = [
  {
    keywords: [
      'consum',
      'litri',
      'litru',
      'alimentare',
      'alimentat',
      'benzina',
      'motorina',
      'plin',
      'bon carburant',
      'bon combustibil',
      'carburant',
      'combustibil',
      'benzinarie',
      'benzinărie',
    ],
    domain: 'fuel',
  },
  {
    keywords: [
      'service',
      'revizie',
      'mentenanta',
      'ulei',
      'filtru',
      'placu',
      'distributie',
      'anvelope',
      'frana',
      'curea',
    ],
    domain: 'maintenance',
  },
  {
    keywords: ['km', 'kilometr', 'parcurs', 'odometru', 'kilometraj'],
    domain: 'km',
  },
];

function detectDomains(text: string): Set<VehicleDomain> {
  const norm = normalize(text);
  const out = new Set<VehicleDomain>();
  for (const { keywords, domain } of KEYWORD_TO_DOMAIN) {
    if (keywords.some(kw => norm.includes(normalize(kw)))) out.add(domain);
  }
  return out;
}

/**
 * Detectează tipurile de documente relevante din textul mesajului.
 * Returnează null dacă nu detectează nimic specific (= trimite toate).
 */
function detectRelevantTypes(text: string): DocumentType[] | null {
  const norm = normalize(text);
  const types = new Set<DocumentType>();

  for (const { keywords, types: docTypes } of KEYWORD_TO_TYPES) {
    if (keywords.some(kw => norm.includes(normalize(kw)))) {
      if (docTypes.length === 0) return null; // "expirare" → toate
      docTypes.forEach(t => types.add(t));
    }
  }

  return types.size > 0 ? Array.from(types) : null;
}

/**
 * Colectează ID-urile entităților menționate din ultimele N mesaje din istoric.
 * Propagă contextul @mențiunilor prin conversație.
 */
function collectHistoryMentions(history: ChatMessage[], lastN = 6): Set<string> {
  const ids = new Set<string>();
  const recent = history.slice(-lastN);
  for (const msg of recent) {
    if (msg.role === 'user') {
      extractMentionedIds(msg.content).forEach(id => ids.add(id));
    }
  }
  return ids;
}

// ─── Construire context filtrat ───────────────────────────────────────────────

const MAX_DOCS_FULL = 80; // fără filtrare: max 80 doc
const MAX_DOCS_FILTERED = 40; // cu filtrare: mai mult spațiu per doc
const NOTE_LIMIT = 500; // caractere notă AI (date distilate, prioritare)
const OCR_LIMIT = 1000; // caractere OCR pentru orice document
const OCR_LIMIT_FULL = 3000; // doc găsit prin căutare text — OCR complet

// Sumarizare per vehicul: dacă 5+ vehicule și user nu a @menționat unul anume,
// sumarizez agresiv (fără ultimele 5 bonuri).
const COMPACT_SUMMARY_THRESHOLD = 5;

function fmtDateRo(iso?: string): string {
  if (!iso) return '?';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function vehicleTag(v: Vehicle): string {
  return `[ENT:${v.name}|vehicle|${v.id}]`;
}

async function buildFuelSummary(vehicleList: Vehicle[], compact: boolean): Promise<string> {
  if (vehicleList.length === 0) return '';
  const lines: string[] = ['Carburant:'];
  for (const v of vehicleList) {
    const stats = await computeFuelStats(v.id);
    if (stats.totalRecords === 0) {
      lines.push(`- ${vehicleTag(v)}: nicio înregistrare`);
      continue;
    }
    const consum =
      stats.avgConsumptionL100 !== undefined
        ? `${stats.avgConsumptionL100.toFixed(1)} L/100km`
        : 'consum necalculat';
    const km = stats.latestKm !== undefined ? `${stats.latestKm.toLocaleString('ro-RO')} km` : '?';
    const sum = `- ${vehicleTag(v)}: ${stats.totalRecords} bonuri, ${stats.totalLiters.toFixed(0)}L total, ${consum}, ultim km ${km}, cost total ${stats.totalCost.toFixed(0)} RON`;
    lines.push(sum);

    if (!compact) {
      const records = await getFuelRecords(v.id);
      const recent = records.slice(0, 5);
      if (recent.length > 0) {
        for (const r of recent) {
          const parts: string[] = [fmtDateRo(r.date)];
          if (r.station) parts.push(r.station);
          if (r.liters !== undefined) parts.push(`${r.liters.toFixed(2)}L`);
          if (r.km_total !== undefined) parts.push(`${r.km_total.toLocaleString('ro-RO')}km`);
          if (r.price !== undefined) parts.push(`${r.price.toFixed(2)} RON`);
          if (!r.is_full) parts.push('(parțial)');
          lines.push(`    · ${parts.join(' | ')}`);
        }
      }
    }
  }
  return lines.join('\n');
}

async function buildMaintenanceSummary(vehicleList: Vehicle[]): Promise<string> {
  if (vehicleList.length === 0) return '';
  const lines: string[] = ['Mentenanță:'];
  for (const v of vehicleList) {
    const tasks = await getMaintenanceTasks(v.id);
    if (tasks.length === 0) {
      lines.push(`- ${vehicleTag(v)}: niciun task setat`);
      continue;
    }
    const currentKm = await getCurrentKm(v.id);
    lines.push(`- ${vehicleTag(v)} (${tasks.length} task-uri):`);
    for (const t of tasks) {
      const status = computeTaskStatus(t, currentKm);
      const last =
        t.last_done_date || t.last_done_km !== undefined
          ? `ultim ${fmtDateRo(t.last_done_date)}${t.last_done_km !== undefined ? ` la ${t.last_done_km.toLocaleString('ro-RO')} km` : ''}`
          : 'niciodată efectuat';
      const trigger: string[] = [];
      if (t.trigger_km != null) trigger.push(`${t.trigger_km.toLocaleString('ro-RO')} km`);
      if (t.trigger_months != null) trigger.push(`${t.trigger_months} luni`);
      lines.push(
        `    · ${t.name}: ${last}, prag ${trigger.join(' / ') || '?'}, status ${status.status} (${status.dueMessage})`
      );
    }
  }
  return lines.join('\n');
}

async function buildKmSummary(vehicleList: Vehicle[]): Promise<string> {
  if (vehicleList.length === 0) return '';
  const lines: string[] = ['Kilometraj curent:'];
  for (const v of vehicleList) {
    const km = await getCurrentKm(v.id);
    if (km == null) {
      lines.push(`- ${vehicleTag(v)}: km necunoscut (nicio înregistrare)`);
    } else {
      lines.push(`- ${vehicleTag(v)}: ${km.toLocaleString('ro-RO')} km`);
    }
  }
  return lines.join('\n');
}

// ─── Detecție intent + perioadă financiară ───────────────────────────────────

const FINANCE_KEYWORDS = [
  'cheltui',
  'cheltuit',
  'cheltuieli',
  'cheltuiala',
  'venit',
  'venituri',
  'salariu',
  'incasari',
  'încasări',
  'sold',
  'balanta',
  'balanță',
  'tranzactie',
  'tranzacții',
  'tranzactii',
  'categorie',
  'categorii',
  'buget',
  'bugetul',
  'cont bancar',
  'conturi',
  'contul',
  'iban',
  'bancar',
  'plata',
  'plati',
  'plătit',
  'platit',
  'platesc',
  'plătesc',
  'cumparat',
  'cumpărat',
  'cumparaturi',
  'cumpărături',
  'achizitie',
  'achiziție',
  'extras',
  'extrase',
  'restaurant',
  'restaurante',
  'magazin',
  'magazine',
  'mancare',
  'mâncare',
  'utilitati',
  'utilități',
  'abonament',
  'abonamente',
  'curent electric',
  'gaz',
  'apa',
  'apă',
  'transport',
  'taxi',
  'uber',
  'bolt',
  'farmacie',
  'medicament',
  'cinema',
  'concert',
  'biletul', // dispute cu doc 'bilet' — rămâne, cap. context separat
  'shopping',
  'haine',
  'vacanta',
  'vacanță',
  'hotel',
  'merchant',
];

function hasFinanceIntent(text: string): boolean {
  const norm = normalize(text);
  return FINANCE_KEYWORDS.some(kw => norm.includes(normalize(kw)));
}

const RO_MONTHS: Record<string, number> = {
  ianuarie: 1,
  ian: 1,
  februarie: 2,
  feb: 2,
  martie: 3,
  mar: 3,
  aprilie: 4,
  apr: 4,
  mai: 5,
  iunie: 6,
  iun: 6,
  iulie: 7,
  iul: 7,
  august: 8,
  aug: 8,
  septembrie: 9,
  sept: 9,
  sep: 9,
  octombrie: 10,
  oct: 10,
  noiembrie: 11,
  nov: 11,
  noi: 11,
  decembrie: 12,
  dec: 12,
};

interface FinancePeriod {
  fromDate: string; // YYYY-MM-DD inclusiv
  toDate: string; // YYYY-MM-DD inclusiv
  label: string; // pentru AI context
  /** dacă e single-month, codul YYYY-MM (folosit pentru getMonthlyTotals) */
  yearMonth?: string;
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodFromMonth(year: number, month: number): FinancePeriod {
  const from = new Date(year, month - 1, 1);
  const to = endOfMonth(from);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return {
    fromDate: fmtIsoDate(from),
    toDate: fmtIsoDate(to),
    label: `${Object.keys(RO_MONTHS).find(k => RO_MONTHS[k] === month && k.length > 3) ?? `luna ${month}`} ${year}`,
    yearMonth: ym,
  };
}

/**
 * Parsează perioadă din mesaj. Suportă:
 * - „luna mai", „mai 2025", „în mai" → o lună
 * - „luna trecută", „luna anterioară" → luna precedentă
 * - „luna asta", „luna curentă" → luna curentă (default)
 * - „anul trecut" → 12 luni anul precedent
 * - „anul acesta", „anul curent" → de la 01-ian până azi
 * - „ultimele N luni" → ultimele N luni complete + curentă
 * Default: luna curentă.
 */
function parseFinancePeriod(text: string): FinancePeriod {
  const norm = normalize(text);
  const now = new Date();
  const currYear = now.getFullYear();

  // ── „anul trecut" / „anul acesta" ──
  if (/\banul\s+(trecut|anterior|precedent)\b/.test(norm)) {
    const y = currYear - 1;
    return {
      fromDate: `${y}-01-01`,
      toDate: `${y}-12-31`,
      label: `anul ${y}`,
    };
  }
  if (
    /\banul\s+(acesta|asta|curent|in\s+curs|in\s+curs)\b/.test(norm) ||
    /\banul\s+\d{4}\b/.test(norm)
  ) {
    const yearMatch = /\banul\s+(\d{4})\b/.exec(norm);
    const y = yearMatch ? parseInt(yearMatch[1], 10) : currYear;
    const isCurrent = y === currYear;
    return {
      fromDate: `${y}-01-01`,
      toDate: isCurrent ? fmtIsoDate(now) : `${y}-12-31`,
      label: isCurrent ? `anul ${y} (până azi)` : `anul ${y}`,
    };
  }

  // ── „ultimele N luni" ──
  const lastNMatch = /\bultim(ele|ii|a|ul)\s+(\d{1,2})\s+(luni|luna)\b/.exec(norm);
  if (lastNMatch) {
    const n = Math.min(24, Math.max(1, parseInt(lastNMatch[2], 10)));
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    return {
      fromDate: fmtIsoDate(start),
      toDate: fmtIsoDate(now),
      label: `ultimele ${n} luni`,
    };
  }

  // ── „luna trecută" / „luna anterioară" ──
  if (/\bluna\s+(trecut|anterior|precedent)/.test(norm)) {
    const d = new Date(currYear, now.getMonth() - 1, 1);
    return periodFromMonth(d.getFullYear(), d.getMonth() + 1);
  }

  // ── nume lună (cu sau fără an) ──
  // ex. „luna mai 2025", „mai 2025", „în mai", „pe mai"
  const monthRegex = new RegExp(`\\b(${Object.keys(RO_MONTHS).join('|')})\\b(?:\\s+(\\d{4}))?`);
  const monthMatch = monthRegex.exec(norm);
  if (monthMatch) {
    const monthNum = RO_MONTHS[monthMatch[1]];
    const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : currYear;
    return periodFromMonth(year, monthNum);
  }

  // ── default: luna curentă ──
  return periodFromMonth(currYear, now.getMonth() + 1);
}

const CATEGORY_KEYWORDS: Array<{ key: CategoryKey; keywords: string[] }> = [
  {
    key: 'food',
    keywords: [
      'mancare',
      'mâncare',
      'restaurant',
      'restaurante',
      'fast food',
      'pizza',
      'cafenea',
      'cafea',
      'masa',
      'pranz',
      'prânz',
      'cina',
      'cină',
      'mic dejun',
    ],
  },
  {
    key: 'transport',
    keywords: [
      'transport',
      'taxi',
      'uber',
      'bolt',
      'autobuz',
      'tren',
      'metrou',
      'tramvai',
      'cfr',
      'stb',
      'parcare',
    ],
  },
  {
    key: 'utilities',
    keywords: [
      'utilitati',
      'utilități',
      'curent electric',
      'electricitate',
      'gaz',
      'apa',
      'apă',
      'internet',
      'cablu tv',
      'rcs',
      'enel',
      'eon',
      'telefon',
    ],
  },
  {
    key: 'health',
    keywords: [
      'sanatate',
      'sănătate',
      'farmacie',
      'medic',
      'doctor',
      'spital',
      'medicament',
      'analize medicale',
      'vitamine',
    ],
  },
  {
    key: 'vehicle',
    keywords: [
      'masina',
      'mașină',
      'combustibil',
      'benzina',
      'benzină',
      'motorina',
      'motorină',
      'service',
      'piese auto',
      'spalatorie',
      'spălătorie',
    ],
  },
  {
    key: 'home',
    keywords: [
      'casa',
      'casă',
      'chirie',
      'mobilier',
      'menaj',
      'curatenie',
      'curățenie',
      'gradina',
      'grădină',
    ],
  },
  {
    key: 'entertainment',
    keywords: [
      'distractie',
      'distracție',
      'cinema',
      'teatru',
      'concert',
      'iesit',
      'ieșit',
      'club',
      'bar',
    ],
  },
  {
    key: 'subscriptions',
    keywords: [
      'abonament',
      'abonamente',
      'netflix',
      'spotify',
      'hbo',
      'disney',
      'youtube premium',
      'icloud',
      'google one',
    ],
  },
  {
    key: 'shopping',
    keywords: [
      'cumparaturi',
      'cumpărături',
      'shopping',
      'haine',
      'incaltaminte',
      'încălțăminte',
      'emag',
      'kaufland',
      'lidl',
      'mega image',
      'carrefour',
      'auchan',
      'profi',
    ],
  },
  {
    key: 'education',
    keywords: [
      'educatie',
      'educație',
      'scoala',
      'școală',
      'universitate',
      'curs',
      'cursuri',
      'taxa scolarizare',
    ],
  },
  {
    key: 'travel',
    keywords: [
      'calatorie',
      'călătorie',
      'calatorii',
      'călătorii',
      'vacanta',
      'vacanță',
      'hotel',
      'airbnb',
      'zbor',
      'avion',
      'pensiune',
    ],
  },
  {
    key: 'income',
    keywords: ['venit', 'venituri', 'salariu', 'incasare', 'încasare', 'incasari', 'încasări'],
  },
];

function detectCategoryKeys(text: string): Set<CategoryKey> {
  const norm = normalize(text);
  const out = new Set<CategoryKey>();
  for (const { key, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => norm.includes(normalize(kw)))) out.add(key);
  }
  return out;
}

interface FinanceIntent {
  period: FinancePeriod;
  categoryKeys: Set<CategoryKey>;
  /** termen liber pentru căutare în merchant/description (ex. „Lidl" deși e și categorie) */
  searchTerms: string[];
}

function buildFinanceIntent(text: string): FinanceIntent {
  const period = parseFinancePeriod(text);
  const categoryKeys = detectCategoryKeys(text);
  // Reciclăm extractSearchTerms (deja exclude stop-words). Folosim aceleași termene
  // pentru filtrarea pe merchant/description; e benign dacă nu se potrivește nimic.
  const searchTerms = extractSearchTerms(text);
  return { period, categoryKeys, searchTerms };
}

// ─── Construire secțiune DATE FINANCIARE ─────────────────────────────────────

const FINANCE_TX_LIMIT = 30; // tranzacții individuale (cu filtru categorie/merchant)
const FINANCE_TOP_CATEGORIES = 8;
const FINANCE_TOP_MERCHANTS = 12;

function fmtMoney(n: number): string {
  return n.toFixed(2);
}

async function buildFinanceSummary(intent: FinanceIntent): Promise<string> {
  const { period, categoryKeys, searchTerms } = intent;

  // Conturile (pentru sold + filtru pe valută)
  const accounts = await getFinancialAccounts(true);
  if (accounts.length === 0) {
    return `=== DATE FINANCIARE ===\n(Nicio dată financiară: hub-ul „Gestiune financiară" e activ, dar nu există conturi sau tranzacții.)`;
  }

  // Categorii (pentru a mapa CategoryKey → category_id)
  const categories = await getCategories(true);
  const targetCategoryIds = new Set<string>();
  for (const k of categoryKeys) {
    const found = categories.find(c => c.key === k);
    if (found) targetCategoryIds.add(found.id);
  }

  // Tranzacțiile din perioadă (excludem duplicate + transferuri pentru analitice)
  const txs = await getTransactions({
    fromDate: period.fromDate,
    toDate: period.toDate,
    excludeDuplicates: true,
    excludeTransfers: true,
    limit: 5000, // safety cap
  });

  const lines: string[] = ['=== DATE FINANCIARE ==='];
  lines.push(`Perioadă: ${period.label} (${period.fromDate} → ${period.toDate})`);
  lines.push(`Conturi: ${accounts.length} (${accounts.filter(a => !a.archived).length} active)`);

  // ── Sumar pe perioadă ──
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    const v = t.amount_ron ?? t.amount;
    if (v >= 0) income += v;
    else expense += Math.abs(v);
  }
  lines.push(
    `Total venituri: ${fmtMoney(income)} RON | total cheltuieli: ${fmtMoney(expense)} RON | net: ${fmtMoney(income - expense)} RON | ${txs.length} tranzacții`
  );

  // ── Soldul curent al conturilor active (max 5 listate) ──
  const activeAccounts = accounts.filter(a => !a.archived).slice(0, 5);
  if (activeAccounts.length > 0) {
    const accountLines = activeAccounts
      .map(a => `${a.name} (${a.currency}): ${fmtMoney(a.initial_balance)} sold inițial`)
      .join('; ');
    lines.push(`Conturi active: ${accountLines}`);
  }

  // ── Top categorii (din breakdown lunar dacă e o singură lună, altfel calcul aici) ──
  let breakdown: CategoryBreakdownItem[] = [];
  if (period.yearMonth) {
    breakdown = await getCategoryBreakdown(period.yearMonth);
  } else {
    // Calcul manual pentru perioade multi-lună
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const t of txs) {
      const v = t.amount_ron ?? t.amount;
      if (v >= 0) continue;
      const cat = t.category_id ? categories.find(c => c.id === t.category_id) : null;
      const key = cat?.id ?? '__none__';
      const name = cat?.name ?? 'Necategorizat';
      const ex = map.get(key) ?? { name, total: 0, count: 0 };
      ex.total += Math.abs(v);
      ex.count += 1;
      map.set(key, ex);
    }
    const total = Array.from(map.values()).reduce((s, x) => s + x.total, 0);
    breakdown = Array.from(map.entries())
      .map(([id, x]) => ({
        category_id: id === '__none__' ? null : id,
        category_name: x.name,
        category_key: null,
        icon: null,
        color: null,
        total_ron: x.total,
        percentage: total > 0 ? Math.round((x.total / total) * 1000) / 10 : 0,
        transaction_count: x.count,
      }))
      .sort((a, b) => b.total_ron - a.total_ron);
  }

  if (breakdown.length > 0) {
    lines.push(
      `\nTop categorii cheltuieli (top ${Math.min(FINANCE_TOP_CATEGORIES, breakdown.length)}):`
    );
    for (const item of breakdown.slice(0, FINANCE_TOP_CATEGORIES)) {
      lines.push(
        `- ${item.category_name}: ${fmtMoney(item.total_ron)} RON (${item.percentage}%, ${item.transaction_count} tranzacții)`
      );
    }
  }

  // ── Top merchants (cheltuieli) ──
  const merchantMap = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    const v = t.amount_ron ?? t.amount;
    if (v >= 0) continue;
    const merchantRaw = (t.merchant ?? t.description ?? '').trim();
    if (!merchantRaw) continue;
    const key = merchantRaw.slice(0, 80);
    const ex = merchantMap.get(key) ?? { total: 0, count: 0 };
    ex.total += Math.abs(v);
    ex.count += 1;
    merchantMap.set(key, ex);
  }
  const topMerchants = Array.from(merchantMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, FINANCE_TOP_MERCHANTS);
  if (topMerchants.length > 0) {
    lines.push(`\nTop comercianți / descrieri (top ${topMerchants.length}):`);
    for (const [name, x] of topMerchants) {
      lines.push(`- ${name}: ${fmtMoney(x.total)} RON (${x.count}× )`);
    }
  }

  // ── Listă tranzacții filtrate (când userul a întrebat despre o categorie sau merchant specific) ──
  const wantsList =
    targetCategoryIds.size > 0 || (searchTerms.length > 0 && searchTerms.some(t => t.length >= 3));

  if (wantsList) {
    let filtered = txs.filter(t => {
      const v = t.amount_ron ?? t.amount;
      if (v >= 0) return false; // doar cheltuieli (pt analitice de tip „cât am cheltuit pe X")
      const matchCat =
        targetCategoryIds.size > 0 && t.category_id && targetCategoryIds.has(t.category_id);
      const haystack = normalize(`${t.merchant ?? ''} ${t.description ?? ''}`);
      const matchTerm = searchTerms.length > 0 && searchTerms.some(term => haystack.includes(term));
      return matchCat || matchTerm;
    });

    // Dacă are venituri printre potriviri (ex. „salariu") includem și pozitivele
    if (categoryKeys.has('income')) {
      const incomeMatches = txs.filter(t => {
        const v = t.amount_ron ?? t.amount;
        if (v < 0) return false;
        return targetCategoryIds.size > 0 && t.category_id && targetCategoryIds.has(t.category_id);
      });
      filtered = [...incomeMatches, ...filtered];
    }

    filtered = filtered.slice(0, FINANCE_TX_LIMIT);
    if (filtered.length > 0) {
      const total = filtered.reduce((s, t) => s + Math.abs(t.amount_ron ?? t.amount), 0);
      lines.push(
        `\nTranzacții relevante (${filtered.length}, ${fmtMoney(total)} RON, sortate descrescător după dată):`
      );
      for (const t of filtered) {
        const cat = t.category_id ? categories.find(c => c.id === t.category_id)?.name : null;
        const v = t.amount_ron ?? t.amount;
        const merchant = t.merchant ?? '';
        const desc = t.description ?? '';
        const label = merchant || desc || '(fără descriere)';
        const extra: string[] = [];
        if (cat) extra.push(cat);
        if (merchant && desc && merchant !== desc) extra.push(desc.slice(0, 60));
        const extraStr = extra.length ? ` [${extra.join(' · ')}]` : '';
        lines.push(`- ${t.date} | ${fmtMoney(v)} RON | ${label}${extraStr}`);
      }
    } else {
      lines.push(
        `\n(Nicio tranzacție relevantă pentru filtru categorie/merchant în această perioadă.)`
      );
    }
  }

  return lines.join('\n');
}

async function buildContext(
  userMessage: string,
  history: ChatMessage[],
  financeHubActive: boolean
): Promise<{ contextText: string; filtered: boolean; docMap: Map<string, string> }> {
  const [persons, properties, vehicles, cards, animals, documents] = await Promise.all([
    getPersons(),
    getProperties(),
    getVehicles(),
    getCards(),
    getAnimals(),
    getDocumentsForAI(),
  ]);

  const noData =
    !persons.length &&
    !properties.length &&
    !vehicles.length &&
    !cards.length &&
    !animals.length &&
    !documents.length;

  if (noData) {
    return {
      contextText:
        'NU EXISTĂ DATE ÎN APLICAȚIE. Utilizatorul nu a adăugat nicio entitate sau document.',
      filtered: false,
      docMap: new Map(),
    };
  }

  // ── Identificare filtre ────────────────────────────────────────────────────

  // ID-uri menționate: mesajul curent + ultimele mesaje din istoric
  const currentMentions = extractMentionedIds(userMessage);
  const historyMentions = collectHistoryMentions(history);
  const allMentionedIds = new Set([...currentMentions, ...historyMentions]);

  // Tipuri de documente detectate din mesajul curent
  const cleanMessage = userMessage.replace(/^\[Context mențiuni:[^\]]*\]\n?/, '');
  const relevantTypes = detectRelevantTypes(cleanMessage);

  // Căutare text în OCR complet (înainte de trunchere)
  const searchTerms = extractSearchTerms(cleanMessage);
  const ocrMatchedIds = findDocsByOcrSearch(documents, searchTerms);

  const hasEntityFilter = allMentionedIds.size > 0;
  const hasTypeFilter = relevantTypes !== null;
  const hasOcrMatch = ocrMatchedIds.size > 0;
  const isFiltered = hasEntityFilter || hasTypeFilter || hasOcrMatch;

  // ── Filtrare documente ─────────────────────────────────────────────────────

  let filteredDocs: Document[] = documents;

  if (hasEntityFilter) {
    filteredDocs = filteredDocs.filter(
      doc =>
        (doc.person_id && allMentionedIds.has(doc.person_id)) ||
        (doc.vehicle_id && allMentionedIds.has(doc.vehicle_id)) ||
        (doc.property_id && allMentionedIds.has(doc.property_id)) ||
        (doc.card_id && allMentionedIds.has(doc.card_id)) ||
        (doc.animal_id && allMentionedIds.has(doc.animal_id)) ||
        (doc.company_id && allMentionedIds.has(doc.company_id))
    );
    if (filteredDocs.length === 0) filteredDocs = documents;
  }

  if (hasTypeFilter && relevantTypes!.length > 0) {
    const typeFiltered = filteredDocs.filter(doc => relevantTypes!.includes(doc.type));
    if (typeFiltered.length > 0) filteredDocs = typeFiltered;
  }

  // Documentele găsite prin căutare OCR se adaugă întotdeauna la set
  // (chiar dacă nu au trecut filtrele de entitate/tip)
  if (hasOcrMatch) {
    const existingIds = new Set(filteredDocs.map(d => d.id));
    const ocrExtra = documents.filter(d => ocrMatchedIds.has(d.id) && !existingIds.has(d.id));
    filteredDocs = [...filteredDocs, ...ocrExtra];
  }

  // Limită maximă de documente
  const maxDocs = isFiltered ? MAX_DOCS_FILTERED : MAX_DOCS_FULL;
  if (filteredDocs.length > maxDocs) {
    // Prioritizăm: 1. găsite prin OCR search, 2. cu dată expirare, 3. restul
    filteredDocs = [
      ...filteredDocs.filter(d => ocrMatchedIds.has(d.id)),
      ...filteredDocs.filter(d => !ocrMatchedIds.has(d.id) && d.expiry_date),
      ...filteredDocs.filter(d => !ocrMatchedIds.has(d.id) && !d.expiry_date),
    ].slice(0, maxDocs);
  }

  // ── Construire string context ──────────────────────────────────────────────

  const lines: string[] = ['=== DATE APLICAȚIE ==='];

  if (persons.length) {
    const personStrings = persons.map(p => {
      const extra: string[] = [];
      if (p.phone) extra.push(`tel: ${p.phone}`);
      if (p.email) extra.push(`email: ${p.email}`);
      const details = extra.length ? ` (${extra.join(', ')})` : '';
      return `[ENT:${p.name}|person|${p.id}]${details}`;
    });
    lines.push(`Persoane: ${personStrings.join(', ')}`);
  }
  if (properties.length)
    lines.push(
      `Proprietăți: ${properties.map(p => `[ENT:${p.name}|property|${p.id}]`).join(', ')}`
    );
  if (vehicles.length)
    lines.push(`Vehicule: ${vehicles.map(v => `[ENT:${v.name}|vehicle|${v.id}]`).join(', ')}`);
  if (cards.length)
    lines.push(
      `Carduri: ${cards.map(c => `[ENT:${c.nickname}|card|${c.id}]` + ` (****${c.last4})`).join(', ')}`
    );
  if (animals.length)
    lines.push(
      `Animale: ${animals.map(a => `[ENT:${a.name}|animal|${a.id}]` + ` (${a.species})`).join(', ')}`
    );

  // Notă de filtrare (ajută AI-ul să înțeleagă că nu vede tot)
  if (isFiltered && filteredDocs.length < documents.length) {
    lines.push(
      `\nDocumente (${filteredDocs.length} din ${documents.length} total, filtrate după context):`
    );
  } else {
    lines.push('\nDocumente:');
  }

  if (!filteredDocs.length) {
    lines.push('(niciun document relevant găsit)');
  }

  for (const doc of filteredDocs) {
    // OCR limit per document:
    // - găsit prin căutare text → OCR complet (3000 chars)
    // - restul → 1000 chars
    const ocrLimit = ocrMatchedIds.has(doc.id) ? OCR_LIMIT_FULL : OCR_LIMIT;
    const entity =
      persons.find(p => p.id === doc.person_id)?.name ??
      vehicles.find(v => v.id === doc.vehicle_id)?.name ??
      properties.find(p => p.id === doc.property_id)?.name ??
      cards.find(c => c.id === doc.card_id)?.nickname ??
      animals.find(a => a.id === doc.animal_id)?.name ??
      null;
    const label = DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
    const expiry = doc.expiry_date ? ` | expiră: ${doc.expiry_date}` : '';
    const issued = doc.issue_date ? ` | emis: ${doc.issue_date}` : '';
    const entityStr = entity ? ` (${entity})` : '';
    const noteStr = doc.note
      ? ` | notă: ${doc.note.slice(0, NOTE_LIMIT)}${doc.note.length > NOTE_LIMIT ? '…' : ''}`
      : '';

    let meta = '';
    if (doc.metadata) {
      try {
        const parsed = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
        const metaParts = Object.entries(parsed as Record<string, string>)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`);
        if (metaParts.length) meta = ` | ${metaParts.join(', ')}`;
      } catch {
        /* metadata coruptă */
      }
    }

    const ocrText = doc.ocr_text
      ? ` | OCR: ${doc.ocr_text.slice(0, ocrLimit)}${doc.ocr_text.length > ocrLimit ? '…' : ''}`
      : '';

    lines.push(
      `- [DOC:${label}|${doc.id}]${entityStr}${issued}${expiry}${noteStr}${meta}${ocrText}`
    );
  }

  // ── Date vehicule (intent-based) ───────────────────────────────────────────
  // Adăugăm sumare pentru carburant/mentenanță/km doar dacă mesajul atinge
  // explicit aceste subiecte (evită umflarea contextului).
  const domains = detectDomains(cleanMessage);
  if (domains.size > 0 && vehicles.length > 0) {
    const mentionedVehicles = hasEntityFilter
      ? vehicles.filter(v => allMentionedIds.has(v.id))
      : [];
    const targetVehicles = mentionedVehicles.length > 0 ? mentionedVehicles : vehicles;
    const compact = mentionedVehicles.length === 0 && vehicles.length >= COMPACT_SUMMARY_THRESHOLD;

    const sections: string[] = [];
    if (domains.has('fuel')) {
      const s = await buildFuelSummary(targetVehicles, compact);
      if (s) sections.push(s);
    }
    if (domains.has('maintenance')) {
      const s = await buildMaintenanceSummary(targetVehicles);
      if (s) sections.push(s);
    }
    if (domains.has('km')) {
      const s = await buildKmSummary(targetVehicles);
      if (s) sections.push(s);
    }
    if (sections.length > 0) {
      lines.push('\n=== DATE VEHICULE ===');
      if (compact) {
        lines.push(
          `(sumar compact, ${vehicles.length} vehicule — folosește @mențiune pentru detalii)`
        );
      }
      lines.push(...sections);
    }
  }

  // ── Date financiare (intent-based) ─────────────────────────────────────────
  // Adăugăm sumar financiar doar dacă mesajul atinge subiecte financiare ȘI
  // hub-ul „Gestiune financiară" e activ (visibilitate entitate financial_account).
  if (financeHubActive && hasFinanceIntent(cleanMessage)) {
    const intent = buildFinanceIntent(cleanMessage);
    const financeSection = await buildFinanceSummary(intent);
    if (financeSection) lines.push('\n' + financeSection);
  }

  // Hartă id → label pentru post-procesare răspuns AI
  const docMap = new Map<string, string>();
  for (const doc of documents) {
    docMap.set(doc.id, DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type);
  }

  return { contextText: lines.join('\n'), filtered: isFiltered, docMap };
}

// ─── Export principal ─────────────────────────────────────────────────────────

export async function sendMessage(userMessage: string, history: ChatMessage[]): Promise<string> {
  const visibleEntityTypes = await getVisibleEntityTypes().catch(() => [] as EntityType[]);
  const financeHubActive = visibleEntityTypes.includes('financial_account');
  const { contextText, docMap } = await buildContext(userMessage, history, financeHubActive);

  const systemPrompt = `${buildAppKnowledge(financeHubActive)}

## Datele utilizatorului

${contextText}

Când menționezi un document specific, folosește ÎNTOTDEAUNA tag-ul [DOC:...|...] din context.
Când menționezi o entitate, folosește ÎNTOTDEAUNA tag-ul [ENT:...|...|...] din context.`;

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let reply = await sendAiRequest(messages, 500);

  // Post-procesare: înlocuiește orice [ID:uuid] rămas cu [DOC:label|uuid]
  // (AI-ul uneori ignoră instrucțiunile și generează formatul vechi)
  reply = reply.replace(/\[ID:([^\]]+)\]/g, (_match, id: string) => {
    const label = docMap.get(id);
    return label ? `[DOC:${label}|${id}]` : _match;
  });

  return reply;
}
