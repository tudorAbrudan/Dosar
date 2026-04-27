import * as FileSystem from 'expo-file-system/legacy';
import { db } from './db';
import * as cloudStorage from './cloudStorage';
import { applyManifest } from './backup';
import { buildCanonicalManifest, hashManifestAsync } from './manifestHash';
import * as entities from './entities';
import * as docs from './documents';
import * as fuel from './fuel';
import { getCustomTypes } from './customTypes';
import { toFileUri } from './fileUtils';
import type {
  Animal,
  Card,
  CloudManifestMeta,
  Company,
  CustomDocumentType,
  Document,
  DocumentPage,
  EntityType,
  FuelRecord,
  Person,
  Property,
  SnapshotFrequency,
  Vehicle,
} from '@/types';

const CLOUD_ROOT = 'Dosar';
const MANIFEST_PATH = `${CLOUD_ROOT}/manifest.json`;
const META_PATH = `${CLOUD_ROOT}/manifest.meta.json`;
const MANIFEST_VERSION = 1;

interface CloudState {
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

interface ManifestPayload {
  version: number;
  exportDate: string;
  persons: Person[];
  properties: Property[];
  vehicles: Vehicle[];
  cards: Card[];
  animals: Animal[];
  companies: Company[];
  fuelRecords: FuelRecord[];
  customTypes: CustomDocumentType[];
  documents: Document[];
  documentPages: DocumentPage[];
  entityOrder: { entity_type: EntityType; entity_id: string; sort_order: number }[];
}

async function buildManifestPayload(): Promise<ManifestPayload> {
  const [
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    fuelRecords,
    documents,
    allPages,
    customTypes,
    entityOrder,
  ] = await Promise.all([
    entities.getPersons(),
    entities.getProperties(),
    entities.getVehicles(),
    entities.getCards(),
    entities.getAnimals(),
    entities.getCompanies(),
    fuel.getAllFuelRecords(),
    docs.getDocuments(),
    docs.getAllDocumentPages(),
    getCustomTypes(),
    db.getAllAsync<{ entity_type: EntityType; entity_id: string; sort_order: number }>(
      'SELECT entity_type, entity_id, sort_order FROM entity_order'
    ),
  ]);

  return {
    version: MANIFEST_VERSION,
    exportDate: new Date().toISOString(),
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    fuelRecords,
    customTypes,
    documents,
    documentPages: allPages,
    entityOrder,
  };
}

/**
 * Compară hash-ul manifestului curent cu ultimul uploadat. Dacă diferă, urcă manifest + meta.
 * Returnează true dacă a făcut upload, false dacă skip (no changes).
 *
 * @throws când iCloud devine indisponibil între `isAvailable()` și `writeFile`,
 *   sau când scrierea/serializarea eșuează. Apelantul (Task 11) este responsabil
 *   să prindă și să decidă retry vs. logging.
 */
export async function uploadManifestIfChanged(): Promise<boolean> {
  if (!(await cloudStorage.isAvailable())) return false;

  const payload = await buildManifestPayload();
  const canonical = buildCanonicalManifest(payload as unknown as Record<string, unknown>);
  const hash = await hashManifestAsync(canonical);

  const state = await getCloudState();
  if (state.last_manifest_hash === hash) {
    return false;
  }

  const json = JSON.stringify(payload);
  await cloudStorage.writeFile(MANIFEST_PATH, json, 'utf8');

  const documentCount = payload.documents.length;
  const fileCount =
    payload.documents.filter(d => d.file_path).length + payload.documentPages.length;
  const meta: CloudManifestMeta = {
    version: MANIFEST_VERSION,
    uploadedAt: Date.now(),
    hash,
    deviceId: state.device_id,
    encrypted: false,
    documentCount,
    fileCount,
  };
  await cloudStorage.writeFile(META_PATH, JSON.stringify(meta), 'utf8');

  await setCloudState({
    last_manifest_hash: hash,
    last_manifest_uploaded_at: meta.uploadedAt,
  });

  return true;
}

export async function readCloudMeta(): Promise<CloudManifestMeta | null> {
  if (!(await cloudStorage.isAvailable())) return null;
  if (!(await cloudStorage.exists(META_PATH))) return null;
  try {
    const text = await cloudStorage.readFile(META_PATH, 'utf8');
    return JSON.parse(text) as CloudManifestMeta;
  } catch {
    return null;
  }
}

// TODO(task-9): namespace remote paths by document_id if filenames ever collide.
// Today file_path is `documents/<UUID>.<ext>` so basename is collision-safe.
const FILES_PREFIX = `${CLOUD_ROOT}/files/`;
const MAX_ATTEMPTS = 5;

/**
 * Skip oversized files in upload (`processQueue`) AND download (`restoreFromCloud`).
 * Justification: base64 encoding of a 50 MB file is ~67 MB held in JS memory; large
 * media is the wrong fit for iCloud Documents anyway. Cap is intentionally generous
 * for typical document/photo backups.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function fileNameFromPath(relPath: string): string {
  return relPath.split('/').pop() ?? relPath;
}

/**
 * Adaugă un fișier în coada de upload. Idempotent — re-enqueue resetează
 * `attempt_count` și `last_error` (`ON CONFLICT` pe `file_path`).
 *
 * @throws când scrierea în SQLite eșuează (rar — DB locală).
 */
export async function enqueueFileUpload(filePath: string): Promise<void> {
  if (!filePath) return;
  await db.runAsync(
    `INSERT INTO pending_uploads (file_path, attempt_count, created_at)
     VALUES (?, 0, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       attempt_count = 0,
       last_error = NULL,
       created_at = excluded.created_at`,
    [filePath, Date.now()]
  );
}

/**
 * Scoate un fișier din coadă (dacă era pending) și încearcă să-l șteargă din cloud
 * (dacă era deja uploadat). Erorile remote sunt înghițite (eventual consistency).
 *
 * @throws când scrierea în SQLite eșuează.
 */
export async function dequeueFileDelete(filePath: string): Promise<void> {
  if (!filePath) return;
  await db.runAsync('DELETE FROM pending_uploads WHERE file_path = ?', [filePath]);
  if (await cloudStorage.isAvailable()) {
    const remote = `${FILES_PREFIX}${fileNameFromPath(filePath)}`;
    try {
      await cloudStorage.deleteFile(remote);
    } catch {
      // ignore — eventual consistency
    }
  }
}

/**
 * Procesează coada secvențial: citește pending rows cu `attempt_count < MAX_ATTEMPTS`,
 * urcă base64 în iCloud. Per-rând: succes → DELETE; eroare → bump `attempt_count` + `last_error`.
 *
 * Apelată fire-and-forget din hooks `documents.ts`. Erorile per-fișier sunt
 * persistate în `pending_uploads.last_error` și nu sunt aruncate.
 *
 * @throws când SELECT-ul inițial eșuează sau când UPDATE-ul de bookkeeping
 *   pentru un eșec nu poate fi scris (ambele indică o problemă cu SQLite).
 */
export async function processQueue(): Promise<void> {
  if (!(await cloudStorage.isAvailable())) return;

  const pending = await db.getAllAsync<{ id: number; file_path: string; attempt_count: number }>(
    'SELECT id, file_path, attempt_count FROM pending_uploads WHERE attempt_count < ? ORDER BY id ASC',
    [MAX_ATTEMPTS]
  );

  for (const row of pending) {
    try {
      const localUri = toFileUri(row.file_path);
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        await db.runAsync('DELETE FROM pending_uploads WHERE id = ?', [row.id]);
        continue;
      }
      if ('size' in info && typeof info.size === 'number' && info.size > MAX_FILE_BYTES) {
        // Permanent skip — bump to MAX_ATTEMPTS so it stops being retried.
        await db.runAsync(
          'UPDATE pending_uploads SET attempt_count = ?, last_error = ? WHERE id = ?',
          [
            MAX_ATTEMPTS,
            `Fișier prea mare (${Math.round(info.size / 1024 / 1024)} MB > limită ${MAX_FILE_BYTES / 1024 / 1024} MB)`,
            row.id,
          ]
        );
        continue;
      }
      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const remote = `${FILES_PREFIX}${fileNameFromPath(row.file_path)}`;
      await cloudStorage.writeFile(remote, base64, 'base64');
      await db.runAsync('DELETE FROM pending_uploads WHERE id = ?', [row.id]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Eroare necunoscută';
      await db.runAsync(
        'UPDATE pending_uploads SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
        [message, row.id]
      );
    }
  }
}

/** Numărul de fișiere în coadă active (`attempt_count < MAX_ATTEMPTS`). */
export async function getPendingCount(): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM pending_uploads WHERE attempt_count < ?',
    [MAX_ATTEMPTS]
  );
  return row?.c ?? 0;
}

