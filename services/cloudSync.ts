import * as FileSystem from 'expo-file-system/legacy';
import { db } from './db';
import * as cloudStorage from './cloudStorage';
import { applyManifest } from './backup';
import { buildCanonicalManifest, hashManifestAsync } from './manifestHash';
import * as entities from './entities';
import * as docs from './documents';
import * as fuel from './fuel';
import * as maintenance from './maintenance';
import { getCustomTypes } from './customTypes';
import { toFileUri } from './fileUtils';
import { getCloudEncryptionEnabled } from './settings';
import {
  PasswordRequiredError,
  decryptString,
  decryptToBase64,
  encryptBase64,
  encryptString,
  getSessionKey,
  isSessionUnlocked,
} from './cloudCrypto';
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
  VehicleMaintenanceTask,
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
  maintenanceTasks: VehicleMaintenanceTask[];
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
    maintenanceTasks,
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
    maintenance.getAllMaintenanceTasks(),
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
    maintenanceTasks,
    customTypes,
    documents,
    documentPages: allPages,
    entityOrder,
  };
}

/**
 * Compară hash-ul manifestului curent cu ultimul uploadat. Dacă diferă, urcă meta + manifest.
 * Returnează true dacă a făcut upload, false dacă skip (no changes).
 *
 * Dacă criptarea e activă (`getCloudEncryptionEnabled() === true`) manifestul e
 * encriptat cu cheia de sesiune înainte de upload, iar `meta.encrypted` devine `true`.
 * Hash-ul e calculat pe formatul canonic plain — așa rămâne stabil indiferent
 * dacă encriptarea e on/off (IV-ul random ar varia hash-ul ciphertext-ului).
 *
 * **Ordine de scriere:** `meta.json` PRIMUL, apoi `manifest.json`. Meta e mic,
 * rapid și rar eșuează; dacă scrierea manifestului eșuează după meta, încercăm
 * un best-effort rollback al meta-ului la valorile vechi (loggat ca warning dacă
 * și acela eșuează). Motivul ordinei: dacă am scrie întâi manifestul (potențial
 * encriptat) și meta ar eșua, un alt device care polluiește în interval ar găsi
 * manifest nou cu `meta.encrypted=false` stale și ar încerca să facă JSON.parse
 * pe ciphertext. Recovery: la următorul upload reușit, ambele se reîmprospătează.
 *
 * @throws `PasswordRequiredError` când criptarea e activă dar sesiunea nu e deblocată.
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
  const encryptionEnabled = await getCloudEncryptionEnabled();
  let payloadToWrite = json;
  let encrypted = false;
  if (encryptionEnabled) {
    const key = getSessionKey();
    if (!key) {
      throw new PasswordRequiredError('Parolă necesară pentru backup criptat');
    }
    payloadToWrite = await encryptString(json, key);
    encrypted = true;
  }

  const documentCount = payload.documents.length;
  const fileCount =
    payload.documents.filter(d => d.file_path).length + payload.documentPages.length;
  const meta: CloudManifestMeta = {
    version: MANIFEST_VERSION,
    uploadedAt: Date.now(),
    hash,
    deviceId: state.device_id,
    encrypted,
    documentCount,
    fileCount,
  };

  // Snapshot al meta-ului anterior pentru rollback dacă manifestul eșuează după meta.
  const previousMeta = await readCloudMeta();

  // Scriem META PRIMUL — mic, rapid, mai puțin probabil să eșueze. Dacă manifestul
  // eșuează după, alt device care citește în interval vede meta cu hash nou + manifest
  // vechi (inconsistent dar recuperabil la următorul refresh).
  await cloudStorage.writeFile(META_PATH, JSON.stringify(meta), 'utf8');

  try {
    await cloudStorage.writeFile(MANIFEST_PATH, payloadToWrite, 'utf8');
  } catch (e) {
    // Best-effort rollback al meta-ului la valoarea anterioară, ca să nu rămână meta
    // pretinzând "există hash nou" cu manifest vechi pe disc.
    if (previousMeta) {
      try {
        await cloudStorage.writeFile(META_PATH, JSON.stringify(previousMeta), 'utf8');
      } catch (rollbackErr) {
        console.warn(
          '[cloudSync.uploadManifestIfChanged] meta rollback failed:',
          rollbackErr instanceof Error ? rollbackErr.message : rollbackErr
        );
      }
    }
    throw e;
  }

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
/** Numărul de fișiere procesate în paralel pentru upload și download. iCloud
 * Drive serializează intern oricum la un anumit nivel, dar 4 e un compromis bun
 * între latență și consum de memorie (4 × ~7MB base64 ~= 28MB la peak). */
