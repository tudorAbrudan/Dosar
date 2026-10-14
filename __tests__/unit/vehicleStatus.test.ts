import {
  ITP_REVIEW_KEY,
  applyItpReviewFlag,
  buildVehicleStatusItems,
} from '@/services/vehicleStatus';
import type { Document } from '@/types';
import type { FuelStats } from '@/services/fuel';

function doc(overrides: Partial<Document> & { type: Document['type'] }): Document {
  return {
    id: 'd1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Document;
}

function emptyStats(): FuelStats {
  return {
    totalRecords: 0,
    totalLiters: 0,
    totalCost: 0,
    consumptionSparkline: [],
  };
}

describe('buildVehicleStatusItems', () => {
  const today = new Date('2026-04-23T00:00:00.000Z');

  it('returns empty array when vehicle has no docs and no fuel data', () => {
    const items = buildVehicleStatusItems({
      documents: [],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items).toEqual([]);
  });

  it('includes RCA slot with critical when expiring in 3 days', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'r1', type: 'rca', expiry_date: '2026-04-26' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const rca = items.find(i => i.key === 'rca');
    expect(rca).toBeDefined();
    expect(rca?.severity).toBe('critical');
  });

  it('RCA severity warning when within notificationDays but > 7', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'r1', type: 'rca', expiry_date: '2026-05-10' })], // +17 zile
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'rca')?.severity).toBe('warning');
  });

  it('RCA severity ok when expiring beyond notificationDays', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'r1', type: 'rca', expiry_date: '2026-08-10' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'rca')?.severity).toBe('ok');
  });

  it('RCA expired → critical with value "Expirat"', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'r1', type: 'rca', expiry_date: '2026-01-01' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const rca = items.find(i => i.key === 'rca');
    expect(rca?.severity).toBe('critical');
    expect(rca?.value).toBe('Expirat');
  });

  it('picks RCA with max expiry_date when multiple exist', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 'r1', type: 'rca', expiry_date: '2026-05-01' }),
        doc({ id: 'r2', type: 'rca', expiry_date: '2027-05-01' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'rca')?.docId).toBe('r2');
  });

  it('ITP slot uses standalone ITP doc when only ITP has expiry', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 't1', type: 'itp', expiry_date: '2026-08-01' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp).toBeDefined();
    expect(itp?.docId).toBe('t1');
  });

  it('ITP slot falls back to talon expiry when ITP doc missing', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'tl1', type: 'talon', expiry_date: '2026-04-26' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp).toBeDefined();
    expect(itp?.docId).toBe('tl1');
    expect(itp?.severity).toBe('critical');
    expect(itp?.subValue).toBe('26.04.2026');
  });

  it('ITP slot falls back to talon when ITP doc has no expiry_date', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 't1', type: 'itp' }), // fără expiry
        doc({ id: 'tl1', type: 'talon', expiry_date: '2026-08-01' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')?.docId).toBe('tl1');
  });

  it('ITP slot picks the source with the latest expiry when both exist (ITP later)', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 'tl1', type: 'talon', expiry_date: '2026-04-26' }),
        doc({ id: 't1', type: 'itp', expiry_date: '2027-04-26' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')?.docId).toBe('t1');
  });

  it('ITP slot picks the source with the latest expiry when both exist (talon later)', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 't1', type: 'itp', expiry_date: '2026-04-26' }),
        doc({ id: 'tl1', type: 'talon', expiry_date: '2027-04-26' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')?.docId).toBe('tl1');
  });

  it('no ITP slot when neither ITP nor talon has expiry_date', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 't1', type: 'itp' }), doc({ id: 'tl1', type: 'talon' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')).toBeUndefined();
  });

  it('ITP slot falls back to talon metadata.itp_expiry_date when expiry_date missing', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({
          id: 'tl1',
          type: 'talon',
          metadata: { itp_expiry_date: '26.04.2026' },
        }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp).toBeDefined();
    expect(itp?.docId).toBe('tl1');
    expect(itp?.subValue).toBe('26.04.2026');
    expect(itp?.severity).toBe('critical');
  });

  it('ITP slot picks ITP doc over talon metadata when ITP doc is later', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({
          id: 'tl1',
          type: 'talon',
          metadata: { itp_expiry_date: '01.05.2026' },
        }),
        doc({ id: 't1', type: 'itp', expiry_date: '2027-04-26' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')?.docId).toBe('t1');
  });

  it('ITP slot picks talon metadata over ITP doc when talon date is later', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 't1', type: 'itp', expiry_date: '2026-04-26' }),
        doc({
          id: 'tl1',
          type: 'talon',
          metadata: { itp_expiry_date: '15.10.2027' },
        }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp?.docId).toBe('tl1');
    expect(itp?.subValue).toBe('15.10.2027');
  });

  it('ITP slot ignores invalid talon metadata.itp_expiry_date format', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({
          id: 'tl1',
          type: 'talon',
          metadata: { itp_expiry_date: 'invalid' },
        }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    expect(items.find(i => i.key === 'itp')).toBeUndefined();
  });

  it('includes CASCO slot with same rules as RCA', () => {
    const items = buildVehicleStatusItems({
      documents: [doc({ id: 'c1', type: 'casco', expiry_date: '2026-04-26' })],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const casco = items.find(i => i.key === 'casco');
    expect(casco).toBeDefined();
    expect(casco?.severity).toBe('critical');
  });

  it('consum slot only when avg defined', () => {
    const items = buildVehicleStatusItems({
      documents: [],
      fuelStats: { ...emptyStats(), avgConsumptionL100: 7.2, consumptionSparkline: [7, 7.2, 7.1] },
      notificationDays: 30,
      today,
    });
    const fuel = items.find(i => i.key === 'fuel');
    expect(fuel).toBeDefined();
    expect(fuel?.severity).toBe('ok');
    expect(fuel?.sparkline).toEqual([7, 7.2, 7.1]);
  });

  it('orders items RCA, CASCO, ITP, fuel', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({ id: 'r1', type: 'rca', expiry_date: '2026-08-01' }),
        doc({ id: 'c1', type: 'casco', expiry_date: '2026-08-01' }),
        doc({ id: 't1', type: 'itp', expiry_date: '2026-08-01' }),
      ],
      fuelStats: {
        ...emptyStats(),
        latestKm: 100000,
        avgConsumptionL100: 7,
        consumptionSparkline: [7],
      },
      notificationDays: 30,
      today,
    });
    expect(items.map(i => i.key)).toEqual(['rca', 'casco', 'itp', 'fuel']);
  });
});

