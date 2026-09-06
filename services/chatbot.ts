import {
  getPersons,
  getProperties,
  getVehicles,
  getCards,
  getAnimals,
  getCompanies,
} from './entities';
// `getDocumentsForAI` strips private_notes. NU folosi `getDocuments` aici —
// vezi `.claude/rules/ai-privacy.md`.
import { getDocumentsForAI } from './documents';
import { getCustomTypes } from './customTypes';
import { getDocumentLabel } from '@/types';
import type { DocumentType, Document, Vehicle, CustomDocumentType } from '@/types';
import { buildAppKnowledge } from './appKnowledge';
import { sendAiRequest, getAiConfig } from './aiProvider';
import type { AiMessage } from './aiProvider';
import { getFuelRecords, computeFuelStats } from './fuel';
import { getMaintenanceTasks, computeTaskStatus, getCurrentKm } from './maintenance';
import {
  detectTaskRequirements,
  formatTaskRequirementSpec,
  type TaskRequirement,
} from './taskRequirements';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Regulă statică injectată în system prompt-ul chatbot-ului GENERAL. Datele
 * medicale sunt deja excluse din context (getDocumentsForAI). Aici instruim
 * modelul să redirecționeze întrebările medicale către chat-ul medical, fără
 * să inventeze și fără să nege existența documentelor. Text FIX — zero date
 * per-document, deci nicio scurgere.
 */
export const MEDICAL_REDIRECT_RULE = `## Documente medicale — fără acces

Nu ai acces la documentele medicale ale utilizatorului (analize, rețete, diagnostice, scrisori medicale, bilete de externare/trimitere, imagistică, vaccinuri) — din motive de confidențialitate/GDPR, ele NU apar în „Datele utilizatorului" de mai sus.

Dacă utilizatorul întreabă despre analize, rezultate, medicamente, diagnostice sau orice subiect medical: NU inventa date și NU spune că documentele nu există. Răspunde îndrumându-l: „Pentru analizele și documentele tale medicale, deschide Dosarul medical — chat-ul de acolo are acces la ele."

Poți confirma că funcționalitatea „Dosar medical" există în aplicație, dar datele medicale propriu-zise sunt accesibile EXCLUSIV din chat-ul Dosarului medical, nu de aici.`;

// ─── Filtrare context ─────────────────────────────────────────────────────────

/**
 * Extrage ID-urile entităților menționate din prefixul adăugat de chat.tsx.
 * Format: "[Context mențiuni: @Nume = Tip (ID: abc123), ...]"
 */
/**
 * Toate id-urile de entitate legate de un document: coloanele legacy `*_id` PLUS
 * `entity_links` (tabelul `document_entities`).
 *
 * Coloanele legacy țin doar PRIMUL link de fiecare tip, deci un document cu
 * multi-link sau primit prin partajare apare doar în junction. Același motiv
 * pentru care există `scripts/entity-doc-links-audit.js` — dar acela scanează
 * query-uri SQL, iar aici filtrarea e în memorie, deci nu l-ar fi prins.
 */
function docEntityIds(doc: Document): string[] {
  const ids = [
    doc.person_id,
    doc.vehicle_id,
    doc.property_id,
    doc.card_id,
    doc.animal_id,
    doc.company_id,
    ...(doc.entity_links?.map(l => l.entityId) ?? []),
  ];
  return ids.filter((id): id is string => Boolean(id));
}

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
const KEYWORD_TO_TYPES: { keywords: string[]; types: DocumentType[] }[] = [
  { keywords: ['buletin', 'ci', 'carte identitate', 'identitate'], types: ['buletin'] },
  { keywords: ['pasaport', 'pașaport', 'passport'], types: ['pasaport'] },
  { keywords: ['permis', 'sofer', 'șofer'], types: ['permis_auto'] },
  { keywords: ['talon', 'inmatriculare', 'înmatriculare'], types: ['talon'] },
  { keywords: ['carte auto', 'civ'], types: ['carte_auto'] },
  { keywords: ['rca', 'asigurare obligatorie', 'asigurare auto'], types: ['rca'] },
  { keywords: ['casco'], types: ['casco'] },
  {
    keywords: ['itp', 'inspectie tehnica', 'inspecție tehnică', 'inspectia tehnica'],
    types: ['itp'],
  },
  { keywords: ['vigneta', 'vignetă', 'rovinieta'], types: ['vigneta'] },
  { keywords: ['factura', 'factură', 'invoice'], types: ['factura'] },
  { keywords: ['contract'], types: ['contract'] },
  { keywords: ['garantie', 'garanție', 'warranty'], types: ['garantie'] },
  { keywords: ['pad', 'asigurare locuinta', 'asigurare locuință'], types: ['pad'] },
  { keywords: ['vaccin', 'vaccinare'], types: ['vaccin_animal'] },
  { keywords: ['deparazitare', 'antiparazitar'], types: ['deparazitare'] },
  { keywords: ['veterinar', 'vet', 'cabinet veterinar', 'consult animal'], types: ['vizita_vet'] },
  {
    keywords: ['fisa consultatie', 'fișă consultație', 'fisa de consultatie', 'consult medic'],
    types: ['fisa_consultatie'],
  },
  {
    keywords: [
      'bilet trimitere',
      'bilet de trimitere',
      'trimitere medic',
      'trimitere specialist',
      'trimitere investigatii',
      'referral',
    ],
    types: ['bilet_trimitere'],
  },
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

/**
 * Potrivire cuvânt-cheie la ÎNCEPUT de cuvânt, nu oriunde în text.
 *
 * `norm.includes(kw)` prindea cuvântul cheie și în interiorul altor cuvinte:
 * „ci" (carte de identitate) se potrivea în „fa-ci", „de-ci", „ai-ci", iar „bon"
 * în „a-bon-ament". Rezultat: întrebări fără legătură primeau un filtru de tip
 * greșit și contextul se îngusta pe documentele greșite — vizibil mai ales pe
 * model local, unde numărul de documente e plafonat.
 *
 * Ancorăm doar începutul (`\b<kw>`), nu și sfârșitul: româna articulează
 * substantivele, iar „pașaportul" / „talonul" / „buletinul" trebuie să se
 * potrivească în continuare cu „pasaport" / „talon" / „buletin".
 */
const KEYWORD_RE_CACHE = new Map<string, RegExp>();
function matchesKeyword(normText: string, keyword: string): boolean {
  const kw = normalize(keyword);
  if (!kw) return false;
  let re = KEYWORD_RE_CACHE.get(kw);
  if (!re) {
    re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    KEYWORD_RE_CACHE.set(kw, re);
  }
  return re.test(normText);
}

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
 * Grupuri de sinonime: cuvântul din întrebarea utilizatorului diferă de cel
 * tipărit în document. Un termen care începe cu oricare rădăcină din grup
 * caută în OCR TOATE rădăcinile grupului.
 *
 * Ex. real (2026-07-29): „ce dimensiune au cauciucurile la Westfalia?" — cartea
 * de identitate a vehiculului scrie „ANVELOPE", niciodată „cauciucuri", deci
 * documentul nu era găsit de căutarea în OCR și primea doar bugetul scurt de
 * text → AI-ul răspundea că informația nu apare în acte.
 *
 * Reguli pentru rădăcini noi: minim 4 caractere și fără substringuri ambigue
 * (căutarea e `includes`, deci „vin" ar prinde și „vinietă", „kg" orice).
 */
const OCR_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['cauciuc', 'anvelop', 'pneu', 'reifen', 'bereifung'],
  ['jant', 'roata', 'roti'],
  ['motorin', 'diesel'],
  ['benzin', 'ottokraftstoff'],
  ['proprietar', 'titular', 'detinator', 'halter'],
  ['sasiu', 'caroserie', 'fahrgestell'],
  ['cilindree', 'cilindrica', 'hubraum'],
  ['culoare', 'farbe'],
];

/** Adaugă la termenii extrași rădăcinile sinonime din același grup. */
function expandWithSynonyms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const group of OCR_SYNONYM_GROUPS) {
      if (!group.some(root => term.startsWith(root))) continue;
      for (const root of group) expanded.add(root);
    }
  }
  return [...expanded];
}

