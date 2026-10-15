/**
 * Ștergerea unei entități partajate „și la ei": starea din registru, golirea zonei
 * la owner și curățarea copiei la participant. Orchestrarea CloudKit (push, sync,
 * închiderea zonei) e în `cloudShare.ts`.
 * Spec: ../docs/superpowers/specs/2026-10-15-delete-shared-entity-design.md
 *
 * Owner: zona se golește (rădăcina întâi), partajarea rămâne deschisă
 * SHARE_TEARDOWN_GRACE_DAYS zile de la confirmarea ștergerii pe server, ca s-o
 * prindă și participanții offline, apoi zona se șterge.
 * Participant: dispariția rădăcinii din zonă = owner-ul a șters entitatea.
 */
import { db } from './db';
import { PAGE_RECORD_TYPE } from './cloudShareMapping';
import { deleteDocument, LEGACY_ENTITY_COLUMN } from './documents';
import {
  deleteAnimal,
  deleteCompany,
  deletePerson,
  deleteProperty,
  deleteVehicle,
} from './entities';
import { emit } from './events';
import { enqueueSharePush, getCloudRecordsByPrefix, mapSharedEntity } from './sharing';
import type { SharedEntity, SharedEntityRow } from './sharing';
import { shareEntityTable, type ShareableEntityType } from './shareZones';

export const SHARE_TEARDOWN_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

async function selectShares(where: string, params: string[] = []): Promise<SharedEntity[]> {
  const rows = await db.getAllAsync<SharedEntityRow>(
    `SELECT * FROM shared_entities WHERE ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(mapSharedEntity);
}

/** Toate partajările nerevocate, inclusiv cele în curs de ștergere. */
export function getUnrevokedShares(): Promise<SharedEntity[]> {
  return selectShares('revoked_at IS NULL');
}

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
 * Owner: pune în coadă ștergerea fiecărui record cunoscut din zonă și marchează
 * partajarea ca fiind în curs de ștergere. Rădăcina intră prima în coadă: e
 * semnalul pentru participanți, iar paginile pleacă odată cu documentul lor
 * (`flushZoneGroup`).
 */
export async function enqueueZoneTeardown(share: SharedEntity): Promise<void> {
  const known = await getCloudRecordsByPrefix(share.zone_name, '');
  await enqueueSharePush({
    zoneName: share.zone_name,
    recordName: share.entity_id,
    op: 'delete',
    scope: 'private',
    kind: 'entity',
  });
  for (const rec of known) {
    if (rec.record_name === share.entity_id || rec.record_type === PAGE_RECORD_TYPE) continue;
    await enqueueSharePush({
      zoneName: share.zone_name,
      recordName: rec.record_name,
      op: 'delete',
      scope: 'private',
      kind: 'document',
    });
  }
  await db.runAsync('UPDATE shared_entities SET delete_requested_at = ? WHERE zone_name = ?', [
    new Date().toISOString(),
    share.zone_name,
  ]);
  emit('sharing:changed');
}

/** Owner: ștergerea rădăcinii a ajuns pe server — de aici curge termenul de închidere. */
export async function markShareDeleteSent(zoneName: string): Promise<void> {
  await db.runAsync(
    `UPDATE shared_entities SET delete_sent_at = COALESCE(delete_sent_at, ?)
     WHERE zone_name = ? AND delete_requested_at IS NOT NULL`,
    [new Date().toISOString(), zoneName]
  );
  emit('sharing:changed');
}

export async function deleteSharePushesForZone(zoneName: string): Promise<void> {
  await db.runAsync('DELETE FROM pending_share_pushes WHERE zone_name = ?', [zoneName]);
}

/**
 * Participant: owner-ul a șters entitatea. Push-urile încă netrimise spre zonă se
 * abandonează: zona e goală, iar o re-creare ar ascunde ștergerea de ceilalți.
 */
export async function markOwnerDeleted(zoneName: string): Promise<void> {
  await db.runAsync(
    `UPDATE shared_entities SET owner_deleted_at = COALESCE(owner_deleted_at, ?)
     WHERE zone_name = ? AND role = 'participant'`,
    [new Date().toISOString(), zoneName]
  );
  await deleteSharePushesForZone(zoneName);
  emit('sharing:changed');
}

/** Participant: partajări șterse de owner, din care încă n-am ieșit. */
export function getOwnerDeletedShares(): Promise<SharedEntity[]> {
  return selectShares(
    "role = 'participant' AND owner_deleted_at IS NOT NULL AND revoked_at IS NULL"
  );
}

/** Participant: ștergeri despre care userul încă n-a văzut mesajul. */
export function getUnseenOwnerDeletions(): Promise<SharedEntity[]> {
  return selectShares(
    "role = 'participant' AND owner_deleted_at IS NOT NULL AND owner_deleted_seen_at IS NULL"
  );
}

export async function markOwnerDeletionSeen(zoneName: string): Promise<void> {
  await db.runAsync(
    'UPDATE shared_entities SET owner_deleted_seen_at = COALESCE(owner_deleted_seen_at, ?) WHERE zone_name = ?',
    [new Date().toISOString(), zoneName]
  );
  emit('sharing:changed');
}

// Ștergerea locală a fiecărui tip partajabil: aceeași cale ca butonul „Șterge" din
// ecranul entității (poză, furnizori, ordine, legături). Chei = enum validat.
// check-hardcoded-entities-disable-next-cluster
const DELETE_ENTITY: Record<ShareableEntityType, (id: string) => Promise<void>> = {
  person: deletePerson,
  property: deleteProperty,
  vehicle: deleteVehicle,
  animal: deleteAnimal,
  company: deleteCompany,
};

const LEGACY_COLUMNS = Object.entries(LEGACY_ENTITY_COLUMN).filter(
  (entry): entry is [string, string] => entry[1] !== null
);

/** Documentul mai e legat de o altă entitate decât cea partajată (junction sau coloană legacy). */
async function isLinkedElsewhere(documentId: string, share: SharedEntity): Promise<boolean> {
  const other = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM document_entities
     WHERE document_id = ? AND NOT (entity_type = ? AND entity_id = ?) LIMIT 1`,
    [documentId, share.entity_type, share.entity_id]
  );
  if (other) return true;
  const row = await db.getFirstAsync<Record<string, string | null>>(
    `SELECT ${LEGACY_COLUMNS.map(([, col]) => col).join(', ')} FROM documents WHERE id = ?`,
    [documentId]
  );
  return LEGACY_COLUMNS.some(
    ([type, col]) => !!row?.[col] && !(type === share.entity_type && row[col] === share.entity_id)
  );
}

