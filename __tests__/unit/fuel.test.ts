import { computeConsumptionFromFullToFull } from '@/services/fuel';
import type { FuelRecord } from '@/services/fuel';

function record(
  overrides: Partial<FuelRecord> & Pick<FuelRecord, 'id' | 'date'>
): FuelRecord {
  return {
    vehicle_id: 'v1',
    is_full: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeConsumptionFromFullToFull', () => {
  it('returns undefined avg when fewer than 2 full fills', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 100000, liters: 40, is_full: true }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeUndefined();
    expect(result.sparkline).toEqual([]);
  });

  it('calculates correct consumption between two full fills', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 100000, liters: 40, is_full: true }),
      record({ id: '2', date: '2026-01-15', km_total: 100500, liters: 35, is_full: true }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeCloseTo(7.0, 2);
    expect(result.sparkline).toEqual([expect.closeTo(7.0, 2)]);
  });

  it('aggregates partial fills into the next full window', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 100000, liters: 40, is_full: true }),
      record({ id: '2', date: '2026-01-05', km_total: 100200, liters: 15, is_full: false }),
      record({ id: '3', date: '2026-01-15', km_total: 100500, liters: 20, is_full: true }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeCloseTo(7.0, 2);
  });

  it('returns undefined when all fills are partial', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 100000, liters: 20, is_full: false }),
      record({ id: '2', date: '2026-01-05', km_total: 100200, liters: 15, is_full: false }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeUndefined();
  });

  it('ignores leading partial fills before first full', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 99900, liters: 10, is_full: false }),
      record({ id: '2', date: '2026-01-03', km_total: 100000, liters: 40, is_full: true }),
      record({ id: '3', date: '2026-01-15', km_total: 100500, liters: 35, is_full: true }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeCloseTo(7.0, 2);
    expect(result.sparkline).toHaveLength(1);
  });

  it('computes average across multiple full-to-full windows and returns last 8 in sparkline', () => {
    const records: FuelRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push(
        record({
          id: `r${i}`,
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          km_total: 100000 + i * 500,
          liters: i === 0 ? 40 : 35,
          is_full: true,
        })
      );
    }
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeCloseTo(7.0, 2);
    expect(result.sparkline).toHaveLength(8);
  });

  it('skips records without km_total or liters', () => {
    const records: FuelRecord[] = [
      record({ id: '1', date: '2026-01-01', km_total: 100000, liters: 40, is_full: true }),
      record({ id: '2', date: '2026-01-10', km_total: undefined, liters: 20, is_full: true }),
      record({ id: '3', date: '2026-01-15', km_total: 100500, liters: 35, is_full: true }),
    ];
    const result = computeConsumptionFromFullToFull(records);
    expect(result.avgConsumptionL100).toBeCloseTo(7.0, 2);
  });
});
