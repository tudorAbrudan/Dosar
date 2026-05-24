export type DocumentType =
  | 'buletin'
  | 'pasaport'
  | 'permis_auto'
  | 'talon'
  | 'carte_auto'
  | 'rca'
  | 'casco'
  | 'itp'
  | 'vigneta'
  | 'act_proprietate'
  | 'cadastru'
  | 'factura'
  | 'impozit_proprietate'
  | 'contract'
  | 'card'
  | 'card_sanatate'
  | 'garantie'
  | 'certificat_nastere'
  | 'certificat_casatorie'
  | 'certificat_botez'
  | 'bon_cumparaturi'
  | 'bon_parcare'
  | 'pad'
  | 'stingator_incendiu'
  | 'abonament'
  | 'vaccin_animal'
  | 'deparazitare'
  | 'vizita_vet'
  | 'bilet'
  | 'certificat_inregistrare'
  | 'autorizatie_activitate'
  | 'act_constitutiv'
  | 'certificat_tva'
  | 'asigurare_profesionala'
  | 'asigurare_personala'
  | 'diploma'
  | 'foaie_matricola'
  | 'certificat_absolvire'
  | 'certificat_curs'
  | 'adeverinta_studii'
  // Medical
  | 'reteta_medicala'
  | 'analize_medicale'
  | 'scrisoare_medicala'
  | 'bilet_externare'
  | 'imagistica'
  | 'vaccin_persoana'
  | 'fisa_consultatie'
  | 'bilet_trimitere'
  | 'altul'
  | 'custom';

export interface CustomDocumentType {
  id: string;
  name: string;
  created_at: string;
}

export interface Person {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;  // ISO date YYYY-MM-DD
  createdAt: string;
}

export interface Property {
  id: string;
  name: string;
  createdAt: string;
}

export type VehicleFuelType = 'diesel' | 'benzina' | 'gpl' | 'electric';

export interface Vehicle {
  id: string;
  name: string;
  photo_uri?: string;
  plate_number?: string;
  fuel_type?: VehicleFuelType;
  createdAt: string;
}

export interface Card {
  id: string;
  nickname: string;
  last4: string;
  expiry?: string;
  createdAt: string;
}

export interface Animal {
  id: string;
  name: string;
  species: string;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string; // denumire firmă
  cui?: string; // cod unic de înregistrare
  reg_com?: string; // nr. registru comerț (ex: J40/1234/2020)
  createdAt: string;
}

// ─── Medical (Art. 9 GDPR) ────────────────────────────────────────────────────

export interface MedicalRecord {
  id: string;
  person_id: string;          // FK la persons; 1:1 strict
  name: string;
  ai_consent_at: string | null;
  ai_consent_version: number;
  encryption_key_ref: string; // ex: 'v1'
  blood_group?: string;
  allergies?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  created_at: string;
  updated_at: string;
}

export type ObservationCategory =
  | 'lipide'
  | 'hematologie'
  | 'tiroidiene'
  | 'hormonal'
  | 'hepatice'
  | 'renale'
  | 'urinare'
  | 'microbiologie'
  | 'imunologie'
  | 'biochimie'
  // Valori biometrice (greutate/kg, înălțime/cm etc.) — tracked as observations
  // over time for the Timeline sparkline UX, not as static fields on medical_record.
  | 'biometric'
  | 'altele';

export const OBSERVATION_CATEGORIES: ObservationCategory[] = [
  'lipide',
  'hematologie',
  'tiroidiene',
  'hormonal',
  'hepatice',
  'renale',
  'urinare',
  'microbiologie',
  'imunologie',
  'biochimie',
  'biometric',
  'altele',
];

export const OBSERVATION_CATEGORY_LABELS: Record<ObservationCategory, string> = {
  lipide: 'Lipide',
  hematologie: 'Hematologie',
  tiroidiene: 'Tiroidiene',
  hormonal: 'Hormonal',
  hepatice: 'Hepatice',
  renale: 'Renale',
  urinare: 'Urinare',
  microbiologie: 'Microbiologie',
  imunologie: 'Imunologie',
  biochimie: 'Biochimie',
  biometric: 'Biometric',
  altele: 'Altele',
};

