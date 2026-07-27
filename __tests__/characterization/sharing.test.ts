/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — granița de privacy a partajării entităților (CloudKit).
 *
 * Garanție: un bundle de share NU conține niciodată documente medicale,
 * `private_notes` (CVV/PIN/parole), sau câmpuri în afara whitelist-ului.
 * Vezi docs/superpowers/specs/2026-07-22-cloudkit-entity-sharing.md +
 * services/sharing.ts + scripts/share-privacy-audit.js.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import type { TestDb } from '../helpers/testDb';
import type { Document } from '@/types';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let sharing: typeof import('@/services/sharing');

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    sharing = require('@/services/sharing');
  });
});

function resetSchema(): void {
  const tables = testDb._raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    if (t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* virtual/shadow tables */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

function insertPerson(id: string, name: string): void {
  testDb._raw
    .prepare(`INSERT INTO persons (id, name, created_at) VALUES (?, ?, ?)`)
    .run(id, name, '2026-07-22T00:00:00Z');
}

function insertDoc(fields: {
  id: string;
  type: string;
  personId?: string;
  note?: string;
  privateNotes?: string;
  filePath?: string;
}): void {
  testDb._raw
    .prepare(
      `INSERT INTO documents (id, type, person_id, note, private_notes, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.id,
      fields.type,
      fields.personId ?? null,
      fields.note ?? null,
      fields.privateNotes ?? null,
      fields.filePath ?? null,
      '2026-07-22T00:00:00Z'
    );
}

describe('toShareableDocument — whitelist + excludere medicală', () => {
  it('returnează null pentru un document medical', () => {
    const medical = { id: 'd1', type: 'analize_medicale', created_at: 'x' } as unknown as Document;
    expect(sharing.toShareableDocument(medical)).toBeNull();
  });

  it('scoate private_notes și păstrează doar câmpurile din whitelist', () => {
    const doc = {
      id: 'd2',
      type: 'buletin',
      note: 'CI valid',
      private_notes: 'CVV_SECRET_999',
      file_path: 'files/ci.jpg',
      created_at: '2026-07-22T00:00:00Z',
    } as unknown as Document;

    const record = sharing.toShareableDocument(doc);
    expect(record).not.toBeNull();
    expect(record!.fields.private_notes).toBeUndefined();
    expect(record!.fields.note).toBe('CI valid');
    expect(record!.fields.type).toBe('buletin');
    // file_path e CKAsset, nu field
    expect(record!.fields.file_path).toBeUndefined();
    expect(record!.files).toEqual([{ file_path: 'files/ci.jpg', role: 'main' }]);
    expect(JSON.stringify(record)).not.toContain('CVV_SECRET_999');
    expect(JSON.stringify(record)).not.toContain('private_notes');
  });
});

describe('getShareBundle — bundle pe entitate', () => {
  it('exclude medical, scoate private_notes, include documentele normale + fișiere', async () => {
    insertPerson('pers-1', 'Ana Pop');
    insertDoc({ id: 'doc-med', type: 'analize_medicale', personId: 'pers-1', note: 'Glucoză 95' });
    insertDoc({
      id: 'doc-buletin',
      type: 'buletin',
      personId: 'pers-1',
      note: 'CI',
      privateNotes: 'CVV_SECRET_999',
      filePath: 'files/ci.jpg',
    });
    testDb._raw
      .prepare(
        `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('pg-1', 'doc-buletin', 1, 'files/ci-verso.jpg', '2026-07-22T00:00:00Z');

    const bundle = await sharing.getShareBundle('person', 'pers-1');
    const ids = bundle.documents.map(d => d.recordName);

    expect(ids).toContain('doc-buletin');
    expect(ids).not.toContain('doc-med');
    expect(bundle.entityFields.name).toBe('Ana Pop');

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('CVV_SECRET_999');
    expect(serialized).not.toContain('Glucoză');
    expect(serialized).not.toContain('private_notes');

    const buletin = bundle.documents.find(d => d.recordName === 'doc-buletin')!;
    expect(buletin.files).toEqual([
      { file_path: 'files/ci.jpg', role: 'main' },
      { file_path: 'files/ci-verso.jpg', role: 'page', page_order: 1 },
    ]);
  });

  it('aruncă pentru entități ne-partajabile (card, medical_record)', async () => {
    await expect(sharing.getShareBundle('card', 'c1')).rejects.toThrow();
    await expect(sharing.getShareBundle('medical_record', 'm1')).rejects.toThrow();
  });
});

