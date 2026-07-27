import { requireNativeModule } from 'expo-modules-core';

/**
 * Spike Faza 0 — CloudKit zone sharing (CKShare) între conturi iCloud.
 * Vezi `docs/superpowers/specs/2026-07-22-cloudkit-entity-sharing.md`.
 *
 * ⚠️ iOS only. Testare reală = 2 device-uri fizice + 2 Apple ID
 * (simulatorul nu acoperă CloudKit sharing).
 */

export type CloudKitAccountStatus =
  | 'available'
  | 'noAccount'
  | 'restricted'
  | 'couldNotDetermine'
  | 'temporarilyUnavailable'
  | 'unknown';

export interface AvailabilityResult {
  available: boolean;
  accountStatus: CloudKitAccountStatus;
}

export interface PutRecordOptions {
  zoneName: string;
  recordName: string;
  recordType: string;
  /** Câmpuri string (spike). Câmpuri tipate + CKAsset vin în Faza 2. */
  fields?: Record<string, string>;
}

export interface PutRecordResult {
  recordName: string;
  changeTag: string;
}

export interface GetRecordOptions {
  zoneName: string;
  recordName: string;
  /** 'private' (owner) sau 'shared' (participant). Default 'private'. */
  scope?: 'private' | 'shared';
  /** Necesar pentru shared DB: numele owner-ului zonei. */
  ownerName?: string;
}

export interface GetRecordResult {
  recordName: string;
  changeTag: string;
  fields: Record<string, string>;
}

export interface ShareZoneOptions {
  zoneName: string;
  /** Titlul afișat în sheet-ul de invitație. */
  title?: string;
}

export interface ShareZoneResult {
  /** URL-ul CKShare (poate fi trimis manual dacă `presented` e false). */
  shareURL: string;
  /** true dacă UICloudSharingController a fost prezentat. */
  presented: boolean;
}

export interface SharedZone {
  zoneName: string;
  ownerName: string;
}

/** Fișier atașat unui record (devine CKAsset). `path` = cale absolută pe disc. */
export interface PushFile {
  key: string;
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
  /** Cale locală (tmp) unde a fost descărcat CKAsset-ul. */
  path: string;
}

export interface FetchedRecord {
  recordName: string;
  recordType: string;
  changeTag: string;
  fields: Record<string, string>;
  assets: FetchedAsset[];
}

export interface FetchZoneChangesResult {
  records: FetchedRecord[];
  deletedRecordNames: string[];
}

const NativeModule = requireNativeModule('ExpoCloudKitShare');

/** Statusul contului iCloud pe acest device. */
export function isAvailable(): Promise<AvailabilityResult> {
  return NativeModule.isAvailable();
}

/** Creează o zonă custom în private DB (o zonă per entitate partajată). */
export function createSharedZone(zoneName: string): Promise<{ zoneName: string }> {
  if (!zoneName) throw new Error('createSharedZone: zoneName obligatoriu');
  return NativeModule.createSharedZone(zoneName);
}

/** Fetch-or-create + salvare record cu câmpuri string. */
export function putRecord(options: PutRecordOptions): Promise<PutRecordResult> {
  if (!options.zoneName || !options.recordName || !options.recordType) {
    throw new Error('putRecord: zoneName, recordName, recordType obligatorii');
  }
  return NativeModule.putRecord(options);
}

/** Citește un record; null dacă nu există. */
export function getRecord(options: GetRecordOptions): Promise<GetRecordResult | null> {
  if (!options.zoneName || !options.recordName) {
    throw new Error('getRecord: zoneName, recordName obligatorii');
  }
  return NativeModule.getRecord(options);
}

/** Creează CKShare pe zonă + prezintă invitația nativă. */
export function shareZone(options: ShareZoneOptions): Promise<ShareZoneResult> {
  if (!options.zoneName) throw new Error('shareZone: zoneName obligatoriu');
  return NativeModule.shareZone(options);
}

/** Zonele acceptate de acest cont (participant) din shared DB. */
export function listSharedZones(): Promise<SharedZone[]> {
  return NativeModule.listSharedZones();
}

/** Owner: urcă entitatea + documentele + fișierele într-o zonă. */
export function pushBundle(bundle: PushBundle): Promise<{ changeTags: Record<string, string> }> {
  if (!bundle.zoneName) throw new Error('pushBundle: zoneName obligatoriu');
  return NativeModule.pushBundle(bundle);
}

/** Pull toate recordurile dintr-o zonă (scope 'private' owner / 'shared' participant). */
export function fetchZoneChanges(options: {
  zoneName: string;
  scope?: 'private' | 'shared';
  ownerName?: string;
}): Promise<FetchZoneChangesResult> {
  if (!options.zoneName) throw new Error('fetchZoneChanges: zoneName obligatoriu');
  return NativeModule.fetchZoneChanges(options);
}

/** Owner: șterge share-ul zonei (revocare forward-only). */
export function stopSharing(zoneName: string): Promise<{ revoked: boolean }> {
  if (!zoneName) throw new Error('stopSharing: zoneName obligatoriu');
  return NativeModule.stopSharing(zoneName);
}