export interface MedicalObservation {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  name: string;              // decriptat
  value: string | null;      // decriptat; string ca să accepte "pozitiv"/"negativ" + numeric
  unit: string | null;       // plaintext
  ref_min: string | null;    // decriptat
  ref_max: string | null;    // decriptat
  observed_at: string | null; // plaintext (sortare)
  category: ObservationCategory;
  confidence: number;
  needs_review: boolean;
  /** true dacă userul a editat manual valoarea după extracție AI. */
  user_corrected: boolean;
  created_at: string;
  updated_at: string;
}

export interface MedicalChatThread {
  id: string;
  medical_record_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  type: 'OBS' | 'DOC';
  id: string;
  doc_type?: DocumentType;
}

/** Tip rol mesaj chat medical. */
export type MedicalChatRole = 'user' | 'assistant';

/**
 * Citație în răspunsul asistentului medical.
 * Formatul din conținut: [OBS:id] sau [DOC:label|id].
 */
export type MedicalChatCitation =
  | { type: 'observation'; id: string }
  | { type: 'document'; id: string; label: string };

export interface MedicalChatMessage {
  id: string;
  thread_id: string;
  role: MedicalChatRole;
  content: string;          // decriptat
  citations: MedicalChatCitation[];
  created_at: string;
}

export interface MedicalDocumentSummary {
  document_id: string;
  summary: string;
  generated_at: string;
  model_used: string | null;
}

export interface MedicalShare {
  id: string;
  medical_record_id: string;
  created_at: string;
  expires_at: string;
  size_bytes: number;
  doc_count: number;
  obs_count: number;
  revoked_at: string | null;
}

/**
 * Înregistrare alimentare carburant / electric.
 *
 * - `vehicle_id` NULL ⇒ canistră / alt scop, nu intră în calcul consum, KM nu e required
 * - `vehicle_id` NOT NULL + `km_total` NULL ⇒ alimentare „pending KM" (intră în lanțul de calcul când KM-ul e completat ulterior)
 * - `is_full = false` ⇒ alimentare parțială (nu deschide o fereastră nouă în algoritmul full-to-full)
 */
export interface FuelRecord {
  id: string;
  vehicle_id?: string;
  date: string; // YYYY-MM-DD
  liters?: number;
  km_total?: number;
  price?: number;
  currency: string;
  fuel_type?: VehicleFuelType;
  is_full: boolean;
  station?: string;
  pump_number?: string;
  created_at: string;
}

export interface DocumentPage {
  id: string;
  document_id: string;
  page_order: number;
  file_path: string;
  created_at: string;
  /** True după ce userul a rotit manual pagina; OCR sare auto-rotate-ul. */
  orientation_locked: boolean;
}

export interface DocumentEntityLink {
  entityType: EntityType;
  entityId: string;
}

export interface Document {
  id: string;
  /** True după ce userul a rotit manual pagina principală (doc.file_path); OCR sare auto-rotate-ul. */
  main_orientation_locked: boolean;
  type: DocumentType;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  custom_type_id?: string;
  metadata?: Record<string, string>;
  pages?: DocumentPage[];
  // Legacy single-entity columns (backward compat)
  person_id?: string;
  property_id?: string;
  vehicle_id?: string;
  card_id?: string;
  animal_id?: string;
  company_id?: string;
  auto_delete?: string;
  ocr_text?: string;
  file_hash?: string;
  /**
   * Notă privată — rămâne STRICT pe device. Nu se trimite niciodată la AI
   * (chatbot, OCR LLM, sumarizare, etc.). Conține date sensibile alese de
   * utilizator: CVV carduri, PIN-uri, parole, coduri. Vezi
   * `sanitizeDocumentForAI` din `services/documents.ts` și
   * `.claude/rules/ai-privacy.md`.
   */
  private_notes?: string;
  /** ID-ul evenimentului din calendar (expirare sau bilet). Permite update silent / dedupe. */
  calendar_event_id?: string;
  /** Rezumat AI generat la extracția medicală. Markdown ușor. NU intră în FTS / chat (spec 2026-05-24 §8). */
  ai_summary?: string;
  /** Timestamp ISO la prima decizie a userului pe modalul de calendar reminders. Blochează re-prompt (D10). */
  medical_reminders_prompted_at?: string;
  /** JSON `[{label, suggested_date_iso}]` persistat tranzitoriu între extracție și prima vizitare a doc/dosar (D13). */
  pending_reminders_json?: string;
  created_at: string;
  // Multi-entity links (din document_entities junction table)
  entity_links?: DocumentEntityLink[];
}

