import { sendAiRequest, sendAiRequestWithImage } from './aiProvider';
import type { ExtractResult } from './ocrExtractors';
import type { DocumentType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';

const MAX_OCR_CHARS = 3000;

interface TypeConfig {
  fieldsHint: string;
  noteInstruction: string;
  /** Regulă specială pentru expiryDate, prepended la „Reguli" în prompt. */
  expiryRule?: string;
}

const TALON_EXPIRY_RULE = `expiry_date pentru "talon" = data ULTIMEI inspecții ITP, citită EXCLUSIV de pe ȘTAMPILA CEA MAI DE JOS din tabelul „INSPECȚII TEHNICE PERIODICE" (anexă, partea dreaptă a talonului).

  PROCEDURĂ:
  1. Localizează tabelul ITP. Are 4-5 rânduri: primul TIPĂRIT (mașina nouă), restul completate la fiecare inspecție prin ȘTAMPILĂ + DATĂ SCRISĂ DE MÂNĂ.
  2. Mergi de SUS în JOS și identifică ULTIMUL rând cu ștampilă RAR aplicată.
  3. Citește data DE PE ACEA ȘTAMPILĂ (cea mai de jos). Toate ștampilele de deasupra sunt expirate, IGNORĂ-LE.
  4. Format dată ștampilă: "ZZ.LL.AA" (an cu 2 cifre → adaugă "20" în față, ex: "15.04.28" → 2028) sau "ZZ.LL.AAAA".

  REASAMBLARE FRAGMENTATĂ: data e FRECVENT scrisă VERTICAL pe 2-3 linii în interiorul ștampilei (ex: "15." sus, "04." mijloc, "28" jos = 15.04.2028). Reasamblează cifrele aliniate vertical din aceeași ștampilă într-o singură dată.

  HOLOGRAMĂ: ștampila cea mai recentă e adesea peste o hologramă reflexivă. Descifrează cifrele scrise PESTE ea — au prioritate față de orice altă dată din document.

  NULL OBLIGATORIU dacă ștampila cea mai de jos există dar NU poți citi cu CERTITUDINE data:
  → expiry_date: null
  → în metadata pune: "itp_warning": "Nu am putut citi cu certitudine data ITP de pe ștampila cea mai de jos. Verifică talonul și completează manual data expirării ITP."

  INTERZIS:
  - NU folosi câmpul I sau I.1 (data primei înmatriculări — din TRECUT).
  - NU folosi câmpul B (emitere talon).
  - NU folosi data tipărită din rând 1 dacă există ștampile pe rândurile următoare.
  - NU folosi o ștampilă mai veche dacă cea mai de jos e ilizibilă — pune null.
  - NU ghici. Null > dată inventată.

  Confuzii uzuale OCR: 0↔6, 0↔8, 1↔7, 2↔7. Dacă o dată pare în trecut pe o ștampilă recentă, recheck anul (ex. "2028" citit "2023").`;

const TYPE_CONFIG: Partial<Record<DocumentType, TypeConfig>> = {
  talon: {
    fieldsHint:
      'plate (nr. înmatriculare format "B 123 ABC"), marca (VW/Dacia etc.), model, vin (17 caractere, fără I/O/Q), itp_expiry_date (formatul ZZ.LL.AAAA, DOAR dacă expiry_date e completat — vezi regula de mai jos despre ștampila ITP)',
    noteInstruction:
      'Listează: marca/model, plate, VIN, capacitate cilindrică, propietar (C.2.1, C.2.2), data primei înmatriculări (câmpul I), număr certificat. NU include date ITP în notă — sunt în expiry_date.',
    expiryRule: TALON_EXPIRY_RULE,
  },
  analize_medicale: {
    fieldsHint:
      'lab (laboratorul: Synevo/MedLife/Regina Maria etc.), doctor (medic solicitant — "Dr.", "Medic solicitant", "Solicitat de"), pacient (numele pacientului — "Pacient:", "Nume:")',
    noteInstruction:
      'Listează TOATE analizele găsite, câte una pe rând, format: "Nume analiză: Valoare Unitate (ref: Min-Max)" sau "Nume analiză: Valoare Unitate". Adaugă la început: Pacient, Laborator, Medic, Data recoltare (dacă le găsești). Max 40 rânduri.',
  },
  reteta_medicala: {
    fieldsHint:
      'doctor (medic prescriptor — "Dr.", "Medic"), medication_1 (primul medicament după "Rp:" sau "1.")',
    noteInstruction:
      'Listează medicamentele prescrise cu doze, frecvență și durată. Adaugă: Medic, Data, Diagnostic, Unitate medicală (dacă apar). Include orice alte informații relevante din document.',
  },
  factura: {
    fieldsHint:
      'supplier (furnizor — din antet), invoice_number (numărul facturii), amount (total de plată), due_date (scadență ZZ.LL.AAAA), period (perioada de facturare)',
    noteInstruction:
      'Furnizor, Nr. factură, Sumă totală, Scadență, Perioadă facturare, Adresă livrare/consum, Nr. client/contract, detalii consum (dacă apar). Include toate valorile și identificatorii găsiți.',
  },
  contract: {
    fieldsHint: 'tip_contract (Chirie/Prestări servicii/Vânzare-cumpărare etc.), amount (valoare)',
    noteInstruction:
      'Tip contract, Valoare, Toate părțile contractante (nume, CNP/CUI, adrese), Durată, Perioadă, Obiect contract, Clauze importante. Include toți identificatorii și datele găsite.',
  },
  garantie: {
    fieldsHint: 'product_name (produsul garantat), serie_produs (seria/numărul de serie)',
    noteInstruction:
      'Produs, Serie/Nr. bon, Perioadă garanție, Vânzător, Magazin, Data cumpărare, Condiții garanție. Include toți identificatorii găsiți.',
  },
  abonament: {
    fieldsHint: 'service_name (serviciul: Netflix/Spotify etc.), amount (suma lunară/anuală)',
    noteInstruction:
      'Serviciu, Sumă, Periodicitate, Data reînnoire, Nr. cont/abonat, Beneficii incluse. Include toate detaliile găsite.',
  },
  asigurare_personala: {
    fieldsHint:
      'tip_asigurare ("viata" | "sanatate" | "calatorie" — alege pe baza obiectului poliței), asigurator (Allianz/NN/Generali/Signal Iduna/Mondial Assistance etc.), policy_number (numărul poliței), prima (sumă + frecvență, ex "250 RON/lună"), suma_asigurata, beneficiar (DOAR pentru viață), tip_eveniment (DOAR pentru viață: deces/invaliditate/boli grave), pachet (DOAR pentru sănătate), spitale_partenere (DOAR pentru sănătate), plafon_anual (DOAR pentru sănătate), destinatie (DOAR pentru călătorie), perioada_voiaj (DOAR pentru călătorie), acoperiri (DOAR pentru călătorie)',
    noteInstruction:
      'Listează: Tip asigurare (viață/sănătate/călătorie), Asigurat, Asigurator, Nr. poliță, Sumă asigurată/plafon, Primă (sumă + frecvență), Perioadă valabilitate. Pentru viață adaugă: Beneficiar, Tip eveniment acoperit. Pentru sănătate: Pachet servicii, Spitale partenere, Plafon anual. Pentru călătorie: Destinație, Perioadă voiaj, Acoperiri (medical/bagaje/anulare). Max 20 rânduri.',
  },
};

function buildPrompt(
  typeLabel: string,
  config: TypeConfig | undefined,
  ocrText: string,
  hasImage: boolean
): string {
  const fieldsInstruction = config?.fieldsHint
    ? `Câmpuri specifice pentru „${typeLabel}": ${config.fieldsHint}`
    : `Câmpuri utile în metadata: supplier, amount, invoice_number, tip_contract, policy_number, plate, vin, cnp, series, marca, model, due_date, period, insurer, bank, last4, lab, doctor, product_name — DOAR dacă le găsești`;

  const noteInstruction =
    config?.noteInstruction ??
    'Rezumat structurat cu informațiile cheie: identificatori (nr. document, serie, cod, poliță, VIN etc.), date importante, sume, nume și firme relevante. Format "Câmp: Valoare", câte un câmp pe rând. Max 15 rânduri. Omite informații administrative sau redundante.';

  // Când avem imagine (AI vision), NU mai injectăm OCR-ul existent — altfel AI
  // crede că OCR-ul e deja făcut și sare peste transcrierea în secțiunea OCR.
  // Pentru text-only (fallback fără vision), păstrăm referința.
  const textSection =
    !hasImage && ocrText.trim()
      ? `\nText OCR (referință primară — sursa pe care lucrezi):\n---\n${ocrText.slice(0, MAX_OCR_CHARS)}\n---`
      : '';

  const expirySection = config?.expiryRule
    ? `\n\n━━━ REGULĂ SPECIALĂ EXPIRY ━━━\n${config.expiryRule}`
    : '';

  const visionInstruction = hasImage
    ? `\n\nIMPORTANT: documentul îți este furnizat ca IMAGINE. Trebuie să CITEȘTI imaginea direct prin vision și să produci O TRANSCRIERE PROPRIE (secțiunea ===OCR===). NU presupune că ai deja OCR — citește pixel cu pixel din imagine. Acoperă tot conținutul vizibil al documentului, nu doar un rezumat.`
    : '';

  return `Procesează acest document românesc.
Tip document: ${typeLabel}${textSection}${expirySection}${visionInstruction}

Răspunsul TĂU trebuie să conțină AMBELE secțiuni de mai jos, în această ORDINE EXACTĂ. Folosește marker-ii pe linii separate, fără indentare:

===OCR===
[Antet]
Synevo - Laborator Bucuresti
[Pacient]
Ion Popescu, CNP 1234567890123
[Rezultate]
Hemoglobina: 14.5 g/dL (ref: 12.0-16.0)
Glucoza: 95 mg/dL (ref: 70-110)
[Concluzii]
Valori normale
===META===
{
  "issue_date": "2024-03-15",
  "expiry_date": null,
  "note": "rezumat scurt structurat",
  "metadata": { "lab": "Synevo" }
}

(exemplul de mai sus e doar formatul — înlocuiește cu datele reale din documentul curent)

REGULI OCR (după ===OCR===, ÎNAINTE de ===META===):
- OBLIGATORIU prezentă. Nu sări această secțiune.
- Transcrie TOT conținutul vizibil al documentului ca PLAIN TEXT (nu JSON, fără escape \\n, fără ghilimele wrapping). Linii noi normale.
- Păstrează ordinea naturală a citirii (sus → jos, stânga → dreapta).
- Grupează pe secțiuni cu titluri între paranteze pătrate când e relevant: [Antet], [Pacient], [Medic], [Date examen], [Rezultate], [Valori normale], [Concluzii], [Recomandări], [Diagnostic], [Tratament], [Semnătură], [Ștampilă]. Sări secțiunile care nu apar.
- Pentru tabele de analize: o linie per analiză, format „Nume analiză: Valoare Unitate (ref: Min–Max)".
- Pentru rețete: o linie per medicament, format „Denumire concentrație — doză, frecvență, durată".
- Pentru facturi/contracte/utilitare: liste linie cu linie, perechi „Câmp: Valoare".
- Include numere, coduri, CNP, serii, ștampile, semnături lizibile. Marchează pasajele ilizibile cu „[ilizibil]".
- NU rezuma. NU interpreta clinic. NU sări peste informații. Transcriere COMPLETĂ, structurată dar fidelă.
- Dacă documentul e gol/ilegibil complet → scrie doar: „[document gol sau ilegibil]".
- Fără markdown (**bold**, # heading). Doar text simplu cu marker-i "[Secțiune]".

REGULI META (după ===META===, până la sfârșit):
- JSON strict valid, toate cele 4 chei (issue_date, expiry_date, note, metadata) prezente.
- ${fieldsInstruction}
- note: ${noteInstruction}
- Nu inventa valori. Dacă nu găsești o informație, pune null sau omite cheia din metadata.
- Datele în format YYYY-MM-DD.
- amount cu punct zecimal (ex: "123.45").`;
}

/**
 * Extrage valoarea unui string JSON dintr-un text potențial truncat, fără
 * a folosi `JSON.parse`. Suportă escape-uri standard (\\n, \\", \\\\, etc.)
 * și se oprește la prima ghilimea neescapată sau la sfârșitul stringului
 * dacă răspunsul a fost cut mid-value (response-ul lui Mistral cu max_tokens
 * atins). Returnează `undefined` dacă cheia nu apare în text.
 */
function extractJsonStringField(text: string, key: string): string | undefined {
  const keyRe = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = keyRe.exec(text);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) break; // truncat mid-escape
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else if (next === '/') out += '/';
      else if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
        i += 6;
        continue;
      } else {
        out += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  // String truncat — întoarcem ce am acumulat, e mai bine decât nimic.
  return out;
}

