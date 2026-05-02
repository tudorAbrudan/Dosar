/**
 * OCR → AI Mapper
 *
 * Trimite textul OCR la AI și returnează câmpuri structurate pentru document:
 * - Tip document detectat
 * - Câmpuri specifice (metadate)
 * - Dată emitere / expirare
 * - Sugestii entitate asociată (persoană, vehicul, etc.)
 */

import { sendAiRequest, sendAiRequestWithImage } from './aiProvider';
import { extractPlateNumber } from './ocr';
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
  vehicles: Array<{ id: string; name: string; plate?: string; vin?: string }>;
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
export function sanitizeOcrText(text: string): string {
  return text
    .slice(0, 15000)
    .replace(/"""/g, "'''") // escape triple-quote delimiter
    .replace(/```/g, '~~~') // escape markdown code blocks
    .replace(/<\|/g, '< |') // escape Mistral special tokens
    .replace(/\[INST\]/gi, '[inst]') // escape instruction tokens
    .replace(/\[\/INST\]/gi, '[/inst]');
}

// ─── Bon carburant ────────────────────────────────────────────────────────────

export interface FuelAiResult {
  liters?: number;
  km?: number;
  price?: number;
  date?: string; // YYYY-MM-DD
  station?: string;
}

// ─── Mapper principal ─────────────────────────────────────────────────────────

export async function mapOcrWithAi(
  ocrText: string,
  entities: AvailableEntities,
  imageBase64?: string
): Promise<AiOcrResult> {
  // Folosim indecși numerici în loc de ID-uri reale — previne exfiltrarea ID-urilor
  const { entityContext, indexToId } = buildEntityContext(entities);

  const sanitizedOcr = sanitizeOcrText(ocrText);

  const systemMessage = `Ești un expert în analiza documentelor românești. Sarcina ta este să extragi date structurate din textul OCR furnizat și să returnezi exclusiv JSON valid, fără text suplimentar.`;

  const prompt = `Analizează textul OCR și returnează un JSON structurat.

TEXT OCR (poate conține mai multe fișiere separate prin "---"):
"""
${sanitizedOcr}
"""

IMPORTANT: Dacă există mai multe fișiere/pagini:
- Pentru "documentType" și "fields": identifică documentul PRINCIPAL (ex: polița RCA, nu scrisoarea de informare). Ignoră paginile de tip "scrisoare de însoțire", "informații produs", "adresă de înaintare".
- Pentru "structuredNote": include conținut din TOATE fișierele, nu doar cel principal.

ENTITĂȚI EXISTENTE ÎN APLICAȚIE (folosește indexul e0, e1, ... în entityId):
${entityContext}

━━━ REGULI MATCHING ENTITĂȚI ━━━

Pentru a lega documentul de o entitate existentă, compară cu DATELE entității (nu doar cu numele):
- Vehicule: caută în textul OCR orice placă ("B 123 ABC") sau VIN (17 caractere, fără I/O/Q) care apare în lista de mai sus la un vehicul. Dacă placa sau VIN-ul se potrivește → confidence="high" (chiar dacă numele vehiculului nu apare în text). CIV conține de obicei doar VIN; talonul conține placa și VIN; facturi service/amenzi conțin placa.
- Persoane, Proprietăți, Animale, Firme: matching după nume (exact sau parțial semnificativ).
- Nu inventa legături — dacă niciun identificator nu corespunde, nu returna entitySuggestions pentru acel tip.

━━━ REGULI IDENTIFICARE TIP DOCUMENT ━━━

VEHICULE — distincție critică:
- "talon" = Certificat de Înmatriculare (CR). Conține: "CERTIFICAT DE ÎNMATRICULARE", marcă/model/culoare/proprietar, ștampilă RAR cu data ITP. NU are "CARTE DE IDENTITATE". NU expiră ca document.
- "carte_auto" = Carte de Identitate a Vehiculului (CIV). Conține: "CARTE DE IDENTITATE A VEHICULULUI" sau "CERTIFICATUL DE ÎNMATRICULARE AL VEHICULULUI" cu booklet mic. NU expiră. NU conține placa (placa e doar pe talon). VIN-ul e etichetat "NUMĂRUL DE IDENTIFICARE AL VEHICULULUI" sau "NIV" sau ca punct "E." (câmpul E din formatul EU) — NU ca "VIN". Caută după aceste etichete. VIN-ul poate apărea fragmentat în OCR (ex: "WVW ZZZ1JZ3W 386752") — concatenează-l la 17 caractere fără spații.
- "itp" = Inspecție Tehnică Periodică. Conține: "INSPECȚIE TEHNICĂ PERIODICĂ", nr. stație ITP, rezultat ADMIS/RESPINS.
- "rca" = Poliță RCA (Răspundere Civilă Auto). Conține: "ASIGURARE OBLIGATORIE" sau "RCA", nr. poliță (format RO/XX/... sau ROXXV...), asigurator, interval de valabilitate, primă de asigurare.
  - Asiguratori români: Allianz, Groupama (prefix RO32V), Generali, Omniasig, Uniqa, Asirom, Grawe, Signal Iduna, Euroins, Axeria, Certasig, Metropolitan.
  - Dacă asiguratorul NU apare explicit în text, detectează-l din prefixul numărului de poliță: RO32V→Groupama, RO/01/→Allianz, RO/GR→Grawe, RO/UN→Uniqa.
  - prima: suma totală plătită ("Primă de asigurare", "Total de plată", "De plată") — format "850.00"
  - valid_from: data intrării în vigoare / începerea riscului (ZZ.LL.AAAA)
  - marca_model: marca și modelul vehiculului asigurat

IDENTITATE:
- "buletin" = carte de identitate română (CI), conține CNP, serie+număr (ex: RX 123456), adresă.
- "pasaport" = pașaport, conține MRZ, nr. pașaport (ex: 05123456).
- "permis_auto" = permis de conducere, conține categorii (A, B, C...), nr. permis.

MEDICAL:
- "analize_medicale" = buletin analize laborator: hemogramă, biochimie, urină etc. NU are dată de expirare.
  - lab: numele laboratorului (Synevo, MedLife, Regina Maria, Medicover, Bioclinica etc.)
  - doctor: medicul solicitant/prescriptor (poate apărea ca "Medic prescriptor", "Dr.", "Solicitat de")
  - pacient: numele pacientului (poate apărea ca "Pacient", "Numele pacientului", "Nume:")
- "reteta_medicala" = rețetă medicală cu medicamente prescrise. Are dată expirare (valabilitate rețetă).

FACTURI (utilități și servicii):
- "factura" = orice factură emisă de furnizori de servicii: curent electric (E.ON, Electrica, CEZ, Enel, DEER), gaz (Engie, Distrigaz, Romgaz), internet/TV (Digi/RCS&RDS, UPC/Vodafone, Orange, Telekom), apă (Apă Nova, Aquatim, Apa Canal), termoficare (Termoenergetica, RADET), etc.
  - supplier: numele companiei furnizoare (caută în header/antet, chiar dacă nu e precedat de "Furnizor:")
  - invoice_number: numărul facturii (poate fi "Seria XXX Nr. YYYYYYY" sau "Factura nr. XXXXXX")
  - amount: TOTALUL DE PLATĂ (nu subtotaluri intermediare). Caută: "Total de plată", "Sold de plată", "Total facturat", "De plată", "Total". Ia ULTIMA valoare dacă apar multiple.
  - due_date: data scadenței/limita de plată (format ZZ.LL.AAAA)
  - period: perioada de facturare ("01.03.2024 - 31.03.2024") — caută "Perioadă de facturare", "Perioada", interval de date

━━━ CÂMPURI EXACTE PER TIP (folosește EXACT aceste chei în "fields") ━━━

talon: plate="B 123 ABC", marca="VW", model="Golf", vin="VIN17CARACTERE", itp_expiry_date="ZZ.LL.AAAA" (data din ștampila ITP/RAR sau din "Data urmatoarei inspectii tehnice")
carte_auto: vin="VIN17CARACTERE" (CIV NU conține nr. de înmatriculare — nu-l include chiar dacă apare)
itp: plate="B 123 ABC"
rca: policy_number="RO32V32LM1100745021", insurer="Groupama", plate="B 123 ABC", prima="850.00", valid_from="01.04.2024", marca_model="Dacia Logan"
casco: policy_number="...", insurer="...", plate="B 123 ABC"
vigneta: plate="B 123 ABC"
buletin: series="RX 123456", cnp="1234567890123", birth_date="28.09.1985" (derivă din CNP: cifra 1=sex/secol, pozițiile 2-3=an, 4-5=lună, 6-7=zi; S∈{1,2}→1900+AA, S∈{5,6}→2000+AA), address="Str. Exemplu nr. 1, Cluj-Napoca" (doar dacă apare în text)
pasaport: series="05123456"
permis_auto: series="12345678", categories="B"
analize_medicale: lab="Synevo", doctor="Dr. Ionescu Maria", pacient="Popescu Ion"
reteta_medicala: doctor="Dr. Ionescu", medication_1="Amoxicilina 500mg"
factura: invoice_number="FAC-001", supplier="E.ON Energie România", amount="225.06", due_date="15.04.2024", period="01.03.2024 - 31.03.2024"
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

- issueDate: data emiterii/eliberării documentului (YYYY-MM-DD). null dacă nu există. NU folosi date de încetare contract, date de valabilitate perpetuă (ex: 31.12.2999) sau alte date administrative — doar data efectivă a documentului.
- expiryDate: data expirării documentului (YYYY-MM-DD). EXCEPȚII — pune null pentru: carte_auto, analize_medicale, buletin (expiryDate e separat), cadastru, act_proprietate.
- Pentru "talon": expiryDate = data ITP din ștampila RAR sau din "Data urmatoarei inspectii tehnice" (YYYY-MM-DD). Pune și în fields.itp_expiry_date (ZZ.LL.AAAA). NU pune data emiterii talonului în expiryDate.
- Pentru "factura": expiryDate = data scadenței/limita de plată (YYYY-MM-DD). Pune și în fields.due_date (ZZ.LL.AAAA). NU pune data emiterii facturii în expiryDate.
- Pentru "rca" și "casco": expiryDate = data expirării poliței (YYYY-MM-DD). issueDate = data emiterii poliței. Pune data intrării în vigoare în fields.valid_from (ZZ.LL.AAAA) — poate fi diferită de issueDate.
- Nr. înmatriculare românesc: format "B 123 ABC" sau "CJ 01 XYZ" etc.
- VIN: 17 caractere alfanumerice (niciodată litere I, O, Q).
- Pentru vehicule: dacă entitatea are numărul de înmatriculare între paranteze (ex. "Dacia Logan (B 123 ABC)") și acel număr apare în textul OCR, sugereaz-o cu confidence "high".

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
  "structuredNote": "<rezumat structurat al TUTUROR fișierelor din textul OCR (separate prin '---'):\n- Dacă există mai multe fișiere diferite: secțiune separată pentru FIECARE cu header clar (ex: 'RCA:', 'Factură:')\n- analize_medicale: toate analizele format 'Nume: Valoare Unitate (ref: Min-Max)'; Pacient, Laborator, Medic, Data recoltare\n- reteta_medicala: medicamente cu doze și durată; Medic, Data, Diagnostic, Unitate medicală\n- factura: Furnizor, Nr. factură, Sumă totală, Scadență, Perioadă facturare, Adresă livrare/consum, Nr. client/contract, detalii consum (kWh, m³, Gcal etc. dacă apar). Include toate valorile și identificatorii găsiți.\n- rca/casco: Nr. poliță, Asigurator, Vehicul, Perioadă valabilitate, Primă\n- contract: Tip, Valoare, Toate părțile (nume, CNP/CUI), Durată, Obiect\n- garantie: Produs, Serie, Perioadă garanție, Vânzător, Data cumpărare\n- alte tipuri: câmpurile cheie — identificatori, date, sume, părți implicate — format 'Câmp: Valoare'. Omite texte administrative și informații redundante.\nMax 40 rânduri pentru analize, 20 pentru restul. null dacă OCR-ul nu conține nimic util.>"
}

Răspunde DOAR cu JSON, fără text suplimentar.`;

  let rawResponse: string;
  if (imageBase64) {
    rawResponse = await sendAiRequestWithImage(systemMessage, prompt, imageBase64, 'image/jpeg', 1400);
  } else {
    rawResponse = await sendAiRequest(
      [
        { role: 'system' as const, content: systemMessage },
        { role: 'user' as const, content: prompt },
      ],
      1200
    );
  }

  const parsed = parseAiResponse(rawResponse, entities, indexToId);
  return augmentWithPlateMatch(parsed, ocrText, entities);
}

/**
 * Normalizează numărul de înmatriculare pentru comparație: uppercase,
 * elimină tot ce nu e alfanumeric (spații, cratime, puncte).
 * Ex: "B 123 ABC" / "B-123-ABC" / "b123abc" → "B123ABC"
 */
function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Match determinist: dacă OCR-ul conține un număr de înmatriculare care
 * se potrivește exact cu `plate_number` al unei mașini salvate, injectează
 * acea sugestie cu confidence "high" pe prima poziție. Overrides orice
 * sugestie de vehicul venită de la AI (plate matching e mai sigur decât
 * potrivirea textuală pe marcă/model).
 */
function augmentWithPlateMatch(
  result: AiOcrResult,
  ocrText: string,
  entities: AvailableEntities
): AiOcrResult {
  const extractedPlate = extractPlateNumber(ocrText);
  if (!extractedPlate) return result;

  const target = normalizePlate(extractedPlate);
  if (!target) return result;

  const matched = entities.vehicles.find(
    v => v.plate && normalizePlate(v.plate) === target
  );
  if (!matched) return result;

  const highMatch: AiEntitySuggestion = {
    entityType: 'vehicle',
    entityId: matched.id,
    entityName: matched.name,
    confidence: 'high',
  };

  // Elimină orice altă sugestie de vehicul (plate-ul e autoritatea) și
  // prepend-ează match-ul determinist.
  const filtered = result.entitySuggestions.filter(s => s.entityType !== 'vehicle');
  return {
    ...result,
    entitySuggestions: [highMatch, ...filtered],
  };
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
    entities.vehicles.map(v => {
      const extras: string[] = [];
      if (v.plate) extras.push(`placă: ${v.plate}`);
      if (v.vin) extras.push(`VIN: ${v.vin}`);
      const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      return { id: v.id, display: `${v.name}${suffix}` };
    })
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

const AI_NOTES_MAX_LENGTH = 3000;

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
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, ' ') // păstrează \x09=tab, \x0A=newline
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
  let result: string | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) result = raw;
  else {
    const m = raw.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
    if (m) result = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!result) return undefined;
  // Respinge ani absurzi (ex: 2999 din dată de încetare contract)
  const year = parseInt(result.slice(0, 4), 10);
  if (year < 1900 || year > 2099) return undefined;
  return result;
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
    default:
      return false;
  }
}