describe('ITP de verificat (ștampilă scrisă de mână)', () => {
  const today = new Date('2026-04-23T00:00:00.000Z');

  it('marks the ITP slot "De verificat" when the talon date is unconfirmed', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({
          id: 'tl1',
          type: 'talon',
          expiry_date: '2027-04-30',
          metadata: { [ITP_REVIEW_KEY]: '1' },
        }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp?.needsReview).toBe(true);
    expect(itp?.subValue).toBe('De verificat');
  });

  it('does not flag when the latest ITP comes from a dedicated ITP doc', () => {
    const items = buildVehicleStatusItems({
      documents: [
        doc({
          id: 'tl1',
          type: 'talon',
          expiry_date: '2026-05-30',
          metadata: { [ITP_REVIEW_KEY]: '1' },
        }),
        doc({ id: 't1', type: 'itp', expiry_date: '2028-05-30' }),
      ],
      fuelStats: emptyStats(),
      notificationDays: 30,
      today,
    });
    const itp = items.find(i => i.key === 'itp');
    expect(itp?.docId).toBe('t1');
    expect(itp?.needsReview).toBeUndefined();
    expect(itp?.subValue).toBe('30.05.2028');
  });

  describe('applyItpReviewFlag', () => {
    it('flags a talon date the user has not confirmed', () => {
      expect(applyItpReviewFlag({ plate: 'B 1 ABC' }, 'talon', '2027-04-30', '')).toEqual({
        plate: 'B 1 ABC',
        [ITP_REVIEW_KEY]: '1',
      });
    });

    it('clears the flag once the user confirms or picks the date', () => {
      expect(
        applyItpReviewFlag(
          { plate: 'B 1 ABC', [ITP_REVIEW_KEY]: '1' },
          'talon',
          '2027-04-30',
          '2027-04-30'
        )
      ).toEqual({ plate: 'B 1 ABC' });
    });

    it('re-flags when OCR overwrites a confirmed date', () => {
      expect(applyItpReviewFlag({}, 'talon', '2028-04-30', '2027-04-30')).toEqual({
        [ITP_REVIEW_KEY]: '1',
      });
    });

    it('never flags without a date or on other document types', () => {
      expect(applyItpReviewFlag({ [ITP_REVIEW_KEY]: '1' }, 'talon', '', '')).toBeUndefined();
      expect(
        applyItpReviewFlag({ [ITP_REVIEW_KEY]: '1' }, 'rca', '2027-04-30', '')
      ).toBeUndefined();
    });
  });
});
