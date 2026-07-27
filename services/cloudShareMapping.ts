import type { EntityShareBundle } from './sharing';

/**
 * Transformări PURE între `EntityShareBundle` (sharing.ts) și forma nativă
 * CloudKit (push/pull). Fără dependențe de modulul nativ sau de DB → testabil
 * direct în Jest, fără mock. Vezi `cloudShare.ts` pentru orchestrare.
 */

export interface PushFile {
  key: string;
  /** Cale absolută pe disc (CKAsset are nevoie de file URL real). */
  path: string;
}

export interface PushRecord {
  recordName: string;
  recordType: string;
  fields: Record<string, string>;
  files?: PushFile[];
}

export interface PushBundle {
  zoneName: string;
  entity: PushRecord;
  documents: PushRecord[];
}

export interface FetchedAsset {
  key: string;
  path: string;
}

export interface FetchedRecord {
  recordName: string;
  recordType: string;
  changeTag: string;
  fields: Record<string, string>;
  assets: FetchedAsset[];
}

export interface ParsedPull {
  /** Singurul record non-document = entitatea-rădăcină a zonei. */
  entity: FetchedRecord | null;
  documents: FetchedRecord[];
}

/** Cheia CKAsset pentru un fișier: `file_main` sau `file_page_<N>`. */
export function fileKey(role: 'main' | 'page', pageOrder?: number): string {
  return role === 'main' ? 'file_main' : `file_page_${pageOrder ?? 0}`;
}

/**
 * `EntityShareBundle` → `PushBundle` nativ. `resolvePath` transformă calea
 * relativă (DocumentsDirectory) în absolută pentru CKAsset.
 */
export function bundleToPushBundle(
  bundle: EntityShareBundle,
  zoneName: string,
  resolvePath: (relativePath: string) => string
): PushBundle {
  return {
    zoneName,
    entity: {
      recordName: bundle.entityRecordName,
      recordType: bundle.entityType,
      fields: bundle.entityFields,
    },
    documents: bundle.documents.map(doc => ({
      recordName: doc.recordName,
      recordType: 'document',
      fields: doc.fields,
      files: doc.files.map(f => ({
        key: fileKey(f.role, f.page_order),
        path: resolvePath(f.file_path),
      })),
    })),
  };
}

/** Separă recordurile primite (pull) în entitate-rădăcină + documente. */
export function parseFetchedRecords(records: FetchedRecord[]): ParsedPull {
  let entity: FetchedRecord | null = null;
  const documents: FetchedRecord[] = [];
  for (const rec of records) {
    // Record-urile de sistem CloudKit (`cloudkit.share`, `cloudkit.*`) vin în
    // zonă alături de datele noastre — NU sunt entitatea. Le ignorăm, altfel
    // share-ul ar fi tratat drept entitate și am insera un rând fără câmpuri.
    if (rec.recordType.startsWith('cloudkit.')) continue;
    if (rec.recordType === 'document') {
      documents.push(rec);
    } else {
      entity = rec; // singurul record de date non-document = entitatea-rădăcină
    }
  }
  return { entity, documents };
}
