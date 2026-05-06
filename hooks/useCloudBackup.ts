import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  processQueue,
  uploadManifestIfChanged,
  maybeSnapshot,
  readCloudMeta,
  getPendingCount,
  getPendingBytes,
  getLocalDbSizeBytes,
  type BackupProgress,
} from '@/services/cloudSync';
import { isAvailable } from '@/services/cloudStorage';
import {
  getCloudBackupEnabled,
  setCloudBackupEnabled,
  getCloudSnapshotFrequency,
  getCloudSnapshotRetention,
} from '@/services/settings';
import { isImportInProgress } from '@/services/backup';
import type { CloudStatus } from '@/types';

interface State {
  status: CloudStatus;
  enabled: boolean;
  available: boolean;
  lastUploadedAt: number | null;
  pendingCount: number;
  /** Bytes ne-sincronizați (estimat din `pending_uploads.file_size`). */
  pendingBytes: number;
  /** Mărimea fișierului SQLite local. */
  dbSizeBytes: number;
  documentCount: number;
  fileCountMb: number;
  loading: boolean;
  error: string | null;
  /** Progres viu cât rulează `backupNow` (null altfel). */
  backupProgress: BackupProgress | null;
}

const INITIAL: State = {
  status: 'idle',
  enabled: false,
  available: false,
  lastUploadedAt: null,
  pendingCount: 0,
  pendingBytes: 0,
  dbSizeBytes: 0,
  documentCount: 0,
  fileCountMb: 0,
  loading: true,
  error: null,
  backupProgress: null,
};

/** Interval poll cât status === 'uploading'. La 3s e suficient ca UI-ul să
 * reflecte progresul fără să încarce DB-ul cu queries. */
const UPLOADING_POLL_MS = 3000;

/**
 * Hook global pentru cloud backup. Mount-at o singură dată în `RootLayoutNav`,
 * leagă tranzițiile `AppState` la operațiile cloudSync potrivite:
 *
 * - `background` → `uploadManifestIfChanged` + `maybeSnapshot` (best-effort, înghite erorile).
 * - `active` → `processQueue` apoi `refresh()` ca să reflecte ultimele schimbări.
 *
 * În timp ce un import / restore e în curs (`isImportInProgress() === true`)
 * tot handler-ul `AppState` e bypass-uit ca să nu apară race condition pe DB.
 *
 * Expune contractul standard `{ loading, error, refresh, ... }` plus `setEnabled`
 * și `backupNow` pentru ecranul de Setări (Task 12).
 *
 * Niciodată nu aruncă — eșecurile sunt expuse prin `error` (status flips to `'error'`).
 */
export function useCloudBackup() {
  const [state, setState] = useState<State>(INITIAL);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const inFlightBackupRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const enabled = await getCloudBackupEnabled();
      const available = await isAvailable();
      const meta = enabled && available ? await readCloudMeta() : null;
      const pendingCount = enabled ? await getPendingCount() : 0;
      const pendingBytes = enabled ? await getPendingBytes() : 0;
      const dbSizeBytes = await getLocalDbSizeBytes();
      let status: CloudStatus = 'idle';
      if (!available) status = 'unavailable';
      else if (!enabled) status = 'paused';
      else if (pendingCount > 0) status = 'uploading';

      if (mountedRef.current) {
        setState(s => ({
          ...s,
          status,
          enabled,
          available,
          lastUploadedAt: meta?.uploadedAt ?? null,
          pendingCount,
          pendingBytes,
          dbSizeBytes,
          documentCount: meta?.documentCount ?? 0,
          fileCountMb: 0,
          loading: false,
          error: null,
        }));
      }
    } catch (e) {
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          status: 'error',
          loading: false,
          error: e instanceof Error ? e.message : 'Eroare necunoscută',
        }));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const onAppStateChange = useCallback(
    async (s: AppStateStatus) => {
      if (isImportInProgress()) return;
      const enabled = await getCloudBackupEnabled();
      if (!enabled) return;
      if (s === 'background') {
        try {
          await uploadManifestIfChanged();
          const freq = await getCloudSnapshotFrequency();
          const retention = await getCloudSnapshotRetention();
          await maybeSnapshot(freq, retention);
        } catch (e) {
          console.warn(
            '[useCloudBackup] background sync failed:',
            e instanceof Error ? e.message : e
          );
        }
      } else if (s === 'active') {
        try {
          await processQueue();
        } catch (e) {
          console.warn('[useCloudBackup] processQueue failed:', e instanceof Error ? e.message : e);
        }
        await refresh();
      }
    },
    [refresh]
  );

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [refresh, onAppStateChange]);

  // Poll periodic cât status === 'uploading' — UI-ul reflectă pendingCount /
  // pendingBytes care scad pe măsură ce processQueue rulează (din altă parte:
  // documents.ts fire-and-forget, sau backupNow de aici).
  useEffect(() => {
    if (state.status !== 'uploading') return;
    const id = setInterval(() => {
      if (mountedRef.current) void refresh();
    }, UPLOADING_POLL_MS);
    return () => clearInterval(id);
  }, [state.status, refresh]);

  const setEnabled = useCallback(
    async (v: boolean) => {
      await setCloudBackupEnabled(v);
      await refresh();
    },
    [refresh]
  );

  const backupNow = useCallback(async () => {
    if (inFlightBackupRef.current) return;
    inFlightBackupRef.current = true;
    if (mountedRef.current) {
      setState(s => ({
        ...s,
        status: 'uploading',
        backupProgress: { phase: 'files', current: 0, total: 0, bytesDone: 0, bytesTotal: 0 },
      }));
    }
    try {
      await processQueue(p => {
        if (mountedRef.current) {
          setState(s => ({ ...s, backupProgress: p }));
        }
      });
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          backupProgress: s.backupProgress
            ? { ...s.backupProgress, phase: 'manifest' }
            : { phase: 'manifest', current: 0, total: 1, bytesDone: 0, bytesTotal: 0 },
        }));
      }
      await uploadManifestIfChanged();
      const freq = await getCloudSnapshotFrequency();
      const retention = await getCloudSnapshotRetention();
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          backupProgress: s.backupProgress
            ? { ...s.backupProgress, phase: 'snapshot' }
            : { phase: 'snapshot', current: 0, total: 1, bytesDone: 0, bytesTotal: 0 },
        }));
      }
      await maybeSnapshot(freq, retention);
    } catch (e) {
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : 'Eroare necunoscută',
          backupProgress: null,
        }));
      }
      inFlightBackupRef.current = false;
      return;
    }
    inFlightBackupRef.current = false;
    if (mountedRef.current) {
      setState(s => ({ ...s, backupProgress: null }));
    }
    await refresh();
  }, [refresh]);

  return { ...state, refresh, setEnabled, backupNow };
}
