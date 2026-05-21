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
import { DOCUMENT_TYPE_LABELS, NO_EXPIRY_DOC_TYPES, ALL_ENTITY_TYPES } from '@/types';

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
  persons: { id: string; name: string }[];
  vehicles: { id: string; name: string; plate?: string; vin?: string }[];
  properties: { id: string; name: string }[];
  cards: { id: string; nickname: string; last4: string }[];
  animals: { id: string; name: string; species: string }[];
  companies: { id: string; name: string }[];
}

// ─── Tipuri document pentru prompt ───────────────────────────────────────────

const DOC_TYPE_LIST = Object.entries(DOCUMENT_TYPE_LABELS)
  .filter(([v]) => v !== 'custom')
  .map(([v, l]) => `${v}: ${l}`)
  .join(', ');

// ─── Extracție JSON ───────────────────────────────────────────────────────────

// Extrage primul obiect JSON valid dintr-un text (poate include ``` sau text auxiliar)
export function extractFirstJsonObject(raw: string): unknown | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  // Încearcă lacom mai întâi (cazul comun: model returnează exact JSON)
  const end = raw.lastIndexOf('}');
  if (end <= start) return null;
  // Scanează închideri de la cea mai exterioară spre interior până găsim parse valid
  for (let i = end; i > start; i--) {
    if (raw[i] !== '}') continue;
    try {
      return JSON.parse(raw.slice(start, i + 1));
    } catch {
      // continuă căutarea cu paranteza precedentă
    }
  }
  return null;
}

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
  priceL?: number; // RON/litru (preț unitar din bon)
  date?: string; // YYYY-MM-DD
  station?: string;
  pump?: number; // nr. pompă (1-20)
}

export function validateFuelAiResponse(parsed: unknown): FuelAiResult {
  const r: FuelAiResult = {};
  if (!parsed || typeof parsed !== 'object') return r;
  const p = parsed as Record<string, unknown>;

  // liters: număr pozitiv, plauzibil pentru un bon (0.5 < L < 200)
  if (typeof p.liters === 'number' && p.liters > 0.5 && p.liters < 200) {
    r.liters = p.liters;
  }

  // price: număr pozitiv, plauzibil (1 < RON < 5000)
  if (typeof p.price === 'number' && p.price > 1 && p.price < 5000) {
    r.price = p.price;
  }

  // km: integer plauzibil (1000 < km < 9_999_999)
  if (typeof p.km === 'number' && Number.isInteger(p.km) && p.km > 1000 && p.km < 9_999_999) {
    r.km = p.km;
  }

  // date: YYYY-MM-DD valid CALENDARISTIC, în ultimii 2 ani și nu în viitor.
  // Reconstrucția prin Date+round-trip respinge "2026-85-82" sau "2026-02-30"
  // (pattern-ul simplu le-ar trece, dar nu sunt date reale).
  if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    const d = new Date(`${p.date}T00:00:00Z`);
    const roundTrip = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    if (roundTrip === p.date) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const twoYearsAgoDate = new Date();
      twoYearsAgoDate.setFullYear(twoYearsAgoDate.getFullYear() - 2);
      const twoYearsAgoStr = twoYearsAgoDate.toISOString().slice(0, 10);
      if (p.date <= todayStr && p.date >= twoYearsAgoStr) {
        r.date = p.date;
      }
    }
  }

  // station: string non-vid, max 100 chars
  if (typeof p.station === 'string' && p.station.trim()) {
    r.station = p.station.trim().slice(0, 100);
  }

  // pump: integer 1-20 (nr. pompă tipic la o stație)
  if (typeof p.pump === 'number' && Number.isInteger(p.pump) && p.pump >= 1 && p.pump <= 20) {
    r.pump = p.pump;
  }

  // priceL: preț unitar pe litru. Acceptăm orice valoare pozitivă rezonabilă
  // (0 < x < 100) — nu restricționăm la range RO 4-15 pentru a permite și bonuri
  // din străinătate (ex. EUR/L). UI-ul face cross-check matematic cu liters/price.
  if (typeof p.priceL === 'number' && p.priceL > 0 && p.priceL < 100) {
    r.priceL = p.priceL;
  }

  // Sanity check: dacă avem și liters și price, verifică plauzibilitatea
  // prețului implicit per litru. Carburant RO 2024-2026: 4-15 RON/L.
  // Pe bonurile MOL formatul "9,82 X 106,84 L" e (preț/litru × cantitate);
  // AI confunda uneori 9,82 cu cantitatea. Dacă raportul e absurd, refuzăm
  // valoarea AI pentru liters ca să lase regex-ul să folosească numărul
  // corect (cel cu sufixul L).
  if (r.liters !== undefined && r.price !== undefined) {
    const pricePerLiter = r.price / r.liters;
    if (pricePerLiter < 4 || pricePerLiter > 15) {
      delete r.liters;
    }
  }

  return r;
}

