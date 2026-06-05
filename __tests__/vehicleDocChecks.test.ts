import { findOverlappingDoc, findMissingObligations } from '@/services/vehicleDocChecks';
import type { Document } from '@/types';

const doc = (o: Partial<Document>): Document =>
  ({ id: 'x', type: 'rca', created_at: 't', ...o }) as Document;
const today = new Date('2026-06-05T00:00:00Z');

it('finds an overlapping valid RCA', () => {
  const existing = [
    doc({ id: 'r1', type: 'rca', issue_date: '2025-08-01', expiry_date: '2026-08-01' }),
  ];
  const hit = findOverlappingDoc(existing, {
    type: 'rca',
    issue_date: '2026-06-10',
    expiry_date: '2027-06-10',
  });
  expect(hit?.id).toBe('r1');
});

it('no overlap when existing already expired before candidate start', () => {
  const existing = [
    doc({ id: 'r1', type: 'rca', issue_date: '2024-01-01', expiry_date: '2025-01-01' }),
  ];
  const hit = findOverlappingDoc(existing, {
    type: 'rca',
    issue_date: '2026-06-10',
    expiry_date: '2027-06-10',
  });
  expect(hit).toBeNull();
});

it('ignores other types and self', () => {
  const existing = [doc({ id: 'r1', type: 'vigneta', expiry_date: '2027-01-01' })];
  expect(
    findOverlappingDoc(existing, {
      type: 'rca',
      issue_date: '2026-06-10',
      expiry_date: '2027-06-10',
    })
  ).toBeNull();
});

it('reports missing/expired obligations excluding the just-added type', () => {
  const docs = [doc({ id: 'r1', type: 'rca', expiry_date: '2027-01-01' })]; // rca ok
  const missing = findMissingObligations(docs, 'rca', today, 30);
  const keys = missing.map(o => o.key).sort();
  expect(keys).toEqual(['itp', 'vigneta']); // both missing, rca excluded
});
