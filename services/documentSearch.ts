/**
 * Căutarea din ecranul Documente.
 *
 * Până la 2026-10 bara de căutare se uita doar în numele documentului și în
 * notă: „Allianz", un număr de înmatriculare sau seria unei polițe nu găseau
 * nimic, deși textul era salvat. Acum se caută în nume, entitatea legată,
 * câmpurile completate (metadata), notă și textul citit din poză (OCR).
 *
 * Reguli:
 * - fără diacritice și fără majuscule („inmatriculare" găsește „Înmatriculare");
 * - toți termenii trebuie să apară, oriunde în document;
 * - de la 4 caractere în sus, potrivirea ignoră și spațiile/punctuația
 *   („b123abc" găsește „B 123 ABC", „ro25" găsește „RO/25/…");
 * - `private_notes` nu se caută niciodată: un fragment ar afișa CVV-uri,
 *   PIN-uri sau parole direct în listă;
 * - la documentele medicale se caută doar numele, entitatea și nota (ca
 *   înainte), fără fragment — conținutul lor rămâne în spatele blocării
 *   dosarului medical.
 */
import { MEDICAL_DOC_TYPES, type Document } from '@/types';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import { ITP_REVIEW_KEY } from './vehicleStatus';

/** Sub atât, potrivirea fără spații/punctuație ar prinde aproape orice. */
const MIN_COMPACT_TERM = 4;
const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 60;

type FieldKind = 'label' | 'entity' | 'meta' | 'note' | 'ocr';

interface IndexedField {
  kind: FieldKind;
  /** Textul în care se caută (la `meta`: doar valoarea câmpului). */
  text: string;
  /** Afișat înaintea fragmentului (la `meta`: „Nr. poliță: "). */
  prefix: string;
  norm: string;
  compact: string;
}

export interface SearchIndexEntry {
  fields: IndexedField[];
  /** `false` la documentele medicale — vezi antetul. */
  snippetAllowed: boolean;
}

interface QueryTerm {
  norm: string;
  compact: string;
}

export interface SearchQuery {
  terms: QueryTerm[];
}

export interface SearchSnippet {
  text: string;
  /** Intervalul potrivirii în `text`, pentru evidențiere. */
  matchStart: number;
  matchEnd: number;
}

export function normalizeForSearch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function compactOf(norm: string): string {
  return norm.replace(/[^a-z0-9]/g, '');
}

function makeField(kind: FieldKind, text: string, prefix = ''): IndexedField {
  const norm = normalizeForSearch(text);
  return { kind, text, prefix, norm, compact: compactOf(norm) };
}

function metadataFields(doc: Document): IndexedField[] {
  if (!doc.metadata) return [];
  const defs = DOCUMENT_FIELDS[doc.type] ?? [];
  const fields: IndexedField[] = [];
  for (const [key, value] of Object.entries(doc.metadata)) {
    if (!value || key === ITP_REVIEW_KEY) continue;
    const label = defs.find(f => f.key === key)?.label;
    fields.push(makeField('meta', String(value), label ? `${label}: ` : ''));
  }
  return fields;
}

/**
 * Indexul se construiește o dată per listă de documente; căutarea la fiecare
 * tastă face doar `includes` pe textul deja normalizat.
 */
export function buildSearchIndex(
  documents: Document[],
  describe: (doc: Document) => { label: string; entityName: string | null }
): Map<string, SearchIndexEntry> {
  const index = new Map<string, SearchIndexEntry>();
  for (const doc of documents) {
    const { label, entityName } = describe(doc);
    const isMedical = MEDICAL_DOC_TYPES.has(doc.type);
    const fields = [makeField('label', label)];
    if (entityName) fields.push(makeField('entity', entityName));
    if (!isMedical) fields.push(...metadataFields(doc));
    if (doc.note) fields.push(makeField('note', doc.note));
    if (!isMedical && doc.ocr_text) fields.push(makeField('ocr', doc.ocr_text));
    index.set(doc.id, { fields, snippetAllowed: !isMedical });
  }
  return index;
}