// Mirror of FuelInfo from services/ocr.ts — duplicated to keep aiOcrMapper test-friendly (no ML Kit native import).
export interface FuelMergeRegexInput {
  liters?: number;
  km?: number;
  price?: number;
  priceL?: number;
  date?: string;
  station?: string;
  pump?: number;
}

/**
 * Pentru `liters`: când AI și regex furnizează valori care diferă cu >10%,
 * preferă regex — `extractFuelInfo` are cross-check matematic (total/priceL)
 * care prinde confuziile de cifre OCR-style (1↔8, 0↔6 etc.) pe care AI vision
 * le produce uneori. Sub 10% (variație normală de rounding), AI câștigă.
 */
function pickLiters(ai?: number, regex?: number): number | undefined {
  if (ai === undefined) return regex;
  if (regex === undefined) return ai;
  const ratio = Math.max(ai, regex) / Math.min(ai, regex);
  return ratio > 1.1 ? regex : ai;
}

export function mergeFuelResults(ai: FuelAiResult, regex: FuelMergeRegexInput): FuelAiResult {
  return {
    liters: pickLiters(ai.liters, regex.liters),
    km: ai.km ?? regex.km,
    price: ai.price ?? regex.price,
    priceL: ai.priceL ?? regex.priceL,
    date: ai.date ?? regex.date,
    station: ai.station ?? regex.station,
    pump: ai.pump ?? regex.pump,
  };
}

