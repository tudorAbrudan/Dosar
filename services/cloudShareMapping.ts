import type { EntityShareBundle, ShareableDocumentPage, ShareableDocumentRecord } from './sharing';

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
  /** Singurul record care nu e document/pagină = entitatea-rădăcină a zonei. */
  entity: FetchedRecord | null;
  documents: FetchedRecord[];
  pages: FetchedRecord[];
}

/**
 * Nume de câmpuri și tipuri de record — TOATE fixe, niciodată derivate din date.
 * Schema mediului Production e blocată: un câmp nou (cum era `file_page_<N>`,
 * generat din numărul de pagini) face serverul să respingă recordul întreg. Un
 * document = un record cu `file_main`; fiecare pagină secundară = un record
 * `document_page` propriu, cu un singur asset `file`.
 */
export const MAIN_FILE_KEY = 'file_main';
export const PAGE_FILE_KEY = 'file';
export const PAGE_RECORD_TYPE = 'document_page';

/**
 * Numele CloudKit al recordului unei pagini: `<documentId>__p__<pageId>`.
 * Prefixul permite găsirea paginilor unui document în `cloud_records` fără să
 * mai avem rândul local (necesar ca să ștergem de pe server paginile eliminate
 * local). Idempotent — reaplicat pe un nume deja prefixat întoarce același nume,
 * deci participantul care re-trimite o pagină primită nu dublează prefixul.
 */
export function pageRecordName(documentRecordName: string, pageId: string): string {
  const prefix = `${documentRecordName}__p__`;
  return pageId.startsWith(prefix) ? pageId : `${prefix}${pageId}`;
}

/** Prefixul după care se caută în `cloud_records` paginile unui document. */
export function pageRecordPrefix(documentRecordName: string): string {
  return `${documentRecordName}__p__`;
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
 * Un document partajabil → `PushRecord`-ul propriu (fără pagini — acelea sunt
 * recorduri separate, vezi `pageToPushRecord`). `resolvePath` transformă calea
 * relativă (DocumentsDirectory) în absolută.
 *
 * `mainFileUnchanged` (decizia 5 — CKAsset doar la fișier schimbat): când true,
 * fișierul principal pleacă ca `{key, unchanged: true}` fără `path` — nativul
 * păstrează CKAsset-ul existent în loc să re-urce tot PDF-ul pentru o editare
 * de notă.
 */
export function shareableDocToPushRecord(
  doc: ShareableDocumentRecord,
  resolvePath: (relativePath: string) => string,
  mainFileUnchanged = false
): PushRecord {
  const files: PushFile[] = [];
  if (doc.mainFilePath) {
    files.push(
      mainFileUnchanged
        ? { key: MAIN_FILE_KEY, unchanged: true }
        : { key: MAIN_FILE_KEY, path: resolvePath(doc.mainFilePath) }
    );
  }
  return {
    recordName: doc.recordName,
    recordType: 'document',
    fields: doc.fields,
    files,
  };
}

/** O pagină secundară → record `document_page` cu un singur asset (`file`). */
export function pageToPushRecord(
  page: ShareableDocumentPage,
  documentRecordName: string,
  resolvePath: (relativePath: string) => string
): PushRecord {
  return {
    recordName: pageRecordName(documentRecordName, page.id),
    recordType: PAGE_RECORD_TYPE,
    fields: {
      document_id: documentRecordName,
      page_order: String(page.page_order),
    },
    files: [{ key: PAGE_FILE_KEY, path: resolvePath(page.file_path) }],
  };
}

/** Documentul + toate paginile lui, în ordinea de push. */
export function docWithPagesToPushRecords(
  doc: ShareableDocumentRecord,
  resolvePath: (relativePath: string) => string,
  mainFileUnchanged = false
): PushRecord[] {
  // Fără spread de `doc` în vreo formă — `share-privacy-audit.js` (regula B)
  // interzice tiparul în calea de share, ca nimeni să nu ocolească whitelist-ul
  // dintr-o scurtătură sintactică.
  const records: PushRecord[] = [shareableDocToPushRecord(doc, resolvePath, mainFileUnchanged)];
  for (const page of doc.pages) {
    records.push(pageToPushRecord(page, doc.recordName, resolvePath));
  }
  return records;
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
    documents: bundle.documents.flatMap(doc => docWithPagesToPushRecords(doc, resolvePath)),
  };
}

/** Separă recordurile primite (pull) în entitate-rădăcină + documente + pagini. */
export function parseFetchedRecords(records: FetchedRecord[]): ParsedPull {
  let entity: FetchedRecord | null = null;
  const documents: FetchedRecord[] = [];
  const pages: FetchedRecord[] = [];
  for (const rec of records) {
    // Record-urile de sistem CloudKit (`cloudkit.share`, `cloudkit.*`) vin în
    // zonă alături de datele noastre — NU sunt entitatea. Le ignorăm, altfel
    // share-ul ar fi tratat drept entitate și am insera un rând fără câmpuri.
    if (rec.recordType.startsWith('cloudkit.')) continue;
    if (rec.recordType === 'document') {
      documents.push(rec);
    } else if (rec.recordType === PAGE_RECORD_TYPE) {
      pages.push(rec);
    } else {
      entity = rec; // singurul record de date rămas = entitatea-rădăcină
    }
  }
  return { entity, documents, pages };
}
