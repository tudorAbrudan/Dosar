import * as FileSystem from 'expo-file-system/legacy';

import type * as CloudKitShareModule from '@/modules/expo-cloudkit-share/src';
import type { DocumentEntityLink, EntityType } from '@/types';

import {
  MAIN_FILE_KEY,
  PAGE_FILE_KEY,
  PAGE_RECORD_TYPE,
  docWithPagesToPushRecords,
  entityToPushRecord,
  pageRecordName,
  pageRecordPrefix,
  parseFetchedRecords,
} from './cloudShareMapping';
import type { FetchedRecord, PushRecord } from './cloudShareMapping';
import { db } from './db';
import { getDocumentById } from './documents';
import { assignNextOrder } from './entityOrder';
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
  deleteCloudRecordsForZone,
  deleteSharePush,
  enqueueSharePush,
  getCloudRecord,
  getCloudRecordsByPrefix,
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
  ShareableDocumentRecord,
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

/**
 * Coloana legacy denormalizată din `documents` pentru un tip de entitate —
 * convenția `${entityType}_id` (sursa: `LEGACY_ENTITY_COLUMN` din
 * `services/documents.ts`). `null` pentru tipuri nepartajabile, ceea ce face
 * interpolarea în SQL sigură (cheia e validată prin `ENTITY_TABLE`).
 */
function legacyColumnFor(entityType: EntityType): string | null {
  return ENTITY_TABLE[entityType] ? `${entityType}_id` : null;
}

export type LocalTable =
  | 'persons'
  | 'properties'
  | 'vehicles'
  | 'animals'
  | 'companies'
  | 'documents';

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
    ...bundle.documents.flatMap(doc => docWithPagesToPushRecords(doc, rel => toFileUri(rel))),
  ];
  const { succeeded, failed } = await native().pushRecords({
    zoneName,
    scope: 'private',
    records,
    deletions: [],
  });

  // Eșecurile PER-RECORD nu mai sunt tăcute. `pushRecords` raportează fiecare
  // record separat (schema CloudKit nepublicată în Production, quota iCloud
  // plină, fișier lipsă) — ignorând `failed`, owner-ul vedea „partajat" cu bifă
  // verde, iar participantul primea o zonă GOALĂ, fără nicio eroare nicăieri
  // (regresia raportată 2026-07-30). Entitatea-rădăcină lipsă = share inutil →
  // aruncă ÎNAINTE de a prezenta invitația, ca userul să nu trimită un link mort.
  const entityError = failed[bundle.entityRecordName];
  if (entityError) {
    throw new Error(`Entitatea nu s-a putut urca în iCloud: ${entityError}`);
  }
  // Un document e „picat" dacă a eșuat recordul lui SAU oricare pagină a lui —
  // altfel participantul ar primi un document cu pagini lipsă, fără să afle.
  const failedDocs = bundle.documents.filter(
    d => failed[d.recordName] || d.pages.some(p => failed[pageRecordName(d.recordName, p.id)])
  );
  const firstFailure = (doc: (typeof bundle.documents)[number]): string =>
    failed[doc.recordName] ??
    doc.pages.map(p => failed[pageRecordName(doc.recordName, p.id)]).find(Boolean) ??
    'eroare necunoscută';

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
    // Bookkeeping doar pentru ce EXISTĂ pe server — per record, nu per document:
    // o pagină picată nu trebuie să șteargă evidența documentului urcat corect.
    if (!failed[doc.recordName]) {
      await upsertCloudRecord({
        zoneName,
        recordName: doc.recordName,
        recordType: 'document',
        localTable: 'documents',
        localId: doc.recordName,
        changeTag: succeeded[doc.recordName],
      });
      // Hash bookkeeping pentru push-urile incrementale viitoare (skip CKAsset la
      // fișier neschimbat) — vezi shareableDocToPushRecord (cloudShareMapping.ts).
      const fullDoc = await getDocumentById(doc.recordName);
      if (fullDoc?.file_hash)
        await setCloudRecordFileHash(zoneName, doc.recordName, fullDoc.file_hash);
    }
    await rememberPushedPages(zoneName, doc, succeeded, failed);
  }

  await recordShare({
    entityType,
    entityId,
    zoneName,
    role: 'owner',
    shareUrl: shareURL,
    permission,
    shareTitle: bundle.entityFields.name,
  });

  // Documente picate: share-ul e valid (entitatea a urcat), dar incomplet. Le
  // pune în coada de retry (vizibile în UI ca „modificări în așteptare") ȘI
  // marchează eroarea pe zonă, ca userul să vadă DE CE lipsesc, în loc să
  // descopere de la celălalt telefon că entitatea a ajuns goală.
  if (failedDocs.length > 0) {
    for (const doc of failedDocs) {
      await enqueueSharePush({
        zoneName,
        recordName: doc.recordName,
        op: 'upsert',
        scope: 'private',
        kind: 'document',
      });
    }
    await markZoneSyncError(
      zoneName,
      `${failedDocs.length} ${failedDocs.length === 1 ? 'document' : 'documente'} nu s-au urcat: ${firstFailure(failedDocs[0])}`
    );
  }
  return shareURL;
}

