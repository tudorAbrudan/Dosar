/**
 * Oferte de reînnoire pentru asigurări (asigra.ro) — sursă unică pentru
 * tipurile care primesc link, textul butonului și URL-ul pe produs.
 *
 * Fiecare loc din aplicație are propriul `utm_content`, ca să se vadă pe
 * asigra.ro ce punct de contact aduce oferte. URL-ul nu conține date ale
 * utilizatorului (număr, VIN, CNP) — doar tipul de asigurare și locul.
 */
import { ASIGRA_URL } from '@/constants/AppLinks';
import type { DocumentType } from '@/types';

export type InsuranceOfferPlacement =
  | 'notificare'
  | 'calendar'
  | 'document'
  | 'vehicul'
  | 'expirari'
  | 'home'
  | 'asistent';

export interface InsuranceOffer {
  /** Text de buton, ex. „Compară oferte RCA". */
  label: string;
  /** Nume scurt al produsului, pentru texte compuse. */
  product: string;
}

const OFFERS: Partial<Record<DocumentType, InsuranceOffer & { path: string; hash?: string }>> = {
  rca: { label: 'Compară oferte RCA', product: 'RCA', path: '/rca/quote' },
  casco: {
    label: 'Cere ofertă CASCO',
    product: 'CASCO',
    path: '/produse-si-servicii',
    hash: 'casco',
  },
  pad: {
    label: 'Cere ofertă asigurare locuință',
    product: 'asigurarea locuinței',
    path: '/produse-si-servicii',
    hash: 'locuinta',
  },
};

/** Zilele din jurul expirării în care oferta e relevantă (înainte și după). */
export const INSURANCE_OFFER_WINDOW_DAYS = 30;

export function getInsuranceOffer(type: DocumentType): InsuranceOffer | null {
  const o = OFFERS[type];
  return o ? { label: o.label, product: o.product } : null;
}

export function getInsuranceOfferUrl(
  type: DocumentType,
  placement: InsuranceOfferPlacement
): string | null {
  const o = OFFERS[type];
  if (!o) return null;
  const query = `utm_source=dosar&utm_medium=app&utm_campaign=${type}&utm_content=${placement}`;
  return `${ASIGRA_URL}${o.path}?${query}${o.hash ? `#${o.hash}` : ''}`;
}

/**
 * Oferta se arată doar aproape de expirare: cu cel mult `INSURANCE_OFFER_WINDOW_DAYS`
 * înainte sau după. Polița expirată de mult a fost probabil reînnoită în altă parte.
 */
export function isInsuranceOfferDue(daysUntilExpiry: number): boolean {
  return Math.abs(daysUntilExpiry) <= INSURANCE_OFFER_WINDOW_DAYS;
}
