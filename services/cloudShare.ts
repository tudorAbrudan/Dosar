import * as FileSystem from 'expo-file-system/legacy';

import type * as CloudKitShareModule from '@/modules/expo-cloudkit-share/src';
import type { DocumentEntityLink, EntityType } from '@/types';

import { entityToPushRecord, parseFetchedRecords, shareableDocToPushRecord } from './cloudShareMapping';
import type { FetchedRecord, PushRecord } from './cloudShareMapping';
import { db } from './db';
import { getDocumentById } from './documents';
import { toFileUri } from './fileUtils';
import {
  getCloudKitDbChangeToken,
  getCloudKitDbSubscribed,
  setCloudKitDbChangeToken,
  setCloudKitDbSubscribed,
} from './settings';
import {
  ENTITY_SYNC_FIELDS,
  bumpSharePushAttempt,
  deleteCloudRecord,
  deleteSharePush,
  enqueueSharePush,
  getCloudRecord,
  getCloudRecordsForLocal,
  getEntityShareFields,
  getPendingSharePushes,
  getShareBundle,
  getSharedEntities,
  getShareForEntity,
  getZoneChangeToken,
  getZonesForDocument,
  markZoneSyncError,
  markZoneSyncSuccess,
  parseZoneName,
  recordShare,
  revokeShare,
  setCloudRecordFileHash,
  setZoneChangeToken,
  toShareableDocument,
  upsertCloudRecord,
  zoneNameFor,
} from './sharing';
import type {
  PendingSharePush,
  PushScope,
  SharedEntity,
  SharePermission,
  SharePushOp,
} from './sharing';

/**
 * Orchestrarea partajării CloudKit: owner push (granular, incremental) +
 * participant pull (incremental, non-destructiv) + revocare.
 *
 * ⚠️ UNVERIFIED on-device: fluxul CloudKit efectiv (accept share + sync între
 * două conturi iCloud, silent push) NU poate fi testat fără al doilea cont/telefon.
 * Logica pură de mapare e izolată în `cloudShareMapping.ts` (testată). Validare
 * reală = TestFlight pe două telefoane.
 * Vezi docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md.
 */

// Import lazy al modulului nativ: ecranul de UI se randează în simulator chiar
// dacă modulul nu e încă linkat (înainte de prebuild). Apelurile eșuează grațios.
/* eslint-disable @typescript-eslint/no-var-requires */
let nativeModule: typeof CloudKitShareModule | null = null;
function native(): typeof CloudKitShareModule {
  if (!nativeModule) {
    nativeModule = require('@/modules/expo-cloudkit-share/src') as typeof CloudKitShareModule;
  }
  return nativeModule;
}

// Mapare service-layer entityType→tabel SQLite (nu label UI). Chei EntityType
// legitime — nu există sursă unică pentru numele tabelului în types/index.ts.
// check-hardcoded-entities-disable-next-cluster
const ENTITY_TABLE: Record<string, string> = {
  person: 'persons',
  vehicle: 'vehicles',
  property: 'properties',
  animal: 'animals',
  company: 'companies',
};

const TABLE_TO_ENTITY_TYPE: Record<string, EntityType> = Object.fromEntries(
  Object.entries(ENTITY_TABLE).map(([entityType, table]) => [table, entityType as EntityType])
);

export type LocalTable = 'persons' | 'properties' | 'vehicles' | 'animals' | 'companies' | 'documents';

export async function isCloudKitAvailable(): Promise<boolean> {
  try {
    const { available } = await native().isAvailable();
    return available;
  } catch {
    return false;
  }
}