/** Numărul de fișiere care au atins `MAX_ATTEMPTS` și nu mai sunt re-încercate. */
export async function getFailedCount(): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM pending_uploads WHERE attempt_count >= ?',
    [MAX_ATTEMPTS]
  );
  return row?.c ?? 0;
}

const SNAPSHOTS_PREFIX = `${CLOUD_ROOT}/snapshots/`;

const FREQUENCY_MS: Record<SnapshotFrequency, number> = {
  off: Number.POSITIVE_INFINITY,
  daily: 24 * 60 * 60 * 1000,
  every3days: 3 * 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

function todaySnapshotName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `manifest_${y}-${m}-${day}.json`;
}

/**
 * Dacă a trecut intervalul corespunzător `frequency` de la ultimul snapshot,
 * copiază `manifest.json` curent în `snapshots/manifest_YYYY-MM-DD.json` și
 * rulează cleanup pentru retenție. Skip dacă `frequency === 'off'`, iCloud
 * indisponibil, sau manifestul nu există încă.
 *
 * La prima rulare (`last_snapshot_at === null`) snapshot-ul SE FACE — operatorul
 * `&&` scurt-circuitează verificarea de interval. Dacă în aceeași zi se apelează
 * de mai multe ori după ce intervalul a expirat, fișierul curent se suprascrie
 * (același nume `manifest_YYYY-MM-DD.json`).
 *
 * @returns true dacă a făcut snapshot, false dacă a sărit.
 * @throws când iCloud devine indisponibil între `isAvailable()` și read/write,
 *   sau când scrierea în SQLite (`last_snapshot_at`) eșuează.
 */