export type MaintenancePresetKey =
  | 'oil'
  | 'timing_belt'
  | 'filters'
  | 'service'
  | 'itp'
  | 'brakes'
  | 'coolant'
  | 'custom';

export interface MaintenancePreset {
  key: MaintenancePresetKey;
  name: string;
  icon: string;
  trigger_km?: number;
  trigger_months?: number;
}

export interface VehicleMaintenanceTask {
  id: string;
  vehicle_id: string;
  name: string;
  preset_key?: MaintenancePresetKey;
  trigger_km?: number;
  trigger_months?: number;
  last_done_km?: number;
  last_done_date?: string;
  note?: string;
  calendar_event_id?: string;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceStatus = 'ok' | 'warning' | 'critical';

export interface MaintenanceTaskStatus {
  status: MaintenanceStatus;
  kmRemaining?: number;
  daysRemaining?: number;
  dueBy?: 'km' | 'date';
  dueMessage: string;
}

export type EntityType =
  | 'person'
  | 'property'
  | 'vehicle'
  | 'card'
  | 'animal'
  | 'company'
  | 'medical_record';

// Tipurile de entități pe care utilizatorul le poate activa/dezactiva din
// Setări → Vizibilitate sau adăuga din ecranul „Adaugă entitate".
export const ALL_ENTITY_TYPES: EntityType[] = [
  'person',
  'vehicle',
  'property',
  'card',
  'animal',
  'company',
  'medical_record',
];

/**
 * Etichete pentru entități — sursa unică de adevăr.
 * Folosit de Setări/Vizibilitate, „Adaugă entitate", OnboardingWizard,
 * ecran detail document. Adăugarea unui EntityType nou impune și aici o intrare.
 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  property: 'Proprietate',
  vehicle: 'Vehicul',
  card: 'Card',
  animal: 'Animal',
  company: 'Firmă',
  medical_record: 'Dosar medical',
};

/**
 * Emoji per entitate — folosit unde nu vrem Ionicons (header detail document,
 * onboarding, list-uri compacte).
 */
export const ENTITY_TYPE_EMOJI: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
  company: '🏢',
  medical_record: '🏥',
};

// Lista completă a tipurilor standard (fără 'custom') — apare în Setări
export const STANDARD_DOC_TYPES: DocumentType[] = [
  'buletin',
  'pasaport',
  'permis_auto',
  'certificat_nastere',
  'certificat_casatorie',
  'certificat_botez',
  'card_sanatate',
  // Medical
  'reteta_medicala',
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'vaccin_persoana',
  'fisa_consultatie',
  'bilet_trimitere',
  'talon',
  'carte_auto',
  'rca',
  'casco',
  'itp',
  'vigneta',
  'act_proprietate',
  'cadastru',
  'factura',
  'impozit_proprietate',
  'pad',
  'contract',
  'card',
  'garantie',
  'abonament',
  'bon_cumparaturi',
  'bon_parcare',
  'stingator_incendiu',
  'vaccin_animal',
  'deparazitare',
  'vizita_vet',
  'bilet',
  'certificat_inregistrare',
  'autorizatie_activitate',
  'act_constitutiv',
  'certificat_tva',
  'asigurare_profesionala',
  'asigurare_personala',
  'diploma',
  'foaie_matricola',
  'certificat_absolvire',
  'certificat_curs',
  'adeverinta_studii',
  'altul',
];

/**
 * Tipuri de documente care, inerent, se repetă peste timp pentru aceeași entitate.
 *
 * Pentru ele, un al doilea document de același tip + entitate NU e duplicat —
 * e o intrare nouă (analiză nouă, factură lună nouă, asigurare reînnoită etc.).
 * Detecția de duplicat trebuie să folosească un câmp distinctiv suplimentar
 * (în primul rând `issue_date`).
 *
 * Tipurile care NU sunt aici (buletin, pasaport, talon, card, act_proprietate,
 * cadastru, diplomă, etc.) sunt considerate unice per entitate la un moment dat
 * și păstrează detecția simplă de duplicat pe (type + entity).
 */
