import * as FileSystem from 'expo-file-system/legacy';

import type * as CloudKitShareModule from '@/modules/expo-cloudkit-share/src';
import type { EntityType } from '@/types';

import { bundleToPushBundle, parseFetchedRecords } from './cloudShareMapping';
import type { FetchedRecord } from './cloudShareMapping';
import { db } from './db';
import { toFileUri } from './fileUtils';
import {
  getShareBundle,
  getSharedEntities,
  getShareForEntity,
  parseZoneName,
  recordShare,
  revokeShare,
  upsertCloudRecord,
  zoneNameFor,
} from './sharing';
import type { SharedEntity } from './sharing';

/**
 * Orchestrarea partajării CloudKit: owner push + participant pull + revocare.
 *
 * ⚠️ UNVERIFIED on-device: fluxul CloudKit efectiv (accept share + sync între
 * două conturi iCloud) NU poate fi testat fără al doilea cont/telefon. Logica
 * pură de mapare e izolată în `cloudShareMapping.ts` (testată). Validare reală
 * = TestFlight pe două telefoane. Vezi spec 2026-07-22.
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

// Nume de coloană acceptate la aplicarea unui record primit (defense: field-urile
// vin din CloudKit, deci nu construim SQL cu nume arbitrare).
const COLUMN_RE = /^[a-z_]+$/;

export async function isCloudKitAvailable(): Promise<boolean> {
  try {
    const { available } = await native().isAvailable();
    return available;
  } catch {
    return false;
  }
}

/** Owner: partajează o entitate — creează zona, urcă bundle-ul, prezintă invitația. */
export async function shareEntity(entityType: EntityType, entityId: string): Promise<string> {
  // getShareBundle aruncă dacă entitatea nu e partajabilă + garantează no-leak.
  const bundle = await getShareBundle(entityType, entityId);
  const zoneName = zoneNameFor(entityType, entityId);

  await native().createSharedZone(zoneName);

  const push = bundleToPushBundle(bundle, zoneName, rel => toFileUri(rel));
  const { changeTags } = await native().pushBundle(push);

  // Prezintă invitația ÎNAINTE de a persista starea locală. Dacă CloudKit refuză
  // share-ul (ex: schema neplublicată în Production → „Cannot create new type
  // cloudkit.share in production schema"), aruncă aici și NU rămânem cu rânduri
  // orfane în shared_entities/cloud_records care ar arăta „Revocă" degeaba.
  const { shareURL } = await native().shareZone({
    zoneName,
    title: bundle.entityFields.name ?? 'Entitate Dosar',
  });

  await upsertCloudRecord({
    zoneName,
    recordName: bundle.entityRecordName,
    recordType: entityType,
    localTable: entityType,
    localId: entityId,
    changeTag: changeTags[bundle.entityRecordName],
  });
  for (const doc of bundle.documents) {
    await upsertCloudRecord({
      zoneName,
      recordName: doc.recordName,
      recordType: 'document',
      localTable: 'documents',
      localId: doc.recordName,
      changeTag: changeTags[doc.recordName],
    });
  }

  await recordShare({ entityType, entityId, zoneName, role: 'owner', shareUrl: shareURL });
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

/**
 * Pull zonele partajate și aplică local. MVP one-directional: doar
 * PARTICIPANȚII trag date. Owner-ul e sursa locală de adevăr — nu-și re-aplică
 * propria zonă (ar re-descărca fișierele și ar risca clobber prin INSERT OR
 * REPLACE peste rândul lui local). Sync participant→owner (bidirecțional) =
 * enhancement viitor, cere merge/conflict handling.
 */
export async function syncSharedEntities(): Promise<void> {
  // Fără cont iCloud (simulator, delogat) → no-op liniștit, fără a arunca eroare
  // în UI. Altfel `listSharedZones`/`fetchZoneChanges` ar arunca la fiecare mount.
  if (!(await isCloudKitAvailable())) return;

  // Întâi înregistrează zonele nou-acceptate, apoi trage-le.
  await reconcileParticipantShares();

  const shares = await getSharedEntities();
  for (const share of shares) {
    if (share.role === 'owner') continue;
    const { records } = await native().fetchZoneChanges({
      zoneName: share.zone_name,
      scope: 'shared',
      ownerName: share.owner_name,
    });
    await applyFetchedRecords(share, records);
  }
}

async function applyFetchedRecords(share: SharedEntity, records: FetchedRecord[]): Promise<void> {
  const { entity, documents } = parseFetchedRecords(records);
  if (entity) await upsertEntityRow(share.entity_type, entity.recordName, entity.fields);
  for (const doc of documents) await upsertDocumentRow(share, doc);
}

async function upsertEntityRow(
  entityType: EntityType,
  recordName: string,
  fields: Record<string, string>
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  if (!table) return;
  // Toate tabelele de entitate au `name` NOT NULL. Fără el în payload, nu inserăm
  // (record de sistem sau payload incomplet) — altfel SQLite aruncă cod 19.
  if (!fields.name) return;
  const cols = ['id', ...Object.keys(fields).filter(c => COLUMN_RE.test(c) && c !== 'id')];
  const values = cols.map(c => (c === 'id' ? recordName : fields[c]));
  const placeholders = cols.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    values
  );
}

async function upsertDocumentRow(share: SharedEntity, rec: FetchedRecord): Promise<void> {
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
  await db.runAsync(
    `INSERT OR REPLACE INTO documents
       (id, type, issue_date, expiry_date, note, file_path, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec.recordName,
      f.type ?? 'altul',
      f.issue_date ?? null,
      f.expiry_date ?? null,
      f.note ?? null,
      mainRel,
      f.metadata ?? null,
      f.created_at ?? new Date().toISOString(),
    ]
  );

  for (const page of pageRels) {
    await db.runAsync(
      `INSERT OR REPLACE INTO document_pages (id, document_id, page_order, file_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        `${rec.recordName}_p${page.order}`,
        rec.recordName,
        page.order,
        page.rel,
        new Date().toISOString(),
      ]
    );
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO document_entities (id, document_id, entity_type, entity_id)
     VALUES (?, ?, ?, ?)`,
    [`${rec.recordName}_shlink`, rec.recordName, share.entity_type, share.entity_id]
  );
}

async function ensureParentDir(relativePath: string): Promise<void> {
  const abs = toFileUri(relativePath);
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
}