/**
 * Extrage termeni de căutare semnificativi din mesajul userului.
 * Elimină prefixul de mențiuni, stop words și cuvinte prea scurte, apoi
 * adaugă sinonimele documentare (vezi `OCR_SYNONYM_GROUPS`).
 */
function extractSearchTerms(message: string): string[] {
  const clean = message.replace(/^\[Context mențiuni:[^\]]*\]\n?/, '');
  const norm = normalize(clean);
  const terms = norm
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return expandWithSynonyms(terms);
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

const KEYWORD_TO_DOMAIN: { keywords: string[]; domain: VehicleDomain }[] = [
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
export function detectRelevantTypes(text: string): DocumentType[] | null {
  const norm = normalize(text);
  const types = new Set<DocumentType>();

  for (const { keywords, types: docTypes } of KEYWORD_TO_TYPES) {
    if (keywords.some(kw => matchesKeyword(norm, kw))) {
      // Regula „expirare" e wildcard (types: []). NU mai iese din buclă aici:
      // la „ce ITP expiră următorul", `itp` adăuga corect tipul, apoi wildcard-ul
      // făcea `return null` și ARUNCA filtrul acumulat → se căuta prin toate
      // documentele. Pe model local, cu plafonul de documente, exact talonul
      // căutat putea cădea din context. Raportat 2026-09-03.
      if (docTypes.length === 0) continue;
      docTypes.forEach(t => types.add(t));
    }
  }

  // Tipuri concrete găsite → ele câștigă, chiar dacă a apărut și „expiră".
  // Intersecția („ITP" ȘI „expiră") e mai îngustă decât oricare separat, deci
  // mai bună atât pentru context mic, cât și pentru acuratețe.
  // Doar wildcard („ce-mi expiră luna asta?") → null, fără filtru de tip.
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

// Limite pentru provider-e remote (Mistral cloud / OpenAI etc., context 32K+).
// `ocrLimitFull` primesc doar documentele găsite prin căutare în OCR sau o
// selecție îngustă (vezi FULL_OCR_DOC_BUDGET), deci worst-case sunt 8 × 6000 =
// 48K caractere ≈ 12K tokeni — confortabil pentru Mistral Large.
interface ContextLimits {
  maxDocsFull: number;
  maxDocsFiltered: number;
  noteLimit: number;
  ocrLimit: number;
  ocrLimitFull: number;
  /**
   * Plafon DUR pe lungimea secțiunii de documente, în caractere. Estimarea per
   * document e o medie — un singur document cu OCR complet o poate depăși de
   * câteva ori. Fără plafonul ăsta, contextul se umflă peste fereastră și
   * llama.cpp întoarce „Context is full". `undefined` = fără plafon (remote).
   */
  maxDocChars?: number;
}

const REMOTE_LIMITS = {
  maxDocsFull: 80,
  maxDocsFiltered: 40,
  noteLimit: 500,
  ocrLimit: 1000,
  ocrLimitFull: 6000,
} as const;

/**
 * Câte documente pot primi OCR-ul complet într-un răspuns. Când întrebarea e
 * țintită (mențiune de entitate / filtru de tip) și rămân puține documente,
 * fiecare primește `ocrLimitFull` — altfel informația cerută poate cădea exact
 * în partea tăiată a textului OCR (regresia „dimensiune cauciucuri", 2026-07-29).
 */
const FULL_OCR_DOC_BUDGET = 8;

// Limite pentru model local pe device (context util ~8K tokeni — n_ctx pe GPU
// e plafonat de memoria Metal a A15, vezi localModel.ts). buildAppKnowledge()
// e deja ~3K tokeni fix; peste el vine contextText (entități + max 6 documente).
// `note` și `ocr_text` conțin de obicei informația esențială → 500 chars fiecare
// ca AI-ul să aibă cu ce răspunde. Bugetul e ok pe Q3_K_S (2.28GB, model mic):
// worst-case ~3K appKnowledge + 6 docs × ~300 tokeni + entități ≈ ~6K tokeni,
// sub 8192. Pe Q4_K_M (3.1GB) ar fi risc de jetsam — de-aia quant mic pe 6GB.
// Dacă apare jetsam pe device, scade întâi ocrLimit/noteLimit. Măsurat 2026-07-01.
const LOCAL_LIMITS = {
  maxDocsFull: 6,
  maxDocsFiltered: 6,
  noteLimit: 500,
  ocrLimit: 500,
  ocrLimitFull: 800,
} as const;

/**
 * Cost estimat în tokeni al unui document în context.
 *
 * 500 caractere OCR + 500 note + antet/metadata/tag-uri. La ~2.5 caractere per
 * token în română, doar textul e ~400 tokeni; cu restul, 600 e estimarea sigură.
 *
 * Prima valoare aleasă (300) era prea optimistă și a produs „Context is full" pe
 * device, la 36 de documente într-o fereastră de 16384. Măsurat 2026-09-04.
 * Estimarea NU e singura protecție — vezi `MAX_CONTEXT_CHARS` mai jos.
 */
const EST_TOKENS_PER_DOC = 600;
/**
 * Tokeni rezervați din fereastră pentru altceva decât documente.
 *
 * MĂSURAT (2026-09-04), după trecerea appKnowledge pe secțiuni la cerere:
 * promptul fix a scăzut de la ~5300 de tokeni (manualul complet, la fiecare
 * întrebare) la 667–1400, în funcție de subiect. Rezerva acoperă cazul cel mai
 * prost măsurat, nu media.
 *
 * 1500 appKnowledge (worst case) + 1200 entități/reguli de task + 1300 răspuns
 * (n_predict 500) și marjă = 4000.
 */
const LOCAL_RESERVED_TOKENS = 4000;
/** Caractere per token, estimare conservatoare pentru română cu diacritice. */
const CHARS_PER_TOKEN = 2.5;
/**
 * Buget de caractere pentru ISTORICUL conversației trimis modelului local.
 *
 * Istoricul se trimite integral la fiecare mesaj, deci CREȘTE cu fiecare tur —
 * bugetul de documente singur nu e suficient. După câteva răspunsuri lungi,
 * istoricul depășea singur fereastra și llama.cpp întorcea „Context is full"
 * chiar și la o întrebare scurtă („câți ani are Silvia?"). Măsurat pe device
 * 2026-09-04.
 *
 * ~1600 tokeni: suficient pentru ultimele câteva schimburi, care e tot ce
 * folosește aplicația (mențiunile se propagă separat, prin collectHistoryMentions).
 */
const LOCAL_HISTORY_CHARS = 4000;

/**
 * Păstrează cele mai RECENTE mesaje care încap în bugetul de caractere.
 * Mesajele vechi se taie primele — contextul apropiat contează mai mult.
 */
export function trimHistoryForLocal(
  history: ChatMessage[],
  maxChars = LOCAL_HISTORY_CHARS
): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const len = history[i].content.length;
    if (used + len > maxChars) break;
    used += len;
    kept.unshift(history[i]);
  }
  // Garantăm cel puțin ultimul mesaj, chiar dacă singur depășește bugetul:
  // fără el, modelul pierde complet firul întrebării anterioare.
  if (kept.length === 0 && history.length > 0) {
    const last = history[history.length - 1];
    kept.push({ ...last, content: last.content.slice(0, maxChars) });
  }
  return kept;
}
/** Nu coborâm sub plafonul istoric, oricât de mică ar fi fereastra. */
const LOCAL_MIN_DOCS = 6;

