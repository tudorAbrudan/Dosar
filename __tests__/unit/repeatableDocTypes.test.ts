import { REPEATABLE_DOC_TYPES, STANDARD_DOC_TYPES } from '@/types';
import type { DocumentType } from '@/types';

describe('REPEATABLE_DOC_TYPES', () => {
  it('contains medical types that repeat naturally', () => {
    expect(REPEATABLE_DOC_TYPES.has('analize_medicale')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('reteta_medicala')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('vizita_vet')).toBe(true);
  });

  it('contains financial types that recur', () => {
    expect(REPEATABLE_DOC_TYPES.has('factura')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('abonament')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('bon_cumparaturi')).toBe(true);
  });

  it('contains insurance types with yearly renewals', () => {
    expect(REPEATABLE_DOC_TYPES.has('rca')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('casco')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('pad')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('asigurare_personala')).toBe(true);
  });

  it('contains auto types with periodic renewals', () => {
    expect(REPEATABLE_DOC_TYPES.has('itp')).toBe(true);
    expect(REPEATABLE_DOC_TYPES.has('vigneta')).toBe(true);
  });

  it('does NOT contain unique identity types', () => {
    expect(REPEATABLE_DOC_TYPES.has('buletin')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('pasaport')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('permis_auto')).toBe(false);
  });

  it('does NOT contain unique property/vehicle docs', () => {
    expect(REPEATABLE_DOC_TYPES.has('talon')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('carte_auto')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('act_proprietate')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('cadastru')).toBe(false);
    expect(REPEATABLE_DOC_TYPES.has('card')).toBe(false);
  });

  it('every member is a valid DocumentType', () => {
    const standardSet = new Set<DocumentType>(STANDARD_DOC_TYPES);
    REPEATABLE_DOC_TYPES.forEach(t => {
      expect(standardSet.has(t)).toBe(true);
    });
  });
});