export async function mapFuelReceiptWithAi(
  ocrText: string,
  imageBase64?: string
): Promise<FuelAiResult> {
  const sanitizedOcr = sanitizeOcrText(ocrText);

  const systemMessage =
    'Ești un expert în extragerea datelor din bonuri de carburant românești. Returnează exclusiv JSON valid, fără text suplimentar.';

  const prompt = `Extrage datele din bonul de carburant. TEXT OCR:
"""
${sanitizedOcr}
"""

Câmpuri de extras (toate opționale, omite ce nu e clar):
- liters: CANTITATEA de carburant alimentat, în litri (număr cu zecimale, ex: 42.31).
  ATENȚIE — pe bonurile MOL/OMV/Petrom/Rompetrol formatul tipic e:
    "PREȚ_PER_LITRU X CANTITATE L"  (ex: "9,82 X 106,84 L" → cantitate = 106,84)
  sau:
    "9,82 X 50,23 L  493,76"  (cantitate × preț/L = total)
  Cantitatea este numărul DE LÂNGĂ litera "L" (sufix), NU numărul de la stânga lui "X". Numărul de la stânga lui "X" este preț/litru (mereu 4-15 RON/L pe piața RO 2024-2026). Numărul cu "L" e cantitatea (de obicei 5-100 L).
  Dacă apare un singur număr cu sufix "L", "litri", "Cantitate", acela e cantitatea.

  ━━━ VERIFICARE OBLIGATORIE A ARITMETICII ━━━
  Înainte să returnezi cantitatea, calculează: PREȚ_PER_LITRU × CANTITATE și compară cu TOTAL.
  Exemplu: dacă vezi "9,82 X 106,84 L" și TOTAL = 1049,17 → 9,82 × 106,84 = 1049,17 ✓ corect.
  Dacă rezultatul nu se potrivește cu TOTAL în limita 1%, ai citit greșit o cifră — REVERIFICĂ.
  Confuzii uzuale OCR pe bonuri termice slab printate: 0↔6, 0↔8, 1↔7, 1↔8, 6↔8, 3↔8, 5↔6.
  Exemplu de eroare: "9,82 X 186,84 L" cu TOTAL 1049,17 → 9,82 × 186,84 = 1834,77 ≠ 1049,17. Reverifică prima cifră a cantității: probabil "1" citit ca "8" sau invers. Calculul corect: 1049,17 / 9,82 = 106,84 → cantitatea e 106,84, nu 186,84.
  Returnează valoarea consistentă cu TOTAL, NU prima citire.
- price: TOTALUL de plată (NU preț/litru, NU subtotal, NU "TOTAL TVA"). Caută linia "TOTAL:" exact (singură, fără cuvinte după). Ignoră "SUBTOTAL", "TOTAL TVA", "TOTAL TVA A". Format număr ex: 285.50, 1049.17.
- km: ODOMETRUL VEHICULULUI (rulajul mașinii, 5-7 cifre). Returnează km DOAR DACĂ apare cu unul din label-urile EXACTE: "Odometru:", "Rulaj:", "Kilometraj:" sau "KM vehicul:". Bonurile de carburant din România de regulă NU conțin odometru — în acest caz întoarce null pentru km.
  ATENȚIE — NU confunda cu:
  • Adresa stației pe autostradă, ex: "AUTOSTRADA A1 KM 316+360" sau "DN1 KM 45+200" (acel KM e poziția stației pe drum, NU odometrul).
  • Nr. bon fiscal, cod fiscal CUI/CIF, RC (registru comerț), ID tranzacție, ora, dată.
  • Codul de identificare a stației ("SB:", "RC:").
  Dacă ai vreun dubiu, returnează null pentru km.
- date: data bonului (YYYY-MM-DD). Convertește din ZZ.LL.AAAA. Validează: ziua 1-31, luna 1-12, anul ultimii 2 ani. Dacă o cifră e ambiguă (OCR a confundat 0↔8, 1↔7), reverifică din contextul bonului — data trebuie să fie reală.
- station: brand benzinărie + oraș/adresă scurtă (ex: "OMV Cluj-Napoca, Calea Turzii"). Branduri RO: OMV, MOL, Petrom, Lukoil, Rompetrol, Socar, Gazprom, Shell, BP, Avia, Eko.
- pump: NUMĂRUL POMPEI la care s-a alimentat (integer 1-20). Pe bonurile MOL/OMV/Petrom apare ca prefix la linia produsului: "*2 MOTORINA EVO D" → pump = 2; "*1 BENZINA 95" → pump = 1; "*12 GPL" → pump = 12. Returnează null dacă nu apare prefixul "*N" sau alt indicator clar de pompă.
- priceL: PREȚUL PE LITRU (RON/L sau valuta locală /L), număr cu zecimale. Pe bonurile MOL/OMV/Petrom e numărul DE LA STÂNGA lui "X" în formatul "PREȚ_PER_LITRU X CANTITATE L" (ex: "9,82 X 106,84 L" → priceL = 9.82). Pe alte bonuri poate fi etichetat "Preț unitar", "Pret/L", "RON/L". Pentru carburant RO 2024-2026 e tipic 4-15 RON/L. Returnează null dacă nu apare clar.

Returnează EXCLUSIV JSON:
{"liters": <număr|null>, "price": <număr|null>, "priceL": <număr|null>, "km": <int|null>, "date": "<YYYY-MM-DD|null>", "station": "<text|null>", "pump": <int|null>}

Răspunde DOAR cu JSON, fără text suplimentar.`;

  let rawResponse: string;
  if (imageBase64) {
    rawResponse = await sendAiRequestWithImage(
      systemMessage,
      prompt,
      imageBase64,
      'image/jpeg',
      400
    );
  } else {
    rawResponse = await sendAiRequest(
      [
        { role: 'system' as const, content: systemMessage },
        { role: 'user' as const, content: prompt },
      ],
      400,
      'extraction'
    );
  }

  const parsed = extractFirstJsonObject(rawResponse);
  if (parsed === null) return {};
  return validateFuelAiResponse(parsed);
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
  ━━━ DOUĂ FORMATE DE TALON ROMÂNESC ━━━
  • **Talon NOU (post-2018, EU-harmonizat):** card plastifiat format card de credit (ISO/IEC 7810 ID-1), față cu poză vehicul + coduri **A, B, D.1, D.2, E** etc. tipărite explicit lângă valori. Spate cu coduri **F.1, G, P.1, P.2, P.3, R, S.1** etc. Tabelul ITP poate fi pe spate sau anexă separată.
  • **Talon VECHI (pre-2018):** broșură A6 albă/gri pe hârtie, mai multe pagini, **NU are codurile EU literă/cifră** — câmpurile sunt etichetate doar textual în română („Marca", „Tipul", „Numărul de identificare", „Capacitate cilindrică" etc.). Tabelul ITP e tipărit pe paginile interioare.
  Pentru AMBELE formate folosește mapările definite la „CÂMPURI EXACTE PER TIP" — diferența e doar UNDE găsești valoarea (după cod literal vs. după etichetă textuală). Dacă vezi codurile A/D.1/E etc. → talon nou; dacă vezi doar etichete textuale RO fără coduri → talon vechi. Niciodată nu raporta tipul ca subcategorie — câmpul "documentType" rămâne "talon" în ambele cazuri.
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

FACTURI (utilități și servicii):
- "factura" = orice factură emisă de furnizori de servicii: curent electric (E.ON, Electrica, CEZ, Enel, DEER), gaz (Engie, Distrigaz, Romgaz), internet/TV (Digi/RCS&RDS, UPC/Vodafone, Orange, Telekom), apă (Apă Nova, Aquatim, Apa Canal), termoficare (Termoenergetica, RADET), etc.
  - supplier: numele companiei furnizoare (caută în header/antet, chiar dacă nu e precedat de "Furnizor:")
  - invoice_number: numărul facturii (poate fi "Seria XXX Nr. YYYYYYY" sau "Factura nr. XXXXXX")
  - amount: TOTALUL DE PLATĂ (nu subtotaluri intermediare). Caută: "Total de plată", "Sold de plată", "Total facturat", "De plată", "Total". Ia ULTIMA valoare dacă apar multiple.
  - due_date: data scadenței/limita de plată (format ZZ.LL.AAAA)
  - period: perioada de facturare ("01.03.2024 - 31.03.2024") — caută "Perioadă de facturare", "Perioada", interval de date

━━━ CÂMPURI EXACTE PER TIP (folosește EXACT aceste chei în "fields") ━━━

talon: Talonul românesc respectă formatul EU (Directiva 1999/37/CE) — fiecare câmp are un cod literă/cifră tipărit în stânga lui. Mapează STRICT după aceste coduri:
  - plate="B 123 ABC" — câmpul **A** „Număr de înmatriculare"
  - marca="VOLKSWAGEN" — câmpul **D.1** „Marca"
  - model="GOLF" — câmpul **D.2** „Tipul" sau **D.3** „Denumirea comercială"
  - vin="WVWZZZ1JZ3W386752" — câmpul **E** „Numărul de identificare al vehiculului" (NIV / VIN). Exact 17 caractere alfanumerice (niciodată I/O/Q). În talon e tipărit explicit cu prefixul „E.".
  - itp_expiry_date="ZZ.LL.AAAA" — data celei mai recente ștampile RAR din tabelul „INSPECȚII TEHNICE PERIODICE" (vezi „REGULI DATE")
  - category="M1" — câmpul **J** „Categoria vehiculului" (M1=autoturism, M2/M3=transport persoane, N1=utilitară ≤3.5t, N2=3.5-12t, N3≥12t, L3e=motocicletă, L7e=cvadriciclu, O=remorcă)
  - an_fabricatie="2020" — câmpul „ANUL FABRICAȚIEI" sau „An fabricație" (4 cifre). NU folosi câmpul **B** (acela e „Data primei înmatriculări" — diferit de anul fabricației). Dacă nu apare explicit, derivă din poziția 10 a VIN-ului (mapping standard ISO 3779: A=1980 → Y=2000, 1=2001 → 9=2009, A=2010 → Y=2030).
  - combustibil="Benzină" — câmpul **P.3** „Tipul de combustibil sau sursa de energie" (Benzină / Motorină / GPL / Electric / Hibrid / Hidrogen)
  - cilindree_cm3="1498" — câmpul **P.1** „Capacitatea cilindrică (cm³)". Doar cifre, fără unitate.
  - putere_kw="85" — câmpul **P.2** „Puterea netă maximă (kW)". Doar cifre, fără unitate. NU folosi CP — talonul EU exprimă puterea în kW (1 CP ≈ 0.7355 kW).
  - masa_max_kg="1670" — câmpul **F.1** „Masă maximă tehnic admisibilă (kg)" (MMA). Doar cifre. NU folosi câmpul **G** (acela e „Masa vehiculului în serviciu", diferit de MMA).
  - nr_locuri="5" — câmpul **S.1** „Numărul de locuri pe scaune" (inclusiv șoferul)
  - culoare="Gri" — câmpul **R** „Culoarea vehiculului"
  Atenție la confuziile uzuale: NU mapa câmpul **C** (proprietar), **H** (validitate înmatriculare), **I/I.1** (data primei înmatriculări), **K** (nr. omologare). Acestea NU sunt în lista de mai sus.
