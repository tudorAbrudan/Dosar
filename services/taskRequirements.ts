/**
 * taskRequirements.ts — Sursă de adevăr pentru „ce date îmi trebuie pentru X".
 *
 * Folosit de chatbot.ts pentru a răspunde precis la întrebări de tipul:
 *   - „dă-mi datele pentru RCA"
 *   - „ce trebuie pentru rovinietă"
 *   - „date pentru check-in hotel"
 *
 * Pattern: similar cu KEYWORD_TO_DOMAIN din chatbot.ts — intent detection pe
 * cuvinte cheie, injectare condiționată în prompt DOAR când e relevant.
 * Nu intră în baseline-ul system prompt-ului (zero bloat per request).
 *
 * Pentru a adăuga un task nou, completează lista TASK_REQUIREMENTS.
 */

import type { DocumentType } from '@/types';

export interface TaskField {
  key: string; // cheia exactă din metadata documentului sursă
  label: string; // eticheta umană (RO)
  required?: boolean; // true = obligatoriu pentru task
}

export interface TaskRequirement {
  /** Identificator stabil, folosit în loguri / referințe interne. */
  id: string;
  /** Etichetă umană afișată în secțiunea „DATE NECESARE". */
  label: string;
  /** Cuvinte cheie pentru intent detection (lowercase, fără diacritice). */
  keywords: string[];
  /** Tipul de document sursă (sau lista de tipuri, primul preferat). */
  sourceDocTypes: DocumentType[];
  /** Câmpurile cerute pentru completarea task-ului. */
  fields: TaskField[];
  /** Notă opțională (instrucțiuni, context legal etc.). */
  notes?: string;
}

