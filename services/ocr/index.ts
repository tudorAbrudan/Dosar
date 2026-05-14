/**
 * Dispatcher principal + barrel pentru toate extractoarele OCR per tip de document.
 *
 * Fiecare extractor returnează DOAR câmpurile-cheie (2-5 per tip), conform
 * `DOCUMENT_FIELDS` din `types/documentFields.ts`. Textul complet OCR se
 * salvează separat în `documents.ocr_text`.
 */
import type { DocumentType } from '@/types';
import { NO_EXPIRY_DOC_TYPES } from '@/types';
import type { ExtractResult } from './types';

import { extractBuletin, extractPasaport, extractPermisAuto } from './personal';
import {
  extractTalonDoc,
  extractCarteAuto,
  extractRca,
  extractItp,
  extractVigneta,
  extractCasco,
} from './auto';
import {
  extractPad,
  extractActProprietate,
  extractCadastru,
  extractImpozitProprietate,
} from './property';
import {
  extractFactura,
  extractBonCumparaturi,
  extractBonParcare,
  extractGarantie,
  extractContract,
  extractAbonament,
  extractCard,
  extractBilet,
} from './commerce';
import { extractVaccinAnimal, extractDeparazitare, extractVizitaVet } from './animal';
import {
  extractCertificatInregistrare,
  extractAutorizatieActivitate,
  extractActConstitutiv,
  extractCertificatTva,
  extractAsigurareProf,
} from './business';
import { extractStingator, extractGeneric } from './misc';

// Re-exporturi pentru codul care le importa direct
export type { ExtractResult } from './types';
export { isKnownUtilitySupplier } from './suppliers';

export function extractFieldsForType(
  type: DocumentType | string,
  text: string
): ExtractResult {
  const result = extractFieldsForTypeInner(type, text);
  // Safety net: tipurile fără expirare nu trebuie să capete expiry_date —
  // chiar dacă regex-ul a prins o dată în document.
  if (NO_EXPIRY_DOC_TYPES.has(type as DocumentType)) {
    delete result.expiry_date;
  }
  return result;
}

function extractFieldsForTypeInner(type: DocumentType | string, text: string): ExtractResult {
  switch (type) {
    case 'buletin':
      return extractBuletin(text);
    case 'pasaport':
      return extractPasaport(text);
    case 'permis_auto':
      return extractPermisAuto(text);
    case 'talon':
      return extractTalonDoc(text);
    case 'carte_auto':
      return extractCarteAuto(text);
    case 'rca':
      return extractRca(text);
    case 'itp':
      return extractItp(text);
    case 'vigneta':
      return extractVigneta(text);
    case 'casco':
      return extractCasco(text);
    case 'pad':
      return extractPad(text);
    case 'factura':
      return extractFactura(text);
    case 'bon_cumparaturi':
      return extractBonCumparaturi(text);
    case 'bon_parcare':
      return extractBonParcare(text);
    case 'garantie':
      return extractGarantie(text);
    case 'contract':
      return extractContract(text);
    case 'act_proprietate':
      return extractActProprietate(text);
    case 'cadastru':
      return extractCadastru(text);
    case 'impozit_proprietate':
      return extractImpozitProprietate(text);
    case 'abonament':
      return extractAbonament(text);
    case 'stingator_incendiu':
      return extractStingator(text);
    case 'vaccin_animal':
      return extractVaccinAnimal(text);
    case 'deparazitare':
      return extractDeparazitare(text);
    case 'vizita_vet':
      return extractVizitaVet(text);
    case 'card':
      return extractCard(text);
    case 'bilet':
      return extractBilet(text);
    case 'certificat_inregistrare':
      return extractCertificatInregistrare(text);
    case 'autorizatie_activitate':
      return extractAutorizatieActivitate(text);
    case 'act_constitutiv':
      return extractActConstitutiv(text);
    case 'certificat_tva':
      return extractCertificatTva(text);
    case 'asigurare_profesionala':
      return extractAsigurareProf(text);
    default:
      return extractGeneric(text);
  }
}
