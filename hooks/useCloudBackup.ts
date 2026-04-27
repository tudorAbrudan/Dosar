import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  processQueue,
  uploadManifestIfChanged,
  maybeSnapshot,
  readCloudMeta,
  getPendingCount,
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
  documentCount: number;
  fileCountMb: number;
  loading: boolean;
  error: string | null;
}

const INITIAL: State = {
  status: 'idle',
  enabled: false,
  available: false,
  lastUploadedAt: null,
  pendingCount: 0,
  documentCount: 0,
  fileCountMb: 0,
  loading: true,
  error: null,
};

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
      let status: CloudStatus = 'idle';
      if (!available) status = 'unavailable';
      else if (!enabled) status = 'paused';
      else if (pendingCount > 0) status = 'uploading';

      if (mountedRef.current) {
        setState({
          status,
          enabled,
          available,
          lastUploadedAt: meta?.uploadedAt ?? null,
          pendingCount,
          documentCount: meta?.documentCount ?? 0,
          // TODO(task-12): compute from cloudStorage.listDir(FILES_PREFIX) sum.
          fileCountMb: 0,
          loading: false,
          error: null,
        });
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
      setState(s => ({ ...s, status: 'uploading' }));
    }
    try {
      await processQueue();
      await uploadManifestIfChanged();
      const freq = await getCloudSnapshotFrequency();
      const retention = await getCloudSnapshotRetention();
      await maybeSnapshot(freq, retention);
    } catch (e) {
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : 'Eroare necunoscută',
        }));
      }
      inFlightBackupRef.current = false;
      return;
    }
    inFlightBackupRef.current = false;
    await refresh();
  }, [refresh]);

  return { ...state, refresh, setEnabled, backupNow };
}
