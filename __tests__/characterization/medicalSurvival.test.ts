/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Regresie 2026-10-01 — dosarul medical dispărea tăcut la restore/sync.
 *
 * Lanț: un manifest cu `medical_record.person_id` care nu e în `persons` (starea
 * produsă de un restore pe cod vechi, 24 sept) → INSERT cu FK ON pică → dosarul e
 * sărit (doar un string în `errors`) → starea redusă se încarcă în iCloud peste
 * singurul backup bun.
 *
 * Plase:
 *   1. applyManifest NU pierde un dosar medical a cărui persoană lipsește din manifest.
 *   2. detectManifestShrink semnalează scăderile care trebuie să păstreze manifestul vechi.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let applyManifest: typeof import('@/services/backup').applyManifest;
let detectManifestShrink: typeof import('@/services/cloudSync').detectManifestShrink;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    applyManifest = require('@/services/backup').applyManifest;
    detectManifestShrink = require('@/services/cloudSync').detectManifestShrink;
  });
});

function resetSchema(): void {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_') || t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* shadow tables FTS */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}
beforeEach(resetSchema);

const TS = '2026-01-01T00:00:00Z';

describe('restore — dosar medical cu persoana lipsă din manifest', () => {
  it('păstrează dosarul și observațiile, legate de o persoană existentă', async () => {
    const payload = {
      version: 4,
      persons: [{ id: 'p-new', name: 'Tudor', created_at: TS }],
      medicalRecords: [
        {
          id: 'm-1',
          person_id: 'p-GONE', // nu există în persons[]
          name: 'Tudor Abrudan',
          encryption_key_ref: 'plaintext-v2',
          blood_group: '0 pozitiv',
          created_at: TS,
          updated_at: TS,
        },
      ],
      medicalObservations: [
        {
          id: 'o-1',
          medical_record_id: 'm-1',
          name: 'Glicemie',
          value: '95',
          category: 'biochimie',
          confidence: 0.9,
          created_at: TS,
          updated_at: TS,
        },
      ],
    };
    const res = await applyManifest(payload as Record<string, unknown>, { wipeFirst: true });

    const rec = testDb._raw.prepare('SELECT * FROM medical_record').all() as any[];
    expect(rec).toHaveLength(1);
    expect(rec[0].blood_group).toBe('0 pozitiv');
    const person = testDb._raw.prepare('SELECT id FROM persons WHERE id = ?').get(rec[0].person_id);
    expect(person).toBeTruthy();
    const obs = testDb._raw.prepare('SELECT COUNT(*) n FROM medical_observations').get() as any;
    expect(obs.n).toBe(1);
    expect(res.errors.filter(e => e.startsWith('Dosar medical'))).toEqual([]);
  });
});

describe('detectManifestShrink', () => {
  const prev = { documentCount: 53, personCount: 5, medicalRecordCount: 1 };

  it('semnalează dispariția tuturor dosarelor medicale', () => {
    expect(detectManifestShrink(prev, { documents: 53, persons: 5, medicalRecords: 0 })).toBe(true);
  });
  it('semnalează o scădere a documentelor de peste 30%', () => {
    expect(detectManifestShrink(prev, { documents: 30, persons: 5, medicalRecords: 1 })).toBe(true);
  });
  it('semnalează pierderea de persoane', () => {
    expect(detectManifestShrink(prev, { documents: 53, persons: 3, medicalRecords: 1 })).toBe(true);
  });
  it('nu semnalează creșteri sau scăderi mici', () => {
    expect(detectManifestShrink(prev, { documents: 52, persons: 5, medicalRecords: 1 })).toBe(
      false
    );
    expect(detectManifestShrink(prev, { documents: 60, persons: 6, medicalRecords: 2 })).toBe(
      false
    );
  });
  it('nu semnalează fără meta anterior sau fără câmpurile noi', () => {
    expect(detectManifestShrink(null, { documents: 0, persons: 0, medicalRecords: 0 })).toBe(false);
    expect(
      detectManifestShrink({ documentCount: 3 }, { documents: 3, persons: 1, medicalRecords: 0 })
    ).toBe(false);
  });
});
