/**
 * Închiderea partajărilor proprii cu confirmare de la participanți și ieșirea
 * participantului. Extras din `cloudShare.ts` (fișier mare); orchestrarea sync-ului
 * rămâne acolo.
 * Spec: ../docs/superpowers/specs/2026-10-15-share-close-confirmations-design.md
 *
 * Owner: după „Șterge și la ei" (zona golită) sau „Revocă" (semnal pe rădăcină),
 * partajarea rămâne deschisă până ies toți participanții care o aveau când semnalul
 * a ajuns pe server, cel mult SHARE_CLOSE_GRACE_DAYS zile, apoi zona se șterge.
 * Participant: OK pe mesaj = ieșire din partajare = confirmarea văzută de owner.
 */
import type { ShareParticipant } from '@/modules/expo-cloudkit-share/src';
import { isZoneGoneError, native } from './cloudKitNative';
import { stopSignalRecord } from './cloudShareMapping';
import { emit } from './events';
import { db } from './db';
import {
  deleteSharePushesForZone,
  getOwnerDeletedShares,
  markOwnerDeletionSeen,
  purgeOwnerDeletedEntity,
} from './shareDeletion';
import { deleteCloudRecordsForZone, markZoneSyncError, revokeShare, selectShares } from './sharing';
import type { SharedEntity } from './sharing';

export const SHARE_CLOSE_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Un participant care trebuie să confirme închiderea (instantaneu la owner). */
export interface ClosingParticipant {
  /** `userRecordID` — null dacă CloudKit nu l-a dat; atunci nu se poate confirma. */
  id: string | null;
  name: string | null;
  confirmedAt: string | null;
}

export type ShareCloseKind = 'delete' | 'stop';

const OWNER_CLOSING_SQL =
  "role = 'owner' AND revoked_at IS NULL" +
  ' AND (delete_requested_at IS NOT NULL OR stop_requested_at IS NOT NULL)';

/** Owner: partajările șterse „și la ei" sau oprite, încă neînchise. */
export function getClosingShares(): Promise<SharedEntity[]> {
  return selectShares(OWNER_CLOSING_SQL);
}

export async function getClosingShare(zoneName: string): Promise<SharedEntity | null> {
  const [share] = await selectShares(`zone_name = ? AND ${OWNER_CLOSING_SQL}`, [zoneName]);
  return share ?? null;
}

export function shareCloseKind(share: SharedEntity): ShareCloseKind {
  return share.delete_requested_at ? 'delete' : 'stop';
}

/** Semnalul (ștergerea rădăcinii sau `share_state`) a ajuns pe server. */
export function closeSignalSentAt(share: SharedEntity): string | null {
  return share.delete_sent_at ?? share.stop_sent_at ?? null;
}

/** Cel mai târziu când se închide zona: la SHARE_CLOSE_GRACE_DAYS de la semnal. */
export function shareClosesAt(share: SharedEntity): Date | null {
  const sentAt = closeSignalSentAt(share);
  if (!sentAt) return null;
  return new Date(new Date(sentAt).getTime() + SHARE_CLOSE_GRACE_DAYS * DAY_MS);
}

/** Instantaneul participanților; null până la prima citire reușită. */
export function getClosingParticipants(share: SharedEntity): ClosingParticipant[] | null {
  if (!share.closing_participants) return null;
  try {
    const parsed: unknown = JSON.parse(share.closing_participants);
    return Array.isArray(parsed) ? (parsed as ClosingParticipant[]) : null;
  } catch {
    return null;
  }
}

/**
 * Instantaneul precedent + lista curentă din CloudKit → instantaneul actualizat.
 * Prima citire îi reține pe participanții acceptați atunci; cine apare după nu mai
 * contează (linkul public nu se poate închide fără să-i scoată pe toți). Confirmat =
 * lipsește din listă sau are `removed` (docs Apple nu spun care dintre ele). O
 * confirmare nu se mai retrage.
 */
export function updateClosingParticipants(
  previous: ClosingParticipant[] | null,
  current: ShareParticipant[],
  now: string
): ClosingParticipant[] {
  if (!previous) {
    return current
      .filter(p => p.status === 'accepted')
      .map(p => ({ id: p.id ?? null, name: p.name ?? null, confirmedAt: null }));
  }
  const live = new Map(current.filter(p => p.id).map(p => [p.id as string, p]));
  return previous.map(p => {
    if (p.confirmedAt || !p.id) return p;
    const found = live.get(p.id);
    const left = !found || found.status === 'removed';
    return { ...p, name: found?.name ?? p.name, confirmedAt: left ? now : null };
  });
}

export function everyoneConfirmed(participants: ClosingParticipant[]): boolean {
  return participants.every(p => !!p.confirmedAt);
}

