import { buildVehicleStatusItems, buildVehicleLegalStatus } from '@/services/vehicleStatus';
import type { Document } from '@/types';

const doc = (over: Partial<Document>): Document =>
  ({ id: 'x', type: 'rca', created_at: 't', ...over }) as Document;

const fuelStats = { avgConsumptionL100: undefined, consumptionSparkline: [] } as never;
const today = new Date('2026-06-05T00:00:00Z');

it('adds a vigneta brick when a vigneta doc exists', () => {
  const items = buildVehicleStatusItems({
    documents: [doc({ id: 'v1', type: 'vigneta', expiry_date: '2026-12-01' })],
    fuelStats,
    notificationDays: 30,
    today,
  });
  expect(items.find(i => i.key === 'vigneta')?.docId).toBe('v1');
});

it('legal status reports missing obligations', () => {
  const legal = buildVehicleLegalStatus(
    [doc({ id: 'r1', type: 'rca', expiry_date: '2026-12-01' })],
    today,
    30
  );
  const byKey = Object.fromEntries(legal.map(o => [o.key, o]));
  expect(byKey.rca.status).toBe('ok');
  expect(byKey.itp.status).toBe('missing');
  expect(byKey.vigneta.status).toBe('missing');
});

it('legal status flags expired and expiring', () => {
  const legal = buildVehicleLegalStatus(
    [
      doc({ id: 'r1', type: 'rca', expiry_date: '2026-05-01' }), // expired (before today)
      doc({ id: 'i1', type: 'itp', expiry_date: '2026-06-20' }), // expiring (<=30 days)
      doc({ id: 'v1', type: 'vigneta', expiry_date: '2027-01-01' }), // ok
    ],
    today,
    30
  );
  const byKey = Object.fromEntries(legal.map(o => [o.key, o]));
  expect(byKey.rca.status).toBe('expired');
  expect(byKey.itp.status).toBe('expiring');
  expect(byKey.vigneta.status).toBe('ok');
});