carte_auto: CIV-ul (Cartea de Identitate a Vehiculului) folosește aceleași coduri EU ca talonul nou. **NU conține număr de înmatriculare** — nu-l include chiar dacă apare ca însemnare ulterioară.
  - vin="WVWZZZ1JZ3W386752" — câmpul **E** „Numărul de identificare al vehiculului" / „NIV" (17 caractere, fără I/O/Q)
  - marca="VOLKSWAGEN" — câmpul **D.1** „Marca"
  - model="GOLF" — câmpul **D.2** „Tipul" / **D.3** „Denumirea comercială"
  - an_fabricatie="2020" — câmpul „ANUL FABRICAȚIEI" sau derivat din poziția 10 a VIN-ului
  - category="M1" — câmpul **J** „Categoria"
  - combustibil="Benzină" — câmpul **P.3** „Tipul de combustibil"
  - cilindree_cm3="1498" — câmpul **P.1** „Capacitatea cilindrică (cm³)", doar cifre
  - putere_kw="85" — câmpul **P.2** „Puterea netă maximă (kW)", doar cifre
  - masa_max_kg="1670" — câmpul **F.1** „Masă maximă tehnic admisibilă (kg)", doar cifre
  - nr_locuri="5" — câmpul **S.1** „Numărul de locuri pe scaune"
  - culoare="Gri" — câmpul **R** „Culoarea vehiculului"
  - omologare="eX*2007/46*XXXX*XX" — câmpul **K** „Numărul de omologare de tip"