/**
 * Limite locale dimensionate după fereastra REALĂ a modelului selectat.
 *
 * Până acum `LOCAL_LIMITS` era o constantă calibrată pentru nCtx 8192, aplicată
 * și modelelor cu 12288 sau 16384 — deci pe Qwen 3.5 2B se folosea sub jumătate
 * din contextul disponibil, iar răspunsurile ieșeau mai slabe decât pe remote
 * fără motiv. Creșterea e sigură abia de la `cache_type_k/v: 'q8_0'` încoace
 * (localModel.ts), care a înjumătățit memoria cache-ului KV.
 *
 * Plafonat la `REMOTE_LIMITS.maxDocsFiltered`: peste atât nu e paritate, e risc
 * de jetsam degeaba. Dacă apare jetsam pe device, scade EST_TOKENS_PER_DOC ↑ sau
 * LOCAL_RESERVED_TOKENS ↑ — nu reveni la plafonul fix.
 */
export function computeLocalLimits(nCtx: number | null): ContextLimits {
  if (!nCtx || nCtx <= 8192) return LOCAL_LIMITS;
  const budget = nCtx - LOCAL_RESERVED_TOKENS;
  const maxDocs = Math.max(
    LOCAL_MIN_DOCS,
    Math.min(REMOTE_LIMITS.maxDocsFiltered, Math.floor(budget / EST_TOKENS_PER_DOC))
  );
  return {
    maxDocsFull: maxDocs,
    maxDocsFiltered: maxDocs,
    // OCR-ul per document rămâne la 500: creșterea lui ar schimba
    // EST_TOKENS_PER_DOC și ar reduce numărul de documente. Mai multe documente
    // bat mai mult text din fiecare, pentru întrebările aplicației.
    noteLimit: LOCAL_LIMITS.noteLimit,
    ocrLimit: LOCAL_LIMITS.ocrLimit,
    ocrLimitFull: LOCAL_LIMITS.ocrLimitFull,
    maxDocChars: Math.floor(budget * CHARS_PER_TOKEN),
  };
}