export const REPEATABLE_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  // Veterinar — repetabile (vaccinuri anuale, deparazitări lunare, controale)
  'vizita_vet',
  'vaccin_animal',
  'deparazitare',
  // Financiar — facturi/bonuri/abonamente recurente, contracte separate
  'factura',
  'bon_cumparaturi',
  'bon_parcare',
  'abonament',
  'garantie',
  'contract',
  'impozit_proprietate',
  // Asigurări — reînnoiri anuale; istoricul rămâne valid
  'asigurare_personala',
  'asigurare_profesionala',
  'rca',
  'casco',
  'pad',
  // Auto — reînnoiri periodice
  'itp',
  'vigneta',
  // Diverse — bilete sunt unice per eveniment, dar multiple per persoană
  'bilet',
  // Curs — se pot face multiple
  'certificat_curs',
  // Medical — se repetă (analize periodice, rețete recurente, vaccinuri anuale, imagistică,
  // consultații succesive la specialist, bilete de trimitere multiple)
  'analize_medicale',
  'vaccin_persoana',
  'imagistica',
  'reteta_medicala',
  'fisa_consultatie',
  'bilet_trimitere',
]);

/**
 * Tipuri de documente medicale (categoria specială Art. 9 GDPR).
 * Folosit pentru: filtrarea picker-ului în detaliu medical_record,
 * triggering medicalExtractor.extractAsync, sanitizare AI privacy.
 */
export const MEDICAL_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  'reteta_medicala',
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'vaccin_persoana',
  'fisa_consultatie',
  'bilet_trimitere',
]);

// Tipuri active implicit pentru utilizatori noi — doar ce folosesc cei mai mulți
export const DEFAULT_VISIBLE_DOC_TYPES: DocumentType[] = [
  // Identitate — toată lumea
  'buletin',
  'pasaport',
  'permis_auto',
  'certificat_nastere',
  'card_sanatate',
  // Vehicule — cei mai mulți adulți
  'talon',
  'carte_auto',
  'rca',
  'vigneta',
  // 'itp' dezactivat by default — data ITP e stocată pe talon; utilizatorul poate activa din Setări
  // Financiar — toată lumea
  'factura',
  'contract',
  'card',
  'garantie',
  'abonament',
  'asigurare_personala',
  // Fallback
  'altul',
];

/**
 * Tipuri de documente care **nu au termen de expirare**. UI-ul nu afișează
 * câmpul „Data expirare" pentru ele, AI nu extrage `expiryDate`, și nu se
 * oferă reminder de expirare în calendar.
 *
 * Diplomele, certificatele de stare civilă și actele de proprietate sunt
 * valabile permanent. Bonurile/parcările/vizitele sunt evenimente trecute.
 *
 * NOTĂ:
 * - `talon` NU este aici — câmpul `expiry_date` pentru talon stochează
 *   scadența ITP (vezi `EXPIRY_FIELD_LABEL`).
 * - `buletin` NU este aici — buletinul are dată de expirare (5-10 ani),
 *   extrasă din MRZ separat de fluxul AI generic.
 */
