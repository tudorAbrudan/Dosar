/**
 * Închiderea partajărilor: owner-ul închide o zonă golită după „Șterge și la ei",
 * participantul curăță copia și iese din partajare după ce vede mesajul.
 * Extras din `cloudShare.ts` (fișier mare); orchestrarea sync-ului rămâne acolo.
 * Spec: ../docs/superpowers/specs/2026-10-15-delete-shared-entity-design.md
 */
import { isZoneGoneError, native } from './cloudKitNative';
import {
  deleteSharePushesForZone,
  getOwnerDeletedShares,
  markOwnerDeletionSeen,
  purgeOwnerDeletedEntity,
} from './shareDeletion';
import { deleteCloudRecordsForZone, markZoneSyncError, revokeShare, selectShares } from './sharing';
import type { SharedEntity } from './sharing';

export const SHARE_TEARDOWN_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const OWNER_TEARDOWN_SQL =
  "role = 'owner' AND delete_requested_at IS NOT NULL AND revoked_at IS NULL";

/** Owner: partajările golite după „Șterge și la ei", încă neînchise. */
export function getShareTeardowns(): Promise<SharedEntity[]> {
  return selectShares(OWNER_TEARDOWN_SQL);
}

export async function getShareTeardown(zoneName: string): Promise<SharedEntity | null> {
  const [share] = await selectShares(`zone_name = ? AND ${OWNER_TEARDOWN_SQL}`, [zoneName]);
  return share ?? null;
}

/** Când se închide zona: la SHARE_TEARDOWN_GRACE_DAYS de la confirmarea ștergerii pe server. */
export function teardownClosesAt(share: SharedEntity): Date | null {
  if (!share.delete_sent_at) return null;
  return new Date(new Date(share.delete_sent_at).getTime() + SHARE_TEARDOWN_GRACE_DAYS * DAY_MS);
}

/**
 * Owner: închide o partajare golită — șterge zona cu tot ce a rămas în ea. Cine n-a
 * sincronizat până acum își păstrează copia (vede doar că zona a dispărut).
 */
export async function closeShareTeardown(zoneName: string): Promise<void> {
  try {
    await native().deleteZone(zoneName);
  } catch (e) {
    if (!isZoneGoneError(e)) throw e;
  }
  await deleteSharePushesForZone(zoneName);
  await deleteCloudRecordsForZone(zoneName);
  await revokeShare(zoneName);
}

export async function closeExpiredTeardowns(): Promise<void> {
  for (const share of await getShareTeardowns()) {
    const closesAt = teardownClosesAt(share);
    if (!closesAt || closesAt.getTime() > Date.now()) continue;
    try {
      await closeShareTeardown(share.zone_name);
    } catch (e) {
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }
}

/** Participant: renunță la propriul acces (owner-ul și ceilalți participanți nu sunt afectați). */
export async function leaveZone(share: SharedEntity): Promise<void> {
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

/**
 * Participant: curăță copia entităților șterse de owner (reluat până vede userul
 * mesajul — o restaurare între timp le-ar readuce) și iese din partajările ale
 * căror mesaje au fost văzute (reluat până reușește).
 */
export async function processOwnerDeletions(): Promise<void> {
  for (const share of await getOwnerDeletedShares()) {
    try {
      if (!share.owner_deleted_seen_at) await purgeOwnerDeletedEntity(share);
      else await leaveZone(share);
    } catch (e) {
      console.warn('[cloudShare] ștergere owner neaplicată:', e instanceof Error ? e.message : e);
    }
  }
}

/** Participant: userul a văzut mesajul despre ștergere → iese din partajare. */
export async function acknowledgeOwnerDeletion(zoneName: string): Promise<void> {
  await markOwnerDeletionSeen(zoneName);
  const share = (await getOwnerDeletedShares()).find(s => s.zone_name === zoneName);
  if (!share) return;
  await leaveZone(share).catch(() => {
    // Offline: `processOwnerDeletions` reîncearcă la următorul sync.
  });
}
