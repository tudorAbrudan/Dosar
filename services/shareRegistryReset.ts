/**
 * Reîmprospătarea registrului de partajare după ce datele locale au fost șterse și
 * (eventual) reinserate: restaurare cu înlocuire sau „Șterge toate datele".
 * Extras din `sharing.ts` (fișier mare); registrul în sine rămâne acolo.
 */
import type { EntityType } from '@/types';
import { db } from './db';
import { emit } from './events';
import { parseZoneName, shareEntityTable } from './shareZones';

/** Mesajul pus pe o partajare proprie a cărei entitate a dispărut la o restaurare / ștergere totală. */
export const SHARE_ENTITY_MISSING_ERROR =
  'Entitatea nu mai există pe acest telefon. Partajarea e încă activă: o poți revoca.';

/**
 * După o restaurare cu înlocuire (wipe + reinserare cu ID-urile originale) sau după
 * „Șterge toate datele", registrul de partajare rămâne, dar starea lui de sync nu mai
 * descrie datele locale. Rulează în aceeași tranzacție cu ștergerea:
 *
 * 1. Zonele primite (participant): token și `cloud_records` șterse → următorul sync
 *    face un fetch complet, idempotent pe ID-urile păstrate (readuce ce lipsește din
 *    backup, fără duplicate).
 * 2. Coada de push: un `upsert` al cărui rând local lipsește ar ajunge tombstone la
 *    flush (ștergere la participanți), iar un `delete` al cărui rând a reapărut ar
 *    șterge din zonă ceva ce există local — ambele se scot.
 * 3. Partajările proprii a căror entitate lipsește primesc o eroare vizibilă; nu se
 *    revocă automat (restaurarea nu face nimic ireversibil în rețea).
 *
 * Zonele proprii NU se resetează: fără `cloud_records`, un pull ar rescrie
 * `file_path` la documentele proprii spre copii din `shared/…`.
 */
export async function resetShareStateAfterWipe(): Promise<void> {
  const shares = await db.getAllAsync<{
    zone_name: string;
    role: string;
    entity_type: string;
    entity_id: string;
  }>(
    'SELECT zone_name, role, entity_type, entity_id FROM shared_entities WHERE revoked_at IS NULL'
  );

  for (const s of shares) {
    if (s.role === 'participant') {
      await db.runAsync('UPDATE shared_entities SET change_token = NULL WHERE zone_name = ?', [
        s.zone_name,
      ]);
      await db.runAsync('DELETE FROM cloud_records WHERE zone_name = ?', [s.zone_name]);
      continue;
    }
    const table = shareEntityTable(s.entity_type as EntityType);
    if (!table) continue;
    const exists = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [
      s.entity_id,
    ]);
    if (!exists) {
      await db.runAsync('UPDATE shared_entities SET last_sync_error = ? WHERE zone_name = ?', [
        SHARE_ENTITY_MISSING_ERROR,
        s.zone_name,
      ]);
    }
  }

  const pending = await db.getAllAsync<{
    id: number;
    zone_name: string;
    record_name: string;
    op: string;
    kind: string;
  }>('SELECT id, zone_name, record_name, op, kind FROM pending_share_pushes');
  for (const row of pending) {
    let table: string | undefined = 'documents';
    if (row.kind === 'entity') {
      const parsed = parseZoneName(row.zone_name);
      table = parsed ? shareEntityTable(parsed.entityType) : undefined;
    }
    if (!table) continue;
    const exists = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [
      row.record_name,
    ]);
    const stale = row.op === 'delete' ? !!exists : !exists;
    if (stale) await db.runAsync('DELETE FROM pending_share_pushes WHERE id = ?', [row.id]);
  }
  emit('sharing:changed');
}
