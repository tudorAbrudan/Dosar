import { getPersons, getProperties, getVehicles, getCards, getAnimals } from './entities';
import { getDocuments } from './documents';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, Document } from '@/types';
import { buildAppKnowledge } from './appKnowledge';
import { sendAiRequest } from './aiProvider';
import type { AiMessage } from './aiProvider';

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

async function buildContext(
  userMessage: string,
  history: ChatMessage[]
): Promise<{ contextText: string; filtered: boolean; docMap: Map<string, string> }> {
  const [persons, properties, vehicles, cards, animals, documents] = await Promise.all([
    getPersons(),
    getProperties(),
    getVehicles(),
    getCards(),
    getAnimals(),
    getDocuments(),
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
      if (p.iban) extra.push(`IBAN: ${p.iban}`);
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

    lines.push(`- [DOC:${label}|${doc.id}]${entityStr}${issued}${expiry}${noteStr}${meta}${ocrText}`);
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
  const { contextText, docMap } = await buildContext(userMessage, history);

  const systemPrompt = `${buildAppKnowledge()}

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