itp: plate="B 123 ABC"
rca: policy_number="RO32V32LM1100745021", insurer="Groupama", plate="B 123 ABC", prima="850.00", valid_from="01.04.2024", marca_model="Dacia Logan"
casco: policy_number="...", insurer="...", plate="B 123 ABC"
vigneta: plate="B 123 ABC"
buletin: Acoperă atât CI vechi (laminat A7) cât și CEI nou (card cu cip, post-2021). Ambele formate au aceleași date utile.
  - series="RX 123456" — „Seria" + „Numărul" (RO format: 2 litere + 6 cifre)
  - cnp="1234567890123" — Codul Numeric Personal (13 cifre)
  - surname="POPESCU" — „Nume" / pe MRZ rândul 1 între tag-uri „<<"
  - given_names="ION ANDREI" — „Prenume"
  - sex="M" — „Sex" (M sau F). Dacă lipsește, derivă din CNP cifra 1: {1,3,5,7}→M, {2,4,6,8}→F.
  - citizenship="Română" — „Cetățenie" / „Naționalitate" (în RO de obicei „Română"; pe MRZ apare „ROU")
  - place_of_birth="Mun. Cluj-Napoca, Jud. Cluj" — „Loc naștere"
  - birth_date="28.09.1985" — „Născut(ă) la"; dacă nu apare textual, derivă din CNP: cifra 1=sex/secol, pozițiile 2-3=an, 4-5=lună, 6-7=zi; S∈{1,2}→1900+AA, S∈{5,6}→2000+AA
  - address="Str. Exemplu nr. 1, Cluj-Napoca" — „Domiciliu" (doar dacă apare în text)
  - issuer="SPCLEP Sect. 1" — „Emis de" / „Eliberat de" (SPCLEP = Serviciul Public Comunitar Local de Evidență a Persoanelor)
