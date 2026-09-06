/**
 * Rutarea întrebare → tipuri de documente.
 *
 * Regresia care a generat testele: „ce ITP expiră următorul" nu filtra nimic.
 * Regula wildcard „expiră" (types: []) făcea `return null` și arunca tipul `itp`
 * acumulat înainte, deci se căuta prin TOATE documentele. Pe model local, unde
 * numărul de documente e plafonat, exact documentul căutat putea cădea afară.
 */
import { detectRelevantTypes } from '@/services/chatbot';

describe('detectRelevantTypes', () => {
  it('tip concret + „expiră" → păstrează tipul concret (regresia raportată)', () => {
    const types = detectRelevantTypes('ce ITP expiră următorul?');
    expect(types).not.toBeNull();
    expect(types).toContain('itp');
  });

  it('ordinea cuvintelor nu contează', () => {
    expect(detectRelevantTypes('cand expira ITP-ul meu')).toContain('itp');
    expect(detectRelevantTypes('ITP valabil pana cand')).toContain('itp');
  });

  it('funcționează și pentru alte tipuri combinate cu expirarea', () => {
    expect(detectRelevantTypes('cand expira pasaportul')).toContain('pasaport');
    expect(detectRelevantTypes('buletinul meu e valabil?')).toContain('buletin');
  });

  it('„expiră" singur rămâne fără filtru de tip (întrebare agregată)', () => {
    expect(detectRelevantTypes('ce-mi expiră luna asta?')).toBeNull();
    expect(detectRelevantTypes('ce documente expira curand')).toBeNull();
  });

  it('întrebare fără cuvinte cheie → fără filtru', () => {
    expect(detectRelevantTypes('salut, ce mai faci?')).toBeNull();
  });

  it('mai multe tipuri concrete se acumulează, nu se suprascriu', () => {
    const types = detectRelevantTypes('am nevoie de buletin si pasaport');
    expect(types).toEqual(expect.arrayContaining(['buletin', 'pasaport']));
  });

  it('funcționează fără diacritice (normalizare)', () => {
    expect(detectRelevantTypes('cand expira inspectia tehnica')).toContain('itp');
  });

  describe('potrivire la început de cuvânt (nu oriunde în text)', () => {
    it('nu confundă „ci" din interiorul altor cuvinte cu tipul buletin', () => {
      // Regresia: keyword-ul „ci" se potrivea în „faci", „deci", „aici".
      for (const q of ['ce mai faci?', 'deci ce zici', 'ce e aici']) {
        expect(detectRelevantTypes(q)).toBeNull();
      }
    });

    it('nu confundă „bon" din „abonament" cu tipurile de bon', () => {
      // „abonament" e tip propriu, deci rezultatul NU e null — dar nu trebuie să
      // conțină bon_cumparaturi/bon_parcare doar pentru că textul include „bon".
      const types = detectRelevantTypes('cat costa abonamentul');
      expect(types).toContain('abonament');
      expect(types).not.toContain('bon_cumparaturi');
      expect(types).not.toContain('bon_parcare');
    });

    it('dar prinde în continuare formele articulate românești', () => {
      expect(detectRelevantTypes('unde e pasaportul meu')).toContain('pasaport');
      expect(detectRelevantTypes('talonul masinii')).toContain('talon');
      expect(detectRelevantTypes('buletinul e expirat?')).toContain('buletin');
    });

    it('prinde „ci" ca sine stătător', () => {
      expect(detectRelevantTypes('unde e CI-ul meu')).toContain('buletin');
    });
  });
});