/**
 * Participant: owner-ul a șters entitatea „și la ei". Șterge entitatea pe aceeași
 * cale ca o ștergere locală, plus documentele legate DOAR de ea (cu pagini,
 * fișiere, remindere). Un document legat și de altă entitate rămâne, doar dezlegat.
 * Fără entitate locală nu face nimic, deci se poate relua la fiecare sync.
 *
 * Rândul trebuie să fie deja marcat `owner_deleted_at`: altfel ștergerile locale
 * ar găsi zona activă și ar încerca să le trimită owner-ului.
 */
export async function purgeOwnerDeletedEntity(share: SharedEntity): Promise<void> {
  const table = shareEntityTable(share.entity_type);
  if (!table) return;
  const entity = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [
    share.entity_id,
  ]);
  if (!entity) return;

  const ownColumn = LEGACY_ENTITY_COLUMN[share.entity_type];
  const linked = await db.getAllAsync<{ id: string }>(
    `SELECT d.id FROM documents d
     WHERE EXISTS (SELECT 1 FROM document_entities de
                   WHERE de.document_id = d.id AND de.entity_type = ? AND de.entity_id = ?)
       ${ownColumn ? `OR d.${ownColumn} = ?` : ''}`,
    ownColumn
      ? [share.entity_type, share.entity_id, share.entity_id]
      : [share.entity_type, share.entity_id]
  );
  const exclusive: string[] = [];
  for (const doc of linked) {
    if (!(await isLinkedElsewhere(doc.id, share))) exclusive.push(doc.id);
  }

  await DELETE_ENTITY[share.entity_type as ShareableEntityType](share.entity_id);
  for (const id of exclusive) await deleteDocument(id);
}