export async function maybeSnapshot(
  frequency: SnapshotFrequency,
  retention: number
): Promise<boolean> {
  if (frequency === 'off') return false;
  if (!(await cloudStorage.isAvailable())) return false;
  if (!(await cloudStorage.exists(MANIFEST_PATH))) return false;

  const state = await getCloudState();
  const interval = FREQUENCY_MS[frequency];
  const now = Date.now();
  if (state.last_snapshot_at && now - state.last_snapshot_at < interval) {
    return false;
  }

  const manifestText = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  const snapshotPath = `${SNAPSHOTS_PREFIX}${todaySnapshotName()}`;
  await cloudStorage.writeFile(snapshotPath, manifestText, 'utf8');

  await setCloudState({ last_snapshot_at: now });

  await cleanupSnapshots(retention);

  return true;
}

async function cleanupSnapshots(retention: number): Promise<void> {
  const safeRetention = Math.max(1, retention); // never delete the snapshot we just took
  const files = await cloudStorage.listDir(SNAPSHOTS_PREFIX);
  const snapshots = files
    .filter(f => f.startsWith('manifest_') && f.endsWith('.json'))
    .sort()
    .reverse();
  const toDelete = snapshots.slice(safeRetention);
  for (const name of toDelete) {
    await cloudStorage.deleteFile(`${SNAPSHOTS_PREFIX}${name}`);
  }
}

/**
 * Listează toate snapshot-urile (`manifest_*.json`) din `snapshots/`,
 * ordonate descrescător (cel mai nou primul). Returnează array gol dacă
 * folder-ul nu există sau iCloud e indisponibil.
 */
export async function listSnapshots(): Promise<string[]> {
  const files = await cloudStorage.listDir(SNAPSHOTS_PREFIX);
  return files
    .filter(f => f.startsWith('manifest_') && f.endsWith('.json'))
    .sort()
    .reverse();
}

export interface RestoreProgress {
  phase: 'manifest' | 'files' | 'apply' | 'done';
  current: number;
  total: number;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// Set deduplicates because a document and its page may legitimately share
// the same `file_path` in legacy data; we don't want to download twice.
function collectFileNamesFromPayload(payload: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const d of asArray<{ file_path?: string }>(payload.documents)) {
    if (d.file_path) out.add(d.file_path);
  }
  for (const p of asArray<{ file_path?: string }>(payload.documentPages)) {
    if (p.file_path) out.add(p.file_path);
  }
  for (const v of asArray<{ photo_uri?: string }>(payload.vehicles)) {
    if (v.photo_uri) out.add(v.photo_uri);
  }
  return Array.from(out);
}

