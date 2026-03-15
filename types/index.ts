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
  | 'pad'
  | 'stingator_incendiu'
  | 'abonament'
  | 'vaccin_animal'
  | 'deparazitare'
  | 'vizita_vet'
  | 'bilet'
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
  createdAt: string;
}

export interface Property {
  id: string;
  name: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  name: string;
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

export interface DocumentPage {
  id: string;
  document_id: string;
  page_order: number;
  file_path: string;
  created_at: string;
}

export interface Document {
  id: string;
  type: DocumentType;
  issue_date?: string;
  expiry_date?: string;
  note?: string;
  file_path?: string;
  custom_type_id?: string;
  metadata?: Record<string, string>;
  pages?: DocumentPage[];
  person_id?: string;
  property_id?: string;
  vehicle_id?: string;
  card_id?: string;
  animal_id?: string;
  auto_delete?: string;
  created_at: string;
}

export type EntityType = 'person' | 'property' | 'vehicle' | 'card' | 'animal';

export const ALL_ENTITY_TYPES: EntityType[] = ['person', 'vehicle', 'property', 'card', 'animal'];

// Lista completă a tipurilor standard (fără 'custom')
export const STANDARD_DOC_TYPES: DocumentType[] = [
  'buletin', 'pasaport', 'permis_auto', 'talon', 'carte_auto', 'rca', 'casco', 'itp',
  'vigneta', 'act_proprietate', 'cadastru', 'factura', 'impozit_proprietate', 'contract',
  'card', 'garantie', 'reteta_medicala', 'analize_medicale', 'bon_cumparaturi', 'pad',
  'stingator_incendiu', 'abonament', 'vaccin_animal', 'deparazitare', 'vizita_vet', 'bilet', 'altul',
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
  pad: 'PAD Asigurare Locuință',
  stingator_incendiu: 'Stingător incendiu',
  abonament: 'Abonament recurent',
  vaccin_animal: 'Vaccin animal',
  deparazitare: 'Deparazitare',
  vizita_vet: 'Vizită veterinar',
  bilet: 'Bilet',
  altul: 'Altele',
  custom: 'Tip personalizat',
};

export const ENTITY_DOCUMENT_TYPES: Record<EntityType, DocumentType[]> = {
  person: ['buletin', 'pasaport', 'permis_auto', 'card', 'reteta_medicala', 'analize_medicale', 'bon_cumparaturi', 'bilet', 'abonament', 'contract', 'garantie', 'altul', 'custom'],
  vehicle: ['talon', 'carte_auto', 'rca', 'casco', 'itp', 'vigneta', 'stingator_incendiu', 'contract', 'altul', 'custom'],
  property: ['act_proprietate', 'cadastru', 'factura', 'impozit_proprietate', 'pad', 'stingator_incendiu', 'abonament', 'contract', 'altul', 'custom'],
  card: ['factura', 'bon_cumparaturi', 'abonament', 'contract', 'altul', 'custom'],
  animal: ['vaccin_animal', 'deparazitare', 'vizita_vet', 'altul', 'custom'],
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