export const NO_EXPIRY_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  // Acte fundamentale — valabile permanent
  'certificat_nastere',
  'certificat_casatorie',
  'certificat_botez',
  // Proprietate — nu expiră (drepturi permanente)
  'act_proprietate',
  'cadastru',
  // Factură — documentul fiscal e valabil permanent ca dovadă; scadența de
  // plată e o caracteristică a OBLIGAȚIEI, nu a documentului, și rămâne în
  // `metadata.due_date` (vizibilă în detail, fără reminder calendar).
  'factura',
  // Contract — documentul ca atare e o dovadă permanentă a înțelegerii; data
  // de încheiere a contractului (chirie expiră, muncă determinată etc.) este
  // un atribut al obligației, nu al documentului. Userul poate stoca data în
  // `note` sau ca memo separat dacă vrea reminder.
  'contract',
  // Vehicul — CIV nu expiră (doar talonul are ITP)
  'carte_auto',
  // Firmă — acte constitutive permanente
  'certificat_inregistrare',
  'act_constitutiv',
  'certificat_tva',
  // Studii — diplomele, certificatele de absolvire/curs și adeverințele de
  // studii (de regulă atestă absolvirea) sunt documente permanente — fără
  // termen real de expirare. Adeverințele „sunt elev/student" cu valabilitate
  // 3-6 luni sunt edge case → user-ul setează manual în câmpul „Notă" data
  // recomandată de re-emitere (sau folosește un memo separat).
  'diploma',
  'foaie_matricola',
  'certificat_absolvire',
  'certificat_curs',
  'adeverinta_studii',
  // Medical — snapshot-uri punctuale; nu expiră formal. (Rețetele și vaccinurile
  // au valabilitate / next-dose-due → rămân în afara setului.)
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'fisa_consultatie',
  // Bonuri și vizite — evenimente trecute, fără expirare
  'bon_cumparaturi',
  'bon_parcare',
  'vizita_vet',
]);

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  buletin: 'Buletin',
  pasaport: 'Pașaport',
  permis_auto: 'Permis auto',
  talon: 'Talon',
  carte_auto: 'Carte auto',
  rca: 'RCA',
  casco: 'CASCO',
  itp: 'ITP',
  vigneta: 'Vignetă',
  act_proprietate: 'Act proprietate',
  cadastru: 'Cadastru',
  factura: 'Factură',
  impozit_proprietate: 'Impozit proprietate',
  contract: 'Contract',
  card: 'Card',
  card_sanatate: 'Card de sănătate',
  garantie: 'Garanție produs',
  certificat_nastere: 'Certificat naștere',
  certificat_casatorie: 'Certificat căsătorie',
  certificat_botez: 'Certificat botez',
  bon_cumparaturi: 'Bon cumpărături',
  bon_parcare: 'Bon parcare',
  pad: 'PAD Asigurare Locuință',
  stingator_incendiu: 'Stingător incendiu',
  abonament: 'Abonament',
  vaccin_animal: 'Vaccin animal',
  deparazitare: 'Deparazitare',
  vizita_vet: 'Vizită veterinar',
  bilet: 'Bilet',
  certificat_inregistrare: 'Certificat înregistrare',
  autorizatie_activitate: 'Autorizație activitate',
  act_constitutiv: 'Act constitutiv',
  certificat_tva: 'Certificat TVA',
  asigurare_profesionala: 'Asigurare profesională',
  asigurare_personala: 'Asigurare personală',
  diploma: 'Diplomă',
  foaie_matricola: 'Foaie matricolă',
  certificat_absolvire: 'Certificat absolvire',
  certificat_curs: 'Certificat curs',
  adeverinta_studii: 'Adeverință studii',
  reteta_medicala: 'Rețetă medicală',
  analize_medicale: 'Analize medicale',
  scrisoare_medicala: 'Scrisoare medicală',
  bilet_externare: 'Bilet de externare',
  imagistica: 'Imagistică',
  vaccin_persoana: 'Vaccin',
  fisa_consultatie: 'Fișă consultație',
  bilet_trimitere: 'Bilet de trimitere',
  altul: 'Altele',
  custom: 'Tip personalizat',
};