interface ParsedMeta {
  issue_date?: string | null;
  expiry_date?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  ocr_text?: string | null;
}

function tryParseJson(text: string): ParsedMeta | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as ParsedMeta;
  } catch {
    return null;
  }
}

function buildResultFromParsed(parsed: ParsedMeta, ocrFallback?: string): ExtractResult {
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.metadata ?? {})) {
    if (typeof v === 'string' && v.trim()) metadata[k] = v.trim();
  }
  const ocrFromJson =
    typeof parsed.ocr_text === 'string' && parsed.ocr_text.trim()
      ? parsed.ocr_text.trim()
      : undefined;
  return {
    metadata,
    issue_date: typeof parsed.issue_date === 'string' ? parsed.issue_date : undefined,
    expiry_date: typeof parsed.expiry_date === 'string' ? parsed.expiry_date : undefined,
    note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : undefined,
    ocr_text: ocrFromJson ?? (ocrFallback?.trim() ? ocrFallback.trim() : undefined),
  };
}

interface MarkerMatch {
  name: 'OCR' | 'META';
  start: number; // index în response unde începe linia marker-ului
  end: number; // index după ultima literă a marker-ului (linia consumată)
}

const MARKER_RE = /^[ \t]*={3,}[ \t]*(OCR|META)[ \t]*={3,}[ \t]*$/gim;

