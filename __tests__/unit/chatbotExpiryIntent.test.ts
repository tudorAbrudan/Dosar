/**
 * Calea deterministă pentru întrebări agregate despre expirări.
 *
 * „Ce expiră următorul?" are nevoie de toate documentele cu dată de expirare,
 * sortate — exact ce nu încape într-un context plafonat. Răspunsul se calculează
 * în cod, deci e IDENTIC pe model local și pe cel online (scopul declarat) și
 * imposibil de halucinat.
 */
import { detectExpiryQuery } from '@/services/chatbot';

describe('detectExpiryQuery', () => {
  it('prinde întrebarea despre următoarea expirare', () => {
    const q = detectExpiryQuery('ce expiră următorul?');
    expect(q).not.toBeNull();
    expect(q!.onlyNext).toBe(true);
  });

  it('prinde ferestre de timp explicite', () => {
    expect(detectExpiryQuery('ce expira luna asta?')!.days).toBe(31);
    expect(detectExpiryQuery('ce expira saptamana asta?')!.days).toBe(7);
    expect(detectExpiryQuery('ce expira anul asta?')!.days).toBe(365);
  });

  it('funcționează și cu tip concret (ITP) — filtrarea se face separat', () => {
    const q = detectExpiryQuery('ce ITP expiră următorul?');
    expect(q).not.toBeNull();
    expect(q!.onlyNext).toBe(true);
  });

  it('NU prinde afirmații despre expirare (doar interogări)', () => {
    // „buletinul meu a expirat" e o afirmație — trebuie să meargă la LLM.
    expect(detectExpiryQuery('buletinul meu a expirat')).toBeNull();
    expect(detectExpiryQuery('am pasaportul expirat')).toBeNull();
  });

  it('NU prinde întrebări fără legătură cu expirarea', () => {
    expect(detectExpiryQuery('ce varsta are Silvia?')).toBeNull();
    expect(detectExpiryQuery('cate documente am?')).toBeNull();
    expect(detectExpiryQuery('salut')).toBeNull();
  });

  it('funcționează fără diacritice', () => {
    expect(detectExpiryQuery('ce expira urmatorul')).not.toBeNull();
    expect(detectExpiryQuery('care e urmatoarea scadenta')).not.toBeNull();
  });
});