export const TASK_REQUIREMENTS: TaskRequirement[] = [
  {
    id: 'rca',
    label: 'Poliță RCA (asigurare auto obligatorie)',
    keywords: [
      'rca',
      'asigurare obligatorie',
      'asigurare auto',
      'polita auto',
      'cotatie rca',
      'reinnoire rca',
      'reinnoiesc rca',
    ],
    sourceDocTypes: ['talon'],
    fields: [
      { key: 'plate', label: 'Nr. înmatriculare', required: true },
      { key: 'vin', label: 'Serie șasiu (VIN)', required: true },
      { key: 'marca', label: 'Marcă', required: true },
      { key: 'model', label: 'Model', required: true },
      { key: 'category', label: 'Categorie (J: M1/N1/L3e...)', required: true },
      { key: 'cilindree_cm3', label: 'Cilindree cm³ (P.1)', required: true },
      { key: 'putere_kw', label: 'Putere kW (P.2)', required: true },
      { key: 'an_fabricatie', label: 'An fabricație', required: true },
      { key: 'combustibil', label: 'Combustibil (P.3)', required: true },
      { key: 'nr_locuri', label: 'Nr. locuri (S.1)' },
      { key: 'masa_max_kg', label: 'Masă maximă autorizată kg (F.1)' },
      { key: 'culoare', label: 'Culoare (R)' },
    ],
    notes:
      'Asigurătorul cere și CNP-ul proprietarului (din buletin) plus istoricul bonus-malus (din ultima poliță RCA emisă pe același CNP).',
  },
  {
    id: 'casco',
    label: 'Poliță CASCO',
    keywords: ['casco', 'asigurare casco', 'cotatie casco', 'polita casco'],
    sourceDocTypes: ['talon'],
    fields: [
      { key: 'plate', label: 'Nr. înmatriculare', required: true },
      { key: 'vin', label: 'Serie șasiu (VIN)', required: true },
      { key: 'marca', label: 'Marcă', required: true },
      { key: 'model', label: 'Model', required: true },
      { key: 'an_fabricatie', label: 'An fabricație', required: true },
      { key: 'cilindree_cm3', label: 'Cilindree cm³ (P.1)' },
      { key: 'putere_kw', label: 'Putere kW (P.2)' },
      { key: 'combustibil', label: 'Combustibil (P.3)' },
      { key: 'culoare', label: 'Culoare (R)' },
    ],
    notes:
      'Asigurătorul cere valoarea de piață a vehiculului (estimată) + dotări (ABS, airbag, GPS, navi etc.) care nu apar pe talon.',
  },
  {
    id: 'rovinieta',
    label: 'Rovinietă (vinietă)',
    keywords: ['rovinieta', 'vigneta', 'vinieta', 'cumpar rovinieta'],
    sourceDocTypes: ['talon'],
    fields: [
      { key: 'plate', label: 'Nr. înmatriculare', required: true },
      { key: 'category', label: 'Categorie (J: M1/N1/N2/N3)', required: true },
      { key: 'masa_max_kg', label: 'Masă maximă autorizată kg (F.1)', required: true },
    ],
    notes:
      'Tariful depinde de categoria vehiculului (M1 autoturism, N1 ≤3.5t, N2 3.5-12t, N3 ≥12t) și MMA.',
  },
  {
    id: 'transfer_proprietate',
    label: 'Transfer proprietate auto (vânzare / cumpărare)',
    keywords: [
      'transfer auto',
      'vanzare auto',
      'cumpar masina',
      'schimb proprietar',
      'transcriere auto',
    ],
    sourceDocTypes: ['talon', 'carte_auto'],
    fields: [
      { key: 'plate', label: 'Nr. înmatriculare', required: true },
      { key: 'vin', label: 'Serie șasiu (VIN)', required: true },
      { key: 'marca', label: 'Marcă', required: true },
      { key: 'model', label: 'Model', required: true },
      { key: 'an_fabricatie', label: 'An fabricație', required: true },
      { key: 'cilindree_cm3', label: 'Cilindree cm³', required: true },
      { key: 'culoare', label: 'Culoare (R)', required: true },
    ],
    notes:
      'La notar ai nevoie de: talon, CIV (carte_auto), ITP în vigoare, RCA în vigoare, fișa de înmatriculare, buletinele ambelor părți, certificat fiscal.',
  },
  {
    id: 'checkin_hotel',
    label: 'Check-in hotel / cazare',
    keywords: ['cazare hotel', 'rezervare hotel', 'inregistrare hotel', 'checkin hotel'],
    sourceDocTypes: ['buletin', 'pasaport'],
    fields: [
      { key: 'series', label: 'Serie și număr', required: true },
      { key: 'cnp', label: 'CNP' },
    ],
    notes:
      'Hotelul cere ID-ul fizic la check-in; datele sunt pentru pre-completare online a fișei de cazare.',
  },
  {
    id: 'reinnoire_pasaport',
    label: 'Reînnoire / eliberare pașaport',
    keywords: [
      'reinnoire pasaport',
      'reînnoire pașaport',
      'reinnoiesc pasaport',
      'pasaport nou',
      'pașaport nou',
      'fac pasaport',
      'eliberare pasaport',
      'cerere pasaport',
    ],
    sourceDocTypes: ['buletin'],
    fields: [
      { key: 'surname', label: 'Nume', required: true },
      { key: 'given_names', label: 'Prenume', required: true },
      { key: 'cnp', label: 'CNP', required: true },
      { key: 'series', label: 'Serie + nr. CI', required: true },
      { key: 'birth_date', label: 'Data nașterii', required: true },
      { key: 'place_of_birth', label: 'Loc naștere', required: true },
      { key: 'sex', label: 'Sex', required: true },
      { key: 'address', label: 'Domiciliu', required: true },
      { key: 'citizenship', label: 'Cetățenie' },
    ],
    notes:
      'Programare la pasapoarte.mai.gov.ro. Pașaportul vechi (dacă există) se depune la cerere. Taxe: pașaport simplu electronic ~258 RON adult / 234 minor. Pentru minori sub 14 ani: acordul ambilor părinți + certificat naștere.',
  },
  {
    id: 'aplicatie_viza',
    label: 'Aplicație viză (turistică / business / studii)',
    keywords: [
      'aplicatie viza',
      'aplicație viză',
      'cerere viza',
      'cerere viză',
      'formular viza',
      'formular viză',
      'date pentru viza',
      'date pentru viză',
      'viza turistica',
      'viza turistică',
      'viza schengen',
      'viza usa',
      'viza sua',
      'viza uk',
      'ds-160',
    ],
    sourceDocTypes: ['pasaport'],
    fields: [
      { key: 'surname', label: 'Nume (familie)', required: true },
      { key: 'given_names', label: 'Prenume', required: true },
      { key: 'series', label: 'Nr. pașaport', required: true },
      { key: 'nationality', label: 'Cetățenie (cod 3 litere)', required: true },
      { key: 'birth_date', label: 'Data nașterii', required: true },
      { key: 'sex', label: 'Sex', required: true },
    ],
    notes:
      'Verifică `expiră:` din header-ul pașaportului — majoritatea consulatelor cer valabilitate ≥6 luni de la întoarcere; SUA cer ≥6 luni dincolo de durata șederii. Documente suplimentare (NU sunt în Dosar): poze format viză, dovezi financiare (extras cont 3-6 luni), itinerar zbor, rezervare hotel, scrisoare invitație/angajator, asigurare medicală călătorie ≥30.000 EUR (Schengen).',
  },
  {
    id: 'inmatriculare_auto',
    label: 'Înmatriculare auto nouă (la RAR / SPCRPCIV)',
    keywords: [
      'inmatriculare auto',
      'înmatriculare auto',
      'inmatriculez masina',
      'înmatriculez mașina',
      'rar inmatriculare',
      'placuta noua',
      'plăcuță nouă',
      'inmatriculare noua',
      'înmatriculare nouă',
      'masina noua inmatriculare',
    ],
    sourceDocTypes: ['carte_auto', 'buletin'],
    fields: [
      // Din CIV
      { key: 'vin', label: 'VIN / Serie șasiu (E)', required: true },
      { key: 'marca', label: 'Marca (D.1)', required: true },
      { key: 'model', label: 'Tipul / Model (D.2)', required: true },
      { key: 'an_fabricatie', label: 'An fabricație', required: true },
      { key: 'category', label: 'Categorie (J)', required: true },
      { key: 'cilindree_cm3', label: 'Cilindree cm³ (P.1)', required: true },
      { key: 'combustibil', label: 'Combustibil (P.3)', required: true },
      { key: 'culoare', label: 'Culoare (R)', required: true },
      { key: 'masa_max_kg', label: 'Masă maximă kg (F.1)' },
      { key: 'omologare', label: 'Nr. omologare (K)' },
      // Din buletin
      { key: 'cnp', label: 'CNP proprietar', required: true },
      { key: 'surname', label: 'Nume proprietar', required: true },
      { key: 'given_names', label: 'Prenume proprietar', required: true },
      { key: 'address', label: 'Domiciliu proprietar', required: true },
    ],
    notes:
      'Plăcuța se atribuie după domiciliu (B=București, CJ=Cluj, IS=Iași etc.). Dosar la SPCRPCIV: CIV original, contract vânzare-cumpărare (sau factură de la dealer), certificat fiscal (de la Direcția Impozite), RCA în vigoare, dovadă plată taxe (timbru de mediu + taxă plăcuțe + taxă autorizație provizorie dacă e cazul). ITP NU se cere pentru mașini noi sub 3 ani.',
  },
  {
    id: 'inchiriere_masina',
    label: 'Închiriere mașină / rent-a-car',
    keywords: [
      'inchiriere masina',
      'închiriere mașină',
      'rent a car',
      'rent-a-car',
      'sixt',
      'hertz',
      'avis',
      'europcar',
      'inchiriez masina',
      'închiriez mașină',
      'rezervare masina',
      'rezervare mașină',
    ],
    sourceDocTypes: ['permis_auto', 'buletin'],
    fields: [
      // Din permis
      { key: 'series', label: 'Nr. permis (câmpul 5)', required: true },
      { key: 'categories', label: 'Categorii permis (câmpul 9)', required: true },
      { key: 'surname', label: 'Nume', required: true },
      { key: 'given_names', label: 'Prenume', required: true },
      { key: 'birth_date', label: 'Data nașterii', required: true },
      { key: 'restrictions', label: 'Restricții (câmpul 12)' },
      // Din buletin (sau pașaport pentru închirieri în străinătate)
      { key: 'cnp', label: 'CNP (alternativă: nr. pașaport)' },
      { key: 'address', label: 'Domiciliu' },
    ],
    notes:
      'Categoria B obligatorie pentru autoturisme; vârsta minimă tipic 21-25 ani, unele firme cer permis emis cu ≥2 ani în urmă (calcula din `issue_date` sau `expiră:` minus 10 ani). Card de credit pentru garanție (NU debit) — NU e în Dosar. Pentru închirieri în străinătate: pașaport în loc de buletin + IDP (International Driving Permit) pentru țări non-UE.',
  },
  {
    id: 'checkin_avion',
    label: 'Check-in zbor / online check-in companie aeriană',
    keywords: [
      'check-in avion',
      'checkin avion',
      'check-in zbor',
      'checkin zbor',
      'check-in online',
      'checkin online',
      'imbarcare',
      'îmbarcare',
      'boarding pass',
      'check-in bilet',
      'checkin bilet',
      'date pentru bilet avion',
      'completare bilet',
    ],
    sourceDocTypes: ['pasaport', 'buletin'],
    fields: [
      { key: 'surname', label: 'Nume (familie)', required: true },
      { key: 'given_names', label: 'Prenume', required: true },
      { key: 'series', label: 'Nr. document de călătorie (pașaport sau CI)', required: true },
      { key: 'birth_date', label: 'Data nașterii', required: true },
      { key: 'sex', label: 'Sex', required: true },
      { key: 'nationality', label: 'Cetățenie (cod 3 litere, ex: ROU)' },
      { key: 'cnp', label: 'CNP (alternativă pe zboruri interne)' },
    ],
    notes:
      'Zboruri intra-Schengen / interne: acceptă buletin. Zboruri extra-Schengen: doar pașaport. Verifică `expiră: ...` din header-ul documentului — multe țări cer pașaport valid ≥6 luni de la întoarcere. Codul rezervării (PNR) și nr. card frequent flyer NU sunt în Dosar — le ai din emailul de la compania aeriană.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Detectează task-urile menționate în textul mesajului utilizatorului.
 * Returnează lista (poate fi goală) — un mesaj poate cere mai multe task-uri
 * simultan (rar, dar posibil: „date pentru RCA și vinietă").
 */
export function detectTaskRequirements(text: string): TaskRequirement[] {
  const norm = normalize(text);
  const matched: TaskRequirement[] = [];
  for (const req of TASK_REQUIREMENTS) {
    if (req.keywords.some(kw => norm.includes(normalize(kw)))) {
      matched.push(req);
    }
  }
  return matched;
}

/**
 * Formatează cerințele unui task pentru injectare în system prompt.
 * Sursa de adevăr a câmpurilor (cheile) — pe care chatbot-ul le va căuta în
 * metadata documentului sursă din contextul deja existent.
 *
 * Nu include valori — doar SPECIFICAȚIA. Valorile se află deja în secțiunea
 * „=== DATE APLICAȚIE ===" sub forma `key: value` (vezi chatbot.ts).
 */
export function formatTaskRequirementSpec(req: TaskRequirement): string {
  const lines: string[] = [];
  lines.push(`### ${req.label}`);
  lines.push(`Sursă: document de tip ${req.sourceDocTypes.join(' sau ')}.`);
  lines.push('Câmpuri necesare (caută-le în metadata documentului):');
  for (const f of req.fields) {
    const tag = f.required ? ' (obligatoriu)' : ' (opțional)';
    lines.push(`- ${f.label}${tag} → cheie: \`${f.key}\``);
  }
  if (req.notes) {
    lines.push(`Notă: ${req.notes}`);
  }
  return lines.join('\n');
}