async function saveClosingParticipants(
  share: SharedEntity,
  participants: ClosingParticipant[]
): Promise<void> {
  const json = JSON.stringify(participants);
  if (json === share.closing_participants) return;
  await db.runAsync('UPDATE shared_entities SET closing_participants = ? WHERE zone_name = ?', [
    json,
    share.zone_name,
  ]);
  emit('sharing:changed');
}

function isShareMissingError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('share-missing');
}

/**
 * Owner: închide o partajare — șterge zona cu tot ce a rămas în ea (CKShare,
 * recorduri). Cine n-a sincronizat până acum își păstrează copia (vede doar că
 * zona a dispărut).
 */
export async function closeShareZone(zoneName: string): Promise<void> {
  try {
    await native().deleteZone(zoneName);
  } catch (e) {
    if (!isZoneGoneError(e)) throw e;
  }
  await deleteSharePushesForZone(zoneName);
  await deleteCloudRecordsForZone(zoneName);
  await revokeShare(zoneName);
}

/**
 * Owner, „Revocă" sau ștergerea locală a entității („Șterge doar la mine"): partajarea
 * nu mai e activă (nimic nu mai pleacă spre zonă), iar semnalul de oprire pleacă la
 * `sendStopSignals`. Ce era în coadă pentru zonă se abandonează.
 */
export async function requestShareStop(zoneName: string): Promise<void> {
  await db.runAsync(
    `UPDATE shared_entities SET stop_requested_at = COALESCE(stop_requested_at, ?)
     WHERE zone_name = ? AND role = 'owner'`,
    [new Date().toISOString(), zoneName]
  );
  await deleteSharePushesForZone(zoneName);
  emit('sharing:changed');
}

async function markShareStopSent(zoneName: string): Promise<void> {
  await db.runAsync(
    'UPDATE shared_entities SET stop_sent_at = COALESCE(stop_sent_at, ?) WHERE zone_name = ?',
    [new Date().toISOString(), zoneName]
  );
  emit('sharing:changed');
}

const STOP_UNSENT_SQL =
  "role = 'owner' AND revoked_at IS NULL AND stop_requested_at IS NOT NULL AND stop_sent_at IS NULL";

/** Semnalul nu poate pleca niciodată: rădăcina lipsește, zona lipsește sau schema din Production n-are câmpul. */
function isPermanentStopFailure(message: string): boolean {
  return (
    message === 'record-missing' ||
    isZoneGoneError(message) ||
    /production schema|cannot create/i.test(message)
  );
}

/**
 * Owner: trimite `share_state = 'stopped'` pe rădăcina fiecărei partajări oprite.
 * Doar actualizare: nativul aplică câmpul peste recordul de pe server, deci merge și
 * cu entitatea ștearsă local. Reușit → de aici curg confirmările și termenul.
 * Imposibil de trimis → închidere imediată, ca înainte de confirmări (participanții
 * păstrează copia, fără mesaj). Eroare de rețea → reîncercat la sync-ul următor.
 */
export async function sendStopSignals(): Promise<void> {
  for (const share of await selectShares(STOP_UNSENT_SQL)) {
    try {
      await sendStopSignal(share);
    } catch (e) {
      await markZoneSyncError(share.zone_name, e instanceof Error ? e.message : String(e));
    }
  }
}

async function sendStopSignal(share: SharedEntity): Promise<void> {
  let error: string;
  try {
    const { succeeded, failed } = await native().pushRecords({
      zoneName: share.zone_name,
      scope: 'private',
      records: [stopSignalRecord(share.entity_type, share.entity_id)],
      deletions: [],
    });
    if (succeeded[share.entity_id]) {
      await markShareStopSent(share.zone_name);
      return;
    }
    error = failed[share.entity_id] ?? 'Semnalul de oprire nu a plecat.';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (isPermanentStopFailure(error)) await closeShareZone(share.zone_name);
  else await markZoneSyncError(share.zone_name, error);
}

/** Termenul a expirat sau au confirmat toți (inclusiv: nu mai are nimeni acces). */
async function isClosingDone(share: SharedEntity): Promise<boolean> {
  const closesAt = shareClosesAt(share);
  if (closesAt && closesAt.getTime() <= Date.now()) return true;
  let current: ShareParticipant[];
  try {
    current = await native().fetchShareParticipants(share.zone_name);
  } catch (e) {
    if (isShareMissingError(e) || isZoneGoneError(e)) return true;
    throw e;
  }
  const participants = updateClosingParticipants(
    getClosingParticipants(share),
    current,
    new Date().toISOString()
  );
  await saveClosingParticipants(share, participants);
  return everyoneConfirmed(participants);
}

/**
 * Owner, la fiecare sync: pentru partajările al căror semnal e pe server, notează
 * cine a confirmat și închide zona când au confirmat toți sau a expirat termenul.
 */
export async function refreshClosingShares(): Promise<void> {
  for (const share of await getClosingShares()) {
    if (!closeSignalSentAt(share)) continue;
    try {
      if (await isClosingDone(share)) await closeShareZone(share.zone_name);
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
