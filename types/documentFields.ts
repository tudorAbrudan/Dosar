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
    { key: 'due_date', label: 'Scadentă', placeholder: 'AAAA-LL-ZZ' },
  ],
  bon_combustibil: [
    { key: 'km', label: 'Kilometraj (km)', placeholder: '125430', keyboardType: 'numeric', ocrKey: 'km' },
    { key: 'liters', label: 'Litri alimentați', placeholder: '45.23', keyboardType: 'decimal-pad', ocrKey: 'liters' },
    { key: 'price_per_liter', label: 'Preț/litru (RON)', placeholder: '7.45', keyboardType: 'decimal-pad' },
    { key: 'total_amount', label: 'Total (RON)', placeholder: '335.81', keyboardType: 'decimal-pad', ocrKey: 'price' },
    { key: 'station', label: 'Stație', placeholder: 'Rompetrol, OMV...' },
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
  medicament: [
    { key: 'medication_name', label: 'Medicament', placeholder: 'Paracetamol 500mg' },
    { key: 'dosage', label: 'Dozaj', placeholder: '1 comprimat/zi' },
    { key: 'quantity', label: 'Cantitate', placeholder: '20 comprimate' },
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
  index_utilitati: [
    { key: 'apa_rece', label: 'Apă rece (mc)', placeholder: '123.45', keyboardType: 'decimal-pad' },
    { key: 'apa_calda', label: 'Apă caldă (mc)', placeholder: '45.67', keyboardType: 'decimal-pad' },
    { key: 'gaz', label: 'Gaz (mc)', placeholder: '234.56', keyboardType: 'decimal-pad' },
    { key: 'curent', label: 'Curent (kWh)', placeholder: '1234', keyboardType: 'numeric' },
    { key: 'luna_an', label: 'Lună/An', placeholder: '03/2026' },
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
};