const PARALLELISM = 4;

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

/** Formatează bytes în KB/MB/GB cu 1 zecimală. Folosit în UI pentru progres
 * upload/download și estimare mărime backup. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
       uploaded_at = NULL,
       file_size = NULL,
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
 * Auto-vindecare: orice `file_path` referit din `documents`, `document_pages` sau
 * `vehicles.photo_uri` care NU e deja în `pending_uploads` se adaugă cu
 * `attempt_count = 0`. Apelată la începutul `processQueue` pentru a recupera
 * fișiere care au „scăpat" la creare (cloud dezactivat la moment, bug istoric,
 * import care nu re-enqueue-iește etc.).
 *
 * `INSERT OR IGNORE` păstrează rândurile existente (UNIQUE pe file_path) —
 * nu resetează attempt_count pentru cele deja procesate sau în retry.
 *
 * Erorile sunt înghițite (best-effort) — schimbări de schemă sau coloane
 * lipsă nu trebuie să blocheze procesarea cozii existente.
 */
async function reconcilePendingUploads(): Promise<void> {
  const sql = `
    INSERT OR IGNORE INTO pending_uploads (file_path, attempt_count, created_at)
    SELECT file_path, 0, ? FROM (
      SELECT file_path FROM documents WHERE file_path IS NOT NULL AND file_path != ''
      UNION
      SELECT file_path FROM document_pages WHERE file_path IS NOT NULL AND file_path != ''
      UNION
      SELECT photo_uri AS file_path FROM vehicles WHERE photo_uri IS NOT NULL AND photo_uri != ''
    )
  `;
  try {
    await db.runAsync(sql, [Date.now()]);
  } catch (e) {
    console.warn('[cloudSync.reconcilePendingUploads] failed:', e instanceof Error ? e.message : e);
  }
}

export interface BackupProgress {
  phase: 'files' | 'manifest' | 'snapshot' | 'done';
  /** Câte fișiere au fost procesate (urcate sau sărite). */
  current: number;
  /** Câte fișiere sunt în lot. 0 când nu sunt fișiere de procesat. */
  total: number;
  /** Bytes urcați (cumulat). */
  bytesDone: number;
  /** Bytes totali estimați (din `pending_uploads.file_size` + stat la nevoie). */
  bytesTotal: number;
}

/**
 * Procesează coada în paralel (chunk-uri de `PARALLELISM`): citește pending rows
 * cu `uploaded_at IS NULL AND attempt_count < MAX_ATTEMPTS`, urcă base64 în iCloud.
 * Per-rând: succes → `UPDATE uploaded_at = now`; eroare → bump `attempt_count` + `last_error`.
 *
 * **Important — fix root cause re-upload:** după upload reușit NU mai facem
 * `DELETE`, ci păstrăm rândul cu `uploaded_at` setat. Reconcile (`INSERT OR IGNORE`)
 * nu va re-adăuga rândul, deci fișierul nu se re-uploadează la următorul ciclu.
 * Re-upload se întâmplă doar când fișierul e modificat (enqueueFileUpload resetează
 * `uploaded_at = NULL`).
 *
 * Înainte de procesare apelează `reconcilePendingUploads` ca să recupereze
 * fișiere care nu sunt în coadă dar sunt referite din DB.
 *
 * `onProgress` (opțional) e apelat după FIECARE fișier procesat, cu cumulative
 * `current` și `bytesDone`. Eșecuri raportează cu fișierul numărat în `current`
 * (nu rămân blocate pe progres).
 *
 * @throws când SELECT-ul inițial eșuează sau când UPDATE-ul de bookkeeping
 *   pentru un eșec nu poate fi scris (ambele indică o problemă cu SQLite).
 */