pasaport: series="05123456" (numărul pașaportului, 8-9 caractere alfanumerice), surname="POPESCU" (numele de familie, din MRZ rândul 1 între P< și <<; sau scris pe pagina cu poza), given_names="ION ANDREI" (prenumele complet, fără caractere <), nationality="ROU" (cod 3 litere ISO 3166: Romania=ROU, US=USA, UK=GBR etc., din MRZ poziția 11-13 a rândului 2), birth_date="28.09.1985" (data nașterii din MRZ format YYMMDD, expandează anul: dacă YY≥30 prefixează "19", altfel "20"), sex="M" (M sau F, din MRZ rândul 2 poziția 21)
permis_auto: Permisul EU (Directiva 2006/126/CE, model standardizat post-2013) are câmpuri numerotate 1-12 tipărite pe față, lângă valori. Pe permisul vechi (cartonat A7, pre-2013) câmpurile au doar etichete textuale RO — mapează după sens.
  - surname="POPESCU" — câmpul **1** „Numele"
  - given_names="ION ANDREI" — câmpul **2** „Prenumele"
  - birth_date="28.09.1985" — câmpul **3a** „Data nașterii"; sau derivă din CNP (vezi reguli buletin)
  - cnp="1234567890123" — câmpul **4d** „Numărul de identificare" (în RO = CNP)
  - series="12345678" — câmpul **5** „Numărul permisului" (NU CNP-ul!)
  - categories="B, BE, A2" — câmpul **9** „Categoriile" (listă separată prin virgulă: A, A1, A2, AM, B, BE, B1, C, C1, CE, C1E, D, D1, DE, D1E, Tr, Tb, Tv)
  - restrictions="01, 78" — câmpul **12** „Restricții" (coduri 01-78; 01=ochelari obligatorii, 78=numai cutie automată, etc.)
  NU confunda câmpul 5 (nr. permis) cu 4d (CNP) — sunt valori complet diferite.
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
certificat_botez: Certificat emis de o parohie ortodoxă/catolică/etc. ce atestă săvârșirea Tainei Botezului. Formularul tipărit are spații completate de mână cu nume și date (frecvent ilegibile parțial — concentrează-te pe text near printed labels). Document permanent (NU expiră). Câmpurile completate de mână pot avea ortografie variată (cratime, diacritice, prescurtări). REGULĂ CHEIE: certificatul de BOTEZ menționează și un nr. de certificat de NAȘTERE — acea referință NU îl face certificat de naștere. Decisiv: emisă de biserică (parohie/arhiepiscopie), nu de Starea Civilă.
  - subject_name="ABRUDAN TUDOR-VASILE" — numele celui botezat (copilul). Apare după labelul tipărit „fiului/fiicei" și înainte de „a(l) d-lui". Păstrează cratimele dacă există („TUDOR-VASILE", „ION-ANDREI"). Toate literele majuscule așa cum sunt scrise de mână.
  - baptism_date="14.05.1984" — data SĂVÂRȘIRII botezului (eveniment istoric, NU data eliberării certificatului). Apare după labelul „în ziua de" și înainte de „s-a săvârșit Sfânta Taină a Botezului". Format ZZ.LL.AAAA. ATENȚIE: NU confunda cu data nașterii (apare separat, după „fiind născut(ă) în ziua de"), nici cu data eliberării (apare la final, după „Drept care s-a eliberat acest certificat astăzi" — pune-o în issueDate, NU în baptism_date).
  - baptism_name="TUDOR-VASILE" — numele primit LA botez (poate fi diferit de cel din certificatul de naștere). Apare după „primind din botez numele" și înainte de „asistând ca naș". Poate lipsi dacă numele de botez coincide cu cel civil — atunci omite câmpul.
  - godparents="CÂNTA SIMONA" — numele nașilor. Apare după „asistând ca naș" și înainte de „domiciliat în localitatea" / „str." Dacă sunt mai mulți nași separați prin „și", concatenează cu „, " (ex. „POPESCU ION, POPESCU MARIA").
  - church="Sfântul Dumitru, Florești" — biserica/parohia. Combină hramul (între ghilimele după „Parohia Bisericii Ortodoxe/Catolice Române") cu localitatea (după „din localitatea"). Format „Hram, Localitate".
  - father_name="ABRUDAN VASILE" — numele tatălui copilului. Apare imediat după „a(l) d-lui" (părintele bărbat). Litere mari, păstrează cratimele și inițialele.
  - mother_name="ABRUDAN MARIANA" — numele mamei copilului. Apare după „și a(l) d-nei" pe rândul următor. Litere mari.
  - birth_date="01.04.1984" — data NAȘTERII copilului (eveniment biologic). Apare după „fiind născut(ă) în ziua de". Format ZZ.LL.AAAA. DIFERIT de baptism_date.
  - document_number="104/2016" — numărul propriu al certificatului de botez (NU al certificatului de naștere referit). Apare după „Nr." pe ultimul rând, înainte sau lângă semnătura preotului. Format „nr/an".
  - priest_name="Dumitru-Marcel Andreșa" — numele preotului paroh care a emis certificatul. Apare deasupra/lângă „PAROH" sau „preot paroh", de obicei dactilografiat. Poate include „Pr." / „Pr. Dr." ca prefix — păstrează-l.
  - issueDate — data eliberării certificatului (după „Drept care s-a eliberat acest certificat astăzi"), NU data botezului, NU data nașterii. Format YYYY-MM-DD în câmpul issueDate, nu în fields.
certificat_inregistrare: Certificat ONRC pentru firmă (SRL/SA/SNC) sau PFA/II/IF. Conține antet „CERTIFICAT DE ÎNREGISTRARE", „Cod Unic de Înregistrare", „Nr. de ordine în registrul comerțului".
  - cui="38122455" — câmpul „Cod Unic de Înregistrare" (CUI/CIF). DOAR cifre, fără prefix „RO". 6-10 cifre.
  - reg_com="F12/1096/22.08.2017" — câmpul „Nr. de ordine în registrul comerțului". Păstrează exact formatul de pe document (prefix 'J' pentru SRL/SA/SNC, 'F' pentru PFA/II/IF, 'C' pentru cooperative). Poate avea sufix doar an (ex. „J40/1234/2020") sau dată completă (ex. „F12/1096/22.08.2017") — capturează tot stringul așa cum apare.
  - denumire="ABRUDAN TUDOR VASILE PERSOANĂ FIZICĂ AUTORIZATĂ" — câmpul „Firma" sau „Denumire". Pentru PFA include integral „PERSOANĂ FIZICĂ AUTORIZATĂ"; pentru SRL/SA păstrează forma juridică în denumire (ex. „ACME SRL"). Nu trunchia.
