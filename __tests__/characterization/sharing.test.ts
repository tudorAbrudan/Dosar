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

function insertVehicle(id: string, fields: { name: string; photo_uri?: string }): void {
  testDb._raw
    .prepare(`INSERT INTO vehicles (id, name, photo_uri, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, fields.name, fields.photo_uri ?? null, '2026-07-22T00:00:00Z');
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

describe('rowToShareFields — decizia 6 (numeric) + 7 (whitelist per entitate)', () => {
  it('păstrează string-urile nevide din whitelist', () => {
    const out = sharing.rowToShareFields({ name: 'Ana', phone: '0722', extra: 'x' }, [
      'name',
      'phone',
    ]);
    expect(out).toEqual({ name: 'Ana', phone: '0722' });
  });

  it('convertește number/boolean la String(v)', () => {
    const out = sharing.rowToShareFields({ mileage: 12345, is_full: 1, active: true }, [
      'mileage',
      'is_full',
      'active',
    ]);
    expect(out).toEqual({ mileage: '12345', is_full: '1', active: 'true' });
  });

  it('sare coloanele absente din whitelist, null și string gol', () => {
    const out = sharing.rowToShareFields(
      { name: 'Ana', private_notes: 'CVV_SECRET', email: '', date_of_birth: null },
      ['name', 'email', 'date_of_birth']
    );
    expect(out).toEqual({ name: 'Ana' });
    expect(out.private_notes).toBeUndefined();
  });
});

describe('getEntityShareFields — whitelist per tip (decizia 7)', () => {
  it('exclude photo_uri pe vehicul (cale locală, fără sens cross-device)', async () => {
    insertVehicle('veh-1', { name: 'Logan', photo_uri: 'documents/poza.jpg' });
    const fields = await sharing.getEntityShareFields('vehicle', 'veh-1');
    expect(fields).not.toBeNull();
    expect(fields!.name).toBe('Logan');
    expect(fields!.photo_uri).toBeUndefined();
  });

  it('null pentru entitate inexistentă sau tip ne-shareable', async () => {
    expect(await sharing.getEntityShareFields('vehicle', 'lipsa')).toBeNull();
    expect(await sharing.getEntityShareFields('card', 'c1')).toBeNull();
  });
});

describe('get/setZoneChangeToken — round-trip', () => {
  it('null implicit, apoi persistă tokenul setat', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-tok');
    await sharing.recordShare({ entityType: 'vehicle', entityId: 'veh-tok', zoneName: zone, role: 'participant' });

    expect(await sharing.getZoneChangeToken(zone)).toBeNull();

    await sharing.setZoneChangeToken(zone, 'base64token==');
    expect(await sharing.getZoneChangeToken(zone)).toBe('base64token==');

    await sharing.setZoneChangeToken(zone, null);
    expect(await sharing.getZoneChangeToken(zone)).toBeNull();
  });
});

describe('isEntityReadOnlyForMe — Faza 2 gating', () => {
  it('owner → false (control total local)', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-owner');
    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-owner',
      zoneName: zone,
      role: 'owner',
      permission: 'read',
    });
    expect(await sharing.isEntityReadOnlyForMe('vehicle', 'veh-owner')).toBe(false);
  });

  it('participant + read → true', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-p-read');
    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-p-read',
      zoneName: zone,
      role: 'participant',
      permission: 'read',
    });
    expect(await sharing.isEntityReadOnlyForMe('vehicle', 'veh-p-read')).toBe(true);
  });

  it('participant + readwrite → false', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-p-rw');
    await sharing.recordShare({
      entityType: 'vehicle',
      entityId: 'veh-p-rw',
      zoneName: zone,
      role: 'participant',
      permission: 'readwrite',
    });
    expect(await sharing.isEntityReadOnlyForMe('vehicle', 'veh-p-rw')).toBe(false);
  });

  it('entitate nepartajată → false', async () => {
    expect(await sharing.isEntityReadOnlyForMe('vehicle', 'veh-unshared')).toBe(false);
  });
});

describe('isDocumentReadOnlyForMe — Faza 2 gating (decizia 1, conservativ)', () => {
  function linkDocToEntity(documentId: string, entityType: string, entityId: string): void {
    testDb._raw
      .prepare(
        `INSERT INTO document_entities (id, document_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`
      )
      .run(`${documentId}-${entityType}-${entityId}`, documentId, entityType, entityId);
  }

  it('document nepartajat → false', async () => {
    insertDoc({ id: 'doc-free', type: 'buletin' });
    expect(await sharing.isDocumentReadOnlyForMe('doc-free')).toBe(false);
  });

  it('legat de zonă owned → false', async () => {
    insertPerson('pers-own', 'Ana');
    insertDoc({ id: 'doc-own', type: 'buletin', personId: 'pers-own' });
    linkDocToEntity('doc-own', 'person', 'pers-own');
    const zone = sharing.zoneNameFor('person', 'pers-own');
    await sharing.recordShare({ entityType: 'person', entityId: 'pers-own', zoneName: zone, role: 'owner' });
    expect(await sharing.isDocumentReadOnlyForMe('doc-own')).toBe(false);
  });

  it('legat de zonă participant+read → true', async () => {
    insertPerson('pers-read', 'Ion');
    insertDoc({ id: 'doc-read', type: 'buletin', personId: 'pers-read' });
    linkDocToEntity('doc-read', 'person', 'pers-read');
    const zone = sharing.zoneNameFor('person', 'pers-read');
    await sharing.recordShare({
      entityType: 'person',
      entityId: 'pers-read',
      zoneName: zone,
      role: 'participant',
      permission: 'read',
    });
    expect(await sharing.isDocumentReadOnlyForMe('doc-read')).toBe(true);
  });

  it('legat de zonă participant+readwrite → false', async () => {
    insertPerson('pers-rw', 'Maria');
    insertDoc({ id: 'doc-rw', type: 'buletin', personId: 'pers-rw' });
    linkDocToEntity('doc-rw', 'person', 'pers-rw');
    const zone = sharing.zoneNameFor('person', 'pers-rw');
    await sharing.recordShare({
      entityType: 'person',
      entityId: 'pers-rw',
      zoneName: zone,
      role: 'participant',
      permission: 'readwrite',
    });
    expect(await sharing.isDocumentReadOnlyForMe('doc-rw')).toBe(false);
  });

  it('legat de DOUĂ zone, una read + una readwrite → true (conservativ, decizia 1)', async () => {
    insertPerson('pers-mix1', 'Radu');
    insertPerson('pers-mix2', 'Vlad');
    insertDoc({ id: 'doc-mix', type: 'buletin', personId: 'pers-mix1' });
    linkDocToEntity('doc-mix', 'person', 'pers-mix1');
    linkDocToEntity('doc-mix', 'person', 'pers-mix2');

    const zone1 = sharing.zoneNameFor('person', 'pers-mix1');
    await sharing.recordShare({
      entityType: 'person',
      entityId: 'pers-mix1',
      zoneName: zone1,
      role: 'participant',
      permission: 'readwrite',
    });
    const zone2 = sharing.zoneNameFor('person', 'pers-mix2');
    await sharing.recordShare({
      entityType: 'person',
      entityId: 'pers-mix2',
      zoneName: zone2,
      role: 'participant',
      permission: 'read',
    });

    expect(await sharing.isDocumentReadOnlyForMe('doc-mix')).toBe(true);
  });
});

describe('markZoneSyncSuccess / markZoneSyncError — diagnostics', () => {
  it('succes setează last_synced_at și curăță eroarea; eșecul păstrează ultimul sync reușit', async () => {
    const zone = sharing.zoneNameFor('vehicle', 'veh-diag');
    await sharing.recordShare({ entityType: 'vehicle', entityId: 'veh-diag', zoneName: zone, role: 'participant' });

    await sharing.markZoneSyncSuccess(zone);
    let share = await sharing.getShareForEntity('vehicle', 'veh-diag');
    expect(share!.last_synced_at).toBeTruthy();
    expect(share!.last_sync_error).toBeUndefined();

    const firstSyncedAt = share!.last_synced_at;
    await sharing.markZoneSyncError(zone, 'rețea indisponibilă');
    share = await sharing.getShareForEntity('vehicle', 'veh-diag');
    expect(share!.last_sync_error).toBe('rețea indisponibilă');
    expect(share!.last_synced_at).toBe(firstSyncedAt); // nu s-a schimbat la eroare
  });
});
