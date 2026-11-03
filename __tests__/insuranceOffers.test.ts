import {
  getInsuranceOffer,
  getInsuranceOfferUrl,
  isInsuranceOfferDue,
} from '@/services/insuranceOffers';
import { buildAppKnowledge } from '@/services/appKnowledge';

it('builds the RCA quote URL with placement tracking', () => {
  expect(getInsuranceOfferUrl('rca', 'notificare')).toBe(
    'https://asigra.ro/rca/quote?utm_source=dosar&utm_medium=app&utm_campaign=rca&utm_content=notificare'
  );
});

it('keeps the query before the hash for section links', () => {
  const url = getInsuranceOfferUrl('casco', 'document')!;
  expect(url.startsWith('https://asigra.ro/produse-si-servicii?')).toBe(true);
  expect(url.endsWith('&utm_content=document#casco')).toBe(true);
  expect(getInsuranceOfferUrl('pad', 'vehicul')!.endsWith('#locuinta')).toBe(true);
});

it('offers only insurance types (ITP is not insurance)', () => {
  expect(getInsuranceOffer('rca')?.label).toBe('Compară oferte RCA');
  expect(getInsuranceOffer('itp')).toBeNull();
  expect(getInsuranceOfferUrl('vigneta', 'home')).toBeNull();
});

it('shows the offer only within 30 days of expiry', () => {
  expect(isInsuranceOfferDue(30)).toBe(true);
  expect(isInsuranceOfferDue(-30)).toBe(true);
  expect(isInsuranceOfferDue(31)).toBe(false);
  expect(isInsuranceOfferDue(-31)).toBe(false);
});

it('gives the assistant the asigra link only for insurance questions', () => {
  expect(buildAppKnowledge('unde îmi reînnoiesc RCA-ul?')).toContain('utm_content=asistent');
  expect(buildAppKnowledge('cum fac backup în iCloud?')).not.toContain('asigra.ro');
});
