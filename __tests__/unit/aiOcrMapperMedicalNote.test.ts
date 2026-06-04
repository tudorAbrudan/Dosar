import {
  STRUCTURED_NOTE_SPEC,
  MAPPER_MAX_TOKENS,
  AI_NOTES_MAX_LENGTH,
} from '@/services/aiOcrMapper';
import { MEDICAL_DOC_TYPES } from '@/types';

describe('STRUCTURED_NOTE_SPEC — clauze medicale', () => {
  it('menționează fiecare tip medical din MEDICAL_DOC_TYPES (guard la tipuri noi)', () => {
    // Dacă pică: ai adăugat un tip medical nou — adaugă-l și în clauzele + lista LUNGIME din STRUCTURED_NOTE_SPEC.
    for (const t of MEDICAL_DOC_TYPES) {
      expect(STRUCTURED_NOTE_SPEC).toContain(t);
    }
  });

  it('cere o linie per analiză cu interval de referință', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('o linie per analiză');
    expect(STRUCTURED_NOTE_SPEC).toContain('ref:');
  });

  it('cere o linie per medicament pentru rețete', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('o linie per medicament');
  });

  it('cere diagnostice + recomandări pentru scrisori/bilete/fișe', () => {
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Dd]iagnostic/);
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Rr]ecomand/);
  });

  it('cere cod ICD-10 pentru bilet de trimitere', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('ICD-10');
  });

  it('ridică plafonul de rânduri pentru medicale, păstrează 20 pentru rest', () => {
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Ff][Ăă]R[Ăă] limit/);
    expect(STRUCTURED_NOTE_SPEC).toContain('20 rânduri');
  });
});

describe('Plafoane de lungime — nu trunchiază nota medicală lungă', () => {
  it('max_tokens vision e suficient pentru un panel mare', () => {
    expect(MAPPER_MAX_TOKENS).toBeGreaterThanOrEqual(1800);
  });

  it('AI_NOTES_MAX_LENGTH încape un panel de ~50 analiți', () => {
    expect(AI_NOTES_MAX_LENGTH).toBeGreaterThanOrEqual(5000);
  });
});
