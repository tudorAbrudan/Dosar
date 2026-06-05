import { buildHomeAlerts } from '@/services/homeAlerts';
import type { Document } from '@/types';

const doc = (over: Partial<Document>): Document =>
  ({ id: 'x', type: 'rca', created_at: 't', ...over }) as Document;

it('alerts when a vehicle has no vigneta doc', () => {
  const vehicles = [{ id: 'veh1', name: 'Logan' }];
  const documents = [doc({ id: 'r1', type: 'rca', vehicle_id: 'veh1' })];
  const alerts = buildHomeAlerts(documents, vehicles, [], ['vigneta']);
  const vignetaAlert = alerts.find(a => a.navigate.type === 'vigneta');
  expect(vignetaAlert?.message).toBe('Logan nu are rovinietă');
  expect(vignetaAlert?.navigate.vehicle_id).toBe('veh1');
});

it('does not alert when the vehicle already has a vigneta doc', () => {
  const vehicles = [{ id: 'veh1', name: 'Logan' }];
  const documents = [doc({ id: 'v1', type: 'vigneta', vehicle_id: 'veh1' })];
  const alerts = buildHomeAlerts(documents, vehicles, [], ['vigneta']);
  expect(alerts.find(a => a.navigate.type === 'vigneta')).toBeUndefined();
});
