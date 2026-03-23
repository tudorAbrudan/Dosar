import type { DocumentType } from './index';

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  /** Cheie din DocumentInfo (ocr.ts) din care OCR pre-populează câmpul */
  ocrKey?: string;
}

export const DOCUMENT_FIELDS: Partial<Record<DocumentType, FieldDef[]>> = {

  // ─── IDENTITATE PERSONALĂ ────────────────────────────────────────────────

  buletin: [
    // Valabilitate CI: 7 ani (14-24 ani), 10 ani (25-54 ani), permanentă (55+)
    { key: 'series',        label: 'Serie și număr',         placeholder: 'RT 123456',              ocrKey: 'series' },
    { key: 'cnp',           label: 'CNP',                    placeholder: '1234567890123',           keyboardType: 'numeric', ocrKey: 'cnp' },
    { key: 'name',          label: 'Prenume și Nume',        placeholder: 'ION POPESCU',             ocrKey: 'name' },
    { key: 'data_nasterii', label: 'Data nașterii',          placeholder: '01.01.1990' },
    { key: 'loc_nastere',   label: 'Loc naștere',            placeholder: 'București / Cluj-Napoca' },
    { key: 'cetatenie',     label: 'Cetățenie',              placeholder: 'ROMÂNĂ' },
    { key: 'domiciliu',     label: 'Domiciliu',              placeholder: 'Str. Mihai Eminescu nr. 5, Sect. 1, București' },
    { key: 'emisa_de',      label: 'Emisă de',               placeholder: 'SPCLEP Sector 1' },
  ],

  pasaport: [
    // Valabilitate: 10 ani (>25 ani), 5 ani (≤25 ani), 3 ani (copii <14 ani)
    { key: 'series',        label: 'Număr pașaport',         placeholder: '05123456',               ocrKey: 'series' },
    { key: 'name',          label: 'Prenume și Nume',        placeholder: 'ION POPESCU',             ocrKey: 'name' },
    { key: 'cnp',           label: 'CNP',                    placeholder: '1234567890123',           keyboardType: 'numeric', ocrKey: 'cnp' },
    { key: 'data_nasterii', label: 'Data nașterii',          placeholder: '01 JAN 1990' },
    { key: 'loc_nastere',   label: 'Loc naștere',            placeholder: 'București' },
    { key: 'cetatenie',     label: 'Cetățenie',              placeholder: 'ROMÂNĂ / ROU' },
    { key: 'sex',           label: 'Sex',                    placeholder: 'M / F' },
    { key: 'emis_de',       label: 'Emis de',                placeholder: 'MAI / Poliția...' },
  ],

  permis_auto: [
    // Valabilitate: 10 ani cat. B/A; 5 ani cat. C/D/CE/DE. expiry_date = cel mai apropiat.
    { key: 'series',        label: 'Număr permis',           placeholder: '12345678',               ocrKey: 'series' },
    { key: 'name',          label: 'Prenume și Nume',        placeholder: 'POPESCU ION',             ocrKey: 'name' },
    { key: 'categories',    label: 'Categorii deținute',     placeholder: 'B, A, C...' },
    { key: 'cat_b_expiry',  label: 'Valabilitate cat. B până la', placeholder: '01.01.2030' },
    { key: 'cat_a_expiry',  label: 'Valabilitate cat. A până la', placeholder: '01.01.2030' },
    { key: 'cat_c_expiry',  label: 'Valabilitate cat. C/D până la', placeholder: '01.01.2027' },
    { key: 'restrictii',    label: 'Coduri restricții',      placeholder: '01 (ochelari), 70 (preschimbare)...' },
    { key: 'emis_de',       label: 'Emis de',                placeholder: 'DRPCIV / Poliție' },
  ],

  // ─── VEHICULE ────────────────────────────────────────────────────────────

  talon: [
    // IMPORTANT: Talonul (Certificatul de Înmatriculare) NU expiră.
    // Câmpul expiry_date al documentului = data expirare ITP înscrisă pe talon (ștampila RAR).
    // itp_expiry_date de mai jos = sursa pentru expiry_date la salvare.
    { key: 'plate',                    label: 'Nr. înmatriculare',                placeholder: 'B 123 ABC' },
    { key: 'vin',                      label: 'Serie șasiu (VIN)',                placeholder: 'WVWZZZ1JZ3W386752' },
    { key: 'marca',                    label: 'Marcă',                            placeholder: 'VOLKSWAGEN' },
    { key: 'model',                    label: 'Model / Tip',                      placeholder: 'GOLF / 1J1' },
    { key: 'an_fabricatie',            label: 'An fabricație',                    placeholder: '2018',   keyboardType: 'numeric' },
    { key: 'combustibil',              label: 'Combustibil',                      placeholder: 'Diesel / Benzină / Electric / Hybrid' },
    { key: 'capacitate_cilindrica',    label: 'Capacitate cilindrică (cm³)',      placeholder: '1968',   keyboardType: 'numeric' },
    { key: 'putere_kw',                label: 'Putere motor (kW)',                placeholder: '110',    keyboardType: 'numeric' },
    { key: 'culoare',                  label: 'Culoare',                          placeholder: 'NEGRU' },
    { key: 'nr_locuri',                label: 'Număr locuri',                     placeholder: '5',      keyboardType: 'numeric' },
    { key: 'masa_totala',              label: 'Masă max. autorizată (kg)',        placeholder: '1850',   keyboardType: 'numeric' },
    { key: 'norma_euro',               label: 'Normă Euro',                       placeholder: 'Euro 6' },
    { key: 'categorie_vehicul',        label: 'Categorie vehicul (UE)',           placeholder: 'M1 (autoturism) / N1 / L (moto)' },
    { key: 'data_prima_inmatriculare', label: 'Data primei înmatriculări',        placeholder: '01.01.2018' },
    { key: 'proprietar',               label: 'Proprietar',                       placeholder: 'POPESCU ION' },
    { key: 'itp_expiry_date',          label: 'Data expirare ITP (de pe talon)', placeholder: '01.2026 (lună/an)' },
    // ↑ Folosit ca sursă pentru expiry_date al documentului — ITP-ul expiră, nu talonul.
  ],

  carte_auto: [
    // CIV (Carte de Identitate a Vehiculului) — document tehnic, NU expiră niciodată.
    // expiry_date = GOL. Lăsați data expirare necompletată.
    { key: 'vin',                       label: 'Serie șasiu (VIN)',               placeholder: 'WVWZZZ1JZ3W386752' },
    { key: 'numar_civ',                 label: 'Număr CIV',                       placeholder: 'ROXXXXXXXXX' },
    { key: 'marca',                     label: 'Marcă',                           placeholder: 'VOLKSWAGEN' },
    { key: 'model',                     label: 'Model / Tip',                     placeholder: 'GOLF / 1J1' },
    { key: 'an_fabricatie',             label: 'An fabricație',                   placeholder: '2018',  keyboardType: 'numeric' },
    { key: 'combustibil',               label: 'Combustibil',                     placeholder: 'MOTORINA / BENZINA / ELECTRIC' },
    { key: 'capacitate_cilindrica',     label: 'Capacitate cilindrică (cm³)',     placeholder: '1968',  keyboardType: 'numeric' },
    { key: 'putere_max_kw',             label: 'Putere maximă (kW)',              placeholder: '110',   keyboardType: 'numeric' },
    { key: 'masa_proprie',              label: 'Masă proprie (kg)',               placeholder: '1350',  keyboardType: 'numeric' },
    { key: 'masa_max_tehnica',          label: 'Masă max. autorizată (kg)',       placeholder: '1850',  keyboardType: 'numeric' },
    { key: 'masa_max_remorcare',        label: 'Masă max. remorcare frânată (kg)', placeholder: '1500', keyboardType: 'numeric' },
    { key: 'nr_locuri',                 label: 'Număr locuri',                    placeholder: '5',     keyboardType: 'numeric' },
    { key: 'culoare',                   label: 'Culoare',                         placeholder: 'NEGRU' },
    { key: 'caroserie',                 label: 'Tip caroserie',                   placeholder: 'BERLINA / BREAK / SUV / HATCHBACK' },
    { key: 'norma_euro',                label: 'Normă Euro',                      placeholder: 'Euro 6' },
  ],

  rca: [
    // expiry_date = data expirare poliță. OBLIGATORIU de completat — RCA expirat = amendă!
    { key: 'policy_number', label: 'Nr. poliță RCA',           placeholder: 'RO/XXXXXXXX/...' },
    { key: 'insurer',       label: 'Asigurator',               placeholder: 'Allianz, Groupama, Omniasig, Uniqa...' },
    { key: 'plate',         label: 'Nr. înmatriculare',        placeholder: 'B 123 ABC' },
    { key: 'vin',           label: 'Serie șasiu (VIN)',        placeholder: 'WVWZZZ...' },
    { key: 'proprietar',    label: 'Proprietar vehicul',       placeholder: 'POPESCU ION' },
    { key: 'bonus_malus',   label: 'Clasă bonus-malus',        placeholder: 'B8 / B6 / M1...' },
    { key: 'prima_totala',  label: 'Primă totală (RON)',       placeholder: '850.00',            keyboardType: 'decimal-pad' },
    { key: 'durata_luni',   label: 'Durată (luni)',            placeholder: '12 / 6 / 3',        keyboardType: 'numeric' },
    { key: 'data_start',    label: 'Dată intrare vigoare',     placeholder: '01.01.2025' },
    { key: 'intermediar',   label: 'Broker / Agent',           placeholder: 'Broker Asigurări SRL' },
  ],

  casco: [
    // expiry_date = data expirare poliță.
    { key: 'policy_number',     label: 'Nr. poliță CASCO',         placeholder: 'XXXXXXXXXX' },
    { key: 'insurer',           label: 'Asigurator',               placeholder: 'Allianz, Generali, Groupama...' },
    { key: 'plate',             label: 'Nr. înmatriculare',        placeholder: 'B 123 ABC' },
    { key: 'vin',               label: 'Serie șasiu (VIN)',        placeholder: 'WVWZZZ...' },
    { key: 'valoare_asigurata', label: 'Valoare asigurată (RON)', placeholder: '75000',             keyboardType: 'decimal-pad' },
    { key: 'prima_totala',      label: 'Primă totală (RON)',       placeholder: '2500.00',           keyboardType: 'decimal-pad' },
    { key: 'fransiza',          label: 'Franșiță',                 placeholder: '250 RON absolută / 5% relativ' },
    { key: 'riscuri_acoperite', label: 'Riscuri acoperite',        placeholder: 'Daune proprii, Furt, Calamități, Vandalism...' },
    { key: 'nr_rate',           label: 'Nr. rate',                 placeholder: '4',                 keyboardType: 'numeric' },
    { key: 'data_start',        label: 'Dată intrare vigoare',     placeholder: '01.01.2025' },
    { key: 'intermediar',       label: 'Broker / Agent',           placeholder: 'Broker Asigurări SRL' },
  ],

  itp: [
    // Periodicitate: autoturisme <8 ani → la 2 ani; >8 ani → anual.
    // expiry_date = data expirare ITP (cel mai important reminder auto).
    { key: 'nr_certificat', label: 'Nr. certificat ITP',       placeholder: 'XXXXXXXX' },
    { key: 'plate',         label: 'Nr. înmatriculare',        placeholder: 'B 123 ABC' },
    { key: 'vin',           label: 'Serie șasiu (VIN)',        placeholder: 'WVWZZZ...' },
    { key: 'statie_itp',    label: 'Stație ITP autorizată',   placeholder: 'AUTO TEST SRL / IF-0123' },
    { key: 'rezultat',      label: 'Rezultat',                 placeholder: 'ADMIS / RESPINS / ADMIS cu deficiențe minore' },
    { key: 'km_inspectie',  label: 'Kilometraj la inspecție', placeholder: '85000',             keyboardType: 'numeric' },
    { key: 'deficiente',    label: 'Deficiențe constatate',   placeholder: 'Niciuna / listă deficiențe...' },
    { key: 'valabilitate',  label: 'Valabilitate (luni)',      placeholder: '24 / 12',           keyboardType: 'numeric' },
  ],

  vigneta: [
    // expiry_date = data/ora expirare vignetă (poate fi în ore sau zile!).
    { key: 'tara',          label: 'Țară',                     placeholder: 'România (Rovinieta) / Austria / Ungaria / Elveția / Cehia / Slovenia' },
    { key: 'plate',         label: 'Nr. înmatriculare',        placeholder: 'B 123 ABC' },
    { key: 'tip_vigneta',   label: 'Tip vignetă',              placeholder: '1 zi / 7 zile / 30 zile / 1 an' },
    { key: 'tip_vehicul',   label: 'Categorie vehicul',        placeholder: 'Autoturism / Motocicletă / >3.5t' },
    { key: 'nr_confirmare', label: 'Nr. confirmare / tranzacție', placeholder: 'RO2025XXXXXX' },
    { key: 'pret',          label: 'Preț plătit',              placeholder: '28 RON / 10 EUR',   keyboardType: 'decimal-pad' },
  ],

  // ─── PROPRIETATE ─────────────────────────────────────────────────────────

  act_proprietate: [
    // expiry_date = GOL (actul nu expiră). Ipotecile au termene separate.
    { key: 'tip_act',           label: 'Tip act',                   placeholder: 'Vânzare-cumpărare / Donație / Moștenire / Titlu de proprietate / Partaj' },
    { key: 'adresa',            label: 'Adresă proprietate',        placeholder: 'Str. Mihai Eminescu nr. 5, ap. 3, Sect. 1, București' },
    { key: 'nr_cadastral',      label: 'Nr. cadastral',             placeholder: '234567',            keyboardType: 'numeric' },
    { key: 'nr_carte_funciara', label: 'Nr. carte funciară',        placeholder: '123456',            keyboardType: 'numeric' },
    { key: 'tip_imobil',        label: 'Tip imobil',                placeholder: 'Apartament / Casă / Teren / Garsonieră / Spațiu comercial' },
    { key: 'suprafata_utila',   label: 'Suprafață utilă (mp)',      placeholder: '65.30',             keyboardType: 'decimal-pad' },
    { key: 'suprafata_teren',   label: 'Suprafață teren (mp)',      placeholder: '500',               keyboardType: 'decimal-pad' },
    { key: 'cota_parte',        label: 'Cotă parte',                placeholder: '1/1 (integral) / 1/2' },
    { key: 'notar',             label: 'Birou notarial',            placeholder: 'BNP Ionescu Ion' },
    { key: 'nr_act_notarial',   label: 'Nr. act notarial',          placeholder: '1234/15.03.2023' },
    { key: 'pret_achizitie',    label: 'Preț achiziție (RON)',      placeholder: '280000',            keyboardType: 'decimal-pad' },
    { key: 'vanzator',          label: 'Vânzător / Donator',        placeholder: 'Popescu Ion / Moștenire' },
  ],

  cadastru: [
    // expiry_date = valabilitate extras CF: 30 zile (informare) sau 10 zile lucr. (autentificare).
    { key: 'nr_carte_funciara', label: 'Nr. carte funciară',        placeholder: '123456',            keyboardType: 'numeric' },
    { key: 'cadastral_number',  label: 'Nr. cadastral',             placeholder: '234567',            keyboardType: 'numeric' },
    { key: 'uat',               label: 'UAT / Localitate',          placeholder: 'București Sector 3 / Florești, Cluj' },
    { key: 'surface',           label: 'Suprafață totală (mp)',     placeholder: '75.40',             keyboardType: 'decimal-pad' },
    { key: 'destinatie',        label: 'Destinație',                placeholder: 'Locuință / Teren agricol / Curți-construcții' },
    { key: 'titular_drept',     label: 'Titular drept',             placeholder: 'Popescu Ion și Popescu Maria' },
    { key: 'tip_drept',         label: 'Tip drept',                 placeholder: 'Proprietate / Uzufruct / Superficie / Servitute' },
    { key: 'sarcini_ipoteci',   label: 'Sarcini / Ipoteci',        placeholder: 'Nicio sarcină / Ipotecă BCR 150.000 RON' },
    { key: 'tip_extras',        label: 'Tip extras',                placeholder: 'Informare (val. 30 zile) / Autentificare (val. 10 zile lucr.)' },
    { key: 'ocpi',              label: 'OCPI / Birou CF',           placeholder: 'OCPI Cluj / OCPI Ilfov' },
  ],

  impozit_proprietate: [
    // expiry_date = 30 noiembrie (ultima scadentă anuală). Plată integrală până 31 martie = 10% reducere.
    { key: 'decision_number',   label: 'Nr. decizie impunere',      placeholder: 'DI-2026/00123' },
    { key: 'year',              label: 'An fiscal',                  placeholder: '2026',              keyboardType: 'numeric' },
    { key: 'tip_impozit',       label: 'Tip impozit',               placeholder: 'Clădire rezidențială / Teren intravilan / Mijloc de transport' },
    { key: 'adresa_imobil',     label: 'Adresă imobil',             placeholder: 'Str. ..., Bl., Ap.' },
    { key: 'amount',            label: 'Sumă anuală (RON)',         placeholder: '1200.00',           keyboardType: 'decimal-pad' },
    { key: 'iban_plata',        label: 'IBAN plată (Trezorerie)',   placeholder: 'RO49TREZ7015...' },
    { key: 'nr_rol_fiscal',     label: 'Nr. rol fiscal / matricol', placeholder: 'RF-12345' },
    { key: 'uatname',           label: 'UAT emitentă',              placeholder: 'DITL Sector 1 / Primăria Cluj-Napoca' },
  ],

  pad: [
    // PAD = Asigurare obligatorie dezastre (cutremur, inundație, alunecare). Lege 260/2008.
    // Primă fixă prin lege: 20 EUR/an (Tip A) sau 10 EUR/an (Tip B). expiry_date = 1 an.
    { key: 'policy_number',     label: 'Nr. poliță PAD',            placeholder: 'PAD-2024-00123456' },
    { key: 'insurer',           label: 'Asigurator',                placeholder: 'Allianz, Groupama, Omniasig, Generali...' },
    { key: 'adresa_asigurata',  label: 'Adresă proprietate asigurată', placeholder: 'Str. ..., Bl., Ap., Sector, Oraș' },
    { key: 'tip_constructie',   label: 'Tip construcție',           placeholder: 'Tip A (beton/cărămidă) / Tip B (lemn/chirpici/tablă)' },
    { key: 'suma_asigurata',    label: 'Sumă asigurată',            placeholder: '20.000 EUR (Tip A) / 10.000 EUR (Tip B)' },
    { key: 'prima_anuala',      label: 'Primă anuală (RON)',        placeholder: '~100 RON (Tip A)',  keyboardType: 'decimal-pad' },
    { key: 'zona_seismica',     label: 'Zonă seismică',             placeholder: 'A / B / C / D / E  (E = cea mai expusă)' },
  ],

  // ─── FINANCIAR ───────────────────────────────────────────────────────────

  factura: [
    // expiry_date = data scadenței plății (de obicei 15-30 zile de la emitere).
    { key: 'invoice_number',    label: 'Nr. factură',               placeholder: 'FAC-2024-001234' },
    { key: 'serie_factura',     label: 'Serie factură',             placeholder: 'FACT / ENE / DIZ' },
    { key: 'supplier',          label: 'Furnizor',                  placeholder: 'E.ON Energie / Engie / Electrica / Digi / Orange / Aquatim...' },
    { key: 'tip_serviciu',      label: 'Tip serviciu',              placeholder: 'Energie electrică / Gaz / Apă-canal / Internet / Telefonie' },
    { key: 'cod_client',        label: 'Cod client / Nr. contract', placeholder: '1234567890' },
    { key: 'perioada_facturare',label: 'Perioadă facturare',        placeholder: '01.01.2026 – 31.01.2026' },
    { key: 'consum',            label: 'Consum',                    placeholder: '111 kWh / 23 mc / 100 GB', keyboardType: 'decimal-pad' },
    { key: 'amount',            label: 'Total cu TVA (RON)',        placeholder: '225.06',            keyboardType: 'decimal-pad' },
    { key: 'due_date',          label: 'Scadentă',                  placeholder: 'ZZ.LL.AAAA' },
    { key: 'iban_plata',        label: 'IBAN plată',                placeholder: 'RO49BTRL...' },
    { key: 'cod_bare_plata',    label: 'Cod de bare / Referință plată', placeholder: '12345678901234567890', keyboardType: 'numeric' },
    { key: 'nr_contor',         label: 'Nr. contor',                placeholder: 'CNT-1234567' },
  ],

  contract: [
    // expiry_date = data încetării (dacă determinat). Remindere: cu 60 zile (preaviz) și 7 zile.
    { key: 'contract_number',   label: 'Nr. contract',              placeholder: 'CTR-2024-001' },
    { key: 'tip_contract',      label: 'Tip contract',              placeholder: 'Chirie / Prestări servicii / Muncă / Comodat / Executare lucrări' },
    { key: 'counterpart',       label: 'Contraparte (Nume / Firmă)', placeholder: 'Firma ABC SRL / Popescu Ion' },
    { key: 'obiect_contract',   label: 'Obiect contract',           placeholder: 'Închiriere apartament 2 camere / Mentenanță software...' },
    { key: 'value',             label: 'Valoare',                   placeholder: '5000.00',           keyboardType: 'decimal-pad' },
    { key: 'moneda',            label: 'Monedă',                    placeholder: 'RON / EUR / USD' },
    { key: 'frecventa_plata',   label: 'Frecvență plată',           placeholder: 'Lunar / Trimestrial / La finalizare' },
    { key: 'durata',            label: 'Durată',                    placeholder: '12 luni / Nedeterminat / 3 ani' },
    { key: 'preaviz',           label: 'Termen preaviz',            placeholder: '30 zile / 60 zile' },
    { key: 'garantie',          label: 'Garanție / Cauțiune',       placeholder: '2 chirii = 3000 RON' },
    { key: 'penalitati',        label: 'Penalități',                placeholder: '0.1%/zi / 2%/lună' },
    { key: 'iban_plata',        label: 'IBAN plată contraparte',    placeholder: 'RO49INGB...' },
  ],

  card: [
    // expiry_date = data expirare card (LL/AA). NICIODATĂ nu salva nr. complet, CVV sau PIN!
    { key: 'last4',             label: 'Ultimele 4 cifre',          placeholder: '1234',              keyboardType: 'numeric' },
    { key: 'bank',              label: 'Bancă emitentă',            placeholder: 'BCR / BRD / BT / ING / Raiffeisen / Revolut / Wise...' },
    { key: 'tip_retea',         label: 'Rețea card',                placeholder: 'Visa / Mastercard / Maestro / Amex' },
    { key: 'tip_card',          label: 'Tip card',                  placeholder: 'Debit / Credit / Prepaid / Business / Co-branded' },
    { key: 'limita_credit',     label: 'Limită credit (RON)',       placeholder: '10000',             keyboardType: 'decimal-pad' },
    { key: 'taxa_anuala',       label: 'Taxă anuală card (RON)',    placeholder: '50',                keyboardType: 'decimal-pad' },
    { key: 'data_scadenta_rata',label: 'Zi scadentă rată (credit)', placeholder: '15 (în fiecare lună)', keyboardType: 'numeric' },
    { key: 'cont_iban',         label: 'IBAN cont asociat',         placeholder: 'RO49INGB...' },
  ],

  garantie: [
    // expiry_date = data achiziție + ani garanție. Garanție legală: 2 ani (OUG 140/2021).
    { key: 'product_name',      label: 'Produs',                    placeholder: 'Mașină de spălat / iPhone 15 / TV Samsung 65"' },
    { key: 'brand',             label: 'Marcă',                     placeholder: 'Samsung / Apple / Bosch / LG / Whirlpool' },
    { key: 'model',             label: 'Model',                     placeholder: 'WW90T534DAE / iPhone 15 Pro / OLED65C3' },
    { key: 'serie_produs',      label: 'Serie produs (S/N)',        placeholder: 'SN1234567890' },
    { key: 'store',             label: 'Magazin achiziție',         placeholder: 'eMAG / Altex / Flanco / Media Galaxy / Dedeman' },
    { key: 'nr_bon_factura',    label: 'Nr. bon / factură achiziție', placeholder: 'BON: 001234 / FAC: SB-001234' },
    { key: 'pret_achizitie',    label: 'Preț achiziție (RON)',      placeholder: '3500.00',           keyboardType: 'decimal-pad' },
    { key: 'garantie_legala',   label: 'Garanție legală (luni)',    placeholder: '24  (2 ani – OUG 140/2021)', keyboardType: 'numeric' },
    { key: 'warranty_years',    label: 'Garanție comercială extra (luni)', placeholder: '12 / 24 / 36', keyboardType: 'numeric' },
    { key: 'service_autorizat', label: 'Service autorizat contact', placeholder: 'Samsung Service: 0800.xxx / service.samsung.com' },
  ],

  bon_cumparaturi: [
    // expiry_date = termen retur (14-30 zile) dacă relevant, altfel GOL.
    { key: 'store',             label: 'Magazin / Furnizor',        placeholder: 'Lidl / Mega Image / eMAG / Altex...' },
    { key: 'nr_bon',            label: 'Nr. bon fiscal',            placeholder: '001234',            keyboardType: 'numeric' },
    { key: 'amount',            label: 'Sumă totală (RON)',         placeholder: '125.80',            keyboardType: 'decimal-pad' },
    { key: 'metoda_plata',      label: 'Metodă plată',              placeholder: 'Card / Numerar / Voucher' },
    { key: 'scop',              label: 'Scop / Motiv',              placeholder: 'Garanție produs / Decontare firmă / Dovadă retur' },
    { key: 'produse_principale',label: 'Produse principale',        placeholder: 'TV Samsung 65", Mașină de spălat Bosch...' },
  ],

  abonament: [
    // expiry_date = data următoarei plăți sau data expirare abonament fix.
    { key: 'service_name',      label: 'Serviciu / Furnizor',       placeholder: 'Netflix / Spotify / Digi / Orange / Sala de sport / Antivirus...' },
    { key: 'tip_plan',          label: 'Plan / Pachet',             placeholder: 'Standard / Premium / Family / Basic' },
    { key: 'amount',            label: 'Sumă',                      placeholder: '55.99',             keyboardType: 'decimal-pad' },
    { key: 'moneda',            label: 'Monedă',                    placeholder: 'RON / EUR / USD' },
    { key: 'recurrence',        label: 'Frecvență',                 placeholder: 'Lunar / Anual / Trimestrial / Săptămânal' },
    { key: 'data_urmatoare_plata', label: 'Data următoarei plăți', placeholder: 'ZZ.LL.AAAA' },
    { key: 'metoda_plata',      label: 'Metodă plată',              placeholder: 'Card Visa *1234 / PayPal / Transfer bancar' },
    { key: 'reinnoire_automata',label: 'Reînnoire automată',        placeholder: 'Da (debit automat) / Nu' },
    { key: 'cod_client',        label: 'Cod client / Nr. cont',     placeholder: '1234567890' },
    { key: 'link_anulare',      label: 'Link anulare / Gestionare', placeholder: 'netflix.com/cancel / account.spotify.com' },
    { key: 'categorie',         label: 'Categorie',                 placeholder: 'Streaming video / Muzică / Telefonie / Software / Fitness / Transport' },
    { key: 'perioada_minima',   label: 'Perioadă minimă contract',  placeholder: '12 luni / 24 luni / Fără perioadă minimă' },
  ],

  // ─── MEDICAL ─────────────────────────────────────────────────────────────

  reteta_medicala: [
    // expiry_date = data expirare rețetă: 30 zile (obișnuită) sau 90 zile (boli cronice).
    // O rețetă poate conține MAX 3 medicamente (norma CNAS). Prescris în DCI (denumire generică).
    { key: 'series',            label: 'Serie rețetă',              placeholder: 'Rx 1234567',        ocrKey: 'series' },
    { key: 'doctor',            label: 'Medic prescriptor',         placeholder: 'Dr. Ionescu Maria' },
    { key: 'doctor_specialty',  label: 'Specialitate',              placeholder: 'Medicină de familie / Cardiologie / Neurologie...' },
    { key: 'doctor_parafa',     label: 'Cod parafă medic',          placeholder: 'P12345' },
    { key: 'unit_medical',      label: 'Unitate medicală',          placeholder: 'CMI Dr. Ionescu / Spital Județean / Policlinică...' },
    { key: 'casa_asigurari',    label: 'Casa de asigurări',         placeholder: 'CASMB / CAS Cluj / CAS Ilfov...' },
    { key: 'patient_cnp',       label: 'CNP pacient',               placeholder: '1234567890123',     keyboardType: 'numeric' },
    { key: 'diagnostic_cod',    label: 'Diagnostic (cod CIM-10)',   placeholder: 'J06.9 – Rinofaringită / I10 – Hipertensiune...' },
    { key: 'medication_1',      label: 'Medicament 1 (DCI)',        placeholder: 'Amoxicilinum 500mg caps. – Nr. 20 – 1cp×3/zi×7 zile' },
    { key: 'medication_2',      label: 'Medicament 2 (DCI)',        placeholder: 'Ibuprofendum 400mg – Nr. 10 – 1cp×3/zi (la nevoie)' },
    { key: 'medication_3',      label: 'Medicament 3 (DCI)',        placeholder: 'lăsați gol dacă nu este cazul' },
    { key: 'reteta_tip',        label: 'Tip rețetă',                placeholder: 'Compensată 90% / Gratuită / Necompensată / Boală cronică' },
  ],

  analize_medicale: [
    // expiry_date: opțional – 30 zile dacă sunt analize pre-operatorii; altfel GOL.
    { key: 'lab',               label: 'Laborator',                 placeholder: 'Synevo / MedLife / Regina Maria / Medicover...' },
    { key: 'report_number',     label: 'Nr. raport / Serie',        placeholder: 'SY-2024-123456' },
    { key: 'name',              label: 'Pacient',                   placeholder: 'POPESCU ION',       ocrKey: 'name' },
    { key: 'recoltare_date',    label: 'Data recoltare',            placeholder: 'ZZ.LL.AAAA' },
    { key: 'tip_analize',       label: 'Tip analize',               placeholder: 'Hemoleucogramă / Biochimie / Hormoni TSH / Urocultură / Coagulogramă...' },
    { key: 'doctor',            label: 'Medic trimițător',          placeholder: 'Dr. Ionescu – Medicină de familie' },
    { key: 'summary_values',    label: 'Valori cheie (rezumat)',    placeholder: 'Glicemie: 95 mg/dL (ref: 70-100). Hb: 13.5 g/dL. TSH: 2.1 mUI/L.' },
    { key: 'observations',      label: 'Observații medic',          placeholder: 'Valori în limite normale. Repetați la 3 luni.' },
  ],

  // ─── ANIMALE ─────────────────────────────────────────────────────────────

  vaccin_animal: [
    // expiry_date = data rapelului (scadența următorului vaccin).
    // Vaccinul antirabic la câini este OBLIGATORIU legal în România (anual). Amendă 500-1000 RON!
    { key: 'microchip',         label: 'Nr. microcip / Tatuaj',    placeholder: '941000012345678  (15 cifre ISO)',  keyboardType: 'numeric' },
    { key: 'vaccine_name',      label: 'Denumire vaccin',          placeholder: 'Nobivac Rabies / Purevax RCPCh / Versican Plus DHPPi...' },
    { key: 'vaccine_type',      label: 'Tip vaccin',               placeholder: 'Antirabic (obligatoriu) / Polivalent câine / Trivalent pisică / FeLV' },
    { key: 'vaccine_lot',       label: 'Nr. lot vaccin',           placeholder: 'A1B2C3  (de pe eticheta autoadezivă)' },
    { key: 'vaccine_producer',  label: 'Producător vaccin',        placeholder: 'MSD Animal Health / Boehringer Ingelheim / Virbac / Zoetis' },
    { key: 'vet_name',          label: 'Medic veterinar',          placeholder: 'Dr. Ionescu Alexandru' },
    { key: 'vet_parafa',        label: 'Cod parafă veterinar',     placeholder: 'V12345' },
    { key: 'cabinet_name',      label: 'Cabinet / Clinică vet.',   placeholder: 'Clinica Vet Pro / Medivet / AnimalLife...' },
  ],

  deparazitare: [
    // expiry_date = data următor tratament:
    //   - extern (purici/căpușe): lunar (sezon cald) sau la 3 luni (iarnă)
    //   - intern (viermi): la 3-6 luni adulți, la 2 săptămâni pui <3 luni
    { key: 'treatment_type',    label: 'Tip deparazitare',         placeholder: 'Internă (viermi) / Externă (purici, căpușe) / Ambele' },
    { key: 'product_name',      label: 'Produs (comercial)',       placeholder: 'Advocate / Frontline Combo / Bravecto / Milbemax / Drontal...' },
    { key: 'active_substance',  label: 'Substanță activă',         placeholder: 'Imidacloprid + moxidectin / Fipronil / Milbemicin oxim...' },
    { key: 'dose',              label: 'Doză administrată',        placeholder: '1 pipetă / 1 comprimat / 2.5 ml' },
    { key: 'animal_weight',     label: 'Greutate animal (kg)',     placeholder: '15.5',              keyboardType: 'decimal-pad' },
    { key: 'vet_name',          label: 'Veterinar / Administrat de', placeholder: 'Dr. Ionescu / Stăpân (acasă)' },
    { key: 'next_treatment',    label: 'Data următor tratament',   placeholder: 'ZZ.LL.AAAA' },
    { key: 'observations',      label: 'Observații',               placeholder: 'Reacție adversă / greață / vomă post-tratament...' },
  ],

  vizita_vet: [
    // expiry_date = data control următor (dacă medicul a stabilit o dată de revenire).
    { key: 'reason',            label: 'Motiv consultație',        placeholder: 'Control anual / Vomă / Șchiopătare / Urgență / Post-operatoriu...' },
    { key: 'diagnosis',         label: 'Diagnostic',               placeholder: 'Gastroenterită / Otită externă / Fractură / Sănătos' },
    { key: 'treatment',         label: 'Tratament prescris',       placeholder: 'Amoxicilina 250mg 1cp×2/zi 7 zile. Probiotice. Dietă blandă.' },
    { key: 'procedures',        label: 'Proceduri efectuate',      placeholder: 'Ecografie abdominală / Radiografie / Suturi / Castrare / Curățare dentară...' },
    { key: 'vet_name',          label: 'Medic veterinar',          placeholder: 'Dr. Ionescu Alexandru' },
    { key: 'clinic_name',       label: 'Cabinet / Clinică',        placeholder: 'Clinica Vet Pro / Medivet / AnimalLife / CrisVet...' },
    { key: 'cost',              label: 'Cost consultație (RON)',   placeholder: '150.00',            keyboardType: 'decimal-pad' },
    { key: 'next_visit',        label: 'Data control următor',     placeholder: 'ZZ.LL.AAAA' },
  ],

  // ─── BILET ───────────────────────────────────────────────────────────────

  bilet: [
    // expiry_date = data evenimentului / zborului / călătoriei.
    // Biletele pot fi arhivate / șterse automat după data evenimentului.
    { key: 'categorie',         label: 'Categorie',                placeholder: 'Avion / Tren CFR / Concert / Festival / Meci / Spectacol / Teatru / Autobuz' },
    { key: 'venue',             label: 'Locație / Rută / Aeroport', placeholder: 'Arena Națională / OTP→LHR / București Nord→Cluj-Napoca' },
    { key: 'eveniment_artist',  label: 'Eveniment / Artist / Nr. zbor / Nr. tren', placeholder: 'Coldplay / RO123 / IR 1581 / W6 1234' },
    { key: 'pasager_titular',   label: 'Pasager / Titular',        placeholder: 'POPESCU/ION MR' },
    { key: 'sector_zona',       label: 'Sector / Zonă / Clasă',    placeholder: 'VIP / Parterre / Clasă 2 / Economic / Business' },
    { key: 'vagon_rand',        label: 'Vagon / Rând',             placeholder: 'Vagon 4 / Rând H' },
    { key: 'seat',              label: 'Loc / Scaun',              placeholder: '12A / Loc 23 / Standing' },
    { key: 'poarta',            label: 'Poartă / Gate',            placeholder: 'B14 / Poarta 3' },
    { key: 'event_date',        label: 'Data evenimentului',       placeholder: 'ZZ.LL.AAAA HH:MM' },
    { key: 'ora_plecare',       label: 'Ora plecare / Îmbarcare',  placeholder: '14:30 îmbarcare / 15:00 decolare / 09:15 plecare tren' },
    { key: 'cod_rezervare',     label: 'Cod rezervare / PNR',      placeholder: 'ABC123' },
    { key: 'nr_bilet',          label: 'Nr. bilet / Cod unic',     placeholder: 'TK-1234567' },
    { key: 'pret',              label: 'Preț (RON)',               placeholder: '250.00',            keyboardType: 'decimal-pad' },
    { key: 'organizator',       label: 'Organizator / Companie',   placeholder: 'Live Nation / TAROM / Wizz Air / CFR Călători / Flixbus' },
    { key: 'platform_achizitie',label: 'Platformă achiziție',      placeholder: 'iabilet.ro / eventim.ro / cfrcalatori.ro / wizz.com' },
  ],

  // ─── STINGĂTOR ───────────────────────────────────────────────────────────

  stingator_incendiu: [
    // Verificare obligatorie: anual (vizuală) + revizie completă la 5 ani (ISCIR).
    // expiry_date = data scadenței următoarei verificări obligatorii.
    { key: 'tip_agent',         label: 'Tip agent stingător',      placeholder: 'Pulbere ABC / Pulbere BC / CO2 / Spumă / Apă pulverizată' },
    { key: 'capacitate',        label: 'Capacitate',               placeholder: '6 kg / 9 litri / 5 kg CO2' },
    { key: 'producator',        label: 'Producător / Marcă',       placeholder: 'Strix / Sting / Total Fire / Minimax' },
    { key: 'serie',             label: 'Nr. serie',                placeholder: 'ST2021-001234' },
    { key: 'data_fabricatie',   label: 'Data fabricației',         placeholder: 'LL/AAAA' },
    { key: 'firma_verificare',  label: 'Firmă verificare autorizată ISCIR', placeholder: 'SC FireCheck SRL / Pyro Service SRL' },
    { key: 'tip_verificare',    label: 'Tip ultimă verificare',    placeholder: 'Verificare anuală / Revizie 5 ani / Reîncărcare după utilizare' },
    { key: 'location',          label: 'Locație',                  placeholder: 'Mașină / Bucătărie / Birou parter lângă ușa de intrare / Server room' },
    { key: 'nr_inventar',       label: 'Nr. inventar intern',      placeholder: 'STING-001' },
  ],

  // ─── FIRMĂ / BUSINESS ────────────────────────────────────────────────────

  certificat_inregistrare: [
    // expiry_date = GOL (permanent). Certificatul Constatator (extras ONRC) expiră la 30 zile.
    { key: 'cui',               label: 'CUI (Cod Unic de Înregistrare)', placeholder: '12345678',   keyboardType: 'numeric' },
    { key: 'reg_com',           label: 'Nr. Registrul Comerțului',  placeholder: 'J40/1234/2020  (J40 = București)' },
    { key: 'legal_form',        label: 'Formă juridică',            placeholder: 'SRL / SA / PFA / II / SNC / SCS / RA' },
    { key: 'denumire',          label: 'Denumire firmă',            placeholder: 'ACME SRL' },
    { key: 'registered_address',label: 'Sediu social',              placeholder: 'Str. ..., nr., Sector, Oraș, Județ' },
    { key: 'cod_caen_principal',label: 'Cod CAEN principal + activitate', placeholder: '6201 – Activități de realizare a soft-ului' },
    { key: 'capital_social',    label: 'Capital social (RON)',      placeholder: '200  (SRL min. 1 RON din 2022)', keyboardType: 'decimal-pad' },
    { key: 'data_inregistrare', label: 'Data înregistrării ONRC',   placeholder: 'ZZ/LL/AAAA' },
  ],

  autorizatie_activitate: [
    // expiry_date = data expirare autorizație (variabil: unele permanente cu revizuire anuală).
    { key: 'tip_autorizatie',       label: 'Tip autorizație',          placeholder: 'Sanitară (DSP) / ISU (PSI) / Mediu (APM) / ANRE / ANCOM / Construire / Funcționare (primărie)' },
    { key: 'autoritate',            label: 'Autoritate emitentă',      placeholder: 'DSP București / ISU / APM Cluj / Primăria Sect. 1 / ANRE' },
    { key: 'numar_autorizatie',     label: 'Nr. autorizație',          placeholder: '1234/2023' },
    { key: 'activitate_autorizata', label: 'Activitate autorizată',    placeholder: 'Alimentație publică (CAEN 5610) / Distribuție energie electrică...' },
    { key: 'adresa_locatie',        label: 'Adresă locație autorizată', placeholder: 'Str. ..., nr., Sector, Oraș, Județ' },
    { key: 'conditii',              label: 'Condiții / Restricții',    placeholder: 'Program 08-20, capacitate max. 50 pers., fără muzică după 22:00...' },
  ],

  act_constitutiv: [
    // expiry_date = GOL (permanent). Se actualizează prin acte adiționale la fiecare modificare.
    { key: 'legal_form',        label: 'Formă juridică',            placeholder: 'SRL / SA / SNC / SCS / RA' },
    { key: 'denumire',          label: 'Denumire societate',        placeholder: 'ACME SRL' },
    { key: 'sediu',             label: 'Sediu social',              placeholder: 'Str. ..., nr., Localitate, Județ' },
    { key: 'obiect_activitate', label: 'Obiect principal activitate', placeholder: '6201 – Activități de realizare a soft-ului la comandă' },
    { key: 'capital_social',    label: 'Capital social total (RON)', placeholder: '200',            keyboardType: 'decimal-pad' },
    { key: 'asociati',          label: 'Asociați / Cotă parte',     placeholder: 'Popescu Ion 50%, Ionescu Ana 50%' },
    { key: 'administratori',    label: 'Administrator(i)',           placeholder: 'Popescu Ion (administrator unic)' },
    { key: 'notary',            label: 'Notar autentificator',      placeholder: 'BNP Ionescu Ion – nr. dosar 1234/2020' },
    { key: 'versiune',          label: 'Versiune / Act adițional',  placeholder: 'Versiune inițială / Act adițional nr. 3 din 15.03.2023' },
  ],

  certificat_tva: [
    // expiry_date = GOL (nu expiră, dar poate fi ANULAT de ANAF!). Verificați statusul periodic.
    { key: 'cod_tva',               label: 'Cod TVA',                      placeholder: 'RO12345678  (= RO + CUI)' },
    { key: 'cui',                   label: 'CUI',                          placeholder: '12345678',        keyboardType: 'numeric' },
    { key: 'denumire',              label: 'Denumire persoană impozabilă', placeholder: 'ACME SRL' },
    { key: 'tip_inregistrare',      label: 'Tip înregistrare TVA',        placeholder: 'Obligatorie (>300k RON CA) / Opțională / Specială (art.317)' },
    { key: 'data_inregistrare_tva', label: 'Data înregistrării în scopuri de TVA', placeholder: 'ZZ.LL.AAAA' },
    { key: 'perioada_fiscala',      label: 'Perioadă fiscală (D300)',      placeholder: 'Lunar (CA>100k EUR) / Trimestrial' },
    { key: 'status_tva',            label: 'Status TVA actual',            placeholder: 'Activ / Suspendat / Anulat  (verificați pe anaf.ro)' },
    { key: 'nr_decizie_anaf',       label: 'Nr. decizie ANAF',            placeholder: '12345/2021' },
  ],

  asigurare_profesionala: [
    // expiry_date = data expirare poliță (reînnoire anuală obligatorie pentru profesii reglementate).
    // Profesii cu asigurare obligatorie: medici (CMR), avocați (UNBR), notari, arhitecți (OAR),
    // contabili (CECCAR), auditori (CAFR), evaluatori (ANEVAR), consultanți fiscali (CCF).
    { key: 'insurer',               label: 'Companie asigurare',          placeholder: 'Allianz-Țiriac / Omniasig / Groupama / Generali...' },
    { key: 'policy_number',         label: 'Nr. poliță',                  placeholder: 'RCP/2024/001234' },
    { key: 'asigurat',              label: 'Asigurat (profesionist)',      placeholder: 'Popescu Ion / Clinica Medicală SRL' },
    { key: 'tip_profesie',          label: 'Tip profesie asigurată',      placeholder: 'Medic / Avocat / Notar / Arhitect / Contabil / Auditor / Evaluator' },
    { key: 'entitate_profesionala', label: 'Corp / Ordin profesional',    placeholder: 'CMR / UNBR / UNNPR / OAR / CECCAR / CAFR / ANEVAR' },
    { key: 'amount',                label: 'Sumă asigurată',              placeholder: '500.000 RON / 200.000 EUR',  keyboardType: 'decimal-pad' },
    { key: 'prima_asigurare',       label: 'Primă anuală (RON)',          placeholder: '1200.00',                   keyboardType: 'decimal-pad' },
    { key: 'risk_type',             label: 'Riscuri acoperite',           placeholder: 'Erori profesionale / Neglijență / Malpraxis / Omisiuni' },
    { key: 'teritoriu',             label: 'Teritoriu acoperire',         placeholder: 'România / UE' },
  ],

};