/** Owner: partajează o entitate — creează zona, urcă bundle-ul, prezintă invitația. */
export async function shareEntity(
  entityType: EntityType,
  entityId: string,
  permission: SharePermission = 'read'
): Promise<string> {
  // getShareBundle aruncă dacă entitatea nu e partajabilă + garantează no-leak.
  const bundle = await getShareBundle(entityType, entityId);
  const zoneName = zoneNameFor(entityType, entityId);

  await native().createSharedZone(zoneName);

  const records: PushRecord[] = [
    entityToPushRecord(bundle),
    ...bundle.documents.map(doc => shareableDocToPushRecord(doc, rel => toFileUri(rel))),
  ];
  const { succeeded } = await native().pushRecords({
    zoneName,
    scope: 'private',
    records,
    deletions: [],
  });

  // Prezintă invitația ÎNAINTE de a persista starea locală. Dacă CloudKit refuză
  // share-ul (ex: schema neplublicată în Production → „Cannot create new type
  // cloudkit.share in production schema"), aruncă aici și NU rămânem cu rânduri
  // orfane în shared_entities/cloud_records care ar arăta „Revocă" degeaba.
  const { shareURL } = await native().shareZone({
    zoneName,
    title: bundle.entityFields.name ?? 'Entitate Dosar',
    permission,
  });

  await upsertCloudRecord({
    zoneName,
    recordName: bundle.entityRecordName,
    recordType: entityType,
    localTable: ENTITY_TABLE[entityType] ?? entityType,
    localId: entityId,
    changeTag: succeeded[bundle.entityRecordName],
  });
  for (const doc of bundle.documents) {
    await upsertCloudRecord({
      zoneName,
      recordName: doc.recordName,
      recordType: 'document',
      localTable: 'documents',
      localId: doc.recordName,
      changeTag: succeeded[doc.recordName],
    });
  }
  // Hash bookkeeping pentru push-urile incrementale viitoare (skip CKAsset la
  // fișier neschimbat) — vezi shareableDocToPushRecord (cloudShareMapping.ts).
  for (const doc of bundle.documents) {
    const fullDoc = await getDocumentById(doc.recordName);
    if (fullDoc?.file_hash) await setCloudRecordFileHash(zoneName, doc.recordName, fullDoc.file_hash);
  }

  await recordShare({ entityType, entityId, zoneName, role: 'owner', shareUrl: shareURL, permission });
  return shareURL;
}

/** Owner: revocă accesul (forward-only). */
export async function revokeEntityShare(entityType: EntityType, entityId: string): Promise<void> {
  const share = await getShareForEntity(entityType, entityId);
  if (!share) return;
  try {
    await native().stopSharing(share.zone_name);
  } catch (e) {
    // Zona poate lipsi pe server: partajarea a fost creată într-un build dev
    // (mediu Development) dar rulăm acum în Production, sau a fost deja ștearsă.
    // Scopul revocării e local — marcăm entitatea ca nepartajată indiferent, ca
    // userul să nu rămână blocat cu un rând „Revocă" imposibil de curățat.
    if (!isZoneGoneError(e)) throw e;
  }
  await revokeShare(share.zone_name);
}

/** True dacă eroarea CloudKit înseamnă „zona nu (mai) există pe server". */
function isZoneGoneError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /zone does not exist|zone not found|zonenotfound/i.test(msg);
}

/** Traduce erorile CloudKit brute în mesaje RO, user-friendly, pentru UI. */
export function friendlyCloudKitMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/production schema|cannot create new type/i.test(msg)) {
    return 'Partajarea nu e încă activată pe server. Schema CloudKit trebuie publicată în Production (Deploy Schema to Production).';
  }
  if (/not authenticated|notauthenticated|no account|account.*not available/i.test(msg)) {
    return 'Conectează-te la iCloud pentru a partaja.';
  }
  if (/network|connection|offline|internet/i.test(msg)) {
    return 'Fără conexiune. Verifică internetul și reîncearcă.';
  }
  if (isZoneGoneError(e)) {
    return 'Zona partajată nu mai există pe server.';
  }
  return 'Partajarea nu a reușit. Reîncearcă.';
}

