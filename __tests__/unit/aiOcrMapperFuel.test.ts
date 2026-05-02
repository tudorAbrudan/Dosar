import {
  validateFuelAiResponse,
  mergeFuelResults,
  extractFirstJsonObject,
} from '@/services/aiOcrMapper';
import type { FuelAiResult } from '@/services/aiOcrMapper';

describe('validateFuelAiResponse', () => {
  it('returns empty object for non-object input', () => {
    expect(validateFuelAiResponse(null)).toEqual({});
    expect(validateFuelAiResponse(undefined)).toEqual({});
    expect(validateFuelAiResponse('text')).toEqual({});
    expect(validateFuelAiResponse(42)).toEqual({});
  });

  it('accepts plausible liters (0.5 < L < 200)', () => {
    expect(validateFuelAiResponse({ liters: 42.31 })).toEqual({ liters: 42.31 });
    expect(validateFuelAiResponse({ liters: 0.6 })).toEqual({ liters: 0.6 });
    expect(validateFuelAiResponse({ liters: 199 })).toEqual({ liters: 199 });
  });

  it('rejects implausible liters', () => {
    expect(validateFuelAiResponse({ liters: 0 })).toEqual({});
    expect(validateFuelAiResponse({ liters: 0.4 })).toEqual({});
    expect(validateFuelAiResponse({ liters: 200 })).toEqual({});
    expect(validateFuelAiResponse({ liters: -5 })).toEqual({});
    expect(validateFuelAiResponse({ liters: '42' })).toEqual({});
  });

  it('accepts plausible price (1 < RON < 5000)', () => {
    expect(validateFuelAiResponse({ price: 285.5 })).toEqual({ price: 285.5 });
    expect(validateFuelAiResponse({ price: 2 })).toEqual({ price: 2 });
    expect(validateFuelAiResponse({ price: 4999 })).toEqual({ price: 4999 });
  });

  it('rejects implausible price', () => {
    expect(validateFuelAiResponse({ price: 1 })).toEqual({});
    expect(validateFuelAiResponse({ price: 5000 })).toEqual({});
    expect(validateFuelAiResponse({ price: -10 })).toEqual({});
    expect(validateFuelAiResponse({ price: '285' })).toEqual({});
  });

  it('accepts plausible km (1000 < km < 9999999, integer)', () => {
    expect(validateFuelAiResponse({ km: 125430 })).toEqual({ km: 125430 });
    expect(validateFuelAiResponse({ km: 1001 })).toEqual({ km: 1001 });
    expect(validateFuelAiResponse({ km: 9999998 })).toEqual({ km: 9999998 });
  });

  it('rejects implausible km', () => {
    expect(validateFuelAiResponse({ km: 1000 })).toEqual({});
    expect(validateFuelAiResponse({ km: 9999999 })).toEqual({});
    expect(validateFuelAiResponse({ km: 1234.5 })).toEqual({});
    expect(validateFuelAiResponse({ km: '125430' })).toEqual({});
  });

  it('accepts valid date in last 2 years', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(validateFuelAiResponse({ date: today })).toEqual({ date: today });
  });

  it('rejects future date, ancient date, or wrong format', () => {
    expect(validateFuelAiResponse({ date: '2099-01-01' })).toEqual({});
    expect(validateFuelAiResponse({ date: '1985-06-15' })).toEqual({});
    expect(validateFuelAiResponse({ date: '02.05.2026' })).toEqual({});
    expect(validateFuelAiResponse({ date: 'not-a-date' })).toEqual({});
  });

  it('accepts station, trims and caps at 100 chars', () => {
    expect(validateFuelAiResponse({ station: '  OMV Cluj-Napoca  ' })).toEqual({
      station: 'OMV Cluj-Napoca',
    });
    const long = 'A'.repeat(150);
    expect(validateFuelAiResponse({ station: long })).toEqual({ station: 'A'.repeat(100) });
  });

  it('rejects empty or whitespace-only station', () => {
    expect(validateFuelAiResponse({ station: '' })).toEqual({});
    expect(validateFuelAiResponse({ station: '   ' })).toEqual({});
    expect(validateFuelAiResponse({ station: 42 })).toEqual({});
  });

  it('combines multiple valid fields', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      validateFuelAiResponse({
        liters: 42.31,
        price: 285.5,
        km: 125430,
        date: today,
        station: 'OMV Cluj',
      })
    ).toEqual({
      liters: 42.31,
      price: 285.5,
      km: 125430,
      date: today,
      station: 'OMV Cluj',
    });
  });

  it('drops invalid fields but keeps valid ones', () => {
    expect(
      validateFuelAiResponse({
        liters: 42.31,
        price: -5,
        km: 'bad',
        station: 'OMV Cluj',
      })
    ).toEqual({
      liters: 42.31,
      station: 'OMV Cluj',
    });
  });
});

describe('mergeFuelResults', () => {
  it('returns empty when both inputs are empty', () => {
    expect(mergeFuelResults({}, {})).toEqual({
      liters: undefined,
      km: undefined,
      price: undefined,
      date: undefined,
      station: undefined,
    });
  });

  it('AI per-field wins over regex', () => {
    const ai: FuelAiResult = { liters: 42.31, price: 285.5 };
    const regex = { liters: 40, price: 200, km: 125430, date: '2026-05-02', station: 'OMV' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 42.31,
      price: 285.5,
      km: 125430,
      date: '2026-05-02',
      station: 'OMV',
    });
  });

  it('falls back to regex when AI field missing', () => {
    const ai: FuelAiResult = { liters: 42.31 };
    const regex = { liters: 40, station: 'MOL' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 42.31,
      km: undefined,
      price: undefined,
      date: undefined,
      station: 'MOL',
    });
  });

  it('treats AI undefined the same as missing', () => {
    const ai: FuelAiResult = { liters: undefined, station: 'AI Station' };
    const regex = { liters: 40, station: 'Regex Station' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 40,
      km: undefined,
      price: undefined,
      date: undefined,
      station: 'AI Station',
    });
  });
});

describe('extractFirstJsonObject', () => {
  it('returns null when no opening brace is present', () => {
    expect(extractFirstJsonObject('no json here')).toBeNull();
  });

  it('returns parsed object for bare JSON input', () => {
    expect(extractFirstJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in ```json fences with trailing prose', () => {
    const raw = '```json\n{"liters": 42.31, "station": "OMV"}\n```\nThat is all.';
    expect(extractFirstJsonObject(raw)).toEqual({ liters: 42.31, station: 'OMV' });
  });

  it('returns the first parseable object when scanning from end finds an inner one', () => {
    // Scan-from-end strategy: it tries the largest envelope first; the largest
    // valid parse it can find from index 0 is the first standalone object.
    expect(extractFirstJsonObject('{"a":1}\nextra\n{"b":2}')).toEqual({ a: 1 });
  });

  it('returns null when an opening brace has no valid matching close', () => {
    expect(extractFirstJsonObject('{not valid')).toBeNull();
  });
});