autorizatie_activitate: tip_autorizatie="Sanitară" (Sanitară / ISU / Mediu / Construire / Funcționare), numar_autorizatie="1234/2023"
act_constitutiv: denumire="ACME SRL" (include forma juridică), legal_form="SRL" (SRL / SA / PFA / II / IF / SNC / SCS / SCA)
certificat_tva: cod_tva="RO12345678" (cu prefix RO dacă apare în document), denumire="ACME SRL"
asigurare_profesionala: policy_number="RCP/2024/001234", insurer="Allianz" (asiguratorul emitent)

━━━ REGULI DATE ━━━

- issueDate: data emiterii/eliberării documentului (YYYY-MM-DD). null dacă nu există. NU folosi date de încetare contract, date de valabilitate perpetuă (ex: 31.12.2999) sau alte date administrative — doar data efectivă a documentului.
- expiryDate: data expirării documentului (YYYY-MM-DD). PUNE OBLIGATORIU null pentru documentele care NU expiră niciodată: ${Array.from(NO_EXPIRY_DOC_TYPES).join(', ')}, buletin (expiryDate e separat, extras din MRZ). Pentru aceste tipuri, chiar dacă găsești o dată în document (de obicei data emiterii), NU o pune în expiryDate.
- Pentru "talon": expiryDate = data ULTIMEI inspecții tehnice efectuate, citită de pe ȘTAMPILA CEA MAI DE JOS DIN TABEL.
  ━━━ REGULĂ FUNDAMENTALĂ ITP — STRICT ━━━
  Pe un talon există: câmpul B (emitere talon), câmpurile I/I.1 (data primei înmatriculări), tabel ITP cu 4-5 rânduri (primul tipărit, restul completate manual la fiecare inspecție prin ȘTAMPILĂ + dată scrisă de mână de la stația RAR).
  **Sursa CORECTĂ pentru expiryDate este EXCLUSIV ștampila CEA MAI DE JOS din tabelul ITP** (ultimul rând completat). Asta e cea mai recentă inspecție efectuată; toate ștampilele de deasupra sunt expirate. Dacă tabelul are doar rând 1 tipărit (mașină nouă, fără ITP încă), folosește acea dată tipărită.
  ━━━ PROCEDURĂ OBLIGATORIE ━━━
  1. Localizează tabelul „INSPECȚII TEHNICE PERIODICE" (în partea dreaptă a talonului, anexă).
  2. Scanează rândurile de SUS în JOS și identifică ULTIMUL rând care are ștampilă RAR aplicată (cu dată scrisă de mână peste/lângă ștampilă). Asta e ștampila care contează.
  3. Citește data de pe acea ștampilă. Ignoră toate ștampilele de deasupra ei (sunt din inspecții vechi, expirate).
  4. expiryDate = data acelei ștampile, în format YYYY-MM-DD. Dacă ștampila are formatul "ZZ.LL.AA" (an cu 2 cifre), adaugă "20" în față (ex: "15.04.28" → 2028).
  ━━━ REASAMBLARE DATĂ DIN ȘTAMPILĂ FRAGMENTATĂ ━━━
  Pe ștampila RAR, data este FRECVENT scrisă de mână fragmentată pe 2 sau 3 LINII VERTICALE (una sub alta), nu pe o singură linie orizontală. Exemplu real:
    Linia 1 sus:    "15."
    Linia 2 mijloc: "04."
    Linia 3 jos:    "28"
  Aceste 3 fragmente aliniate vertical în interiorul aceleiași ștampile reprezintă O SINGURĂ DATĂ: 15.04.2028.
  REGULĂ: când vezi cifre/secvențe scurte aliniate vertical într-o ștampilă (sau în interiorul aceluiași contur dreptunghiular), reasamblează-le top-to-bottom în formatul ZZ.LL.AA(AA). Nu le trata ca date separate, nu le ignora pentru că „nu sunt pe o linie completă".
  Dacă ștampila e parțial acoperită de hologramă reflexivă, încearcă totuși să descifrezi cifrele scrise peste — au prioritate față de orice altă dată din document.
  ━━━ NULL E OBLIGATORIU DACĂ NU ȘTII SIGUR ━━━
  Dacă ștampila cea mai de jos există dar **nu poți citi cu CERTITUDINE** data de pe ea (e ilizibilă, parțial acoperită, scrisul de mână e ambiguu, hologramă prea reflexivă, lipsesc cifre):
  → expiryDate: **null** (NU ghici, NU folosi ștampila precedentă, NU folosi data tipărită din rând 1, NU folosi câmpul I/I.1)
  → în "fields" adaugă: **"itp_warning": "Nu am putut citi cu certitudine data ITP de pe ștampila cea mai de jos. Verifică talonul și completează manual data expirării ITP."**
  ━━━ INTERZIS ABSOLUT ━━━
  - NU folosi NICIODATĂ câmpul I sau I.1 (data primei înmatriculări) ca expiryDate.
  - NU folosi data emiterii talonului (câmpul B) în expiryDate.
  - NU folosi o ștampilă mai veche dacă cea mai de jos există dar e ilizibilă — preferă null.
  - NU presupune o dată dacă nu o vezi clar; null e mereu preferat unei date inventate.
  Confuzii uzuale OCR: 0↔6, 0↔8, 1↔7, 2↔7. Dacă o dată pare în trecut pentru o ștampilă recentă, verifică dacă nu cumva ai citit greșit anul (ex. "2028" citit "2023").
  Format final expiryDate: YYYY-MM-DD. Pune și în fields.itp_expiry_date (ZZ.LL.AAAA) DOAR dacă expiryDate nu e null.
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
  "structuredNote": "<rezumat structurat al TUTUROR fișierelor din textul OCR (separate prin '---'):\n- Dacă există mai multe fișiere diferite: secțiune separată pentru FIECARE cu header clar (ex: 'RCA:', 'Factură:')\n- factura: Furnizor, Nr. factură, Sumă totală, Scadență, Perioadă facturare, Adresă livrare/consum, Nr. client/contract, detalii consum (kWh, m³, Gcal etc. dacă apar). Include toate valorile și identificatorii găsiți.\n- rca/casco: Nr. poliță, Asigurator, Vehicul, Perioadă valabilitate, Primă\n- contract: Tip, Valoare, Toate părțile (nume, CNP/CUI), Durată, Obiect\n- garantie: Produs, Serie, Perioadă garanție, Vânzător, Data cumpărare\n- alte tipuri: câmpurile cheie — identificatori, date, sume, părți implicate — format 'Câmp: Valoare'. Omite texte administrative și informații redundante.\nMax 20 rânduri. null dacă OCR-ul nu conține nimic util.>"
}