// Sumarizare per vehicul: dacă 5+ vehicule și user nu a @menționat unul anume,
// sumarizez agresiv (fără ultimele 5 bonuri).
const COMPACT_SUMMARY_THRESHOLD = 5;

/**
 * Vârsta în ani împliniți la data curentă, din `date_of_birth` ISO.
 *
 * De ce în cod și nu lăsat pe seama modelului: aritmetica pe date e exact ce fac
 * prost modelele mici. Cu `data nașterii: 1985-09-28` trimis brut, Qwen 3.5 2B a
 * răspuns „2 ani și 10 luni" pentru o persoană de 41 de ani (raportat 2026-09-03).
 * Trimițând vârsta gata calculată, eroarea dispare pentru ORICE model.
 *
 * Întoarce null pentru date lipsă, malformate sau în viitor — în acele cazuri
 * contextul rămâne doar cu data nașterii, fără să afirme o vârstă inventată.
 */
/**
 * Data nașterii din CNP românesc (13 cifre): S AA LL ZZ JJ NNN C.
 *
 * Prima cifră dă secolul și sexul: 1/2 → 1900–1999, 3/4 → 1800–1899,
 * 5/6 → 2000–2099, 7/8/9 → rezidenți (secol dedus din an, ca la 1/2).
 *
 * De ce: `Person.date_of_birth` e opțional și de multe ori necompletat, dar CNP-ul
 * e extras din buletin și e sursa exactă. Fără asta, contextul nu conținea nicio
 * vârstă, iar modelul o INVENTA — pe device a răspuns „42 de ani" pentru cineva
 * născut în 1985 (2026-09-04).
 */
export function birthDateFromCnp(cnp?: string): string | null {
  if (!cnp) return null;
  const d = cnp.replace(/\D/g, '');
  if (d.length !== 13) return null;
  const s = Number(d[0]);
  const yy = Number(d.slice(1, 3));
  const mm = Number(d.slice(3, 5));
  const dd = Number(d.slice(5, 7));
  let century: number;
  if (s === 1 || s === 2) century = 1900;
  else if (s === 3 || s === 4) century = 1800;
  else if (s === 5 || s === 6) century = 2000;
  else if (s === 7 || s === 8 || s === 9) century = 1900;
  else return null;
  const year = century + yy;
  const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  // Validare calendaristică prin round-trip (respinge 31 feb, luna 13 etc.)
  const test = new Date(Date.UTC(year, mm - 1, dd));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== mm - 1 || test.getUTCDate() !== dd) {
    return null;
  }
  return iso;
}

export function computeAgeYears(iso?: string, now: Date = new Date()): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const birth = new Date(Date.UTC(y, mo - 1, d));
  // Respinge date imposibile (ex. 2026-02-31 → normalizat de Date la 3 martie)
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== mo - 1 || birth.getUTCDate() !== d) {
    return null;
  }
  let age = now.getUTCFullYear() - y;
  const monthDiff = now.getUTCMonth() - (mo - 1);
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < d)) age--;
  if (age < 0 || age > 150) return null;
  return age;
}

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

