import type { DocumentType } from './index';

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  ocrKey?: string;
}

export const DOCUMENT_FIELDS: Partial<Record<DocumentType, FieldDef[]>> = {
  buletin: [
    { key: 'cnp', label: 'CNP', placeholder: '1234567890123', keyboardType: 'numeric', ocrKey: 'cnp' },
    { key: 'series', label: 'Serie', placeholder: 'RT 123456', ocrKey: 'series' },
    { key: 'name', label: 'Nume complet', placeholder: 'POPESCU ION', ocrKey: 'name' },
  ],
  pasaport: [
    { key: 'series', label: 'Nr. pașaport', placeholder: 'SN123456', ocrKey: 'series' },
    { key: 'name', label: 'Nume complet', placeholder: 'POPESCU ION', ocrKey: 'name' },
  ],
  permis_auto: [
    { key: 'series', label: 'Nr. permis', placeholder: 'RO 123456', ocrKey: 'series' },
    { key: 'categories', label: 'Categorii', placeholder: 'B, AM' },
  ],
  talon: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'vin', label: 'Serie șasiu (VIN)', placeholder: 'WVWZZZ...' },
    { key: 'make_model', label: 'Marcă / Model', placeholder: 'Volkswagen Golf' },
  ],
  carte_auto: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'vin', label: 'Serie șasiu (VIN)', placeholder: 'WVWZZZ...' },
    { key: 'make_model', label: 'Marcă / Model', placeholder: 'Volkswagen Golf' },
  ],
  rca: [
    { key: 'policy_number', label: 'Nr. poliță', placeholder: 'RO/...' },
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz, Groupama...' },
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
  ],
  itp: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'station', label: 'Stație ITP', placeholder: 'Auto Test SRL' },
  ],
  vigneta: [
    { key: 'plate', label: 'Nr. înmatriculare', placeholder: 'B 123 ABC' },
    { key: 'country', label: 'Țară', placeholder: 'Austria, Ungaria...' },
  ],
  act_proprietate: [
    { key: 'address', label: 'Adresă proprietate', placeholder: 'Str. ...' },
    { key: 'surface', label: 'Suprafață (mp)', placeholder: '75', keyboardType: 'numeric' },
  ],
  cadastru: [
    { key: 'cadastral_number', label: 'Nr. cadastral', placeholder: '12345' },
    { key: 'uat', label: 'UAT', placeholder: 'București, Sector 1' },
  ],
  factura: [
    { key: 'invoice_number', label: 'Nr. factură', placeholder: 'FAC001' },
    { key: 'supplier', label: 'Furnizor', placeholder: 'Enel, Digi...' },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '250.00', keyboardType: 'decimal-pad', ocrKey: 'amount' },
    { key: 'due_date', label: 'Scadentă', placeholder: 'ZZ.LL.AAAA' },
  ],
  impozit_proprietate: [
    { key: 'decision_number', label: 'Nr. decizie impunere', placeholder: 'DI-2026/12345' },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '1200.00', keyboardType: 'decimal-pad' },
    { key: 'year', label: 'An fiscal', placeholder: '2026', keyboardType: 'numeric' },
  ],
  contract: [
    { key: 'contract_number', label: 'Nr. contract', placeholder: 'CTR-001' },
    { key: 'counterpart', label: 'Contraparte', placeholder: 'Firma ABC SRL' },
    { key: 'value', label: 'Valoare (RON)', placeholder: '5000.00', keyboardType: 'decimal-pad' },
  ],
  card: [
    { key: 'last4', label: 'Ultimele 4 cifre', placeholder: '1234', keyboardType: 'numeric', ocrKey: 'last4' },
    { key: 'bank', label: 'Bancă', placeholder: 'BRD, BCR, ING...' },
  ],
  garantie: [
    { key: 'product_name', label: 'Produs', placeholder: 'iPhone 15, Mașină de spălat...' },
    { key: 'brand', label: 'Marcă', placeholder: 'Apple, Samsung...' },
    { key: 'store', label: 'Magazin', placeholder: 'eMAG, Altex...' },
    { key: 'warranty_years', label: 'Ani garanție', placeholder: '2', keyboardType: 'numeric' },
  ],
  reteta_medicala: [
    { key: 'medication_name', label: 'Medicament(e)', placeholder: 'Paracetamol 500mg' },
    { key: 'doctor', label: 'Medic', placeholder: 'Dr. Ionescu' },
    { key: 'dosage', label: 'Dozaj', placeholder: '1 comprimat/zi' },
  ],
  pad: [
    { key: 'insurer', label: 'Asigurator', placeholder: 'Allianz, Groupama...' },
    { key: 'policy_number', label: 'Nr. poliță', placeholder: 'RO/...' },
  ],
  stingator_incendiu: [
    { key: 'location', label: 'Locație', placeholder: 'Mașină, Bucătărie...' },
    { key: 'extinguisher_type', label: 'Tip', placeholder: 'Pulbere, CO2...' },
  ],
  abonament: [
    { key: 'service_name', label: 'Serviciu', placeholder: 'Netflix, Spotify, Chirie...' },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '55.00', keyboardType: 'decimal-pad' },
    { key: 'recurrence', label: 'Frecvență', placeholder: 'lunar / anual' },
  ],
  vaccin_animal: [
    { key: 'vaccine_name', label: 'Vaccin', placeholder: 'Antirabic, Hexavalent...' },
    { key: 'vet_name', label: 'Veterinar', placeholder: 'Dr. Ionescu' },
  ],
  deparazitare: [
    { key: 'product_name', label: 'Produs', placeholder: 'Advocate, Frontline...' },
    { key: 'deparazitare_type', label: 'Tip', placeholder: 'Intern, Extern, Ambele' },
  ],
  vizita_vet: [
    { key: 'reason', label: 'Motiv', placeholder: 'Control anual, Boală...' },
    { key: 'vet_name', label: 'Veterinar', placeholder: 'Dr. Ionescu' },
  ],
  analize_medicale: [
    { key: 'lab', label: 'Laborator', placeholder: 'Synevo, MedLife...' },
    { key: 'doctor', label: 'Medic / Specialitate', placeholder: 'Dr. Ionescu – Cardiologie' },
  ],
  bon_cumparaturi: [
    { key: 'store', label: 'Magazin', placeholder: 'Lidl, eMAG, Altex...' },
    { key: 'amount', label: 'Sumă (RON)', placeholder: '250.00', keyboardType: 'decimal-pad', ocrKey: 'amount' },
  ],
  bilet: [
    { key: 'categorie', label: 'Categorie', placeholder: 'Concert, Operă, Teatru, Tren, Avion...' },
    { key: 'venue', label: 'Locație / Rută', placeholder: 'Sala Palatului, Gara de Nord → Cluj...' },
    { key: 'seat', label: 'Loc / Vagon', placeholder: '12A, Vagon 5 Loc 23...' },
    { key: 'event_date', label: 'Data evenimentului', placeholder: 'ZZ.LL.AAAA' },
  ],
  certificat_inregistrare: [
    { key: 'cui', label: 'CUI', placeholder: 'RO12345678' },
    { key: 'reg_com', label: 'Nr. Registru Comerț', placeholder: 'J40/1234/2020' },
    { key: 'legal_form', label: 'Formă juridică', placeholder: 'SRL, SA, PFA, II...' },
    { key: 'registered_address', label: 'Sediu social', placeholder: 'Str. ..., București' },
  ],
  autorizatie_activitate: [
    { key: 'autoritate', label: 'Autoritate emitentă', placeholder: 'ANRE, DSP, Primărie...' },
    { key: 'tip_autorizatie', label: 'Tip autorizație', placeholder: 'Autorizație sanitară, ANRE...' },
    { key: 'numar_autorizatie', label: 'Nr. autorizație', placeholder: 'AUT-2024-001' },
  ],
  act_constitutiv: [
    { key: 'legal_form', label: 'Formă juridică', placeholder: 'SRL, SA, PFA...' },
    { key: 'notary', label: 'Notar', placeholder: 'Birou notarial...' },
  ],
  certificat_tva: [
    { key: 'cod_tva', label: 'Cod TVA', placeholder: 'RO12345678' },
    { key: 'data_inregistrare_tva', label: 'Data înregistrare TVA', placeholder: 'ZZ.LL.AAAA' },
  ],
  asigurare_profesionala: [
    { key: 'insurer', label: 'Companie asigurare', placeholder: 'Allianz, Groupama...' },
    { key: 'policy_number', label: 'Nr. poliță', placeholder: 'AS-2024-001' },
    { key: 'risk_type', label: 'Tip risc', placeholder: 'Răspundere civilă, Malpraxis...' },
    { key: 'amount', label: 'Sumă asigurată (RON)', placeholder: '100000', keyboardType: 'decimal-pad' as const },
  ],
};