/**
 * Restaurează aplicația din backup-ul iCloud: descarcă manifest + fișiere, apoi
 * apelează `applyManifest({ wipeFirst: true })` într-o tranzacție atomică.
 *
 * Pași raportați prin `onProgress`: `manifest` → `files` → `apply` → `done`.
 *
 * Erorile per-fișier (rețea, lipsă remote) sunt logate în consolă și sărite,
 * nu opresc restore-ul. Eșecul în `applyManifest` rollback-uiește tranzacția
 * și DB-ul rămâne în starea anterioară.
 *
 * La final șterge `pending_uploads` în întregime — restore-ul este sursa
 * autoritară, nu vrem re-upload pentru fișiere tocmai descărcate.
 *
 * Dacă `applyManifest` eșuează, fișierele descărcate rămân pe disc (vor fi
 * sărite la următoarea încercare via `!localInfo.exists`). Cleanup pentru
 * orfani după un eșec definitiv este TBD într-o iterație ulterioară.
 *
 * @throws când iCloud nu este disponibil, manifestul lipsește, versiunea e mai
 *   nouă decât suportă app-ul, sau `applyManifest` eșuează (transaction rollback).
 */
export async function restoreFromCloud(
  onProgress?: (p: RestoreProgress) => void
): Promise<{ documentCount: number; fileCount: number }> {
  if (!(await cloudStorage.isAvailable())) {
    throw new Error('iCloud nu este disponibil');
  }

  onProgress?.({ phase: 'manifest', current: 0, total: 1 });
  if (!(await cloudStorage.exists(MANIFEST_PATH))) {
    throw new Error('Nu există backup în iCloud');
  }
  const manifestText = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  const payload = JSON.parse(manifestText) as Record<string, unknown>;
  const version = (payload.version as number) ?? 0;
  if (version > MANIFEST_VERSION) {
    throw new Error('Backup-ul a fost creat cu o versiune mai nouă a aplicației');
  }
  onProgress?.({ phase: 'manifest', current: 1, total: 1 });

  const fileNames = collectFileNamesFromPayload(payload);
  let downloaded = 0;
  for (const fileRel of fileNames) {
    try {
      const localUri = `${FileSystem.documentDirectory}${fileRel}`;
      const localInfo = await FileSystem.getInfoAsync(localUri);
      if (!localInfo.exists) {
        const remote = `${FILES_PREFIX}${fileNameFromPath(fileRel)}`;
        if (await cloudStorage.exists(remote)) {
          const remoteSize = await cloudStorage.fileSize(remote);
          if (remoteSize > MAX_FILE_BYTES) {
            console.warn(
              `[cloudSync.restore] skip oversized file "${fileRel}" (${Math.round(remoteSize / 1024 / 1024)} MB > limită ${MAX_FILE_BYTES / 1024 / 1024} MB)`
            );
          } else {
            const base64 = await cloudStorage.readFile(remote, 'base64');
            const dir = localUri.substring(0, localUri.lastIndexOf('/'));
            await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
            await FileSystem.writeAsStringAsync(localUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Eroare necunoscută';
      console.warn(`[cloudSync.restore] skip file "${fileRel}":`, message);
    }
    downloaded++;
    onProgress?.({ phase: 'files', current: downloaded, total: fileNames.length });
  }

  onProgress?.({ phase: 'apply', current: 0, total: 1 });
  await applyManifest(payload, { wipeFirst: true });
  onProgress?.({ phase: 'apply', current: 1, total: 1 });

  const meta = await readCloudMeta();
  if (meta) {
    await setCloudState({
      last_manifest_hash: meta.hash,
      last_manifest_uploaded_at: meta.uploadedAt,
    });
  }

  // Restore is authoritative — drop any pending uploads (pre-restore staleness
  // or in-flight rows that beat the import-in-progress guard).
  await db.runAsync('DELETE FROM pending_uploads');

  onProgress?.({ phase: 'done', current: 1, total: 1 });

  return {
    documentCount: asArray(payload.documents).length,
    fileCount: fileNames.length,
  };
}