/** `null` pentru o căutare goală (doar spații). */
export function parseSearchQuery(raw: string): SearchQuery | null {
  const terms = normalizeForSearch(raw)
    .split(/\s+/)
    .filter(Boolean)
    .map(norm => ({ norm, compact: compactOf(norm) }));
  return terms.length > 0 ? { terms } : null;
}

function fieldMatches(field: IndexedField, term: QueryTerm): boolean {
  if (field.norm.includes(term.norm)) return true;
  return term.compact.length >= MIN_COMPACT_TERM && field.compact.includes(term.compact);
}

export function matchesQuery(entry: SearchIndexEntry, query: SearchQuery): boolean {
  return query.terms.every(term => entry.fields.some(f => fieldMatches(f, term)));
}

/**
 * Traduce un interval din textul normalizat (sau compact) în pozițiile din
 * textul original — normalizarea poate scoate caractere (diacritice
 * descompuse, spații și punctuație la varianta compactă).
 */
function mapRange(
  text: string,
  start: number,
  length: number,
  compact: boolean
): [number, number] | null {
  const starts: number[] = [];
  const ends: number[] = [];
  let pos = 0;
  for (const ch of text) {
    let n = normalizeForSearch(ch);
    if (compact) n = compactOf(n);
    for (let k = 0; k < n.length; k++) {
      starts.push(pos);
      ends.push(pos + ch.length);
    }
    pos += ch.length;
    if (starts.length >= start + length) break;
  }
  if (starts.length < start + length) return null;
  return [starts[start], ends[start + length - 1]];
}

function locate(field: IndexedField, term: QueryTerm): [number, number] | null {
  const at = field.norm.indexOf(term.norm);
  if (at >= 0) {
    // Cazul obișnuit: normalizarea păstrează lungimea, pozițiile coincid.
    if (field.norm.length === field.text.length) return [at, at + term.norm.length];
    return mapRange(field.text, at, term.norm.length, false);
  }
  if (term.compact.length < MIN_COMPACT_TERM) return null;
  const compactAt = field.compact.indexOf(term.compact);
  return compactAt >= 0 ? mapRange(field.text, compactAt, term.compact.length, true) : null;
}

function excerpt(field: IndexedField, [start, end]: [number, number]): SearchSnippet {
  const { text } = field;
  let from = Math.max(0, start - SNIPPET_BEFORE);
  let to = Math.min(text.length, end + SNIPPET_AFTER);
  // Taie la granița unui cuvânt, nu în mijlocul lui.
  if (from > 0) {
    const ws = text.slice(from, start).search(/\s/);
    if (ws >= 0) from += ws + 1;
  }
  if (to < text.length) {
    const ws = text.slice(end, to).search(/\s\S*$/);
    if (ws > 0) to = end + ws;
  }
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  const lead = `${field.prefix}${from > 0 ? '…' : ''}`;
  const before = clean(text.slice(from, start)).trimStart();
  const match = clean(text.slice(start, end));
  const after = clean(text.slice(end, to)).trimEnd();
  const matchStart = lead.length + before.length;
  return {
    text: `${lead}${before}${match}${after}${to < text.length ? '…' : ''}`,
    matchStart,
    matchEnd: matchStart + match.length,
  };
}

/**
 * Fragmentul care arată DE CE s-a potrivit documentul, sau `null` când motivul
 * se vede deja pe card (nume, entitate) ori documentul e medical. Se calculează
 * doar pentru rândurile randate, nu pentru toată lista.
 */
export function buildSnippet(entry: SearchIndexEntry, query: SearchQuery): SearchSnippet | null {
  if (!entry.snippetAllowed) return null;
  const visible = entry.fields.filter(f => f.kind === 'label' || f.kind === 'entity');
  const hidden = query.terms.filter(t => !visible.some(f => fieldMatches(f, t)));
  if (hidden.length === 0) return null;
  // Termenul cel mai lung e cel mai specific (un număr, un nume) — pe el arătăm.
  const target = hidden.reduce((a, b) => (b.norm.length > a.norm.length ? b : a));
  for (const kind of ['meta', 'note', 'ocr'] as const) {
    for (const field of entry.fields) {
      if (field.kind !== kind) continue;
      const range = locate(field, target);
      if (range) return excerpt(field, range);
    }
  }
  return null;
}
