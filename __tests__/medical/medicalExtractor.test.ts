import {
  validateExtraction,
  parseLlmResponse,
  type RawObservation,
} from '@/services/medicalExtractor';

describe('medicalExtractor — parseLlmResponse', () => {
  it('parses valid JSON response', () => {
    const r = parseLlmResponse('{"observations":[{"name":"HDL","value":"55","confidence":0.9}]}');
    expect(r.observations.length).toBe(1);
  });

  it('returns empty on invalid JSON', () => {
    expect(parseLlmResponse('not json').observations).toEqual([]);
  });

  it('handles JSON wrapped in code fence', () => {
    expect(parseLlmResponse('```json\n{"observations":[]}\n```').observations).toEqual([]);
  });

  it('handles JSON wrapped in generic fence', () => {
    expect(parseLlmResponse('```\n{"observations":[]}\n```').observations).toEqual([]);
  });

  it('returns empty when shape is wrong', () => {
    expect(parseLlmResponse('{"foo":[]}').observations).toEqual([]);
  });
});

describe('medicalExtractor — validateExtraction', () => {
  const r = (o: Partial<RawObservation>): RawObservation => o as RawObservation;

  it('drops obs with missing name', () => {
    const ok = validateExtraction(
      [r({ name: '', value: '5', confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(0);
  });

  it('drops obs with confidence < 0.5', () => {
    const ok = validateExtraction(
      [r({ name: 'X', value: '5', confidence: 0.3 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(0);
  });

  it('drops analize_medicale obs without value', () => {
    const ok = validateExtraction(
      [r({ name: 'X', value: null, confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(0);
  });

  it('keeps reteta_medicala obs without value', () => {
    const ok = validateExtraction(
      [r({ name: 'Paracetamol 500mg', value: null, confidence: 0.9 })],
      'reteta_medicala',
      null
    );
    expect(ok.length).toBe(1);
    expect(ok[0].name).toBe('Paracetamol 500mg');
  });

  it('accepts whitelisted text values for analize', () => {
    const ok = validateExtraction(
      [r({ name: 'Test rapid', value: 'POZITIV', confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(1);
  });

  it('drops non-numeric non-whitelisted for analize', () => {
    const ok = validateExtraction(
      [r({ name: 'Test', value: 'foo bar baz', confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(0);
  });

  it('accepts numeric values with comma decimal', () => {
    const ok = validateExtraction(
      [r({ name: 'HDL', value: '55,5', confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(1);
  });

  it('accepts < and > prefixed values', () => {
    const ok = validateExtraction(
      [r({ name: 'PCR', value: '<5', confidence: 0.9 })],
      'analize_medicale',
      null
    );
    expect(ok.length).toBe(1);
  });

  it('falls back observed_at to issueDate', () => {
    const ok = validateExtraction(
      [r({ name: 'X', value: '1', confidence: 0.9 })],
      'analize_medicale',
      '2024-01-01'
    );
    expect(ok[0].observed_at).toBe('2024-01-01');
  });

  it('clamps unknown category to altele', () => {
    const ok = validateExtraction(
      [r({ name: 'X', value: '1', confidence: 0.9, category: 'unknown_cat' })],
      'analize_medicale',
      null
    );
    expect(ok[0].category).toBe('altele');
  });

  it('keeps valid category', () => {
    const ok = validateExtraction(
      [r({ name: 'HDL', value: '55', confidence: 0.9, category: 'lipide' })],
      'analize_medicale',
      null
    );
    expect(ok[0].category).toBe('lipide');
  });
});