export async function processQueue(onProgress?: (p: BackupProgress) => void): Promise<void> {
  if (!(await cloudStorage.isAvailable())) return;

  await reconcilePendingUploads();

  const encryptionEnabled = await getCloudEncryptionEnabled();
  const pending = await db.getAllAsync<{
    id: number;
    file_path: string;
    attempt_count: number;
    file_size: number | null;
  }>(
    `SELECT id, file_path, attempt_count, file_size FROM pending_uploads
     WHERE uploaded_at IS NULL AND attempt_count < ?
     ORDER BY id ASC`,
    [MAX_ATTEMPTS]
  );

  if (pending.length === 0) {
    onProgress?.({ phase: 'files', current: 0, total: 0, bytesDone: 0, bytesTotal: 0 });
    return;
  }

  // Pre-stat fișierele care nu au file_size cache-uit, ca bytesTotal să fie
  // realist de la primul tick. info.exists e cheap pe FS local.
  const stats = await Promise.all(
    pending.map(async row => {
      if (typeof row.file_size === 'number' && row.file_size > 0) {
        return { id: row.id, size: row.file_size };
      }
      try {
        const info = await FileSystem.getInfoAsync(toFileUri(row.file_path));
        const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
        if (size > 0) {
          await db.runAsync('UPDATE pending_uploads SET file_size = ? WHERE id = ?', [
            size,
            row.id,
          ]);
        }
        return { id: row.id, size };
      } catch {
        return { id: row.id, size: 0 };
      }
    })
  );
  const sizeById = new Map(stats.map(s => [s.id, s.size]));
  const bytesTotal = stats.reduce((sum, s) => sum + s.size, 0);

  let processed = 0;
  let bytesDone = 0;
  const total = pending.length;
  const emitProgress = () =>
    onProgress?.({ phase: 'files', current: processed, total, bytesDone, bytesTotal });
  emitProgress();

  const processOne = async (row: (typeof pending)[number]): Promise<void> => {
    const fileSize = sizeById.get(row.id) ?? 0;
    try {
      const localUri = toFileUri(row.file_path);
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        // Fișierul nu mai e pe disk — drop rândul (nu mai are sens să-l urcăm).
        await db.runAsync('DELETE FROM pending_uploads WHERE id = ?', [row.id]);
        return;
      }
      if ('size' in info && typeof info.size === 'number' && info.size > MAX_FILE_BYTES) {
        await db.runAsync(
          'UPDATE pending_uploads SET attempt_count = ?, last_error = ? WHERE id = ?',
          [
            MAX_ATTEMPTS,
            `Fișier prea mare (${Math.round(info.size / 1024 / 1024)} MB > limită ${MAX_FILE_BYTES / 1024 / 1024} MB)`,
            row.id,
          ]
        );
        return;
      }
      if (encryptionEnabled && !isSessionUnlocked()) {
        // BUG FIX: incrementăm attempt_count ca să nu rămână blocat în coadă
        // la nesfârșit dacă userul nu deblochează niciodată sesiunea.
        await db.runAsync(
          'UPDATE pending_uploads SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
          ['Parolă necesară', row.id]
        );
        return;
      }
      let base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (encryptionEnabled) {
        const key = getSessionKey();
        if (!key) {
          await db.runAsync(
            'UPDATE pending_uploads SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
            ['Parolă necesară', row.id]
          );
          return;
        }
        base64 = await encryptBase64(base64, key);
      }
      const remote = `${FILES_PREFIX}${fileNameFromPath(row.file_path)}`;
      await cloudStorage.writeFile(remote, base64, 'base64');
      await db.runAsync(
        'UPDATE pending_uploads SET uploaded_at = ?, last_error = NULL, file_size = ? WHERE id = ?',
        [Date.now(), fileSize || null, row.id]
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Eroare necunoscută';
      await db.runAsync(
        'UPDATE pending_uploads SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?',
        [message, row.id]
      );
    } finally {
      processed += 1;
      bytesDone += fileSize;
      emitProgress();
    }
  };

  // Procesare în chunk-uri paralele. Folosim allSettled ca un eșec într-un chunk
  // să nu blocheze restul; oricum erorile sunt persistate în `last_error`.
  for (let i = 0; i < pending.length; i += PARALLELISM) {
    const chunk = pending.slice(i, i + PARALLELISM);
    await Promise.allSettled(chunk.map(processOne));
  }
}

