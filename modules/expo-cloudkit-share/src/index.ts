import { requireNativeModule } from 'expo-modules-core';

/**
 * CloudKit zone sharing (CKShare) — Increment 2: motor live (fetch incremental cu
 * token, push granular per-record cu LWW, silent push).
 * Vezi `docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md`.
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
  /** Câmpuri string. */
  fields?: Record<string, string>;
}

export interface PutRecordResult {
  recordName: string;
  changeTag: string;
}

export type CloudKitScope = 'private' | 'shared';

export interface GetRecordOptions {
  zoneName: string;
  recordName: string;
  /** 'private' (owner) sau 'shared' (participant). Default 'private'. */
  scope?: CloudKitScope;
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
  /** Permisiune publică a link-ului — doar la crearea unui share NOU. Default 'read'. */
  permission?: 'read' | 'readwrite';
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
  /** Nume afișabil al owner-ului (din CKUserIdentity) — absent dacă owner-ul nu e descoperibil. */
  ownerDisplayName?: string;
}

export interface FetchShareOwnerNameOptions {
  zoneName: string;
  /** `CKRecordZone.ID.ownerName` — identificatorul opac, nu numele. */
  ownerName?: string;
}

export interface LeaveShareOptions {
  zoneName: string;
  ownerName?: string;
}

/** Fișier atașat unui record (devine CKAsset). */
export interface PushFile {
  key: string;
  /** Cale absolută pe disc — prezentă când fișierul e nou/schimbat. */
  path?: string;
  /** true = păstrează CKAsset-ul existent neatins (fișier neschimbat de la ultimul push). */
  unchanged?: boolean;
}

export interface PushRecord {
  recordName: string;
  recordType: string;
  fields: Record<string, string>;
  /**
   * Setul DORIT de fișiere pentru acest record. Orice cheie `file_*` existentă
   * pe recordul de pe server care NU apare aici e ștearsă (previne CKAsset
   * orfan la eliminarea unei pagini).
   */
  files?: PushFile[];
}

export interface PushRecordsOptions {
  zoneName: string;
  scope: CloudKitScope;
  /** Necesar pentru shared DB (push-back participant, Faza 2). */
  ownerName?: string;
  records: PushRecord[];
  /** Nume de record de șters din zonă. */
  deletions: string[];
}

