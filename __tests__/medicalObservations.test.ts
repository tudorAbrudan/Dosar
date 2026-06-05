/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Round-trip plaintext pentru medical_observations (spec 2026-06-05).
 * insert→get fără criptare: numele/valorile se stochează și se citesc ca TEXT.
 *
 * Folosește better-sqlite3 in-memory cu schema reală din db.ts (același pattern
 * ca __tests__/characterization/). Mock-uim expo-sqlite local ca să întoarcă
 * wrapper-ul nostru în loc de stub-ul no-op din __tests__/setup.ts.
 */
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('./helpers/testDb');
    return createTestDbInstance();
  },
}));

import { applySchemaToTestDb } from './helpers/testDbSetup';
import type { TestDb } from './helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let insertObservation: typeof import('@/services/medicalObservations').insertObservation;
let getObservation: typeof import('@/services/medicalObservations').getObservation;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    applySchemaToTestDb(testDb);
    const obs = require('@/services/medicalObservations');
    insertObservation = obs.insertObservation;
    getObservation = obs.getObservation;
  });
});

beforeEach(() => {
  testDb._raw.pragma('foreign_keys = OFF');
  testDb._raw.exec('DELETE FROM medical_observations');
  testDb._raw.exec('DELETE FROM medical_record');
  testDb._raw.exec('DELETE FROM persons');
  testDb._raw.pragma('foreign_keys = ON');
  // pre-cond: persoana + medical_record 'r1' există în db-ul de test
  testDb._raw.exec(`
    INSERT INTO persons (id, name, created_at)
    VALUES ('p1', 'Ana', 't');
    INSERT INTO medical_record
      (id, person_id, name, ai_consent_at, ai_consent_version, encryption_key_ref,
       created_at, updated_at)
    VALUES ('r1', 'p1', 'Dosar test', NULL, 1, 'plaintext-v2', 't', 't');
  `);
});

it('stores and reads observation name/value as plaintext', async () => {
  const obs = await insertObservation({
    medical_record_id: 'r1',
    source_document_id: null,
    name: 'Hemoglobina',
    value: '14.2',
    unit: 'g/dL',
    ref_min: '13',
    ref_max: '17',
    observed_at: '2026-01-01',
    category: 'hematologie',
    confidence: 0.95,
  });
  const reload = await getObservation(obs.id);
  expect(reload?.name).toBe('Hemoglobina');
  expect(reload?.value).toBe('14.2');
  expect(reload?.ref_min).toBe('13');
  expect(reload?.ref_max).toBe('17');

  // Coloanele sunt TEXT plaintext, nu BLOB — verifică direct în DB.
  const raw = testDb._raw
    .prepare('SELECT name, value FROM medical_observations WHERE id = ?')
    .get(obs.id) as { name: string; value: string };
  expect(raw.name).toBe('Hemoglobina');
  expect(raw.value).toBe('14.2');
});
