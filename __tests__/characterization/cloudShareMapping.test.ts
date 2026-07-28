/**
 * Unit test — transformările pure CloudKit (cloudShareMapping.ts).
 * Nu ating modulul nativ sau DB → rulează fără mock.
 */
import {
  bundleToPushBundle,
  fileKey,
  parseFetchedRecords,
  shareableDocToPushRecord,
} from '@/services/cloudShareMapping';
import type { FetchedRecord } from '@/services/cloudShareMapping';
import type { EntityShareBundle, ShareableDocumentRecord } from '@/services/sharing';

describe('fileKey', () => {
  it('main vs page', () => {
    expect(fileKey('main')).toBe('file_main');
    expect(fileKey('page', 3)).toBe('file_page_3');
    expect(fileKey('page')).toBe('file_page_0');
  });
});

describe('bundleToPushBundle', () => {
  const bundle: EntityShareBundle = {
    entityType: 'vehicle',
    entityRecordName: 'veh-1',
    entityFields: { id: 'veh-1', name: 'Logan' },
    documents: [
      {
        recordName: 'doc-1',
        fields: { type: 'talon', note: 'x' },
        files: [
          { file_path: 'documents/a.jpg', role: 'main' },
          { file_path: 'documents/a2.jpg', role: 'page', page_order: 1 },
        ],
      },
    ],
  };

  it('mapează entity + documente + rezolvă căile fișierelor', () => {
    const push = bundleToPushBundle(bundle, 'entity_vehicle_veh-1', rel => `file:///docs/${rel}`);

    expect(push.zoneName).toBe('entity_vehicle_veh-1');
    expect(push.entity).toEqual({
      recordName: 'veh-1',
      recordType: 'vehicle',
      fields: { id: 'veh-1', name: 'Logan' },
    });
    expect(push.documents).toHaveLength(1);
    expect(push.documents[0].recordType).toBe('document');
    expect(push.documents[0].files).toEqual([
      { key: 'file_main', path: 'file:///docs/documents/a.jpg' },
      { key: 'file_page_1', path: 'file:///docs/documents/a2.jpg' },
    ]);
  });
});

describe('shareableDocToPushRecord — mainFileUnchanged (decizia 5, CKAsset skip)', () => {
  const doc: ShareableDocumentRecord = {
    recordName: 'doc-1',
    fields: { type: 'talon', note: 'x' },
    files: [
      { file_path: 'documents/a.jpg', role: 'main' },
      { file_path: 'documents/a2.jpg', role: 'page', page_order: 1 },
    ],
  };

  it('mainFileUnchanged=false (default) → toate fișierele pleacă cu path', () => {
    const rec = shareableDocToPushRecord(doc, rel => `file:///docs/${rel}`);
    expect(rec.files).toEqual([
      { key: 'file_main', path: 'file:///docs/documents/a.jpg' },
      { key: 'file_page_1', path: 'file:///docs/documents/a2.jpg' },
    ]);
  });

  it('mainFileUnchanged=true → file_main devine {key, unchanged: true} fără path; paginile neafectate', () => {
    const rec = shareableDocToPushRecord(doc, rel => `file:///docs/${rel}`, true);
    expect(rec.files).toEqual([
      { key: 'file_main', unchanged: true },
      { key: 'file_page_1', path: 'file:///docs/documents/a2.jpg' },
    ]);
  });
});

describe('parseFetchedRecords', () => {
  it('separă entitatea-rădăcină de documente', () => {
    const records: FetchedRecord[] = [
      { recordName: 'doc-1', recordType: 'document', changeTag: 't1', fields: {}, assets: [] },
      {
        recordName: 'veh-1',
        recordType: 'vehicle',
        changeTag: 't2',
        fields: { name: 'Logan' },
        assets: [],
      },
      { recordName: 'doc-2', recordType: 'document', changeTag: 't3', fields: {}, assets: [] },
    ];
    const parsed = parseFetchedRecords(records);
    expect(parsed.entity?.recordName).toBe('veh-1');
    expect(parsed.documents.map(d => d.recordName)).toEqual(['doc-1', 'doc-2']);
  });

  it('entity null dacă lipsește recordul non-document', () => {
    const parsed = parseFetchedRecords([
      { recordName: 'doc-1', recordType: 'document', changeTag: 't', fields: {}, assets: [] },
    ]);
    expect(parsed.entity).toBeNull();
    expect(parsed.documents).toHaveLength(1);
  });

  it('ignoră record-ul de sistem cloudkit.share (nu-l tratează ca entitate)', () => {
    const parsed = parseFetchedRecords([
      { recordName: 'share', recordType: 'cloudkit.share', changeTag: 't', fields: {}, assets: [] },
      {
        recordName: 'veh-1',
        recordType: 'vehicle',
        changeTag: 't',
        fields: { name: 'Logan' },
        assets: [],
      },
    ]);
    expect(parsed.entity?.recordName).toBe('veh-1');
    expect(parsed.entity?.fields.name).toBe('Logan');
  });
});
