/**
 * OCR → AI Mapper
 *
 * Trimite textul OCR la AI și returnează câmpuri structurate pentru document:
 * - Tip document detectat
 * - Câmpuri specifice (metadate)
 * - Dată emitere / expirare
 * - Sugestii entitate asociată (persoană, vehicul, etc.)
 */

import { sendAiRequest } from './aiProvider';
import type { DocumentType, EntityType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';

// ─── Tipuri rezultat ──────────────────────────────────────────────────────────

export interface AiEntitySuggestion {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AiOcrResult {
  documentType?: DocumentType;
  fields: Record<string, string>;
  expiryDate?: string; // YYYY-MM-DD
  issueDate?: string; // YYYY-MM-DD
  entitySuggestions: AiEntitySuggestion[];
  structuredNote?: string; // notă structurată pentru câmpul note al documentului
}

// ─── Entități disponibile (pentru context AI) ─────────────────────────────────

export interface AvailableEntities {
  persons: Array<{ id: string; name: string }>;
  vehicles: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; name: string }>;
  cards: Array<{ id: string; nickname: string; last4: string }>;
  animals: Array<{ id: string; name: string; species: string }>;
  companies: Array<{ id: string; name: string }>;
}

// ─── Tipuri document pentru prompt ───────────────────────────────────────────

const DOC_TYPE_LIST = Object.entries(DOCUMENT_TYPE_LABELS)
  .filter(([v]) => v !== 'custom')
  .map(([v, l]) => `${v}: ${l}`)
  .join(', ');

// ─── Sanitizare OCR ───────────────────────────────────────────────────────────

/**
 * Sanitizează textul OCR înainte de inserare în prompt.
 * Scop: previne prompt injection prin escaparea delimitatorilor și
 * a secvențelor care ar putea suprascrie instrucțiunile sistemului.
 */
function sanitizeOcrText(text: string): string {
  return text
    .slice(0, 15000)
    .replace(/"""/g, "'''") // escape triple-quote delimiter
    .replace(/```/g, '~~~') // escape markdown code blocks
    .replace(/<\|/g, '< |') // escape Mistral special tokens
    .replace(/\[INST\]/gi, '[inst]') // escape instruction tokens
    .replace(/\[\/INST\]/gi, '[/inst]');
}

// ─── Mapper principal ─────────────────────────────────────────────────────────

export async function mapOcrWithAi(
  ocrText: string,
  entities: AvailableEntities
): Promise<AiOcrResult> {
  // Folosim indecși numerici în loc de ID-uri reale — previne exfiltrarea ID-urilor
  const { entityContext, indexToId } = buildEntityContext(entities);

  const sanitizedOcr = sanitizeOcrText(ocrText);

  const systemMessage = `Ești un expert în analiza documentelor românești. Sarcina ta este să extragi date structurate din textul OCR furnizat și să returnezi exclusiv JSON valid, fără text suplimentar.`;

  const prompt = `Analizează textul OCR și returnează un JSON structurat.

TEXT OCR (poate conține mai multe pagini separate prin "---"):
"""
${sanitizedOcr}
"""

IMPORTANT: Dacă există mai multe pagini, analizează TOATE și identifică documentul principal (ex: polița RCA, nu scrisoarea de informare sau coperta). Ignoră paginile de tip "scrisoare de însoțire", "informații produs", "adresă de înaintare".

ENTITĂȚI EXISTENTE ÎN APLICAȚIE (folosește indexul e0, e1, ... în entityId):
${entityContext}

━━━ REGULI IDENTIFICARE TIP DOCUMENT ━━━

VEHICULE — distincție critică:
- "talon" = Certificat de Înmatriculare (CR). Conține: "CERTIFICAT DE ÎNMATRICULARE", marcă/model/culoare/proprietar, ștampilă RAR cu data ITP. NU are "CARTE DE IDENTITATE". NU expiră ca document.
- "carte_auto" = Carte de Identitate a Vehiculului (CIV). Conține: "CARTE DE IDENTITATE A VEHICULULUI" sau "CERTIFICATUL DE ÎNMATRICULARE AL VEHICULULUI" cu booklet mic. NU expiră.
- "itp" = Inspecție Tehnică Periodică. Conține: "INSPECȚIE TEHNICĂ PERIODICĂ", nr. stație ITP, rezultat ADMIS/RESPINS.
- "rca" = Poliță RCA. Conține: "ASIGURARE OBLIGATORIE", nr. poliță, asigurator, dată start/stop.

IDENTITATE:
- "buletin" = carte de identitate română (CI), conține CNP, serie+număr (ex: RX 123456), adresă.
- "pasaport" = pașaport, conține MRZ, nr. pașaport (ex: 05123456).
- "permis_auto" = permis de conducere, conține categorii (A, B, C...), nr. permis.

MEDICAL:
- "analize_medicale" = buletin analize laborator: hemogramă, biochimie etc. NU are dată de expirare.
- "reteta_medicala" = rețetă medicală cu medicamente prescrise. Are dată expirare (valabilitate rețetă).

━━━ CÂMPURI EXACTE PER TIP (folosește EXACT aceste chei în "fields") ━━━

talon: plate="B 123 ABC", marca="VW", model="Golf", vin="VIN17CARACTERE", itp_expiry_date="ZZ.LL.AAAA" (data din ștampila ITP/RAR sau din "Data urmatoarei inspectii tehnice")
carte_auto: plate="B 123 ABC", vin="VIN17CARACTERE"
itp: plate="B 123 ABC"
rca: policy_number="RO/XX/...", insurer="Allianz", plate="B 123 ABC"
casco: policy_number="...", insurer="...", plate="B 123 ABC"
vigneta: plate="B 123 ABC"
buletin: series="RX 123456", cnp="1234567890123"
pasaport: series="05123456"
permis_auto: series="12345678", categories="B"
analize_medicale: lab="Synevo"
reteta_medicala: doctor="Dr. Ionescu", medication_1="Amoxicilina 500mg"
factura: invoice_number="FAC-001", supplier="E.ON", amount="225.06"
garantie: product_name="iPhone 15", serie_produs="SN123"
contract: tip_contract="Chirie"
abonament: service_name="Netflix", amount="55.99"
card: last4="1234", bank="BCR"
act_proprietate: adresa="Str. Eminescu 5"
cadastru: nr_cadastral="234567", nr_carte_funciara="123456"
pad: policy_number="PAD-...", insurer="..."
vaccin_animal: vaccine_type="Antirabic", vet_name="Dr. Pop"
deparazitare: treatment_type="Externă", product_name="Frontline"
bilet: categorie="Avion", venue="OTP→LHR", eveniment_artist="RO123"

━━━ REGULI DATE ━━━

- issueDate: data emiterii/eliberării documentului (YYYY-MM-DD). null dacă nu există.
- expiryDate: data expirării documentului (YYYY-MM-DD). EXCEPȚII — pune null pentru: carte_auto, analize_medicale, buletin (expiryDate e separat), cadastru, act_proprietate.
- Pentru "talon": expiryDate = data ITP din ștampila RAR sau din "Data urmatoarei inspectii tehnice" (YYYY-MM-DD). Pune și în fields.itp_expiry_date (ZZ.LL.AAAA). NU pune data emiterii talonului în expiryDate.
- Nr. înmatriculare românesc: format "B 123 ABC" sau "CJ 01 XYZ" etc.
- VIN: 17 caractere alfanumerice (niciodată litere I, O, Q).

━━━ FORMAT RĂSPUNS ━━━

Returnează EXCLUSIV JSON valid:
{
  "documentType": "<tip sau null>",
  "fields": { "<cheie_exacta>": "<valoare>" },
  "issueDate": "<YYYY-MM-DD sau null>",
  "expiryDate": "<YYYY-MM-DD sau null>",
  "entitySuggestions": [
    { "entityType": "person|vehicle|property|card|animal|company", "entityId": "<id exact>", "entityName": "<nume>", "confidence": "high|medium|low" }
  ],
  "structuredNote": "<listă completă cu toate informațiile cheie extrase din document, inclusiv cele mapate în alte câmpuri. Datele vor fi citite de un chatbot, nu de utilizator direct — prioritizează date brute utile: numere, date, sume, coduri. Format:\nCâmp: Valoare\nCâmp: Valoare\n...\nMaxim 15 rânduri, concis. null dacă OCR-ul nu conține nimic util.>"
}

Răspunde DOAR cu JSON, fără text suplimentar.`;

  const rawResponse = await sendAiRequest(
    [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt },
    ],
    600
  );

  return parseAiResponse(rawResponse, entities, indexToId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Construiește contextul de entități folosind indecși numerici în loc de ID-uri reale.
 * Returnează și un map index→id real pentru a putea valida răspunsul AI ulterior.
 * Scop: ID-urile reale (UUID-uri) nu ajung în promptul trimis la AI.
 */
function buildEntityContext(entities: AvailableEntities): {
  entityContext: string;
  indexToId: Map<string, string>;
} {
  const lines: string[] = [];
  const indexToId = new Map<string, string>();
  let idx = 0;

  const addGroup = (label: string, items: Array<{ id: string; display: string }>) => {
    if (items.length === 0) return;
    const parts = items.map(item => {
      const key = `e${idx++}`;
      indexToId.set(key, item.id);
      return `[${key}] ${item.display}`;
    });
    lines.push(`${label}: ${parts.join(', ')}`);
  };

  addGroup(
    'Persoane',
    entities.persons.map(p => ({ id: p.id, display: p.name }))
  );
  addGroup(
    'Vehicule',
    entities.vehicles.map(v => ({ id: v.id, display: v.name }))
  );
  addGroup(
    'Proprietăți',
    entities.properties.map(p => ({ id: p.id, display: p.name }))
  );
  addGroup(
    'Carduri',
    entities.cards.map(c => ({ id: c.id, display: `${c.nickname} (****${c.last4})` }))
  );
  addGroup(
    'Animale',
    entities.animals.map(a => ({ id: a.id, display: `${a.name} (${a.species})` }))
  );
  addGroup(
    'Firme',
    entities.companies.map(c => ({ id: c.id, display: c.name }))
  );

  return {
    entityContext: lines.length > 0 ? lines.join('\n') : 'Nicio entitate disponibilă.',
    indexToId,
  };
}

interface RawAiJson {
  documentType?: string;
  fields?: Record<string, unknown>;
  issueDate?: string;
  expiryDate?: string;
  entitySuggestions?: Array<{
    entityType?: string;
    entityId?: string;
    entityName?: string;
    confidence?: string;
  }>;
  structuredNote?: string;
}

const AI_NOTES_MAX_LENGTH = 1000;

function parseAiResponse(
  raw: string,
  entities: AvailableEntities,
  indexToId: Map<string, string>
): AiOcrResult {
  // Extrage JSON din răspuns (poate veni cu ``` sau text suplimentar)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { fields: {}, entitySuggestions: [] };
  }

  let parsed: RawAiJson;
  try {
    parsed = JSON.parse(jsonMatch[0]) as RawAiJson;
  } catch {
    return { fields: {}, entitySuggestions: [] };
  }

  // Validăm tipul documentului
  const documentType = validateDocumentType(parsed.documentType);

  // Câmpuri — filtrăm valorile goale și limităm lungimea
  const fields: Record<string, string> = {};
  if (parsed.fields && typeof parsed.fields === 'object') {
    for (const [k, v] of Object.entries(parsed.fields)) {
      if (typeof v === 'string' && v.trim() && typeof k === 'string') {
        fields[k.slice(0, 50)] = v.trim().slice(0, 200);
      }
    }
  }

  // Date — validăm formatul YYYY-MM-DD
  const issueDate = validateDate(parsed.issueDate);
  const expiryDate = validateDate(parsed.expiryDate);

  // Sugestii entitate — rezolvăm indexul înapoi la ID real și validăm că există în DB
  const entitySuggestions: AiEntitySuggestion[] = [];
  if (Array.isArray(parsed.entitySuggestions)) {
    for (const s of parsed.entitySuggestions) {
      const validated = validateEntitySuggestion(s, entities, indexToId);
      if (validated) entitySuggestions.push(validated);
    }
  }

  // structuredNote — limităm lungimea și eliminăm caractere de control
  let structuredNote: string | undefined;
  if (typeof parsed.structuredNote === 'string' && parsed.structuredNote.trim()) {
    structuredNote = parsed.structuredNote
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .trim()
      .slice(0, AI_NOTES_MAX_LENGTH);
    if (!structuredNote) structuredNote = undefined;
  }

  return {
    documentType,
    fields,
    issueDate,
    expiryDate,
    entitySuggestions,
    structuredNote,
  };
}

function validateDocumentType(raw: unknown): DocumentType | undefined {
  if (typeof raw !== 'string') return undefined;
  const validTypes = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
  return validTypes.includes(raw as DocumentType) ? (raw as DocumentType) : undefined;
}

function validateDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Încearcă și formatul ZZ.LL.AAAA
  const m = raw.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

const VALID_ENTITY_TYPES = new Set<string>([
  'person',
  'vehicle',
  'property',
  'card',
  'animal',
  'company',
]);

function validateEntitySuggestion(
  s: { entityType?: string; entityId?: string; entityName?: string; confidence?: string },
  entities: AvailableEntities,
  indexToId: Map<string, string>
): AiEntitySuggestion | null {
  if (!s.entityType || !VALID_ENTITY_TYPES.has(s.entityType)) return null;
  if (!s.entityId || typeof s.entityId !== 'string') return null;

  const entityType = s.entityType as EntityType;

  // Rezolvăm indexul numeric (e0, e1, ...) înapoi la ID real
  const resolvedId = indexToId.get(s.entityId) ?? s.entityId;

  // Verificăm că ID-ul rezolvat există în aplicație
  const exists = checkEntityExists(entityType, resolvedId, entities);
  if (!exists) return null;

  const confidence = s.confidence === 'high' || s.confidence === 'low' ? s.confidence : 'medium';

  return {
    entityType,
    entityId: resolvedId,
    entityName: typeof s.entityName === 'string' ? s.entityName : resolvedId,
    confidence,
  };
}

function checkEntityExists(type: EntityType, id: string, entities: AvailableEntities): boolean {
  switch (type) {
    case 'person':
      return entities.persons.some(e => e.id === id);
    case 'vehicle':
      return entities.vehicles.some(e => e.id === id);
    case 'property':
      return entities.properties.some(e => e.id === id);
    case 'card':
      return entities.cards.some(e => e.id === id);
    case 'animal':
      return entities.animals.some(e => e.id === id);
    case 'company':
      return entities.companies.some(e => e.id === id);
  }
}