/**
 * Participant: descoperă zonele partajate ACCEPTATE și le înregistrează local ca
 * `role: 'participant'`. După ce userul deschide link-ul de invitație, iOS acceptă
 * CKShare-ul (accept-handler-ul din `ExpoCloudKitShareAppDelegate`) și zona apare
 * în `sharedCloudDatabase` → `listSharedZones()`. Fără acest pas nu există niciun
 * rând participant, deci `syncSharedEntities` n-ar avea ce trage și „Partajat cu
 * mine" ar rămâne gol. Idempotent: sare zonele deja cunoscute.
 *
 * Curăță și participările a căror zonă a dispărut (owner a revocat, forward-only):
 * datele deja copiate rămân la participant, dar nu mai apar în listă și nu mai
 * sincronizează.
 */
export async function reconcileParticipantShares(): Promise<void> {
  const zones = await native().listSharedZones();
  const liveZoneNames = new Set(zones.map(z => z.zoneName));

  const active = await getSharedEntities();
  const knownParticipant = new Set(
    active.filter(s => s.role === 'participant').map(s => s.zone_name)
  );

  for (const zone of zones) {
    if (knownParticipant.has(zone.zoneName)) continue;
    const parsed = parseZoneName(zone.zoneName);
    if (!parsed) continue; // zonă de sistem sau tip necunoscut — nu inventăm entitate
    await recordShare({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      zoneName: zone.zoneName,
      role: 'participant',
      ownerName: zone.ownerName,
    });
  }

  for (const share of active) {
    if (share.role === 'participant' && !liveZoneNames.has(share.zone_name)) {
      await revokeShare(share.zone_name);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Push local → CloudKit. Owner scrie mereu (scope='private'). Faza 2: și
// participantul poate scrie — DOAR pe zone readwrite (scope='shared').
// ─────────────────────────────────────────────────────────────────────────

interface PushTarget {
  zoneName: string;
  scope: PushScope;
  ownerName?: string;
}

/**
 * Rezolvă zona/zonele afectate de o mutație locală, pune push-ul(urile) în
 * coadă și încearcă imediat să le trimită. No-op adevărat dacă rândul nu e
 * (încă) partajat sau dacă e partajat read-only pentru mine.
 */
export async function pushLocalChange(
  localTable: LocalTable,
  localId: string,
  op: SharePushOp
): Promise<void> {
  if (localTable === 'documents') {
    const live = await getZonesForDocument(localId);
    let targets: PushTarget[] = live
      .filter(z => z.role === 'owner' || (z.role === 'participant' && z.permission === 'readwrite'))
      .map(z => ({
        zoneName: z.zone_name,
        scope: z.role === 'owner' ? 'private' : 'shared',
        ownerName: z.role === 'owner' ? undefined : z.owner_name,
      }));
    if (targets.length === 0 && live.length === 0) {
      // document_entities deja curățat (post-delete) — fallback pe cloud_records
      // pentru delete-ul PROPRIU al owner-ului (un participant nu are de unde
      // să-și mai rezolve zona după ce link-ul local a dispărut — no-op corect).
      const ownedZones = new Set(
        (await getSharedEntities()).filter(s => s.role === 'owner').map(s => s.zone_name)
      );
      targets = (await getCloudRecordsForLocal('documents', localId))
        .map(r => r.zone_name)
        .filter(z => ownedZones.has(z))
        .map(zoneName => ({ zoneName, scope: 'private' as PushScope }));
    }
    if (targets.length === 0) return;
    for (const target of targets) {
      await enqueueSharePush({
        zoneName: target.zoneName,
        recordName: localId,
        op,
        scope: target.scope,
        ownerName: target.ownerName,
        kind: 'document',
      });
    }
  } else {
    const entityType = TABLE_TO_ENTITY_TYPE[localTable];
    if (!entityType) return;
    const share = await getShareForEntity(entityType, localId);
    if (!share) return; // nu-i partajată de mine — no-op adevărat
    if (share.role === 'owner') {
      if (op === 'delete') {
        // Ștergerea entității-rădăcină = revocă share-ul, nu push de delete brut
        // pe zone-root (zona ar rămâne partajată dar goală).
        await revokeEntityShare(entityType, localId);
        return;
      }
      await enqueueSharePush({
        zoneName: share.zone_name,
        recordName: localId,
        op,
        scope: 'private',
        kind: 'entity',
      });
    } else {
      // Participant: push-back doar pe readwrite. Ștergerea locală a COPIEI
      // entității-rădăcină nu propagă — doar owner-ul poate șterge zona.
      if (share.permission !== 'readwrite' || op === 'delete') return;
      await enqueueSharePush({
        zoneName: share.zone_name,
        recordName: localId,
        op,
        scope: 'shared',
        ownerName: share.owner_name,
        kind: 'entity',
      });
    }
  }
  await flushSharePushes();
}

/** Hook thin apelat din `entities.ts` (dynamic import, fire-and-forget). */
export function afterEntityMutation(
  entityType: EntityType,
  entityId: string,
  op: SharePushOp
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  if (!table) return Promise.resolve();
  return pushLocalChange(table as LocalTable, entityId, op).catch(e => {
    console.warn('[cloudShare] afterEntityMutation eșuat:', e instanceof Error ? e.message : e);
  });
}

/** Hook thin apelat din `documents.ts` (dynamic import, fire-and-forget). */
export function afterDocumentMutation(documentId: string, op: SharePushOp): Promise<void> {
  return pushLocalChange('documents', documentId, op).catch(e => {
    console.warn('[cloudShare] afterDocumentMutation eșuat:', e instanceof Error ? e.message : e);
  });
}

/**
 * `removeEntityLinkFromDocument`: după unlink, `getZonesForDocument` nu mai
 * întoarce zona tocmai eliminată — trebuie țintită explicit cu link-ul primit
 * ca parametru, altfel documentul rămâne „fantomă" pe server în acea zonă.
 */
export async function afterDocumentUnlinked(
  documentId: string,
  link: DocumentEntityLink
): Promise<void> {
  try {
    const share = await getShareForEntity(link.entityType, link.entityId);
    if (!share || share.role !== 'owner') return;
    await enqueueSharePush({
      zoneName: share.zone_name,
      recordName: documentId,
      op: 'delete',
      scope: 'private',
      kind: 'document',
    });
    await flushSharePushes();
  } catch (e) {
    console.warn('[cloudShare] afterDocumentUnlinked eșuat:', e instanceof Error ? e.message : e);
  }
}

/**
 * Drenează coada `pending_share_pushes`: re-derivă payload-ul la FLUSH time
 * (nu la enqueue time — un rând poate aștepta offline mult timp, starea locală
 * se poate schimba între timp), grupat per (zonă, scope, owner), trimis printr-un
 * singur apel `pushRecords` per grup.
 */
export async function flushSharePushes(): Promise<void> {
  const pending = await getPendingSharePushes();
  if (pending.length === 0) return;

  const groups = new Map<string, PendingSharePush[]>();
  for (const row of pending) {
    const key = `${row.zone_name} ${row.scope} ${row.owner_name ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  for (const rows of groups.values()) {
    await flushZoneGroup(rows);
  }
}

async function flushZoneGroup(rows: PendingSharePush[]): Promise<void> {
  const zoneName = rows[0].zone_name;
  const scope: PushScope = rows[0].scope;
  const ownerName = rows[0].owner_name;

  const records: PushRecord[] = [];
  const deletions: string[] = [];
  const skipIds: number[] = [];

  for (const row of rows) {
    if (row.op === 'delete') {
      deletions.push(row.record_name);
      continue;
    }
    if (row.kind === 'entity') {
      const entityType = parseZoneName(row.zone_name)?.entityType;
      const fields = entityType ? await getEntityShareFields(entityType, row.record_name) : null;
      if (!fields || !entityType) {
        // entitatea a dispărut sau nu mai e shareable — nimic de trimis.
        skipIds.push(row.id);
        continue;
      }
      records.push({ recordName: row.record_name, recordType: entityType, fields });
    } else {
      const doc = await getDocumentById(row.record_name);
      const shareable = doc ? toShareableDocument(doc) : null;
      if (!shareable) {
        // documentul a dispărut local sau a devenit medical între timp — tombstone
        // doar dacă exista deja pe server, altfel nu inventăm un delete pentru
        // ceva ce n-a fost niciodată pushuit.
        const wasSynced = await getCloudRecord(zoneName, row.record_name);
        if (wasSynced) deletions.push(row.record_name);
        else skipIds.push(row.id);
        continue;
      }
      const existing = await getCloudRecord(zoneName, row.record_name);
      const mainUnchanged = !!doc!.file_hash && doc!.file_hash === existing?.file_hash;
      records.push(shareableDocToPushRecord(shareable, rel => toFileUri(rel), mainUnchanged));
    }
  }

  for (const id of skipIds) await deleteSharePush(id);
  if (records.length === 0 && deletions.length === 0) return;

  try {
    const { succeeded, failed } = await native().pushRecords({
      zoneName,
      scope,
      ownerName,
      records,
      deletions,
    });
    for (const row of rows) {
      if (skipIds.includes(row.id)) continue;
      const errorMsg = failed[row.record_name];
      if (errorMsg) {
        await bumpSharePushAttempt(row.id, errorMsg);
        continue;
      }
      await deleteSharePush(row.id);
      if (row.op === 'delete') {
        await deleteCloudRecord(zoneName, row.record_name);
        continue;
      }
      const changeTag = succeeded[row.record_name];
      if (!changeTag) continue;
      const entityType = row.kind === 'entity' ? parseZoneName(zoneName)?.entityType : undefined;
      await upsertCloudRecord({
        zoneName,
        recordName: row.record_name,
        recordType: row.kind === 'entity' ? (entityType ?? 'entity') : 'document',
        localTable: row.kind === 'entity' ? (entityType ? ENTITY_TABLE[entityType] : 'unknown') : 'documents',
        localId: row.record_name,
        changeTag,
      });
      if (row.kind === 'document') {
        const doc = await getDocumentById(row.record_name);
        if (doc?.file_hash) await setCloudRecordFileHash(zoneName, row.record_name, doc.file_hash);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const row of rows) {
      if (!skipIds.includes(row.id)) await bumpSharePushAttempt(row.id, msg);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pull CloudKit → local. Participanții trag din `scope='shared'` (Faza 1).
// Faza 2: owner-ul trage și el din PROPRIA zonă (`scope='private'`) — dar
// DOAR pentru share-urile readwrite (acolo unde un participant poate scrie).
// Supresia de ecou din `applyFetchedRecords` protejează owner-ul de a-și
// clobber-ui propriile editări mai noi cu propriul ecou.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sincronizare completă: descoperă zone noi/dispărute, drenează coada de push,
 * apoi trage schimbările — atât ca participant cât și, pentru share-urile
 * readwrite, ca owner. Fără cont iCloud (simulator, delogat) → no-op liniștit.
 */
export async function syncSharedEntities(): Promise<void> {
  if (!(await isCloudKitAvailable())) return;

  // Întâi înregistrează zonele nou-acceptate/dispărute.
  await reconcileParticipantShares();

  if (!(await getCloudKitDbSubscribed('shared'))) {
    try {
      await native().subscribeDatabase({ scope: 'shared' });
      await setCloudKitDbSubscribed('shared', true);
    } catch {
      // Best-effort — silent push e doar acceleratorul; sync pe AppState-active
      // rămâne garanția de liveness (decizia 2).
    }
  }
  if (!(await getCloudKitDbSubscribed('private'))) {
    try {
      // Necesar ca owner-ul unui share readwrite să primească silent push când
      // participantul scrie în zona lui. O singură subscripție per DB, ieftină
      // — nu depinde de câte zone readwrite are.
      await native().subscribeDatabase({ scope: 'private' });
      await setCloudKitDbSubscribed('private', true);
    } catch {
      // Best-effort, ca mai sus.
    }
  }

  await flushSharePushes();
  await pullSharedChanges();
  await pullOwnedChanges();
}

async function pullSharedChanges(): Promise<void> {
  const sinceToken = await getCloudKitDbChangeToken('shared');
  const { changedZones, deletedZones, newToken } = await native().fetchDatabaseChanges({
    scope: 'shared',
    sinceToken,
  });

  for (const z of deletedZones) {
    // Zonă dispărută (owner a revocat) — păstrează datele deja copiate local,
    // doar oprește participarea (comportament neschimbat față de reconcile).
    await revokeShare(z.zoneName);
  }

  const shares = await getSharedEntities();
  const byZone = new Map(shares.filter(s => s.role === 'participant').map(s => [s.zone_name, s]));

  let anyFailed = false;
  for (const z of changedZones) {
    const share = byZone.get(z.zoneName);
    if (!share) continue; // zonă necunoscută încă — următorul reconcile o prinde
    try {
      await syncOneZone(share);
      await markZoneSyncSuccess(share.zone_name);
    } catch (e) {
      anyFailed = true;
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }

  // Tokenul DB-level avansează DOAR dacă nicio zonă din pagina asta n-a eșuat.
  // Zonele deja reușite și-au avansat tokenul PER-zonă (shared_entities.change_token)
  // — reîncercarea întregii pagini la următorul sync e ieftină pentru ele (fetch
  // incremental întoarce empty), deci nu-i nevoie de logică de „skip zonele reușite".
  if (!anyFailed) {
    await setCloudKitDbChangeToken('shared', newToken);
  }
}

/**
 * Owner: trage schimbările din PROPRIA zonă privată, doar pentru share-urile
 * readwrite (acolo unde un participant a putut scrie). Share-urile read-only
 * nu au de unde primi push-back, deci n-are rost să le tragem — economisește
 * apeluri CloudKit inutile.
 */
async function pullOwnedChanges(): Promise<void> {
  const sinceToken = await getCloudKitDbChangeToken('private');
  const { changedZones, newToken } = await native().fetchDatabaseChanges({
    scope: 'private',
    sinceToken,
  });

  const shares = await getSharedEntities();
  const byZone = new Map(
    shares.filter(s => s.role === 'owner' && s.permission === 'readwrite').map(s => [s.zone_name, s])
  );

  let anyFailed = false;
  for (const z of changedZones) {
    const share = byZone.get(z.zoneName);
    if (!share) continue; // zonă read-only sau necunoscută — n-avem ce trage acolo
    try {
      await syncOneZone(share);
      await markZoneSyncSuccess(share.zone_name);
    } catch (e) {
      anyFailed = true;
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }

  if (!anyFailed) {
    await setCloudKitDbChangeToken('private', newToken);
  }
}

async function syncOneZone(share: SharedEntity): Promise<void> {
  const scope: PushScope = share.role === 'owner' ? 'private' : 'shared';
  const sinceToken = await getZoneChangeToken(share.zone_name);
  const { records, deletedRecordNames, newToken } = await native().fetchZoneChanges({
    zoneName: share.zone_name,
    scope,
    ownerName: share.owner_name,
    sinceToken,
  });
  // Apply + token în ACEEAȘI tranzacție SQLite — crash mid-apply nu pierde
  // schimbări (tokenul avansează doar împreună cu datele).
  await db.withTransactionAsync(async () => {
    await applyFetchedRecords(share, records);
    await applyDeletions(share, deletedRecordNames);
    await setZoneChangeToken(share.zone_name, newToken);
  });
}

async function applyFetchedRecords(share: SharedEntity, records: FetchedRecord[]): Promise<void> {
  const { entity, documents } = parseFetchedRecords(records);
  if (entity && (await shouldApplyRecord(share.zone_name, entity))) {
    await applyEntityRow(share.entity_type, entity.recordName, entity.fields);
    await rememberAppliedRecord(
      share.zone_name,
      entity.recordName,
      share.entity_type,
      ENTITY_TABLE[share.entity_type] ?? 'unknown',
      entity.changeTag
    );
  }
  for (const doc of documents) {
    if (!(await shouldApplyRecord(share.zone_name, doc))) continue;
    await applyDocumentRow(share, doc);
    await rememberAppliedRecord(share.zone_name, doc.recordName, 'document', 'documents', doc.changeTag);
  }
}

/**
 * Supresie ecou (decizia 9, generalizată la orice pull, nu doar owner-pull):
 * dacă `changeTag`-ul primit e IDENTIC cu ce avem deja înregistrat pentru
 * acest record, nu-i informație nouă — fie e propriul nostru ecou (owner-ul
 * care-și trage zona proprie readwrite), fie l-am aplicat deja la un sync
 * anterior. Aplicarea lui peste o editare locală mai nouă ar fi un clobber
 * tăcut. `cloud_records` e populat atât de push (deja) cât și de pull (nou,
 * `rememberAppliedRecord`), deci verificarea funcționează pe orice cale.
 */
async function shouldApplyRecord(zoneName: string, rec: FetchedRecord): Promise<boolean> {
  const existing = await getCloudRecord(zoneName, rec.recordName);
  return existing?.change_tag !== rec.changeTag;
}

async function rememberAppliedRecord(
  zoneName: string,
  recordName: string,
  recordType: string,
  localTable: string,
  changeTag: string
): Promise<void> {
  await upsertCloudRecord({ zoneName, recordName, recordType, localTable, localId: recordName, changeTag });
}

/**
 * Upsert NON-DESTRUCTIV pe DOAR coloanele din whitelist (`ENTITY_SYNC_FIELDS`),
 * NICIODATĂ `INSERT OR REPLACE` — coloane locale în afara whitelist-ului
 * (nimic azi pe entități, dar tiparul rămâne valabil dacă apar) supraviețuiesc.
 */
async function applyEntityRow(
  entityType: EntityType,
  recordName: string,
  fields: Record<string, string>
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  if (!table) return;
  if (!fields.name) return; // NOT NULL guard — record de sistem/payload incomplet

  const allowed = (ENTITY_SYNC_FIELDS as Partial<Record<EntityType, readonly string[]>>)[entityType] ?? [];
  const cols = allowed.filter(c => c in fields);
  const setClause =
    cols.length > 0 ? cols.map(c => `${c} = excluded.${c}`).join(', ') : 'name = excluded.name';
  const createdAt = fields.created_at ?? new Date().toISOString();
  const allCols = ['id', ...cols, 'created_at'];

  await db.runAsync(
    `INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${setClause}`,
    [recordName, ...cols.map(c => fields[c]), createdAt]
  );
}

/**
 * Upsert NON-DESTRUCTIV pe documente — `custom_type_id`, `card_id`, `company_id`,
 * `auto_delete`, `ocr_text`, `file_hash`, `private_notes`, `calendar_event_id`,
 * `ai_summary` etc. rămân intacte la participant. `INSERT OR REPLACE` ar
 * null-ui aceste coloane ȘI CASCADE-șterge copiii (reminders.document_id
 * ON DELETE CASCADE) — regresie descrisă în plan, decizia 4.
 */
async function applyDocumentRow(share: SharedEntity, rec: FetchedRecord): Promise<void> {
  let mainRel: string | null = null;
  const pageRels: { order: number; rel: string }[] = [];

  for (const asset of rec.assets) {
    const rel = `shared/${share.zone_name}/${rec.recordName}_${asset.key}`;
    await ensureParentDir(rel);
    await FileSystem.copyAsync({ from: toFileUri(asset.path), to: toFileUri(rel) }).catch(() => {});
    if (asset.key === 'file_main') {
      mainRel = rel;
    } else if (asset.key.startsWith('file_page_')) {
      const order = Number(asset.key.replace('file_page_', '')) || 0;
      pageRels.push({ order, rel });
    }
  }

  const f = rec.fields;
  const createdAt = f.created_at ?? new Date().toISOString();
  await db.runAsync(
    `INSERT INTO documents (id, type, issue_date, expiry_date, note, metadata, file_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       issue_date = excluded.issue_date,
       expiry_date = excluded.expiry_date,
       note = excluded.note,
       metadata = excluded.metadata,
       file_path = excluded.file_path`,
    [
      rec.recordName,
      f.type ?? 'altul',
      f.issue_date ?? null,
      f.expiry_date ?? null,
      f.note ?? null,
      f.metadata ?? null,
      mainRel,
      createdAt,
    ]
  );

  // Pagini: replace-all scoped la acest document — `document_pages` n-are
  // copii CASCADE, deci delete+re-insert e sigur (spre deosebire de `documents`).
  await db.runAsync('DELETE FROM document_pages WHERE document_id = ?', [rec.recordName]);
  for (const page of pageRels) {
    await db.runAsync(
      `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`${rec.recordName}_p${page.order}`, rec.recordName, page.order, page.rel, new Date().toISOString()]
    );
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
     VALUES (?, ?, ?, ?)`,
    [`${rec.recordName}_shlink`, rec.recordName, share.entity_type, share.entity_id]
  );
}

/**
 * Un document poate fi legat de DOUĂ entități partajate (zone diferite) — se
 * șterge local doar când dispare din ULTIMA zonă (`getZonesForDocument`).
 */
async function applyDeletions(share: SharedEntity, deletedRecordNames: string[]): Promise<void> {
  for (const recordName of deletedRecordNames) {
    if (recordName === share.entity_id) continue; // zone-root — revocarea reală vine prin deletedZones, nu de aici

    await db.runAsync(
      'DELETE FROM document_entities WHERE document_id = ? AND entity_type = ? AND entity_id = ?',
      [recordName, share.entity_type, share.entity_id]
    );
    const stillLinked = await getZonesForDocument(recordName);
    if (stillLinked.length > 0) continue; // vizibil încă prin altă zonă partajată — păstrează local

    const doc = await db.getFirstAsync<{ file_path: string | null }>(
      'SELECT file_path FROM documents WHERE id = ?',
      [recordName]
    );
    const pages = await db.getAllAsync<{ file_path: string }>(
      'SELECT file_path FROM document_pages WHERE document_id = ?',
      [recordName]
    );
    await db.runAsync('DELETE FROM document_pages WHERE document_id = ?', [recordName]);
    await db.runAsync('DELETE FROM documents WHERE id = ?', [recordName]);
    await deleteCloudRecord(share.zone_name, recordName);
    if (doc?.file_path) {
      await FileSystem.deleteAsync(toFileUri(doc.file_path), { idempotent: true }).catch(() => {});
    }
    for (const p of pages) {
      await FileSystem.deleteAsync(toFileUri(p.file_path), { idempotent: true }).catch(() => {});
    }
  }
}

async function ensureParentDir(relativePath: string): Promise<void> {
  const abs = toFileUri(relativePath);
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────
// Diagnostics — stare per zonă vizibilă în UI (partajare.tsx).
// ─────────────────────────────────────────────────────────────────────────

export interface ShareZoneDiagnostic {
  zoneName: string;
  entityType: EntityType;
  entityId: string;
  role: SharedEntity['role'];
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

/** Peste acest prag de reîncercări, un push e „blocat" (Faza 3 dead-letter) —
 * merită atenția userului, nu doar retry tăcut la infinit. */
const STUCK_PUSH_ATTEMPT_THRESHOLD = 5;

export async function getShareDiagnostics(): Promise<{
  zones: ShareZoneDiagnostic[];
  pendingPushCount: number;
  stuckCount: number;
}> {
  const shares = await getSharedEntities();
  const pending = await getPendingSharePushes();
  return {
    zones: shares.map(s => ({
      zoneName: s.zone_name,
      entityType: s.entity_type,
      entityId: s.entity_id,
      role: s.role,
      lastSyncedAt: s.last_synced_at ?? null,
      lastSyncError: s.last_sync_error ?? null,
    })),
    pendingPushCount: pending.length,
    stuckCount: pending.filter(p => p.attempt_count >= STUCK_PUSH_ATTEMPT_THRESHOLD).length,
  };
}