/**
 * Înregistrează în `cloud_records` paginile urcate cu succes ale unui document.
 * Evidența e per pagină fiindcă de ea depinde ștergerea de pe server a paginilor
 * eliminate ulterior local (vezi `pageDeletionsFor`).
 */
async function rememberPushedPages(
  zoneName: string,
  doc: ShareableDocumentRecord,
  succeeded: Record<string, string>,
  failed: Record<string, string>
): Promise<void> {
  for (const page of doc.pages) {
    const recordName = pageRecordName(doc.recordName, page.id);
    if (failed[recordName]) continue;
    await upsertCloudRecord({
      zoneName,
      recordName,
      recordType: PAGE_RECORD_TYPE,
      localTable: 'document_pages',
      localId: page.id,
      changeTag: succeeded[recordName],
    });
  }
}

/**
 * Paginile prezente pe server pentru un document, dar absente din setul local
 * curent → trebuie șterse din zonă. Fără asta, o pagină eliminată local (sau
 * reordonarea, care recreează rândurile cu id-uri noi) ar lăsa recorduri orfane
 * care reapar la participant.
 */
async function pageDeletionsFor(
  zoneName: string,
  documentRecordName: string,
  desiredRecordNames: Set<string>
): Promise<string[]> {
  const known = await getCloudRecordsByPrefix(zoneName, pageRecordPrefix(documentRecordName));
  return known.map(r => r.record_name).filter(name => !desiredRecordNames.has(name));
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

/**
 * Participant: renunță la propriul acces (owner-ul și ceilalți participanți
 * nu sunt afectați — vezi `leaveShare` nativ). No-op dacă nu ești participant
 * pe entitatea respectivă (ex. eroare de UI care ar chema asta pe o entitate
 * proprie).
 */
export async function leaveEntityShare(entityType: EntityType, entityId: string): Promise<void> {
  const share = await getShareForEntity(entityType, entityId);
  if (!share || share.role !== 'participant') return;
  try {
    await native().leaveShare({ zoneName: share.zone_name, ownerName: share.owner_name });
  } catch (e) {
    // Zona/share-ul poate fi deja dispărut (owner a revocat între timp) —
    // scopul e local, nu rămânem blocați cu un rând agățat.
    if (!isZoneGoneError(e)) throw e;
  }
  await revokeShare(share.zone_name);
  await deleteCloudRecordsForZone(share.zone_name);
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
  if (/quota|storage.*full|exceeded.*storage/i.test(msg)) {
    return 'Spațiul iCloud e plin — documentele nu se pot urca. Eliberează spațiu în iCloud și reîncearcă.';
  }
  if (isZoneGoneError(e)) {
    return 'Zona partajată nu mai există pe server.';
  }
  // Mesajul brut CloudKit rămâne vizibil: funcția e în Beta și un „Reîncearcă"
  // fără cauză a costat deja o rundă de debugging pe două telefoane.
  return `Partajarea nu a reușit: ${msg}`;
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
/**
 * Fallback manual: participantul lipește URL-ul share-ului primit (WhatsApp
 * etc.) în loc să se bazeze pe handler-ul de sistem
 * (`windowScene(_:userDidAcceptCloudKitShareWith:)` — verificat pe device
 * 2026-07-29 că nu se apelează deloc pe iOS 26.5.2, deși iOS confirmă
 * acceptarea la nivel de sistem). Acceptă direct via `acceptShareURL`, apoi
 * rulează sincronizarea completă ca să tragă entitatea imediat.
 */
export async function acceptShareByURL(url: string): Promise<void> {
  const accepted = await native().acceptShareURL(url);
  // Înregistrează imediat share-ul cu numele din metadata acceptării (deja
  // disponibil, fără fetch suplimentar) — `syncSharedEntities` mai jos ar
  // re-descoperi zona oricum prin `reconcileParticipantShares`, dar fără nume
  // (acela cere un fetch separat pe care doar acest punct îl are gratis).
  const parsed = parseZoneName(accepted.zoneName);
  if (parsed) {
    const share = await recordShare({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      zoneName: accepted.zoneName,
      role: 'participant',
      ownerName: accepted.ownerName,
      ownerDisplayName: accepted.ownerDisplayName,
      shareTitle: accepted.title,
      permission: accepted.permission,
    });
    queueReceivedNotice(parsed.entityType, parsed.entityId, accepted.title);
    // Trage ȚINTIT zona tocmai acceptată, fără să depindă de fereastra tokenului
    // DB-level și fără să aștepte un sync general care poate fi deja în curs
    // (trecut de faza de reconcile) — userul se așteaptă să vadă entitatea
    // imediat după „Acceptă".
    try {
      await syncOneZone(share);
      await markZoneSyncSuccess(share.zone_name);
    } catch (e) {
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }
  await syncSharedEntities();
}

/**
 * Un share nou intrat pe device în sincronizarea curentă. Coada e drenată de
 * `useSharingSync` DUPĂ pull, ca să anunțe userul și să-l ducă la entitate —
 * altfel tap-ul pe link deschide aplicația și nu se întâmplă nimic vizibil
 * (reclamat 2026-07-30: „a deschis Dosar… nu m-a dus nicăieri").
 */
export interface ReceivedShareNotice {
  entityType: EntityType;
  entityId: string;
  /** Titlul share-ului (numele entității la owner), dacă e cunoscut. */
  title?: string;
  /** true = rândul entității există deja local, deci navigarea are ce afișa. */
  arrived: boolean;
}

const receivedNotices: { entityType: EntityType; entityId: string; title?: string }[] = [];

function queueReceivedNotice(entityType: EntityType, entityId: string, title?: string): void {
  if (receivedNotices.some(n => n.entityType === entityType && n.entityId === entityId)) return;
  receivedNotices.push({ entityType, entityId, title });
}

/** Golește coada, completând pentru fiecare notice dacă entitatea a ajuns local. */
export async function takeReceivedShareNotices(): Promise<ReceivedShareNotice[]> {
  const drained = receivedNotices.splice(0, receivedNotices.length);
  const out: ReceivedShareNotice[] = [];
  for (const n of drained) {
    const table = ENTITY_TABLE[n.entityType];
    const row = table
      ? await db.getFirstAsync<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, [
          n.entityId,
        ])
      : null;
    out.push({ ...n, title: row?.name ?? n.title, arrived: !!row });
  }
  return out;
}

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
    // Best-effort: `listSharedZones` întoarce doar identificatori opaci — fetch
    // separat pe CKShare-ul zonei pentru numele owner-ului, titlul (= numele
    // entității) și permisiunea mea reală. Dacă eșuează (offline, share dispărut
    // între timp), rândul se creează oricum, iar un reconcile ulterior completează.
    let info: { ownerDisplayName?: string; title?: string; permission?: SharePermission } = {};
    try {
      info = await native().fetchShareInfo({
        zoneName: zone.zoneName,
        ownerName: zone.ownerName,
      });
    } catch {
      // silent — UI cade pe fallback („partajat de cineva" + eticheta de tip)
    }
    await recordShare({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      zoneName: zone.zoneName,
      role: 'participant',
      ownerName: zone.ownerName,
      ownerDisplayName: info.ownerDisplayName,
      shareTitle: info.title,
      permission: info.permission,
    });
    queueReceivedNotice(parsed.entityType, parsed.entityId, info.title);
  }

  // Zone deja cunoscute, dar cu metadate incomplete (rândul a fost creat de un
  // reconcile offline sau de un build vechi): completează titlul/permisiunea la
  // următoarea trecere. Fără asta, un share „Poate edita" rămâne pe veci
  // read-only local, iar rândul rămâne fără numele entității.
  for (const share of active) {
    if (share.role !== 'participant') continue;
    // Titlul e reper: îl setăm mereu la partajare, deci absența lui = rând
    // incomplet. `owner_display_name` poate lipsi legitim pentru totdeauna
    // (owner nedescoperibil) — a-l folosi drept condiție ar însemna un fetch
    // de rețea la FIECARE sincronizare, degeaba.
    if (share.share_title) continue;
    if (!liveZoneNames.has(share.zone_name)) continue;
    try {
      const info = await native().fetchShareInfo({
        zoneName: share.zone_name,
        ownerName: share.owner_name,
      });
      if (info.ownerDisplayName || info.title || info.permission) {
        await recordShare({
          entityType: share.entity_type,
          entityId: share.entity_id,
          zoneName: share.zone_name,
          role: 'participant',
          ownerName: share.owner_name,
          ownerDisplayName: info.ownerDisplayName,
          shareTitle: info.title,
          permission: info.permission,
        });
      }
    } catch {
      // best-effort, ca mai sus
    }
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
    const key = `${row.zone_name}\u0000${row.scope}\u0000${row.owner_name ?? ''}`;
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
  // Rând din coadă → recordurile de pagină trimise pentru el. Un document e
  // „reușit" doar dacă au reușit ȘI paginile lui; altfel rândul rămâne în coadă.
  const pageRecordsByRow = new Map<number, string[]>();

  for (const row of rows) {
    if (row.op === 'delete') {
      deletions.push(row.record_name);
      if (row.kind === 'document') {
        // Paginile sunt recorduri separate: fără ștergerea lor explicită ar
        // rămâne orfane în zonă după ștergerea documentului.
        const pages = await getCloudRecordsByPrefix(zoneName, pageRecordPrefix(row.record_name));
        const pageNames = pages.map(p => p.record_name);
        deletions.push(...pageNames);
        pageRecordsByRow.set(row.id, pageNames);
      }
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
        if (wasSynced) {
          deletions.push(row.record_name);
          const pages = await getCloudRecordsByPrefix(zoneName, pageRecordPrefix(row.record_name));
          deletions.push(...pages.map(p => p.record_name));
          pageRecordsByRow.set(
            row.id,
            pages.map(p => p.record_name)
          );
        } else skipIds.push(row.id);
        continue;
      }
      const existing = await getCloudRecord(zoneName, row.record_name);
      const mainUnchanged = !!doc!.file_hash && doc!.file_hash === existing?.file_hash;
      const docRecords = docWithPagesToPushRecords(shareable, rel => toFileUri(rel), mainUnchanged);
      records.push(...docRecords);
      const pageNames = docRecords.slice(1).map(r => r.recordName);
      pageRecordsByRow.set(row.id, pageNames);
      // Pagini rămase pe server dar eliminate local (ștergere de pagină sau
      // reordonare, care recreează rândurile cu id-uri noi) → tombstone.
      deletions.push(...(await pageDeletionsFor(zoneName, row.record_name, new Set(pageNames))));
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
    // Ștergerile de pagini care nu aparțin niciunui rând din coadă (orfane
    // detectate la push) — curăță evidența locală după succes pe server.
    for (const name of deletions) {
      if (!failed[name] && name.includes('__p__')) await deleteCloudRecord(zoneName, name);
    }

    for (const row of rows) {
      if (skipIds.includes(row.id)) continue;
      const pageNames = pageRecordsByRow.get(row.id) ?? [];
      const errorMsg = failed[row.record_name] ?? pageNames.map(n => failed[n]).find(Boolean);
      if (errorMsg) {
        await bumpSharePushAttempt(row.id, errorMsg);
        continue;
      }
      await deleteSharePush(row.id);
      if (row.op === 'delete') {
        await deleteCloudRecord(zoneName, row.record_name);
        continue;
      }
      for (const name of pageNames) {
        const pageTag = succeeded[name];
        if (!pageTag) continue;
        await upsertCloudRecord({
          zoneName,
          recordName: name,
          recordType: PAGE_RECORD_TYPE,
          localTable: 'document_pages',
          localId: name.slice(name.indexOf('__p__') + '__p__'.length),
          changeTag: pageTag,
        });
      }
      const changeTag = succeeded[row.record_name];
      if (!changeTag) continue;
      const entityType = row.kind === 'entity' ? parseZoneName(zoneName)?.entityType : undefined;
      await upsertCloudRecord({
        zoneName,
        recordName: row.record_name,
        recordType: row.kind === 'entity' ? (entityType ?? 'entity') : 'document',
        localTable:
          row.kind === 'entity' ? (entityType ? ENTITY_TABLE[entityType] : 'unknown') : 'documents',
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
let syncInFlight: Promise<void> | null = null;

/**
 * Serializează sincronizările. `useSharingSync` (mount + AppState → active +
 * silent push) și ecranul Partajare (`useSharing`) pornesc fiecare propriul
 * sync; două rulări concurente consumă aceeași fereastră de token DB-level, iar
 * una dintre ele poate sări o zonă pe care cealaltă n-a înregistrat-o încă
 * (vezi `pullSharedChanges`). Al doilea apelant așteaptă rularea în curs.
 */
export function syncSharedEntities(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  const run = runSyncSharedEntities().finally(() => {
    if (syncInFlight === run) syncInFlight = null;
  });
  syncInFlight = run;
  return run;
}

async function runSyncSharedEntities(): Promise<void> {
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
  const participants = shares.filter(s => s.role === 'participant');
  const byZone = new Map(participants.map(s => [s.zone_name, s]));

  // Ce zone tragem: cele raportate ca schimbate + TOATE cele care n-au tras
  // niciodată nimic (fără `change_token`). Al doilea set e obligatoriu: tokenul
  // DB-level e o fereastră consumabilă, iar o zonă poate rămâne pe dinafara ei
  // (share acceptat de sistem într-o sesiune anterioară, două sync-uri
  // concurente — ecranul Partajare + `useSharingSync` — sau o zonă raportată
  // înainte de a fi înregistrată local). Fără force-fetch, zona rămâne GOALĂ pe
  // veci și fără nicio eroare: exact „apare în «Partajat cu mine», dar entitatea
  // nu apare nicăieri" (raportat 2026-07-30). Un fetch full pe o zonă fără token
  // e ieftin și se întâmplă o singură dată per zonă.
  const zonesToSync = new Map<string, SharedEntity>();
  let missedOwnZone = false;
  for (const z of changedZones) {
    const share = byZone.get(z.zoneName);
    if (!share) {
      // Zonă a APLICAȚIEI, dar încă neînregistrată local (reconcile-ul o prinde
      // la următoarea trecere) → NU avansa tokenul, altfel îi pierdem definitiv
      // notificarea. Zonele străine (nume neparsabil) nu blochează tokenul.
      if (parseZoneName(z.zoneName)) missedOwnZone = true;
      continue;
    }
    zonesToSync.set(share.zone_name, share);
  }
  for (const share of participants) {
    if (zonesToSync.has(share.zone_name)) continue;
    if (!(await getZoneChangeToken(share.zone_name))) zonesToSync.set(share.zone_name, share);
  }

  let anyFailed = false;
  for (const share of zonesToSync.values()) {
    try {
      await syncOneZone(share);
      await markZoneSyncSuccess(share.zone_name);
    } catch (e) {
      anyFailed = true;
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }

  // Tokenul DB-level avansează DOAR dacă nicio zonă din pagina asta n-a eșuat și
  // nicio zonă de-a noastră n-a fost sărită. Zonele deja reușite și-au avansat
  // tokenul PER-zonă (shared_entities.change_token) — reîncercarea întregii
  // pagini la următorul sync e ieftină pentru ele (fetch incremental întoarce
  // empty), deci nu-i nevoie de logică de „skip zonele reușite".
  if (!anyFailed && !missedOwnZone) {
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
    shares
      .filter(s => s.role === 'owner' && s.permission === 'readwrite')
      .map(s => [s.zone_name, s])
  );

  let anyFailed = false;
  for (const z of changedZones) {
    const share = byZone.get(z.zoneName);
    // Zonă read-only, revocată sau necunoscută — n-avem ce trage acolo. Nu
    // blochează avansul tokenului: zonele PROPRII sunt înregistrate local de
    // `shareEntity` înainte de orice push, deci nu există fereastră de pierdut
    // (spre deosebire de partea de participant, unde zona apare din exterior).
    if (!share) continue;
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
  const { entity, documents, pages } = parseFetchedRecords(records);
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
    await rememberAppliedRecord(
      share.zone_name,
      doc.recordName,
      'document',
      'documents',
      doc.changeTag
    );
  }
  // Paginile pot sosi înaintea documentului lor (batch-uri diferite);
  // `document_pages.document_id` n-are FK, deci ordinea nu contează.
  for (const page of pages) {
    if (!(await shouldApplyRecord(share.zone_name, page))) continue;
    await applyPageRow(share, page);
    await rememberAppliedRecord(
      share.zone_name,
      page.recordName,
      PAGE_RECORD_TYPE,
      'document_pages',
      page.changeTag
    );
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
  await upsertCloudRecord({
    zoneName,
    recordName,
    recordType,
    localTable,
    localId: recordName,
    changeTag,
  });
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

  const allowed =
    (ENTITY_SYNC_FIELDS as Partial<Record<EntityType, readonly string[]>>)[entityType] ?? [];
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

  // Ordinea globală din lista Entități: fără un rând în `entity_order`, entitatea
  // primită se duce DUPĂ toate entitățile proprii (vezi sortarea din
  // `app/(tabs)/entitati/index.tsx`) — invizibilă în practică la o listă lungă.
  // `assignNextOrder` o pune în TOP, la fel ca o entitate nou creată local.
  const hasOrder = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM entity_order WHERE entity_type = ? AND entity_id = ?',
    [entityType, recordName]
  );
  if (!hasOrder?.cnt) await assignNextOrder(entityType, recordName);
}

/**
 * Upsert NON-DESTRUCTIV pe documente — `custom_type_id`, `card_id`, `company_id`,
 * `auto_delete`, `ocr_text`, `file_hash`, `private_notes`, `calendar_event_id`,
 * `ai_summary` etc. rămân intacte la participant. `INSERT OR REPLACE` ar
 * null-ui aceste coloane ȘI CASCADE-șterge copiii (reminders.document_id
 * ON DELETE CASCADE) — regresie descrisă în plan, decizia 4.
 */
async function applyDocumentRow(share: SharedEntity, rec: FetchedRecord): Promise<void> {
  const mainAsset = rec.assets.find(a => a.key === MAIN_FILE_KEY);
  const mainRel = mainAsset ? await copyAssetLocally(share, rec.recordName, mainAsset) : null;

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

  await db.runAsync(
    `INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
     VALUES (?, ?, ?, ?)`,
    [`${rec.recordName}_shlink`, rec.recordName, share.entity_type, share.entity_id]
  );

  // Denormalizarea legacy `documents.<tip>_id` — aceeași convenție ca
  // `addEntityLinkToDocument` (prima entitate de acel tip). Restul aplicației
  // (query-uri de vehicul, expirări, export PDF) citește încă aceste coloane;
  // fără ele, un document primit rămâne invizibil pe fluxurile respective.
  const legacyCol = legacyColumnFor(share.entity_type);
  if (legacyCol) {
    await db.runAsync(
      `UPDATE documents SET ${legacyCol} = ? WHERE id = ? AND ${legacyCol} IS NULL`,
      [share.entity_id, rec.recordName]
    );
  }
}

/** Copiază un CKAsset descărcat (tmp) în DocumentsDirectory; întoarce calea relativă. */
async function copyAssetLocally(
  share: SharedEntity,
  recordName: string,
  asset: { key: string; path: string }
): Promise<string> {
  const rel = `shared/${share.zone_name}/${recordName}_${asset.key}`;
  await ensureParentDir(rel);
  await FileSystem.copyAsync({ from: toFileUri(asset.path), to: toFileUri(rel) }).catch(() => {});
  return rel;
}

/**
 * O pagină primită → rând în `document_pages`. Upsert pe id (numele recordului),
 * nu delete-all-and-reinsert ca înainte: paginile sunt acum recorduri
 * independente, care pot sosi câte una, în orice ordine, fără documentul lor.
 */
async function applyPageRow(share: SharedEntity, rec: FetchedRecord): Promise<void> {
  const documentId = rec.fields.document_id;
  if (!documentId) return; // payload incomplet — nu inventăm o pagină orfană
  const asset = rec.assets.find(a => a.key === PAGE_FILE_KEY);
  if (!asset) return; // pagină fără fișier n-are ce afișa (file_path e NOT NULL)

  const rel = await copyAssetLocally(share, rec.recordName, asset);
  const order = Number(rec.fields.page_order ?? '0') || 0;
  await db.runAsync(
    `INSERT INTO document_pages (id, document_id, page_order, file_path, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       document_id = excluded.document_id,
       page_order = excluded.page_order,
       file_path = excluded.file_path`,
    [rec.recordName, documentId, order, rel, new Date().toISOString()]
  );
}

/**
 * Un document poate fi legat de DOUĂ entități partajate (zone diferite) — se
 * șterge local doar când dispare din ULTIMA zonă (`getZonesForDocument`).
 */
async function applyDeletions(share: SharedEntity, deletedRecordNames: string[]): Promise<void> {
  for (const recordName of deletedRecordNames) {
    if (recordName === share.entity_id) continue; // zone-root — revocarea reală vine prin deletedZones, nu de aici

    // Pagină ștearsă la owner (eliminare de pagină sau reordonare): dispare
    // singură, fără să atingă documentul-părinte.
    if (recordName.includes('__p__')) {
      const page = await db.getFirstAsync<{ file_path: string }>(
        'SELECT file_path FROM document_pages WHERE id = ?',
        [recordName]
      );
      await db.runAsync('DELETE FROM document_pages WHERE id = ?', [recordName]);
      await deleteCloudRecord(share.zone_name, recordName);
      if (page?.file_path) {
        await FileSystem.deleteAsync(toFileUri(page.file_path), { idempotent: true }).catch(
          () => {}
        );
      }
      continue;
    }

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
