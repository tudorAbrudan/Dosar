import { parseClassifyResponse } from '@/services/aiClassifier';

describe('parseClassifyResponse', () => {
  it('parses well-formed JSON with type+confidence+top3', () => {
    const raw = JSON.stringify({
      type: 'pad',
      confidence: 0.92,
      top3: [
        { type: 'pad', confidence: 0.92 },
        { type: 'rca', confidence: 0.05 },
        { type: 'factura', confidence: 0.03 },
      ],
      reasoning: 'Antet PAID, mențiune dezastre naturale, adresă locuință',
    });
    const result = parseClassifyResponse(raw);
    expect(result.type).toBe('pad');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.top3).toHaveLength(3);
    expect(result.top3[0].type).toBe('pad');
  });

  it('extracts JSON from prose-wrapped response', () => {
    const raw = `Răspuns: { "type": "rca", "confidence": 0.8, "top3": [{"type":"rca","confidence":0.8}] } gata.`;
    const result = parseClassifyResponse(raw);
    expect(result.type).toBe('rca');
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it('clamps confidence to [0,1]', () => {
    const raw = JSON.stringify({ type: 'factura', confidence: 1.5, top3: [] });
    const result = parseClassifyResponse(raw);
    expect(result.confidence).toBe(1);
  });

  it('returns altul fallback when JSON is unparsable', () => {
    const result = parseClassifyResponse('no json here just text');
    expect(result.type).toBe('altul');
    expect(result.confidence).toBe(0);
  });

  it('returns altul fallback when type field is invalid', () => {
    const raw = JSON.stringify({ type: 'nonexistent_type', confidence: 0.9, top3: [] });
    const result = parseClassifyResponse(raw);
    expect(result.type).toBe('altul');
  });

  it('ensures top3 contains at most 3 valid entries and filters invalid types', () => {
    const raw = JSON.stringify({
      type: 'pad',
      confidence: 0.7,
      top3: [
        { type: 'pad', confidence: 0.7 },
        { type: 'bad_type', confidence: 0.2 },
        { type: 'rca', confidence: 0.05 },
        { type: 'factura', confidence: 0.03 },
        { type: 'casco', confidence: 0.02 },
      ],
    });
    const result = parseClassifyResponse(raw);
    expect(result.top3.length).toBeLessThanOrEqual(3);
    expect(result.top3.every(c => (c.type as string) !== 'bad_type')).toBe(true);
  });
});