Răspunde DOAR cu JSON, fără text suplimentar.`;

  let rawResponse: string;
  if (imageBase64) {
    rawResponse = await sendAiRequestWithImage(
      systemMessage,
      prompt,
      imageBase64,
      'image/jpeg',
      1400
    );
  } else {
    rawResponse = await sendAiRequest(
      [
        { role: 'system' as const, content: systemMessage },
        { role: 'user' as const, content: prompt },
      ],
      1200,
      'extraction'
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

  const matched = entities.vehicles.find(v => v.plate && normalizePlate(v.plate) === target);
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

  const addGroup = (label: string, items: { id: string; display: string }[]) => {
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
  entitySuggestions?: {
    entityType?: string;
    entityId?: string;
    entityName?: string;
    confidence?: string;
  }[];
  structuredNote?: string;
}

const AI_NOTES_MAX_LENGTH = 3000;

function parseAiResponse(
  raw: string,
  entities: AvailableEntities,
  indexToId: Map<string, string>
): AiOcrResult {
  // Extrage JSON din răspuns (poate veni cu ``` sau text suplimentar)
  const parsedJson = extractFirstJsonObject(raw);
  if (parsedJson === null) {
    return { fields: {}, entitySuggestions: [] };
  }
  const parsed = parsedJson as RawAiJson;

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

const VALID_ENTITY_TYPES = new Set<string>(ALL_ENTITY_TYPES);

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

// check-hardcoded-entities-disable-next-cluster
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