function findAllMarkers(response: string): MarkerMatch[] {
  const out: MarkerMatch[] = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(response)) !== null) {
    out.push({
      name: m[1].toUpperCase() as 'OCR' | 'META',
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Parsează răspunsul AI. Format așteptat:
 *
 *   ===OCR===
 *   ...transcriere plain text cu marker-i [Secțiune]...
 *   ===META===
 *   {...JSON cu issue_date, expiry_date, note, metadata...}
 *
 * Parser-ul e tolerant la ordinea marker-ilor: META poate veni înainte de OCR.
 *
 * Fallback-uri (în ordinea încercată):
 *   1. Un singur marker găsit → restul răspunsului e secțiunea complementară.
 *   2. Niciun marker, dar JSON pur cu cheie `ocr_text` inline (compat vechi).
 *   3. JSON parțial + regex extracție pentru ocr_text/note (response truncat).
 */
function parseResponse(response: string): ExtractResult {
  const markers = findAllMarkers(response);

  if (markers.length >= 2) {
    // Două (sau mai multe) marker-e: extragem secțiunea fiecăruia până la
    // următorul marker (sau EOF pentru ultimul).
    const sections: Partial<Record<'OCR' | 'META', string>> = {};
    for (let i = 0; i < markers.length; i++) {
      const cur = markers[i];
      const next = markers[i + 1];
      const sliceEnd = next ? next.start : response.length;
      const body = response
        .slice(cur.end, sliceEnd)
        .replace(/^[\r\n]+/, '')
        .replace(/[\r\n]+$/, '')
        .trim();
      // Dacă marker-ul apare de mai multe ori, păstrează ultima secțiune nevidă.
      if (body) sections[cur.name] = body;
    }

    const metaPart = sections.META ?? '';
    const ocrPart = sections.OCR ?? '';
    const parsed = tryParseJson(metaPart);
    if (parsed) {
      return buildResultFromParsed(parsed, ocrPart);
    }
    const issueDate = extractJsonStringField(metaPart, 'issue_date');
    const expiryDate = extractJsonStringField(metaPart, 'expiry_date');
    const note = extractJsonStringField(metaPart, 'note');
    return {
      metadata: {},
      ocr_text: ocrPart || undefined,
      note: note && note.trim() ? note.trim() : undefined,
      issue_date: issueDate || undefined,
      expiry_date: expiryDate || undefined,
    };
  }

  if (markers.length === 1) {
    // Un singur marker: secțiunea găsită e după marker; restul (înainte) e
    // probabil secțiunea complementară. Pentru OCR-only response, considerăm
    // că tot ce e după marker e OCR și tot ce e înainte încercăm JSON.
    const m = markers[0];
    const before = response.slice(0, m.start).trim();
    const after = response
      .slice(m.end)
      .replace(/^[\r\n]+/, '')
      .replace(/[\r\n]+$/, '')
      .trim();
    if (m.name === 'OCR') {
      const parsed = tryParseJson(before);
      if (parsed) return buildResultFromParsed(parsed, after);
      return { metadata: {}, ocr_text: after || undefined };
    }
    // META primary
    const parsed = tryParseJson(after) ?? tryParseJson(before);
    return buildResultFromParsed(parsed ?? { metadata: {} }, before || after);
  }

  // Niciun marker — compatibilitate cu format vechi (JSON pur).
  const parsed = tryParseJson(response);
  if (parsed) return buildResultFromParsed(parsed);

  // JSON truncat — extragere regex best-effort.
  const jsonMatch = response.match(/\{[\s\S]*/);
  const rawText = jsonMatch ? jsonMatch[0] : response;
  const ocrText = extractJsonStringField(rawText, 'ocr_text');
  const noteField = extractJsonStringField(rawText, 'note');
  const issueDate = extractJsonStringField(rawText, 'issue_date');
  const expiryDate = extractJsonStringField(rawText, 'expiry_date');
  return {
    metadata: {},
    ocr_text: ocrText && ocrText.trim() ? ocrText.trim() : undefined,
    note: noteField && noteField.trim() ? noteField.trim() : undefined,
    issue_date: issueDate || undefined,
    expiry_date: expiryDate || undefined,
  };
}

/**
 * Extrage câmpuri structurate din document.
 * Când imageBase64 e furnizat, trimite imaginea la AI (vision) pentru rezultate mai bune.
 * Fallback automat la text-only dacă imaginea lipsește sau modelul nu suportă vision.
 */
export async function extractFieldsWithLlm(
  type: DocumentType,
  ocrText: string,
  imageBase64?: string
): Promise<ExtractResult> {
  const typeLabel = DOCUMENT_TYPE_LABELS[type] ?? type;
  const config = TYPE_CONFIG[type];
  const hasImage = !!imageBase64;
  const prompt = buildPrompt(typeLabel, config, ocrText, hasImage);

  const systemPrompt = `Ești un expert care procesează documente românești. Răspunzi EXACT în formatul cerut, cu marker-ii ===OCR=== și ===META=== pe linii separate. Secțiunea OCR este OBLIGATORIE și trebuie să conțină transcrierea completă a documentului în plain text (fără JSON). Secțiunea META conține JSON-ul cu câmpurile structurate.`;

  let response: string;
  if (imageBase64) {
    response = await sendAiRequestWithImage(systemPrompt, prompt, imageBase64, 'image/jpeg', 3500);
  } else {
    response = await sendAiRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      3000,
      'extraction'
    );
  }

  const result = parseResponse(response);
  if (!result.ocr_text) {
    console.warn(
      `[ocrLlmExtractor] AI nu a returnat ocr_text. Tip=${type}, response.length=${response.length}, response[0..400]=${response.slice(0, 400)}`
    );
  } else {
    console.warn(
      `[ocrLlmExtractor] AI a returnat ocr_text (${result.ocr_text.length} char), note=${result.note?.length ?? 0} char, response.length=${response.length}`
    );
  }
  return result;
}
