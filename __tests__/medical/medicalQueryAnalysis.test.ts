import {
  analyzeQuery,
  normalizeName,
  buildFtsMatchExpression,
} from '@/services/medicalQueryAnalysis';

describe('medicalQueryAnalysis', () => {
  it('extracts medical term roots', () => {
    const a = analyzeQuery('Cum a evoluat colesterolul meu?');
    expect(a.searchTerms).toContain('colester');
    expect(a.intent).toBe('trend');
  });

  it('detects time intervals: ultimii N ani', () => {
    const a = analyzeQuery('Ce TSH am avut în ultimii 2 ani?');
    expect(a.from).toBeTruthy();
    expect(a.searchTerms).toEqual(expect.arrayContaining(['tsh']));
  });

  it('detects "ultima" intent', () => {
    expect(analyzeQuery('Care e ultima mea analiză?').intent).toBe('latest');
  });

  it('falls back to general intent', () => {
    expect(analyzeQuery('Ce vaccinuri am făcut?').intent).toBe('general');
  });

  it('detects year filter', () => {
    const a = analyzeQuery('Ce analize am făcut în 2024?');
    expect(a.from).toBe('2024-01-01');
    expect(a.to).toBe('2024-12-31');
  });

  it('normalizeName strips diacritics + lowercase', () => {
    expect(normalizeName('Hemoglobină Glicată')).toBe('hemoglobina glicata');
  });

  it('builds FTS5 MATCH expression with prefix wildcards', () => {
    expect(buildFtsMatchExpression(['colester', 'hdl'])).toBe('colester* OR hdl*');
  });

  it('returns null for empty terms', () => {
    expect(buildFtsMatchExpression([])).toBeNull();
  });
});
