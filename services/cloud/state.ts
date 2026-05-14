/**
 * CRUD pentru `cloud_state` — tabelul cu state-ul cloud sync (last hash, timestamps,
 * device ID). Extras din `cloudSync.ts` pentru izolare și testabilitate.
 */
import { db } from '../db';

export interface CloudState {
  last_manifest_hash: string | null;
  last_manifest_uploaded_at: number | null;
  last_snapshot_at: number | null;
  device_id: string;
}

export async function getCloudState(): Promise<CloudState> {
  const row = await db.getFirstAsync<CloudState>(
    'SELECT last_manifest_hash, last_manifest_uploaded_at, last_snapshot_at, device_id FROM cloud_state WHERE id = 1'
  );
  if (!row) throw new Error('cloud_state not initialized');
  return row;
}

export async function setCloudState(patch: Partial<CloudState>): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of Object.keys(patch) as (keyof CloudState)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  await db.runAsync(`UPDATE cloud_state SET ${fields.join(', ')} WHERE id = 1`, values);
}