export const ENTITY_DOCUMENT_TYPES: Record<EntityType, DocumentType[]> = {
  person: [
    'buletin',
    'pasaport',
    'permis_auto',
    'certificat_nastere',
    'certificat_casatorie',
    'certificat_botez',
    'card_sanatate',
    'card',
    'asigurare_personala',
    'diploma',
    'foaie_matricola',
    'certificat_absolvire',
    'certificat_curs',
    'adeverinta_studii',
    'bon_cumparaturi',
    'bon_parcare',
    'bilet',
    'abonament',
    'contract',
    'garantie',
    'altul',
    'custom',
  ],
  vehicle: [
    'talon',
    'carte_auto',
    'rca',
    'casco',
    'itp',
    'vigneta',
    'bon_parcare',
    'stingator_incendiu',
    'contract',
    'altul',
    'custom',
  ],
  property: [
    'act_proprietate',
    'cadastru',
    'factura',
    'impozit_proprietate',
    'pad',
    'stingator_incendiu',
    'abonament',
    'contract',
    'altul',
    'custom',
  ],
  card: ['factura', 'bon_cumparaturi', 'bon_parcare', 'abonament', 'contract', 'altul', 'custom'],
  animal: ['vaccin_animal', 'deparazitare', 'vizita_vet', 'altul', 'custom'],
  company: [
    'certificat_inregistrare',
    'act_constitutiv',
    'certificat_tva',
    'autorizatie_activitate',
    'asigurare_profesionala',
    'factura',
    'contract',
    'altul',
    'custom',
  ],
  medical_record: [
    'reteta_medicala',
    'analize_medicale',
    'scrisoare_medicala',
    'bilet_externare',
    'imagistica',
    'vaccin_persoana',
    'fisa_consultatie',
    'bilet_trimitere',
    'card_sanatate',
    'altul',
    'custom',
  ],
};

/**
 * Entitatea „acasă" pentru fiecare tip de document.
 * Folosită în liste (Expirări, Home) pentru a afișa contextul corect
 * atunci când un document e legat la mai multe entități.
 */
export const DOC_PRIMARY_ENTITY: Partial<Record<DocumentType, EntityType>> = {
  // Persoană
  buletin: 'person',
  pasaport: 'person',
  permis_auto: 'person',
  certificat_nastere: 'person',
  certificat_casatorie: 'person',
  certificat_botez: 'person',
  card_sanatate: 'person',
  diploma: 'person',
  foaie_matricola: 'person',
  certificat_absolvire: 'person',
  certificat_curs: 'person',
  adeverinta_studii: 'person',
  // Vehicul
  talon: 'vehicle',
  carte_auto: 'vehicle',
  rca: 'vehicle',
  casco: 'vehicle',
  itp: 'vehicle',
  vigneta: 'vehicle',
  // Proprietate
  act_proprietate: 'property',
  cadastru: 'property',
  pad: 'property',
  impozit_proprietate: 'property',
  // Animal
  vaccin_animal: 'animal',
  deparazitare: 'animal',
  vizita_vet: 'animal',
  // Firmă
  certificat_inregistrare: 'company',
  autorizatie_activitate: 'company',
  act_constitutiv: 'company',
  certificat_tva: 'company',
  asigurare_profesionala: 'company',
  // Medical
  reteta_medicala: 'medical_record',
  analize_medicale: 'medical_record',
  scrisoare_medicala: 'medical_record',
  bilet_externare: 'medical_record',
  imagistica: 'medical_record',
  vaccin_persoana: 'medical_record',
  fisa_consultatie: 'medical_record',
  bilet_trimitere: 'medical_record',
};

export function getDocumentLabel(
  doc: { type: DocumentType; custom_type_id?: string },
  customTypes: CustomDocumentType[]
): string {
  if (doc.type === 'custom') {
    const ct = customTypes.find(c => c.id === doc.custom_type_id);
    return ct?.name ?? 'Tip personalizat';
  }
  return DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
}

// ── Cloud backup types ────────────────────────────────────────────────────────

export type SnapshotFrequency = 'off' | 'daily' | 'every3days' | 'weekly' | 'monthly';

export interface CloudSettings {
  enabled: boolean;
  snapshotFrequency: SnapshotFrequency;
  snapshotRetention: number; // 1..20, default 4
  encryptionEnabled: boolean;
  /** unix ms — timestamp-ul ultimului banner ignorat (ca să nu mai apară același). */
  ignoredCloudUploadedAt: number | null;
}

export interface CloudManifestMeta {
  version: number;
  uploadedAt: number; // unix ms
  hash: string; // SHA-256 hex
  deviceId: string;
  encrypted: boolean;
  documentCount: number;
  fileCount: number;
}

export interface PendingUpload {
  id: number;
  file_path: string; // relativ în DocumentsDirectory
  attempt_count: number;
  last_error: string | null;
  /** unix ms — vezi cloud-backup plan (column INTEGER, nu TEXT ISO). */
  created_at: number;
}

export type CloudStatus = 'idle' | 'uploading' | 'restoring' | 'error' | 'paused' | 'unavailable';
