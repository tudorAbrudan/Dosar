/**
 * Unit test — transformările pure CloudKit (cloudShareMapping.ts).
 * Nu ating modulul nativ sau DB → rulează fără mock.
 */
import {
  bundleToPushBundle,
  docWithPagesToPushRecords,
  pageRecordName,
  parseFetchedRecords,
  shareableDocToPushRecord,
} from '@/services/cloudShareMapping';
import type { FetchedRecord } from '@/services/cloudShareMapping';
import type { EntityShareBundle, ShareableDocumentRecord } from '@/services/sharing';

describe('pageRecordName', () => {
  it('prefixează cu documentul, ca paginile lui să fie găsibile după prefix', () => {
    expect(pageRecordName('doc-1', 'pg-9')).toBe('doc-1__p__pg-9');
  });

  it('e idempotent — un nume deja prefixat nu se re-prefixează', () => {
    const once = pageRecordName('doc-1', 'pg-9');
    expect(pageRecordName('doc-1', once)).toBe(once);
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
        mainFilePath: 'documents/a.jpg',
        pages: [{ id: 'pg-1', file_path: 'documents/a2.jpg', page_order: 1 }],
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
    // Documentul + pagina lui = DOUĂ recorduri. Numele câmpurilor sunt fixe
    // (`file_main`, `file`) — schema Production nu poate fi depășită de un
    // document cu multe pagini, cum se întâmpla cu `file_page_<N>`.
    expect(push.documents).toHaveLength(2);
    expect(push.documents[0].recordType).toBe('document');
    expect(push.documents[0].files).toEqual([
      { key: 'file_main', path: 'file:///docs/documents/a.jpg' },
    ]);
    expect(push.documents[1]).toEqual({
      recordName: 'doc-1__p__pg-1',
      recordType: 'document_page',
      fields: { document_id: 'doc-1', page_order: '1' },
      files: [{ key: 'file', path: 'file:///docs/documents/a2.jpg' }],
    });
  });
});

describe('shareableDocToPushRecord — mainFileUnchanged (decizia 5, CKAsset skip)', () => {
  const doc: ShareableDocumentRecord = {
    recordName: 'doc-1',
    fields: { type: 'talon', note: 'x' },
    mainFilePath: 'documents/a.jpg',
    pages: [{ id: 'pg-1', file_path: 'documents/a2.jpg', page_order: 1 }],
  };

  it('mainFileUnchanged=false (default) → fișierul principal pleacă cu path', () => {
    const rec = shareableDocToPushRecord(doc, rel => `file:///docs/${rel}`);
    expect(rec.files).toEqual([{ key: 'file_main', path: 'file:///docs/documents/a.jpg' }]);
  });

  it('mainFileUnchanged=true → file_main devine {key, unchanged: true} fără path', () => {
    const rec = shareableDocToPushRecord(doc, rel => `file:///docs/${rel}`, true);
    expect(rec.files).toEqual([{ key: 'file_main', unchanged: true }]);
  });

  it('paginile NU sunt afectate de mainFileUnchanged — au recordurile lor', () => {
    const recs = docWithPagesToPushRecords(doc, rel => `file:///docs/${rel}`, true);
    expect(recs).toHaveLength(2);
    expect(recs[1].files).toEqual([{ key: 'file', path: 'file:///docs/documents/a2.jpg' }]);
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

  it('separă paginile (document_page) de documente și de entitate', () => {
    const parsed = parseFetchedRecords([
      { recordName: 'doc-1', recordType: 'document', changeTag: 't1', fields: {}, assets: [] },
      {
        recordName: 'doc-1__p__pg-1',
        recordType: 'document_page',
        changeTag: 't2',
        fields: { document_id: 'doc-1', page_order: '1' },
        assets: [],
      },
      {
        recordName: 'veh-1',
        recordType: 'vehicle',
        changeTag: 't3',
        fields: { name: 'Logan' },
        assets: [],
      },
    ]);
    expect(parsed.entity?.recordName).toBe('veh-1');
    expect(parsed.documents.map(d => d.recordName)).toEqual(['doc-1']);
    expect(parsed.pages.map(p => p.recordName)).toEqual(['doc-1__p__pg-1']);
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