export interface PushRecordsResult {
  /** recordName → changeTag (sau `"deleted"` pentru ștergeri reușite). */
  succeeded: Record<string, string>;
  /** recordName → mesaj de eroare. */
  failed: Record<string, string>;
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

export interface FetchZoneChangesOptions {
  zoneName: string;
  scope?: CloudKitScope;
  ownerName?: string;
  /** Token de la ultimul pull (`newToken` întors anterior); omis/null = full fetch. */
  sinceToken?: string | null;
}

export interface FetchZoneChangesResult {
  records: FetchedRecord[];
  deletedRecordNames: string[];
  /** Token de salvat pentru următorul pull incremental; `null` = fără token (rar). */
  newToken: string | null;
}

export interface FetchDatabaseChangesOptions {
  scope: CloudKitScope;
  sinceToken?: string | null;
}

export interface ZoneRef {
  zoneName: string;
  ownerName: string;
}

export interface FetchDatabaseChangesResult {
  changedZones: ZoneRef[];
  deletedZones: ZoneRef[];
  newToken: string | null;
}

export interface SubscribeDatabaseOptions {
  scope: CloudKitScope;
}

export type RemoteChangeReason = 'push' | 'accountChanged';

export interface RemoteChangeEvent {
  reason?: RemoteChangeReason;
}

export interface RemoteChangeSubscription {
  remove(): void;
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

/** Creează/reprezintă CKShare pe zonă + prezintă invitația nativă. */
export function shareZone(options: ShareZoneOptions): Promise<ShareZoneResult> {
  if (!options.zoneName) throw new Error('shareZone: zoneName obligatoriu');
  return NativeModule.shareZone(options);
}

/** Zonele acceptate de acest cont (participant) din shared DB. */
export function listSharedZones(): Promise<SharedZone[]> {
  return NativeModule.listSharedZones();
}

/**
 * Fallback manual: acceptă un CKShare direct dintr-un URL lipit de user
 * (windowScene(_:userDidAcceptCloudKitShareWith:) nu se apelează fiabil pe
 * toate versiunile iOS — vezi ExpoCloudKitShareModule.swift).
 */
export function acceptShareURL(url: string): Promise<SharedZone> {
  if (!url) throw new Error('acceptShareURL: url obligatoriu');
  return NativeModule.acceptShareURL(url);
}

/** Pull incremental dintr-o zonă (scope 'private' owner / 'shared' participant). */
export function fetchZoneChanges(
  options: FetchZoneChangesOptions
): Promise<FetchZoneChangesResult> {
  if (!options.zoneName) throw new Error('fetchZoneChanges: zoneName obligatoriu');
  return NativeModule.fetchZoneChanges(options);
}

/** Ce zone s-au schimbat/dispărut într-o bază (private/shared), fără să le viziteze pe toate. */
export function fetchDatabaseChanges(
  options: FetchDatabaseChangesOptions
): Promise<FetchDatabaseChangesResult> {
  if (!options.scope) throw new Error('fetchDatabaseChanges: scope obligatoriu');
  return NativeModule.fetchDatabaseChanges(options);
}

/** Push granular per-record (create/update/delete individual) — nu tot bundle-ul. */
export function pushRecords(options: PushRecordsOptions): Promise<PushRecordsResult> {
  if (!options.zoneName) throw new Error('pushRecords: zoneName obligatoriu');
  return NativeModule.pushRecords(options);
}

/** Silent push pentru o bază (CKDatabaseSubscription) — o dată per scope. */
export function subscribeDatabase(
  options: SubscribeDatabaseOptions
): Promise<{ subscribed: boolean }> {
  if (!options.scope) throw new Error('subscribeDatabase: scope obligatoriu');
  return NativeModule.subscribeDatabase(options);
}

/** Owner: șterge share-ul zonei (revocare forward-only). */
export function stopSharing(zoneName: string): Promise<{ revoked: boolean }> {
  if (!zoneName) throw new Error('stopSharing: zoneName obligatoriu');
  return NativeModule.stopSharing(zoneName);
}

/**
 * Best-effort: numele afișabil al owner-ului unei zone, pentru zone descoperite
 * prin `listSharedZones()` fără să fi trecut prin `acceptShareURL` (care are
 * deja numele din metadata share-ului). Poate întoarce obiect gol.
 */
export function fetchShareOwnerName(
  options: FetchShareOwnerNameOptions
): Promise<{ ownerDisplayName?: string }> {
  if (!options.zoneName) throw new Error('fetchShareOwnerName: zoneName obligatoriu');
  return NativeModule.fetchShareOwnerName(options);
}

/** Participant: renunță la accesul propriu (owner-ul și ceilalți participanți nu sunt afectați). */
export function leaveShare(options: LeaveShareOptions): Promise<{ left: boolean }> {
  if (!options.zoneName) throw new Error('leaveShare: zoneName obligatoriu');
  return NativeModule.leaveShare(options);
}

/**
 * Silent push CloudKit / accept de share / schimbare de cont iCloud — toate
 * re-emise nativ ca `onRemoteChange`. Modulul nativ extinde deja `EventEmitter`
 * (`expo-modules-core`), deci `.addListener` e disponibil direct pe el.
 */
export function addRemoteChangeListener(
  listener: (event: RemoteChangeEvent) => void
): RemoteChangeSubscription {
  const subscription = NativeModule.addListener('onRemoteChange', listener);
  return { remove: () => subscription.remove() };
}
