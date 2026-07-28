import type { EntityShareBundle, ShareableDocumentRecord } from './sharing';

/**
 * Transformări PURE între `EntityShareBundle` (sharing.ts) și forma nativă
 * CloudKit (push/pull). Fără dependențe de modulul nativ sau de DB → testabil
 * direct în Jest, fără mock. Vezi `cloudShare.ts` pentru orchestrare.
 */

export interface PushFile {
  key: string;
  /** Cale absolută pe disc (CKAsset are nevoie de file URL real). Absentă când `unchanged`. */
  path?: string;
  /** true = fișierul nu s-a schimbat de la ultimul push — păstrează CKAsset-ul existent. */
  unchanged?: boolean;
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

/** Record-ul entității-rădăcină → `PushRecord`. Fără fișiere (entitatea n-are CKAsset). */
export function entityToPushRecord(bundle: EntityShareBundle): PushRecord {
  return {
    recordName: bundle.entityRecordName,
    recordType: bundle.entityType,
    fields: bundle.entityFields,
  };
}

/**
 * Un document partajabil → `PushRecord` cu CKAsset-uri. `resolvePath` transformă
 * calea relativă (DocumentsDirectory) în absolută. Sursă unică folosită atât de
 * push-ul de bundle (share inițial) cât și de push-ul granular (o modificare de doc).
 *
 * `mainFileUnchanged` (decizia 5 — CKAsset doar la fișier schimbat): când true,
 * fișierul principal (`role: 'main'`) pleacă ca `{key, unchanged: true}` fără
 * `path` — nativul păstrează CKAsset-ul existent în loc să re-urce tot PDF-ul
 * pentru o editare de notă. Paginile (`role: 'page'`) nu au azi hash bookkeeping,
 * pleacă mereu cu path.
 */
export function shareableDocToPushRecord(
  doc: ShareableDocumentRecord,
  resolvePath: (relativePath: string) => string,
  mainFileUnchanged = false
): PushRecord {
  return {
    recordName: doc.recordName,
    recordType: 'document',
    fields: doc.fields,
    files: doc.files.map(f => {
      const key = fileKey(f.role, f.page_order);
      if (f.role === 'main' && mainFileUnchanged) return { key, unchanged: true };
      return { key, path: resolvePath(f.file_path) };
    }),
  };
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
    entity: entityToPushRecord(bundle),
    documents: bundle.documents.map(doc => shareableDocToPushRecord(doc, resolvePath)),
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
