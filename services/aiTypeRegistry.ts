import type { DocumentType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';

export interface AiTypeEntry {
  /** Label canonical (același din DOCUMENT_TYPE_LABELS). */
  label: string;
  /** Sinonime user-facing pe care AI le poate vedea în document. */
  aliases: string[];
  /** Descriere scurtă pentru clasificator: ce e tipul și cum îl recunoști. */
  description: string;
  /** Semne distinctive concrete pe document (antet, câmpuri caracteristice). */
  distinguishingMarks?: string[];
}

export const DOC_TYPE_AI_REGISTRY: Partial<Record<DocumentType, AiTypeEntry>> = {
  buletin: {
    label: DOCUMENT_TYPE_LABELS.buletin,
    aliases: ['buletin', 'carte de identitate', 'CI', 'CNP'],
    description: 'Cartea de identitate românească emisă de autoritățile române.',
    distinguishingMarks: ['CNP 13 cifre', 'Antet ROMANIA', 'Câmpul „Cetățenia"'],
  },
  pasaport: {
    label: DOCUMENT_TYPE_LABELS.pasaport,
    aliases: ['pasaport', 'passport'],
    description: 'Pașaport românesc sau străin.',
    distinguishingMarks: ['Cuvântul „PASSPORT/PAȘAPORT"', 'Pagină biometrică cu fotografie'],
  },
  permis_auto: {
    label: DOCUMENT_TYPE_LABELS.permis_auto,
    aliases: ['permis auto', 'permis de conducere', 'driving licence'],
    description: 'Permis de conducere românesc sau european.',
    distinguishingMarks: ['Categorii vehicul (B, C, D)', 'Data emiterii și expirării'],
  },
  talon: {
    label: DOCUMENT_TYPE_LABELS.talon,
    aliases: ['talon', 'certificat de înmatriculare', 'CIV'],
    description: 'Certificatul de înmatriculare al unui vehicul (talon).',
    distinguishingMarks: [
      'Câmpuri A, B, C, D, E, F (caroserie, motor, masă)',
      'Tabel ITP cu ștampile',
      'Numărul de înmatriculare în format „B 123 ABC"',
    ],
  },
  carte_auto: {
    label: DOCUMENT_TYPE_LABELS.carte_auto,
    aliases: ['carte auto', 'carte de identitate vehicul', 'CIV format vechi'],
    description:
      'Carte de identitate a vehiculului (document complementar talonului, format vechi).',
  },
  rca: {
    label: DOCUMENT_TYPE_LABELS.rca,
    aliases: [
      'RCA',
      'asigurare auto obligatorie',
      'răspundere civilă auto',
      'asigurare mașină obligatorie',
      'poliță RCA',
    ],
    description: 'Asigurare auto obligatorie (RCA) emisă de un asigurator autorizat ASF.',
    distinguishingMarks: [
      'Numărul de înmatriculare al vehiculului',
      'Antet ASF + asigurator',
      'Mențiunea „răspundere civilă"',
    ],
  },
  casco: {
    label: DOCUMENT_TYPE_LABELS.casco,
    aliases: ['CASCO', 'asigurare auto facultativă', 'asigurare mașină full'],
    description: 'Asigurare auto facultativă (CASCO) care acoperă daune proprii ale vehiculului.',
    distinguishingMarks: ['Mențiunea „CASCO" sau „facultativ"', 'Lista acoperiri (furt, daune)'],
  },
  itp: {
    label: DOCUMENT_TYPE_LABELS.itp,
    aliases: ['ITP', 'inspecție tehnică periodică', 'verificare tehnică'],
    description: 'Certificat de inspecție tehnică periodică pentru vehicul (separat de talon).',
  },
  vigneta: {
    label: DOCUMENT_TYPE_LABELS.vigneta,
    aliases: ['rovignetă', 'rovinieta', 'vignetă', 'taxă drum', 'CNAIR'],
    description: 'Rovinietă (taxă de utilizare a rețelei de drumuri).',
    distinguishingMarks: ['CNAIR', 'Perioadă valabilitate (zile/lună/an)'],
  },
  act_proprietate: {
    label: DOCUMENT_TYPE_LABELS.act_proprietate,
    aliases: ['act de proprietate', 'contract vânzare-cumpărare imobil', 'titlu de proprietate'],
    description: 'Document care atestă dreptul de proprietate asupra unui imobil.',
  },
  cadastru: {
    label: DOCUMENT_TYPE_LABELS.cadastru,
    aliases: ['cadastru', 'extras de carte funciară', 'ANCPI', 'plan cadastral'],
    description: 'Document cadastral / extras de carte funciară de la ANCPI.',
  },
  factura: {
    label: DOCUMENT_TYPE_LABELS.factura,
    aliases: ['factură', 'invoice', 'factură fiscală'],
    description: 'Factură (utilități, servicii, produse).',
    distinguishingMarks: ['Număr factură', 'Furnizor + cumpărător', 'Total de plată', 'Scadență'],
  },
  impozit_proprietate: {
    label: DOCUMENT_TYPE_LABELS.impozit_proprietate,
    aliases: ['impozit clădire', 'impozit teren', 'decizie impunere', 'taxă locală'],
    description: 'Decizie de impunere sau dovadă de plată impozit local.',
  },
  pad: {
    label: DOCUMENT_TYPE_LABELS.pad,
    aliases: [
      'PAD',
      'PAID',
      'asigurare locuință',
      'asigurare casă',
      'asigurare obligatorie locuință',
      'poliță locuință',
      'poliță obligatorie',
    ],
    description:
      'Polița de Asigurare obligatorie a Locuinței împotriva Dezastrelor naturale (PAD) emisă prin PAID.',
    distinguishingMarks: [
      'Cuvântul „PAD" sau „PAID"',
      'Mențiunea „dezastre naturale" (cutremur, alunecări de teren, inundații)',
      'Adresa locuinței',
    ],
  },
  contract: {
    label: DOCUMENT_TYPE_LABELS.contract,
    aliases: ['contract', 'chirie', 'închiriere', 'prestări servicii', 'vânzare-cumpărare'],
    description: 'Contract civil sau comercial (chirie, prestări servicii, vânzare etc.).',
  },
  card: {
    label: DOCUMENT_TYPE_LABELS.card,
    aliases: ['card bancar', 'card de credit', 'card debit'],
    description: 'Card bancar (debit, credit, prepaid).',
    distinguishingMarks: ['16 cifre vizibile', 'Logo Visa/Mastercard', 'Data expirării MM/AA'],
  },
  garantie: {
    label: DOCUMENT_TYPE_LABELS.garantie,
    aliases: ['certificat de garanție', 'garanție produs', 'bon de garanție'],
    description: 'Certificat de garanție pentru un produs (electrocasnice, IT, mobilă etc.).',
  },
  abonament: {
    label: DOCUMENT_TYPE_LABELS.abonament,
    aliases: ['abonament', 'subscription', 'Netflix', 'Spotify', 'sală fitness'],
    description: 'Abonament la un serviciu (streaming, telecom, sală, salubritate etc.).',
  },
  bon_cumparaturi: {
    label: DOCUMENT_TYPE_LABELS.bon_cumparaturi,
    aliases: ['bon fiscal', 'bon de cumpărături', 'chitanță magazin'],
    description: 'Bon fiscal de la un magazin sau hypermarket.',
  },
  bon_parcare: {
    label: DOCUMENT_TYPE_LABELS.bon_parcare,
    aliases: ['bon parcare', 'ticket parcare', 'taxă parcare'],
    description: 'Bon sau ticket de parcare cu plată.',
  },
  reteta_medicala: {
    label: DOCUMENT_TYPE_LABELS.reteta_medicala,
    aliases: ['rețetă', 'prescripție medicală', 'Rp.'],
    description: 'Rețetă medicală cu medicamente prescrise de un medic.',
    distinguishingMarks: ['„Rp." sau lista de medicamente', 'Semnătură + parafă medic'],
  },
  analize_medicale: {
    label: DOCUMENT_TYPE_LABELS.analize_medicale,
    aliases: ['analize medicale', 'rezultate laborator', 'buletin analize'],
    description:
      'Buletin de analize medicale eliberat de un laborator (Synevo/MedLife/Regina Maria etc.).',
    distinguishingMarks: ['Antet laborator', 'Tabel cu analize și valori de referință'],
  },
  stingator_incendiu: {
    label: DOCUMENT_TYPE_LABELS.stingator_incendiu,
    aliases: ['stingător', 'extinctor', 'verificare stingător'],
    description: 'Document de verificare/încărcare stingător de incendiu.',
  },
  vaccin_animal: {
    label: DOCUMENT_TYPE_LABELS.vaccin_animal,
    aliases: ['vaccin animal', 'carnet vaccinări', 'pașaport animal'],
    description: 'Vaccin sau carnet de vaccinări pentru animal de companie.',
  },
  deparazitare: {
    label: DOCUMENT_TYPE_LABELS.deparazitare,
    aliases: ['deparazitare', 'antiparazitar', 'tratament purici'],
    description: 'Tratament deparazitar pentru animal de companie.',
  },
  vizita_vet: {
    label: DOCUMENT_TYPE_LABELS.vizita_vet,
    aliases: ['vizită veterinar', 'fișă veterinară', 'consult animal'],
    description: 'Documentație vizită la veterinar.',
  },
  bilet: {
    label: DOCUMENT_TYPE_LABELS.bilet,
    aliases: ['bilet', 'ticket avion', 'bilet tren', 'bilet eveniment', 'boarding pass'],
    description: 'Bilet de transport sau eveniment.',
  },
  certificat_inregistrare: {
    label: DOCUMENT_TYPE_LABELS.certificat_inregistrare,
    aliases: ['certificat înregistrare', 'CUI', 'ONRC certificat'],
    description: 'Certificat de înregistrare al unei firme la ONRC.',
  },
  autorizatie_activitate: {
    label: DOCUMENT_TYPE_LABELS.autorizatie_activitate,
    aliases: ['autorizație activitate', 'autorizație funcționare'],
    description: 'Autorizație de funcționare a unei activități comerciale.',
  },
  act_constitutiv: {
    label: DOCUMENT_TYPE_LABELS.act_constitutiv,
    aliases: ['act constitutiv', 'statut societate'],
    description: 'Act constitutiv al unei societăți comerciale.',
  },
  certificat_tva: {
    label: DOCUMENT_TYPE_LABELS.certificat_tva,
    aliases: ['certificat TVA', 'plătitor de TVA', 'cod TVA'],
    description: 'Certificat de înregistrare în scop de TVA.',
  },
  asigurare_profesionala: {
    label: DOCUMENT_TYPE_LABELS.asigurare_profesionala,
    aliases: [
      'asigurare profesională',
      'malpraxis',
      'răspundere profesională',
      'asigurare răspundere civilă profesională',
    ],
    description:
      'Asigurare de răspundere civilă profesională (medici, avocați, contabili, arhitecți etc.).',
    distinguishingMarks: [
      'Mențiunea „răspundere civilă profesională"',
      'Profesia / colegiul profesional al asiguratului',
    ],
  },
  asigurare_personala: {
    label: DOCUMENT_TYPE_LABELS.asigurare_personala,
    aliases: [
      'asigurare de viață',
      'poliță de viață',
      'asigurare deces',
      'asigurare protecție',
      'asigurare sănătate',
      'asigurare medicală privată',
      'abonament medical privat',
      'asigurare călătorie',
      'asigurare voiaj',
      'asigurare turism',
      'travel insurance',
      'life insurance',
      'health insurance',
    ],
    description:
      'Asigurare personală a unei persoane fizice: viață (deces/invaliditate/boli grave), sănătate privată sau călătorie. Discriminator în metadata.tip_asigurare.',
    distinguishingMarks: [
      'Asiguratul = persoană fizică (nu vehicul, nu locuință)',
      'Pentru viață: beneficiar nominalizat + tip eveniment',
      'Pentru sănătate: pachet servicii medicale + plafon anual',
      'Pentru călătorie: destinație + perioadă voiaj scurtă (zile)',
    ],
  },
  diploma: {
    label: DOCUMENT_TYPE_LABELS.diploma,
    aliases: ['diplomă', 'diplomă licență', 'diplomă bacalaureat'],
    description: 'Diplomă de studii (bacalaureat, licență, master, doctorat).',
  },
  foaie_matricola: {
    label: DOCUMENT_TYPE_LABELS.foaie_matricola,
    aliases: ['foaie matricolă', 'situație școlară'],
    description: 'Foaie matricolă cu situația școlară.',
  },
  certificat_absolvire: {
    label: DOCUMENT_TYPE_LABELS.certificat_absolvire,
    aliases: ['certificat absolvire', 'adeverință absolvire'],
    description: 'Certificat de absolvire a unui program de studii.',
  },
  certificat_curs: {
    label: DOCUMENT_TYPE_LABELS.certificat_curs,
    aliases: ['certificat curs', 'diplomă curs', 'training'],
    description: 'Certificat de absolvire a unui curs/training.',
  },
  adeverinta_studii: {
    label: DOCUMENT_TYPE_LABELS.adeverinta_studii,
    aliases: ['adeverință studii', 'adeverință student'],
    description: 'Adeverință de la o instituție de învățământ.',
  },
};

export function getRegistryEntry(type: DocumentType): AiTypeEntry {
  const entry = DOC_TYPE_AI_REGISTRY[type];
  if (entry) return entry;
  return {
    label: DOCUMENT_TYPE_LABELS[type] ?? type,
    aliases: [type],
    description: 'Tip generic, fără semne distinctive specifice.',
  };
}

/**
 * Construiește un catalog markdown-style cu tipurile candidate.
 * Folosit ca parte din prompt-ul de clasificare AI.
 */
export function buildClassifierCatalog(candidates: DocumentType[]): string {
  const lines: string[] = [];
  for (const type of candidates) {
    const entry = DOC_TYPE_AI_REGISTRY[type];
    if (!entry) continue;
    const aliases = entry.aliases.join(', ');
    const marks = entry.distinguishingMarks?.length
      ? ` Semne distinctive: ${entry.distinguishingMarks.join('; ')}.`
      : '';
    lines.push(
      `- "${type}" — ${entry.label}. ${entry.description} Cuvinte cheie: ${aliases}.${marks}`
    );
  }
  return lines.join('\n');
}
