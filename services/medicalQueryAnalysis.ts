/**
 * Zero-LLM analiză întrebare pentru chat-ul medical.
 *
 * Returnează termeni medicali (root-stemming RO + EN), intent (trend / latest /
 * general) și interval temporal (ultim N ani / luni, an specific). Folosit ca
 * pre-pass înainte de retrieval hybrid FTS5 + structured lookup.
 *
 * Trade-off conștient: stemming-ul e brut (root-list manual). Pentru MVP e
 * suficient — pe termeni medicali frecvenți în limba română.
 */

export type Intent = 'trend' | 'latest' | 'general';

export interface QueryAnalysis {
  /** Root-uri stem-uite găsite în întrebare (folosite ca prefix MATCH în FTS5). */
  searchTerms: string[];
  intent: Intent;
  /** ISO YYYY-MM-DD; null = fără filtru jos. */
  from: string | null;
  /** ISO YYYY-MM-DD; null = fără filtru sus. */
  to: string | null;
}

/**
 * Root-uri stem-uite pentru termeni medicali frecvenți RO+EN. Folosite ca
 * prefix MATCH în FTS5 (`colester*`, `tireotrop*` etc.) și pentru fuzzy
 * lookup în `medical_observations.name` decriptat.
 *
 * Listă deliberat incompletă; userul poate să-și ceară analize prin nume
 * exact (ex: „proteină C reactivă") și fuzzy match în structured lookup
 * va captura cazurile rare.
 */
const MED_ROOTS = [
  // Lipide
  'colester',
  'hdl',
  'ldl',
  'trigliceri',
  // Glucoză
  'glicem',
  'glicat',
  'glucoz',
  // Tiroidiene
  'tsh',
  'tireotrop',
  'tiroid',
  'ft3',
  'ft4',
  't3',
  't4',
  // Hematologie
  'hemoglobin',
  'leucocit',
  'trombocit',
  'eritrocit',
  'feritin',
  'fier',
  'sideremi',
  'mcv',
  'mch',
  'hematocrit',
  // Renale
  'creatinin',
  'uree',
  'gfr',
  'rfg',
  'acid uric',
  'urat',
  'urin',
  // Hepatice
  'transaminaz',
  'alt',
  'ast',
  'gamma',
  'ggt',
  'bilirubin',
  'albumin',
  'protein',
  // Cardio
  'troponin',
  'ck',
  'ldh',
  // Vitamine / minerale
  'vitamin',
  'd3',
  'b12',
  'b9',
  'folat',
  'calciu',
  'magneziu',
  'sodiu',
  'potasiu',
  'kaliu',
  'zinc',
  'cupru',
  // Hormonal
  'testoster',
  'estrogen',
  'progesteron',
  'cortizol',
  'prolactin',
  'fsh',
  'lh',
  // Inflamație / imun
  'pcr',
  'vsh',
  'esr',
  'imunoglobulin',
  'iga',
  'igg',
  'igm',
  // Documente / proceduri
  'vaccin',
  'medicament',
  'reteta',
  'tratament',
  'analiz',
  'imagistic',
  'rmn',
  'rezonant',
  'ct',
  'tomograf',
  'ecograf',
  'radiograf',
  'biopsie',
];

// \b doar la început — cuvintele pot continua (evoluat, evolutie, evoluție, ultima, ultimul).
const TREND_PATTERNS = /\b(evolu|trend|grafic|istoric|în timp|in timp|de-a lungul)/i;
const LATEST_PATTERNS =
  /\b(ultim|recent|cea mai noua|cea mai nouă|cel mai nou|de curând|de curand)/i;

/**
 * Strips diacritics + lowercase + trim. Folosit pentru fuzzy match pe nume
 * observații decriptate (în memorie, nu SQL).
 */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseInterval(q: string): { from: string | null; to: string | null } {
  const today = new Date();

  // „ultimii 2 ani", „ultimele 6 luni", „in ultimii 3 ani"
  const m = q.match(/ultim(?:ii|ele|a)?\s+(\d+)\s+(an|ani|luna|luni)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const isYears = /an/i.test(m[2]);
    const from = new Date(today);
    if (isYears) from.setFullYear(from.getFullYear() - n);
    else from.setMonth(from.getMonth() - n);
    return { from: toIsoDate(from), to: null };
  }

  // An specific („în 2024", „din 2023")
  const yearMatch = q.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const y = yearMatch[0];
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // „anul acesta" / „anul trecut"
  if (/anul\s+(acesta|curent)/i.test(q)) {
    return { from: `${today.getFullYear()}-01-01`, to: null };
  }
  if (/anul\s+trecut/i.test(q)) {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // „luna aceasta" / „luna trecută"
  if (/luna\s+(aceasta|curenta)/i.test(q)) {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toIsoDate(from), to: null };
  }

  return { from: null, to: null };
}

export function analyzeQuery(q: string): QueryAnalysis {
  const norm = normalizeName(q);
  const terms = new Set<string>();
  for (const root of MED_ROOTS) {
    if (norm.includes(root)) terms.add(root);
  }
  let intent: Intent = 'general';
  if (TREND_PATTERNS.test(q)) intent = 'trend';
  else if (LATEST_PATTERNS.test(q)) intent = 'latest';
  const interval = parseInterval(q);
  return {
    searchTerms: Array.from(terms),
    intent,
    from: interval.from,
    to: interval.to,
  };
}

/**
 * Construiește expresia FTS5 MATCH dintr-o listă de termeni. Prefix wildcard
 * pentru fiecare termen, conjuncție OR ca să prindem variante (HDL / LDL etc.).
 *
 * Returnează null dacă nu e niciun termen (caller-ul ar trebui să sară peste
 * căutarea FTS și să folosească doar lookup-ul structured).
 */
export function buildFtsMatchExpression(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map(t => `${t}*`).join(' OR ');
}
