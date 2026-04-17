import type { DocumentType } from './index';

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}

/**
 * Câmpuri structurate per tip de document.
 *
 * PRINCIPIU: maxim 3-5 câmpuri per tip — doar ce e necesar pentru:
 *   1. Identificare rapidă (ce apare pe card în listă)
 *   2. Cross-linking (plate leagă talon+RCA+ITP+vignetă)
 *   3. Funcționalitate (expiry_date → notificări, sorting)
 *
 * Tot restul informațiilor e disponibil via:
 *   - poza documentului
 *   - câmpul `ocr_text` (textul complet extras de OCR)
 *   - chatbot (răspunde din ocr_text)
 */
export const DOCUMENT_FIELDS: Partial<Record<DocumentType, FieldDef[]>> = {
  // ─── IDENTITATE PERSONALĂ ────────────────────────────────────────────────

  buletin: [
    { key: 'series', label: 'Serie și număr', placeholder: 'RT 123456' },
    { key: 'cnp', label: 'CNP', placeholder: '1234567890123', keyboardType: 'numeric' },
  ],

  pasaport: [{ key: 'series', label: 'Număr pașaport', placeholder: '05123456' }],

  permis_auto: [
    { key: 'series', label: 'Număr permis', placeholder: '12345678' },
    { key: 'categories', label: 'Categorii', placeholder: 'B, A, C...' },
  ],

  // ─── VEHICULE ────────────────────────────────────────────────────────────

  talon: [
    // itp_expiry_date e stocat în metadata (din OCR/AI) dar nu e câmp editabil.
    // Utilizatorul vede o singură dată: "Scadență ITP" → câmpul expiryDate din formular.
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'marca', label: 'Marcă', placeholder: 'VOLKSWAGEN' },
    { key: 'model', label: 'Model', placeholder: 'Golf' },
    { key: 'vin', label: 'Serie șasiu (VIN)', placeholder: 'WVWZZZ1JZ3W386752' },
  ],

  carte_auto: [
    // CIV nu expiră niciodată. Marca/model/an sunt deja pe talon pentru același vehicul.
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'vin', label: 'Serie șasiu (VIN)', placeholder: 'WVWZZZ1JZ3W386752' },
  ],

  rca: [
    { key: 'policy_number', label: 'Nr. poliță RCA', placeholder: 'RO/XXXXXXXX/...' },
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz, Groupama...' },
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'prima', label: 'Primă de asigurare (RON)', placeholder: '850.00', keyboardType: 'decimal-pad' },
    { key: 'valid_from', label: 'Valabil de la', placeholder: '01.04.2024' },
    { key: 'marca_model', label: 'Marcă / model', placeholder: 'Dacia Logan' },
  ],

  itp: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    // statie_itp: omis — rar relevant, disponibil în OCR text
  ],

  vigneta: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    // tip_vigneta: omis — vizibil pe document / OCR text
  ],

  casco: [
    { key: 'policy_number', label: 'Nr. poliță CASCO', placeholder: 'XXXXXXXXXX' },
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz, Generali...' },
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'prima', label: 'Primă de asigurare (RON)', placeholder: '2500.00', keyboardType: 'decimal-pad' },
    { key: 'valid_from', label: 'Valabil de la', placeholder: '01.04.2024' },
    { key: 'marca_model', label: 'Marcă / model', placeholder: 'Dacia Logan' },
  ],

  // ─── PROPRIETATE ─────────────────────────────────────────────────────────

  pad: [
    { key: 'policy_number', label: 'Nr. poliță PAD', placeholder: 'PAD-2024-00123456' },
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz, Groupama...' },
  ],

  act_proprietate: [
    {
      key: 'adresa',
      label: 'Adresă proprietate',
      placeholder: 'Str. Mihai Eminescu nr. 5, Sect. 1',
    },
    // nr_cadastral: omis — există în documentul Cadastru dedicat
  ],

  cadastru: [
    { key: 'nr_cadastral', label: 'Nr. cadastral', placeholder: '234567', keyboardType: 'numeric' },
    {
      key: 'nr_carte_funciara',
      label: 'Nr. carte funciară',
      placeholder: '123456',
      keyboardType: 'numeric',
    },
  ],

  impozit_proprietate: [
    {
      key: 'amount',
      label: 'Sumă anuală (RON)',
      placeholder: '1200.00',
      keyboardType: 'decimal-pad',
    },
  ],

  // ─── FINANCIAR ───────────────────────────────────────────────────────────

  factura: [
    { key: 'invoice_number', label: 'Nr. factură', placeholder: 'FAC-2024-001234' },
    { key: 'supplier', label: 'Furnizor', placeholder: 'E.ON / Engie / Digi...' },
    { key: 'amount', label: 'Total (RON)', placeholder: '225.06', keyboardType: 'decimal-pad' },
    { key: 'due_date', label: 'Scadență', placeholder: '15.04.2024' },
    { key: 'period', label: 'Perioadă facturare', placeholder: '01.03.2024 - 31.03.2024' },
  ],

  bon_cumparaturi: [
    { key: 'store', label: 'Magazin', placeholder: 'Lidl / eMAG / Altex...' },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '125.80', keyboardType: 'decimal-pad' },
  ],

  bon_parcare: [
    {
      key: 'location',
      label: 'Parcare / Locație',
      placeholder: 'Parking Băneasa / Str. Victoriei',
    },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '12.00', keyboardType: 'decimal-pad' },
  ],

  garantie: [
    { key: 'product_name', label: 'Produs', placeholder: 'Mașină de spălat / iPhone 15' },
    { key: 'serie_produs', label: 'Serie produs (S/N)', placeholder: 'SN1234567890' },
    // brand: omis — de obicei inclus în product_name / OCR text
  ],

  contract: [
    {
      key: 'tip_contract',
      label: 'Tip contract',
      placeholder: 'Chirie / Prestări servicii / Muncă',
    },
    // contract_number: omis — disponibil în OCR text
  ],

  abonament: [
    {
      key: 'service_name',
      label: 'Serviciu / Furnizor',
      placeholder: 'Netflix / Digi / Orange / Sala...',
    },
    { key: 'amount', label: 'Sumă', placeholder: '55.99', keyboardType: 'decimal-pad' },
  ],

  card: [
    // NICIODATĂ: nr. complet card, CVV, PIN!
    { key: 'last4', label: 'Ultimele 4 cifre', placeholder: '1234', keyboardType: 'numeric' },
    { key: 'bank', label: 'Bancă emitentă', placeholder: 'BCR / BRD / BT / ING / Revolut' },
    // tip_card: omis — rar relevant pentru stocare structurată
  ],

  // ─── MEDICAL ─────────────────────────────────────────────────────────────

  reteta_medicala: [
    { key: 'doctor', label: 'Medic prescriptor', placeholder: 'Dr. Ionescu Maria' },
    { key: 'medication_1', label: 'Medicament', placeholder: 'Amoxicilinum 500mg – 20 caps.' },
  ],

  analize_medicale: [
    { key: 'lab', label: 'Laborator', placeholder: 'Synevo / MedLife / Regina Maria' },
    // report_number: omis — disponibil în OCR text
  ],

  // ─── ANIMALE ─────────────────────────────────────────────────────────────

  vaccin_animal: [
    { key: 'vaccine_type', label: 'Tip vaccin', placeholder: 'Antirabic / Polivalent câine' },
    { key: 'vet_name', label: 'Medic veterinar', placeholder: 'Dr. Ionescu Alexandru' },
  ],

  deparazitare: [
    { key: 'treatment_type', label: 'Tip deparazitare', placeholder: 'Internă / Externă / Ambele' },
    { key: 'product_name', label: 'Produs', placeholder: 'Advocate / Frontline / Bravecto' },
  ],

  vizita_vet: [
    { key: 'vet_name', label: 'Medic veterinar', placeholder: 'Dr. Ionescu Alexandru' },
    // clinic_name: omis — disponibil în OCR text
  ],

  // ─── BILET ───────────────────────────────────────────────────────────────

  bilet: [
    // expiry_date = data evenimentului / zbor
    { key: 'categorie', label: 'Categorie', placeholder: 'Avion / Tren / Concert / Meci' },
    { key: 'venue', label: 'Locație / Rută', placeholder: 'Arena Națională / OTP→LHR' },
    {
      key: 'eveniment_artist',
      label: 'Eveniment / Nr. zbor',
      placeholder: 'Coldplay / RO123 / IR 1581',
    },
    // seat: omis — disponibil în OCR text / vizibil pe bilet
  ],

  // ─── ALTELE ──────────────────────────────────────────────────────────────

  stingator_incendiu: [
    // expiry_date = data scadenței verificării
    { key: 'serie', label: 'Nr. serie', placeholder: 'ST2021-001234' },
  ],

  certificat_inregistrare: [
    { key: 'cui', label: 'CUI', placeholder: '12345678', keyboardType: 'numeric' },
    { key: 'reg_com', label: 'Nr. Registrul Comerțului', placeholder: 'J40/1234/2020' },
    { key: 'denumire', label: 'Denumire firmă', placeholder: 'ACME SRL' },
  ],

  autorizatie_activitate: [
    {
      key: 'tip_autorizatie',
      label: 'Tip autorizație',
      placeholder: 'Sanitară / ISU / Mediu / Construire',
    },
    { key: 'numar_autorizatie', label: 'Nr. autorizație', placeholder: '1234/2023' },
  ],

  act_constitutiv: [
    { key: 'denumire', label: 'Denumire societate', placeholder: 'ACME SRL' },
    { key: 'legal_form', label: 'Formă juridică', placeholder: 'SRL / SA / PFA / II' },
  ],

  certificat_tva: [
    { key: 'cod_tva', label: 'Cod TVA', placeholder: 'RO12345678' },
    { key: 'denumire', label: 'Firmă', placeholder: 'ACME SRL' },
  ],

  asigurare_profesionala: [
    { key: 'policy_number', label: 'Nr. poliță', placeholder: 'RCP/2024/001234' },
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz / Omniasig...' },
  ],
};