/** Numărul de fișiere ne-sincronizate (`uploaded_at IS NULL` și `attempt_count < MAX`). */
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

/** Mărime estimată a fișierelor ne-sincronizate (în bytes). Folosit de UI ca să
 * afișeze cât are de urcat înainte și în timpul backup-ului. */
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
  /** Bytes descărcați (cumulat). 0 înainte de faza `files`. */
  bytesDone: number;
  /** Bytes totali estimați pentru faza `files`. */
  bytesTotal: number;
}

export interface RestoreEstimate {
  /** Mărimea manifestului în bytes (cca 1-10 KB pentru manifeste mici). */
  manifestBytes: number;
  /** Suma mărimilor fișierelor remote care vor fi descărcate. */
  filesBytes: number;
  /** Numărul de fișiere care vor fi descărcate. */
  fileCount: number;
  /** `true` dacă backup-ul e criptat. */
  encrypted: boolean;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Estimează mărimea backup-ului din iCloud înainte de restore. Citește meta +
 * manifest, apoi face `stat` paralel pentru toate fișierele remote.
 *
 * @throws când iCloud e indisponibil sau manifestul lipsește.
 * @throws `PasswordRequiredError` dacă backup-ul e criptat și sesiunea blocată.
 */
export async function estimateRestoreSize(): Promise<RestoreEstimate> {
  if (!(await cloudStorage.isAvailable())) {
    throw new Error('iCloud nu este disponibil');
  }
  if (!(await cloudStorage.exists(MANIFEST_PATH))) {
    throw new Error('Nu există backup în iCloud');
  }

  const meta = await readCloudMeta();
  const isEncrypted = meta?.encrypted === true;
  if (isEncrypted && !isSessionUnlocked()) {
    throw new PasswordRequiredError('Parolă necesară pentru restaurare backup criptat');
  }
  const sessionKey = isEncrypted ? getSessionKey() : null;

  const manifestBytes = await cloudStorage.fileSize(MANIFEST_PATH);
  const manifestRaw = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  let manifestText = manifestRaw;
  if (isEncrypted && sessionKey) {
    try {
      manifestText = await decryptString(manifestRaw, sessionKey);
    } catch {
      throw new PasswordRequiredError('Parola pare incorectă. Manifestul nu poate fi decriptat.');
    }
  }
  const payload = JSON.parse(manifestText) as Record<string, unknown>;
  const fileNames = collectFileNamesFromPayload(payload);

  // Paralelizăm stat-urile în chunk-uri ca să nu trimitem zeci de cereri concurent.
  let filesBytes = 0;
  for (let i = 0; i < fileNames.length; i += PARALLELISM) {
    const chunk = fileNames.slice(i, i + PARALLELISM);
    const sizes = await Promise.all(
      chunk.map(async f => {
        try {
          const remote = `${FILES_PREFIX}${fileNameFromPath(f)}`;
          if (!(await cloudStorage.exists(remote))) return 0;
          return await cloudStorage.fileSize(remote);
        } catch {
          return 0;
        }
      })
    );
    filesBytes += sizes.reduce((sum, s) => sum + s, 0);
  }

  return {
    manifestBytes,
    filesBytes,
    fileCount: fileNames.length,
    encrypted: isEncrypted,
  };
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
 * Dacă `meta.encrypted === true` și sesiunea nu e deblocată, aruncă
 * `PasswordRequiredError` înainte de orice modificare. Apelantul (Setări) trebuie
 * să prompt-eze utilizatorul, să apeleze `unlockWithPassword`, apoi să reîncerce.
 *
 * @throws `PasswordRequiredError` când backup-ul e criptat și nu există session key,
 *   sau când decriptarea manifestului eșuează (parolă greșită).
 * @throws când iCloud nu este disponibil, manifestul lipsește, versiunea e mai
 *   nouă decât suportă app-ul, sau `applyManifest` eșuează (transaction rollback).
 */
export async function restoreFromCloud(
  onProgress?: (p: RestoreProgress) => void
): Promise<{ documentCount: number; fileCount: number }> {
  if (!(await cloudStorage.isAvailable())) {
    throw new Error('iCloud nu este disponibil');
  }

  // Citește meta întâi — aflăm flag-ul `encrypted` înainte să încercăm să citim
  // manifestul. Dacă meta lipsește dar manifestul există (caz rar de backup
  // parțial), presupunem necriptat ca să nu blocăm restore-ul vechi.
  const metaPre = await readCloudMeta();
  const isEncrypted = metaPre?.encrypted === true;
  if (isEncrypted && !isSessionUnlocked()) {
    throw new PasswordRequiredError('Parolă necesară pentru restaurare backup criptat');
  }
  const sessionKey = isEncrypted ? getSessionKey() : null;

  onProgress?.({ phase: 'manifest', current: 0, total: 1, bytesDone: 0, bytesTotal: 0 });
  if (!(await cloudStorage.exists(MANIFEST_PATH))) {
    throw new Error('Nu există backup în iCloud');
  }
  const manifestRaw = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  let manifestText = manifestRaw;
  if (isEncrypted) {
    if (!sessionKey) {
      throw new PasswordRequiredError('Parolă necesară pentru restaurare backup criptat');
    }
    try {
      manifestText = await decryptString(manifestRaw, sessionKey);
    } catch {
      throw new PasswordRequiredError('Parola pare incorectă. Manifestul nu poate fi decriptat.');
    }
  }
  const payload = JSON.parse(manifestText) as Record<string, unknown>;
  const version = (payload.version as number) ?? 0;
  if (version > MANIFEST_VERSION) {
    throw new Error('Backup-ul a fost creat cu o versiune mai nouă a aplicației');
  }
  onProgress?.({ phase: 'manifest', current: 1, total: 1, bytesDone: 0, bytesTotal: 0 });

  const fileNames = collectFileNamesFromPayload(payload);

  // Pre-stat pentru bytesTotal — același truc ca la upload, ca progresul să fie
  // realist de la primul tick în loc să crească treptat în timpul descărcării.
  const remoteSizes = new Map<string, number>();
  for (let i = 0; i < fileNames.length; i += PARALLELISM) {
    const chunk = fileNames.slice(i, i + PARALLELISM);
    await Promise.all(
      chunk.map(async f => {
        try {
          const remote = `${FILES_PREFIX}${fileNameFromPath(f)}`;
          if (await cloudStorage.exists(remote)) {
            remoteSizes.set(f, await cloudStorage.fileSize(remote));
          } else {
            remoteSizes.set(f, 0);
          }
        } catch {
          remoteSizes.set(f, 0);
        }
      })
    );
  }
  const bytesTotal = Array.from(remoteSizes.values()).reduce((s, n) => s + n, 0);

  let downloaded = 0;
  let bytesDone = 0;
  const total = fileNames.length;
  const emitFiles = () =>
    onProgress?.({ phase: 'files', current: downloaded, total, bytesDone, bytesTotal });
  emitFiles();

  // Listă cu fișierele pentru care download-ul a reușit — folosită mai jos ca să
  // populăm `pending_uploads` cu `uploaded_at` setat (= deja sincronizate, nu
  // re-uploadează la următorul reconcile).
  const restoredFiles: { file_path: string; size: number }[] = [];

  const downloadOne = async (fileRel: string): Promise<void> => {
    const remoteSize = remoteSizes.get(fileRel) ?? 0;
    try {
      const localUri = `${FileSystem.documentDirectory}${fileRel}`;
      const localInfo = await FileSystem.getInfoAsync(localUri);
      if (localInfo.exists) {
        // Fișierul există local — îl considerăm sincronizat (skip download).
        const localSize =
          'size' in localInfo && typeof localInfo.size === 'number' ? localInfo.size : remoteSize;
        restoredFiles.push({ file_path: fileRel, size: localSize });
        return;
      }
      const remote = `${FILES_PREFIX}${fileNameFromPath(fileRel)}`;
      if (!(await cloudStorage.exists(remote))) return;
      if (remoteSize > MAX_FILE_BYTES) {
        console.warn(
          `[cloudSync.restore] skip oversized file "${fileRel}" (${Math.round(remoteSize / 1024 / 1024)} MB > limită ${MAX_FILE_BYTES / 1024 / 1024} MB)`
        );
        return;
      }
      let base64 = await cloudStorage.readFile(remote, 'base64');
      if (isEncrypted && sessionKey) {
        try {
          base64 = await decryptToBase64(base64, sessionKey);
        } catch (e) {
          console.warn(
            `[cloudSync.restore] skip file "${fileRel}" (decrypt failed):`,
            e instanceof Error ? e.message : e
          );
          return;
        }
      }
      const dir = localUri.substring(0, localUri.lastIndexOf('/'));
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(localUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      restoredFiles.push({ file_path: fileRel, size: remoteSize });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Eroare necunoscută';
      console.warn(`[cloudSync.restore] skip file "${fileRel}":`, message);
    } finally {
      downloaded += 1;
      bytesDone += remoteSize;
      emitFiles();
    }
  };

  for (let i = 0; i < fileNames.length; i += PARALLELISM) {
    const chunk = fileNames.slice(i, i + PARALLELISM);
    await Promise.allSettled(chunk.map(downloadOne));
  }

  onProgress?.({ phase: 'apply', current: 0, total: 1, bytesDone, bytesTotal });
  await applyManifest(payload, { wipeFirst: true });
  onProgress?.({ phase: 'apply', current: 1, total: 1, bytesDone, bytesTotal });

  const meta = await readCloudMeta();
  if (meta) {
    await setCloudState({
      last_manifest_hash: meta.hash,
      last_manifest_uploaded_at: meta.uploadedAt,
    });
  }

  // FIX root cause re-upload: după restore, fișierele sunt deja în iCloud (le-am
  // descărcat de acolo). Le marcăm în `pending_uploads` cu `uploaded_at` setat
  // pentru ca reconcile-ul să nu le re-adauge ca pending la următorul ciclu.
  // Începem cu DELETE pentru a curăța eventuale rânduri pre-restore stale.
  await db.runAsync('DELETE FROM pending_uploads');
  const now = Date.now();
  for (const f of restoredFiles) {
    try {
      await db.runAsync(
        `INSERT OR IGNORE INTO pending_uploads (file_path, attempt_count, created_at, uploaded_at, file_size)
         VALUES (?, 0, ?, ?, ?)`,
        [f.file_path, now, now, f.size || null]
      );
    } catch {
      // best-effort — un rând lipsă duce doar la re-upload (nu la pierdere de date).
    }
  }

  onProgress?.({ phase: 'done', current: 1, total: 1, bytesDone, bytesTotal });

  return {
    documentCount: asArray(payload.documents).length,
    fileCount: fileNames.length,
  };
}