describe('assertNoSensitiveLeak — plasă defense-in-depth', () => {
  it('aruncă dacă un câmp private_notes ajunge în bundle', () => {
    const bad = {
      entityType: 'person',
      entityRecordName: 'p1',
      entityFields: {},
      documents: [{ recordName: 'd1', fields: { type: 'buletin', private_notes: 'x' }, files: [] }],
    } as unknown as import('@/services/sharing').EntityShareBundle;
    expect(() => sharing.assertNoSensitiveLeak(bad)).toThrow(/private_notes/);
  });

  it('aruncă dacă un document medical ajunge în bundle', () => {
    const bad = {
      entityType: 'person',
      entityRecordName: 'p1',
      entityFields: {},
      documents: [{ recordName: 'd1', fields: { type: 'analize_medicale' }, files: [] }],
    } as unknown as import('@/services/sharing').EntityShareBundle;
    expect(() => sharing.assertNoSensitiveLeak(bad)).toThrow(/medical/);
  });
});

describe('zoneNameFor ↔ parseZoneName', () => {
  it('round-trip pentru fiecare tip partajabil', () => {
    for (const t of sharing.SHAREABLE_ENTITY_TYPES) {
      const zone = sharing.zoneNameFor(t, 'abc-123');
      expect(sharing.parseZoneName(zone)).toEqual({ entityType: t, entityId: 'abc-123' });
    }
  });

  it('păstrează underscore-urile din entityId', () => {
    const zone = sharing.zoneNameFor('vehicle', 'id_with_underscores');
    expect(sharing.parseZoneName(zone)).toEqual({
      entityType: 'vehicle',
      entityId: 'id_with_underscores',
    });
  });

  it('întoarce null pentru zone de sistem, tipuri necunoscute sau id lipsă', () => {
    expect(sharing.parseZoneName('_defaultZone')).toBeNull();
    expect(sharing.parseZoneName('cloudkit.share')).toBeNull();
    expect(sharing.parseZoneName('entity_unknown_x')).toBeNull();
    expect(sharing.parseZoneName('entity_vehicle_')).toBeNull(); // fără id
    expect(sharing.parseZoneName('entity_medical_record_m1')).toBeNull(); // ne-partajabil
  });
});

describe('store shared_entities', () => {
  it('recordShare + getShareForEntity + revoke', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-1');
    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-1',
      zoneName: zone,
      role: 'owner',
      shareUrl: 'https://www.icloud.com/share/abc',
    });

    const found = await sharing.getShareForEntity('vehicle', 'veh-1');
    expect(found).not.toBeNull();
    expect(found!.role).toBe('owner');
    expect(found!.zone_name).toBe(zone);

    const active = await sharing.getSharedEntities();
    expect(active).toHaveLength(1);

    await sharing.revokeShare(zone);
    expect(await sharing.getShareForEntity('vehicle', 'veh-1')).toBeNull();
    expect(await sharing.getSharedEntities()).toHaveLength(0);
    expect(await sharing.getSharedEntities(true)).toHaveLength(1);
  });
});

describe('store cloud_records', () => {
  it('upsert insert apoi update change_tag + lookup pe local', async () => {
    const zone = 'entity_vehicle_veh-1';
    await sharing.upsertCloudRecord({
      zoneName: zone,
      recordName: 'doc-1',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-1',
      changeTag: 'tag-a',
    });

    let rec = await sharing.getCloudRecord(zone, 'doc-1');
    expect(rec!.change_tag).toBe('tag-a');

    // upsert pe aceeași cheie → update, nu al doilea rând
    await sharing.upsertCloudRecord({
      zoneName: zone,
      recordName: 'doc-1',
      recordType: 'document',
      localTable: 'documents',
      localId: 'doc-1',
      changeTag: 'tag-b',
    });
    rec = await sharing.getCloudRecord(zone, 'doc-1');
    expect(rec!.change_tag).toBe('tag-b');

    const byLocal = await sharing.getCloudRecordForLocal('documents', 'doc-1');
    expect(byLocal!.record_name).toBe('doc-1');
  });
});