async function buildContext(
  userMessage: string,
  history: ChatMessage[],
  limits: ContextLimits
): Promise<{
  contextText: string;
  filtered: boolean;
  docMap: Map<string, string>;
  tasks: TaskRequirement[];
}> {
  const [persons, properties, vehicles, cards, animals, companies, documents, customTypes] =
    await Promise.all([
      getPersons(),
      getProperties(),
      getVehicles(),
      getCards(),
      getAnimals(),
      getCompanies(),
      getDocumentsForAI(),
      getCustomTypes(),
    ]);

  const noData =
    !persons.length &&
    !properties.length &&
    !vehicles.length &&
    !cards.length &&
    !animals.length &&
    !companies.length &&
    !documents.length;

  if (noData) {
    return {
      contextText:
        'NU EXISTĂ DATE ÎN APLICAȚIE. Utilizatorul nu a adăugat nicio entitate sau document.',
      filtered: false,
      docMap: new Map(),
      tasks: [],
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

  // Task-uri detectate („date pentru check-in avion", „ce-mi trebuie la RCA").
  // Calculate ÎNAINTE de filtrare: tipurile lor sursă (pașaport, buletin,
  // talon...) trebuie să treacă de plafonul `maxDocs`, altfel la o cerere
  // pentru mai multe persoane documentul ultimei persoane cade din context
  // și AI-ul răspunde incomplet fără să semnaleze (2026-09-03).
  const tasks = detectTaskRequirements(cleanMessage);
  const taskDocTypes = new Set<DocumentType>(tasks.flatMap(t => t.sourceDocTypes));

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
    filteredDocs = filteredDocs.filter(doc =>
      docEntityIds(doc).some(id => allMentionedIds.has(id))
    );
    // Fallback deliberat: entitatea menționată n-are documente proprii → mai bine
    // tot setul decât o secțiune goală. Notat explicit în context (vezi nota de
    // filtrare de mai jos), altfel modelul crede că tot ce vede aparține entității
    // menționate — exact confuzia „@Silvia → răspuns despre altă persoană".
    if (filteredDocs.length === 0) filteredDocs = documents;
  }

  if (hasTypeFilter && relevantTypes!.length > 0) {
    const allowed = new Set<DocumentType>([...relevantTypes!, ...taskDocTypes]);
    const typeFiltered = filteredDocs.filter(doc => allowed.has(doc.type));
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
  const maxDocs = isFiltered ? limits.maxDocsFiltered : limits.maxDocsFull;
  if (filteredDocs.length > maxDocs) {
    // Prioritizăm: 1. sursa task-ului, 2. entitatea @menționată, 3. OCR search,
    // 4. cu dată expirare, 5. restul.
    //
    // Treapta 2 contează mai ales pe model local, unde maxDocs=6: fără ea, ordinea
    // implicită putea împinge afară exact documentul entității întrebate, iar
    // modelul răspundea din ce-i rămăsese (documentul altei persoane). Raportat
    // 2026-09-03. Se uită și la `entity_links` (junction), nu doar la coloanele
    // legacy `*_id`, care țin doar PRIMUL link de un tip.
    const isTaskSource = (d: Document) => taskDocTypes.has(d.type);
    const isMentioned = (d: Document) =>
      hasEntityFilter && (docEntityIds(d).some(id => allMentionedIds.has(id)) ?? false);
    const rest = (d: Document) => !isTaskSource(d) && !isMentioned(d);
    filteredDocs = [
      // 1. documentele sursă ale task-ului cerut — pe toate persoanele
      ...filteredDocs.filter(isTaskSource),
      ...filteredDocs.filter(d => !isTaskSource(d) && isMentioned(d)),
      ...filteredDocs.filter(d => rest(d) && ocrMatchedIds.has(d.id)),
      ...filteredDocs.filter(d => rest(d) && !ocrMatchedIds.has(d.id) && d.expiry_date),
      ...filteredDocs.filter(d => rest(d) && !ocrMatchedIds.has(d.id) && !d.expiry_date),
    ].slice(0, maxDocs);
  }

  // Întrebare țintită pe puține documente → fiecare primește OCR-ul complet,
  // nu doar cele care au potrivit textual pe termenii căutării.
  const narrowSelection = isFiltered && filteredDocs.length <= FULL_OCR_DOC_BUDGET;

  // ── Construire string context ──────────────────────────────────────────────

  // CNP per persoană, extras din metadata actelor de identitate. Sursa exactă a
  // datei de nașterii când `Person.date_of_birth` nu e completat.
  const cnpByPerson = new Map<string, { cnp: string; docId: string; label: string }>();
  for (const doc of documents) {
    if (doc.type !== 'buletin' && doc.type !== 'pasaport') continue;
    const personId = docEntityIds(doc).find(id => persons.some(p => p.id === id));
    if (!personId || cnpByPerson.has(personId)) continue;
    try {
      const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
      const cnp = (meta as Record<string, unknown> | null)?.cnp;
      if (typeof cnp === 'string' && cnp.trim()) {
        cnpByPerson.set(personId, {
          cnp,
          docId: doc.id,
          label: getDocumentLabel(doc, customTypes),
        });
      }
    } catch {
      // metadata malformată → sărim peste, nu blocăm construirea contextului
    }
  }

  const lines: string[] = ['=== DATE APLICAȚIE ==='];

  // Când userul a @menționat entități, restrânge listele DE ENTITĂȚI la ele.
  // Până acum se filtrau doar documentele, iar lista de persoane pleca INTEGRAL:
  // la „ce vârstă are @Silvia?" modelul primea toate persoanele nediferențiate și
  // răspundea cu numele altcuiva, deși citea documentul corect. Se vede mai ales
  // pe modele locale, unde plafonul de 6 documente (LOCAL_LIMITS) lasă și mai
  // puțin material de dezambiguizare. Raportat 2026-09-03.
  //
  // Fallback deliberat: dacă filtrul n-ar lăsa nimic dintr-o categorie, păstrăm
  // lista întreagă — mai bine context lărgit decât o secțiune goală care ar face
  // modelul să declare că entitatea nu există.
  const narrowByMention = <T extends { id: string }>(items: T[]): T[] => {
    if (!hasEntityFilter) return items;
    const kept = items.filter(i => allMentionedIds.has(i.id));
    return kept.length > 0 ? kept : items;
  };

  const shownPersons = narrowByMention(persons);
  const shownProperties = narrowByMention(properties);
  const shownVehicles = narrowByMention(vehicles);
  const shownCards = narrowByMention(cards);
  const shownAnimals = narrowByMention(animals);
  const shownCompanies = narrowByMention(companies);

  if (shownPersons.length) {
    const personStrings = shownPersons.map(p => {
      const extra: string[] = [];
      // Data nașterii: din câmpul persoanei dacă e completat, altfel dedusă din
      // CNP-ul de pe buletinul ei. Câmpul e opțional și de multe ori gol, iar fără
      // nicio dată în context modelul INVENTEAZĂ vârsta („42 de ani" pentru cineva
      // născut în 1985, pe device 2026-09-04).
      const cnpSource = cnpByPerson.get(p.id);
      const dob = p.date_of_birth ?? birthDateFromCnp(cnpSource?.cnp);
      if (dob) {
        const age = computeAgeYears(dob);
        // Vârsta e pre-calculată, NU lăsată pe seama modelului. Vezi computeAgeYears.
        // Când data vine din CNP, atașăm tag-ul documentului sursă: altfel modelul
        // n-are ce cita pentru o informație care nu apare în niciun document din
        // listă, iar regula de citare devine imposibil de respectat.
        const base =
          age === null ? `data nașterii: ${dob}` : `data nașterii: ${dob}, vârsta: ${age} ani`;
        const src =
          !p.date_of_birth && cnpSource
            ? ` — sursă: [DOC:${cnpSource.label}|${cnpSource.docId}]`
            : '';
        extra.push(`${base}${src}`);
      }
      if (p.phone) extra.push(`tel: ${p.phone}`);
      if (p.email) extra.push(`email: ${p.email}`);
      const details = extra.length ? ` (${extra.join(', ')})` : '';
      return `[ENT:${p.name}|person|${p.id}]${details}`;
    });
    lines.push(`Persoane: ${personStrings.join(', ')}`);
  }
  if (shownProperties.length)
    lines.push(
      `Proprietăți: ${shownProperties.map(p => `[ENT:${p.name}|property|${p.id}]`).join(', ')}`
    );
  if (shownVehicles.length)
    lines.push(
      `Vehicule: ${shownVehicles
        .map(v => {
          const extra: string[] = [];
          if (v.plate_number) extra.push(`nr: ${v.plate_number}`);
          if (v.fuel_type) extra.push(`combustibil: ${v.fuel_type}`);
          const details = extra.length ? ` (${extra.join(', ')})` : '';
          return `[ENT:${v.name}|vehicle|${v.id}]${details}`;
        })
        .join(', ')}`
    );
  if (shownCards.length)
    lines.push(
      `Carduri: ${shownCards
        .map(c => {
          const exp = c.expiry ? `, expiră ${c.expiry}` : '';
          return `[ENT:${c.nickname}|card|${c.id}] (****${c.last4}${exp})`;
        })
        .join(', ')}`
    );
  if (shownAnimals.length)
    lines.push(
      `Animale: ${shownAnimals.map(a => `[ENT:${a.name}|animal|${a.id}]` + ` (${a.species})`).join(', ')}`
    );
  if (shownCompanies.length)
    lines.push(
      `Firme: ${shownCompanies
        .map(c => {
          const extra: string[] = [];
          if (c.cui) extra.push(`CUI: ${c.cui}`);
          if (c.reg_com) extra.push(`Reg. Com.: ${c.reg_com}`);
          const details = extra.length ? ` (${extra.join(', ')})` : '';
          return `[ENT:${c.name}|company|${c.id}]${details}`;
        })
        .join(', ')}`
    );

  // Notă de filtrare/trunchere (ajută AI-ul să înțeleagă că nu vede tot).
  // Emisă ori de câte ori lista e incompletă — inclusiv fără filtru, când
  // maxDocs a tăiat-o (altfel, pe model local cu maxDocsFull=6, AI-ul răspunde
  // cu convingere că userul are doar 6 documente).
  if (filteredDocs.length < documents.length) {
    lines.push(
      isFiltered
        ? `\nDocumente (${filteredDocs.length} din ${documents.length} total, filtrate după context):`
        : `\nDocumente (primele ${filteredDocs.length} din ${documents.length} total — cere un tip de document sau o @mențiune pentru restul):`
    );
  } else {
    lines.push('\nDocumente:');
  }

  if (!filteredDocs.length) {
    lines.push('(niciun document relevant găsit)');
  }

  let docCharsUsed = 0;
  let omittedDocs = 0;
  for (const doc of filteredDocs) {
    // OCR limit per document:
    // - găsit prin căutare text SAU selecție îngustă → OCR complet (ocrLimitFull)
    // - restul → limits.ocrLimit
    const ocrLimit =
      ocrMatchedIds.has(doc.id) || narrowSelection ? limits.ocrLimitFull : limits.ocrLimit;
    const entity =
      persons.find(p => p.id === doc.person_id)?.name ??
      vehicles.find(v => v.id === doc.vehicle_id)?.name ??
      properties.find(p => p.id === doc.property_id)?.name ??
      cards.find(c => c.id === doc.card_id)?.nickname ??
      animals.find(a => a.id === doc.animal_id)?.name ??
      companies.find(c => c.id === doc.company_id)?.name ??
      null;
    const label = getDocumentLabel(doc, customTypes);
    const expiry = doc.expiry_date ? ` | expiră: ${doc.expiry_date}` : '';
    const issued = doc.issue_date ? ` | emis: ${doc.issue_date}` : '';
    const entityStr = entity ? ` (${entity})` : '';
    const noteStr = doc.note
      ? ` | notă: ${doc.note.slice(0, limits.noteLimit)}${doc.note.length > limits.noteLimit ? '…' : ''}`
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

    const line = `- [DOC:${label}|${doc.id}]${entityStr}${issued}${expiry}${noteStr}${meta}${ocrText}`;
    // Plafon dur: oprim ÎNAINTE de a depăși bugetul, nu după. Estimarea per
    // document e o medie; un document cu OCR complet o poate depăși de câteva
    // ori, iar depășirea ferestrei înseamnă „Context is full", adică zero
    // răspuns — mult mai rău decât câteva documente lipsă.
    if (limits.maxDocChars !== undefined) {
      if (docCharsUsed + line.length > limits.maxDocChars) {
        omittedDocs++;
        continue;
      }
      docCharsUsed += line.length;
    }
    lines.push(line);
  }

  if (omittedDocs > 0) {
    lines.push(
      `(încă ${omittedDocs} document(e) nu încap în context — întreabă despre un tip anume sau folosește o @mențiune)`
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

  // ── Date necesare pentru task-uri (intent-based) ───────────────────────────
  // Dacă userul cere date pentru un task specific (RCA, rovinietă, check-in,
  // transfer auto etc.), injectăm SPECIFICAȚIA câmpurilor cerute. Valorile
  // reale le ia AI-ul din metadata documentelor afișate mai sus.
  if (tasks.length > 0) {
    lines.push('\n=== DATE NECESARE ===');
    lines.push(
      '(specificația câmpurilor pentru task-urile detectate în mesaj; valorile reale se citesc din metadata documentelor de mai sus)'
    );
    for (const t of tasks) {
      lines.push('');
      lines.push(formatTaskRequirementSpec(t));
    }
  }

  // Hartă id → label pentru post-procesare răspuns AI
  const docMap = new Map<string, string>();
  for (const doc of documents) {
    docMap.set(doc.id, getDocumentLabel(doc, customTypes));
  }

  return { contextText: lines.join('\n'), filtered: isFiltered, docMap, tasks };
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * Detectează o întrebare AGREGATĂ despre expirări („ce expiră următorul?",
 * „ce-mi expiră luna asta?") și fereastra de timp cerută, în zile.
 *
 * `null` = nu e o astfel de întrebare, se merge pe calea normală cu LLM.
 */
export function detectExpiryQuery(text: string): { days: number; onlyNext: boolean } | null {
  const norm = normalize(text);
  const hasExpiry = /\b(expir|scaden|valabil)/.test(norm);
  if (!hasExpiry) return null;

  // Trebuie să fie o INTEROGARE, nu o afirmație („buletinul meu a expirat").
  const isQuestion = /\b(ce|care|cand|cate|cati|urmator|urmatoare|primul|prima)\b/.test(norm);
  if (!isQuestion) return null;

  // Fără `\b` la final: româna articulează („urmatorUL", „primA"). Aceeași
  // regulă ca la `matchesKeyword` — ancorăm doar începutul cuvântului.
  const onlyNext = /\b(urmator|urmatoare|primul|prima|cel mai apropiat)/.test(norm);
  let days = 365;
  if (/\bluna\b/.test(norm)) days = 31;
  else if (/\bsaptaman/.test(norm)) days = 7;
  else if (/\banul\b/.test(norm)) days = 365;
  else if (/\bcurand|apropiat\b/.test(norm)) days = 90;
  return { days, onlyNext };
}

/**
 * Răspuns DETERMINIST la întrebările agregate despre expirări.
 *
 * De ce fără LLM: „ce expiră următorul?" are nevoie de toate documentele cu dată
 * de expirare, sortate — exact ce NU încape într-un context plafonat, oricât l-am
 * mări. Calculul e trivial în SQL și imposibil de halucinat, iar rezultatul e
 * IDENTIC pe model local și pe cel online — care e chiar scopul.
 *
 * Întoarce null dacă nu se aplică (atunci se merge pe calea normală cu LLM).
 */
async function answerExpiryQuery(
  query: { days: number; onlyNext: boolean },
  types: DocumentType[] | null,
  documents: Document[],
  customTypes: CustomDocumentType[]
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + query.days * 86400000).toISOString().slice(0, 10);

  let pool = documents.filter(d => d.expiry_date);
  if (types && types.length > 0) {
    const allowed = new Set(types);
    pool = pool.filter(d => allowed.has(d.type));
  }
  const upcoming = pool
    .filter(d => d.expiry_date! >= today && d.expiry_date! <= horizon)
    .sort((a, b) => a.expiry_date!.localeCompare(b.expiry_date!));

  const scope = types && types.length > 0 ? `de tipul cerut` : 'din aplicație';
  if (upcoming.length === 0) {
    const expired = pool.filter(d => d.expiry_date! < today);
    if (expired.length === 0) return null; // nimic de spus determinist → lasă LLM-ul
    return `Niciun document ${scope} nu expiră în perioada cerută. Ai însă ${expired.length} document(e) deja expirate.`;
  }

  const fmt = (d: Document) => {
    const label = getDocumentLabel(d, customTypes);
    const days = Math.round(
      (new Date(d.expiry_date! + 'T00:00:00Z').getTime() -
        new Date(today + 'T00:00:00Z').getTime()) /
        86400000
    );
    const inDays = days === 0 ? 'azi' : days === 1 ? 'mâine' : `în ${days} zile`;
    return `- [DOC:${label}|${d.id}] — expiră ${fmtDateRo(d.expiry_date)} (${inDays})`;
  };

  if (query.onlyNext) {
    return `Următorul document care expiră:\n\n${fmt(upcoming[0])}`;
  }
  const shown = upcoming.slice(0, 15);
  const more =
    upcoming.length > shown.length ? `\n\n…și încă ${upcoming.length - shown.length}.` : '';
  return `Documente care expiră în următoarele ${query.days} de zile (${upcoming.length}):\n\n${shown.map(fmt).join('\n')}${more}`;
}

export async function sendMessage(userMessage: string, history: ChatMessage[]): Promise<string> {
  // Detectăm provider-ul ca să comprimăm contextul pentru modele locale
  // (modelele locale au context 8–16K — un system prompt cu 80 docs ×
  // 1000 chars OCR ar depăși ~20K tokeni și ar arunca „Context is full").
  const config = await getAiConfig();
  let limits: ContextLimits = REMOTE_LIMITS;
  if (config.type === 'local') {
    // import dinamic: încărcarea statică a localModel ar trage llama.rn în bundle
    // la orice folosire a chatbot-ului, inclusiv pe provider remote.
    const { getSelectedModelContextSize } = await import('./localModel');
    limits = computeLocalLimits(await getSelectedModelContextSize());
  }
  // ── Cale deterministă: întrebări agregate despre expirări ────────────────
  // Se aplică ÎNAINTE de LLM și doar când întrebarea NU vizează o entitate
  // anume (@mențiune) — acolo calea normală, filtrată pe entitate, e mai bună.
  // Răspunsul e identic pe local și pe remote, ceea ce e chiar scopul.
  const cleanForIntent = userMessage.replace(/^\[Context mențiuni:[^\]]*\]\n?/, '');
  const expiryQuery = detectExpiryQuery(cleanForIntent);
  if (expiryQuery && extractMentionedIds(userMessage).size === 0) {
    const [docsForExpiry, customTypesForExpiry] = await Promise.all([
      getDocumentsForAI(),
      getCustomTypes(),
    ]);
    const deterministic = await answerExpiryQuery(
      expiryQuery,
      detectRelevantTypes(cleanForIntent),
      docsForExpiry,
      customTypesForExpiry
    );
    if (deterministic) return deterministic;
  }

  const { contextText, docMap, tasks } = await buildContext(userMessage, history, limits);

  // Regulă suplimentară când userul cere date pentru un task specific:
  // răspunsul trebuie să folosească EXCLUSIV valorile reale din metadata și
  // să marcheze explicit câmpurile lipsă — niciodată să nu inventeze valori
  // plauzibile (ex. cilindree pentru o marcă cunoscută).
  const taskRule =
    tasks.length > 0
      ? `

## Reguli pentru răspuns la „DATE NECESARE"

Userul a cerut datele pentru: ${tasks.map(t => t.label).join(', ')}.
- Răspunde sub formă de listă, câmp cu câmp, în ordinea din specificația „=== DATE NECESARE ===".
- Pentru fiecare câmp, citește valoarea de unde indică specificația: din metadata documentului sursă din „=== DATE APLICAȚIE ===" (formatul: \`key: value\`) SAU din header-ul acelui document (formatul: \`| expiră: ...\`, \`| emis: ...\`).
- Dacă task-ul e cerut pentru mai multe persoane (sau pentru „toți", „familie", „noi"), repetă lista COMPLETĂ de câmpuri pentru FIECARE persoană, în aceeași ordine. Niciun câmp nu se omite la a doua persoană pentru că „e la fel" sau „a fost deja dat mai sus".
- Dacă o persoană din cele cerute nu are documentul sursă vizibil în context, spune explicit că lipsește pentru ea — nu o omite tăcut din răspuns.
- Dacă valoarea NU există în metadata documentului sursă → scrie EXPLICIT „lipsește din [tip document] — completează manual" SAU caută în OCR (\`OCR: ...\`) dacă apare ca text.
- INTERZIS: să inventezi valori plauzibile pentru marca/modelul respectiv (cilindree, putere, MMA etc.) chiar dacă „știi" specificațiile tipice. Răspunsul reflectă DOAR datele utilizatorului.
- La final, dacă există ≥1 câmp lipsă, sugerează: „Pentru completare, editează [DOC:...|...] din Acte și adaugă câmpurile lipsă."`
      : '';

  const today = new Date().toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const systemPrompt = `${buildAppKnowledge(cleanForIntent)}

Data curentă: ${today}. Folosește-o pentru a calcula vârste, expirări și „câte zile până la…". NU calcula o vârstă sau o durată dacă data de referință (ex. data nașterii) NU apare în datele de mai jos — în acest caz spune că informația lipsește, nu o inventa.

## Datele utilizatorului

${contextText}

${MEDICAL_REDIRECT_RULE}

## Citarea sursei — obligatorie

Orice informație luată dintr-un document se termină cu sursa, ca tag din context.
Un exemplu de răspuns corect:

Buletinul Silviei expiră pe 28.09.2026.
Sursa: [DOC:Buletin|abc-123]

Scrie sursa exact așa: pe linie separată, începând cu „Sursa: ", urmată de tag-ul
[DOC:...|...] copiat din context. Când menționezi o entitate, folosește tag-ul
[ENT:...|...|...] din context.

Răspunde DIRECT din „Datele utilizatorului" de mai sus — NU întreba userul dacă vrea să verifici ceva ce poți verifica chiar acum din context. INTERZIS: „vă rog să specificați dacă doriți să verificăm X" sau „ce document doriți să verificați" când informația cerută e deja vizibilă mai sus. Dacă informația cerută NU apare în context, spune explicit, într-o singură propoziție, că nu găsești acel document/dată — nu cere confirmare, nu propune pași suplimentari.${taskRule}`;

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt },
    // Filtrează mesajele cu conținut gol. Un model local poate întoarce răspuns
    // gol (ex. OOM/eroare) care ajunge salvat în thread; API-uri stricte (Mistral)
    // resping un mesaj assistant fără content cu 400 „must have content or tool_calls".
    // Pe model local, istoricul se plafonează: altfel crește la fiecare tur până
    // depășește fereastra („Context is full"). Remote are context suficient.
    ...(config.type === 'local' ? trimHistoryForLocal(history) : history)
      .filter(m => m.content.trim())
      .map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let reply = await sendAiRequest(messages, 500);

  // Post-procesare: înlocuiește orice [ID:uuid] rămas cu [DOC:label|uuid]
  // (AI-ul uneori ignoră instrucțiunile și generează formatul vechi)
  reply = reply.replace(/\[ID:([^\]]+)\]/g, (_match, id: string) => {
    const label = docMap.get(id);
    return label ? `[DOC:${label}|${id}]` : _match;
  });

  return appendSourceIfUnambiguous(reply, docMap);
}

/**
 * Adaugă linia „Sursa: [DOC:...]" când modelul a omis-o ȘI sursa e neambiguă.
 *
 * Regula din prompt („citează documentul") nu e respectată constant de modelele
 * mici — se vede în capturi: același model citează la o întrebare și omite la
 * următoarea. Aici o impunem în cod, dar DOAR când nu putem greși: un singur
 * document a intrat în context, deci el e obligatoriu sursa.
 *
 * Cu mai multe documente în context NU ghicim — o atribuire inventată e mai rea
 * decât o sursă lipsă, pentru că userul ar avea încredere în ea.
 */
export function appendSourceIfUnambiguous(reply: string, docMap: Map<string, string>): string {
  if (docMap.size !== 1) return reply;
  // Modelul a citat deja (oricum ar fi formulat) → nu dublăm.
  if (reply.includes('[DOC:')) return reply;
  const trimmed = reply.trim();
  if (!trimmed) return reply;
  const [id, label] = [...docMap.entries()][0];
  return `${trimmed}\n\nSursa: [DOC:${label}|${id}]`;
}
