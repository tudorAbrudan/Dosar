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
};

function buildPrompt(typeLabel: string, config: TypeConfig | undefined, ocrText: string): string {
  const fieldsInstruction = config?.fieldsHint
    ? `Câmpuri specifice pentru „${typeLabel}": ${config.fieldsHint}`
    : `Câmpuri utile în metadata: supplier, amount, invoice_number, tip_contract, policy_number, plate, vin, cnp, series, marca, model, due_date, period, insurer, bank, last4, lab, doctor, product_name — DOAR dacă le găsești`;

  const noteInstruction =
    config?.noteInstruction ??
    'Rezumat structurat cu informațiile cheie: identificatori (nr. document, serie, cod, poliță, VIN etc.), date importante, sume, nume și firme relevante. Format "Câmp: Valoare", câte un câmp pe rând. Max 15 rânduri. Omite informații administrative sau redundante.';

  const textSection = ocrText.trim()
    ? `\nText OCR (referință secundară):\n---\n${ocrText.slice(0, MAX_OCR_CHARS)}\n---`
    : '';

  const expirySection = config?.expiryRule ? `\n\n━━━ REGULĂ SPECIALĂ EXPIRY ━━━\n${config.expiryRule}` : '';

  return `Extrage câmpurile structurate din acest document românesc.
Tip document: ${typeLabel}${textSection}${expirySection}

Returnează DOAR JSON valid, fără text suplimentar:
{
  "issue_date": "YYYY-MM-DD sau null",
  "expiry_date": "YYYY-MM-DD sau null",
  "note": "...",
  "metadata": { "cheie": "valoare" }
}

Reguli:
- ${fieldsInstruction}
- note: ${noteInstruction}
- Nu inventa valori. Dacă nu găsești o informație, omite câmpul sau pune null
- Datele în format YYYY-MM-DD
- amount cu punct zecimal (ex: "123.45")`;
}

function parseResponse(response: string): ExtractResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { metadata: {} };

  let parsed: {
    issue_date?: string | null;
    expiry_date?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { metadata: {} };
  }

  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.metadata ?? {})) {
    if (typeof v === 'string' && v.trim()) metadata[k] = v.trim();
  }

  return {
    metadata,
    issue_date: typeof parsed.issue_date === 'string' ? parsed.issue_date : undefined,
    expiry_date: typeof parsed.expiry_date === 'string' ? parsed.expiry_date : undefined,
    note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : undefined,
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
  const prompt = buildPrompt(typeLabel, config, ocrText);

  const systemPrompt = `Ești un expert în extragerea datelor structurate din documente românești. Returnezi EXCLUSIV JSON valid.`;

  let response: string;
  if (imageBase64) {
    response = await sendAiRequestWithImage(systemPrompt, prompt, imageBase64, 'image/jpeg', 1200);
  } else {
    response = await sendAiRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      1000,
      'extraction'
    );
  }

  return parseResponse(response);
}
