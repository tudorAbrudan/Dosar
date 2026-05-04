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
  | 'garantie'
  | 'reteta_medicala'
  | 'analize_medicale'
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
  | 'diploma'
  | 'foaie_matricola'
  | 'certificat_absolvire'
  | 'certificat_curs'
  | 'adeverinta_studii'
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

export type EntityType = 'person' | 'property' | 'vehicle' | 'card' | 'animal' | 'company';

// Tipurile de entități pe care utilizatorul le poate activa/dezactiva din
// Setări → Vizibilitate sau adăuga din ecranul „Adaugă entitate".
export const ALL_ENTITY_TYPES: EntityType[] = [
  'person',
  'vehicle',
  'property',
  'card',
  'animal',
  'company',
];

// Lista completă a tipurilor standard (fără 'custom') — apare în Setări
export const STANDARD_DOC_TYPES: DocumentType[] = [
  'buletin',
  'pasaport',
  'permis_auto',
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
  'reteta_medicala',
  'analize_medicale',
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
  'diploma',
  'foaie_matricola',
  'certificat_absolvire',
  'certificat_curs',
  'adeverinta_studii',
  'altul',
];

// Tipuri active implicit pentru utilizatori noi — doar ce folosesc cei mai mulți
export const DEFAULT_VISIBLE_DOC_TYPES: DocumentType[] = [
  // Identitate — toată lumea
  'buletin',
  'pasaport',
  'permis_auto',
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
  // Medical — toată lumea
  'reteta_medicala',
  'analize_medicale',
  // Fallback
  'altul',
];

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
  garantie: 'Garanție produs',
  reteta_medicala: 'Rețetă medicală',
  analize_medicale: 'Analize medicale',
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
  diploma: 'Diplomă',
  foaie_matricola: 'Foaie matricolă',
  certificat_absolvire: 'Certificat absolvire',
  certificat_curs: 'Certificat curs',
  adeverinta_studii: 'Adeverință studii',
  altul: 'Altele',
  custom: 'Tip personalizat',
};

export const ENTITY_DOCUMENT_TYPES: Record<EntityType, DocumentType[]> = {
  person: [
    'buletin',
    'pasaport',
    'permis_auto',
    'card',
    'reteta_medicala',
    'analize_medicale',
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
  reteta_medicala: 'person',
  analize_medicale: 'person',
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
