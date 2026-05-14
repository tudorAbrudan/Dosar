/**
 * Statistici despre coada de upload + mărimea DB-ului local.
 * Folosite în UI (Setări → Cloud Backup) pentru status + estimare progres.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { db } from '../db';

const MAX_ATTEMPTS = 5;

export async function getPendingCount(): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM pending_uploads WHERE uploaded_at IS NULL AND attempt_count < ?',
    [MAX_ATTEMPTS]
  );
  return row?.c ?? 0;
}

/** Numărul de fișiere care au atins `MAX_ATTEMPTS` și nu mai sunt re-încercate. */
export async function getFailedCount(): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM pending_uploads WHERE uploaded_at IS NULL AND attempt_count >= ?',
    [MAX_ATTEMPTS]
  );
  return row?.c ?? 0;
}

/**
 * Mărime estimată a fișierelor ne-sincronizate (în bytes). Folosit de UI ca să
 * afișeze cât are de urcat înainte și în timpul backup-ului.
 */
export async function getPendingBytes(): Promise<number> {
  const row = await db.getFirstAsync<{ s: number | null }>(
    `SELECT COALESCE(SUM(file_size), 0) as s FROM pending_uploads
     WHERE uploaded_at IS NULL AND attempt_count < ?`,
    [MAX_ATTEMPTS]
  );
  return row?.s ?? 0;
}

/** Mărimea fișierului SQLite local. Nu include WAL-ul (rare > 1MB). */
export async function getLocalDbSizeBytes(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(
      `${FileSystem.documentDirectory}SQLite/documente.db`
    );
    return info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
  } catch {
    return 0;
  }
}
