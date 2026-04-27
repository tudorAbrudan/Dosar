import { useEffect, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getCloudState, readCloudMeta } from '@/services/cloudSync';
import {
  getCloudBackupEnabled,
  getCloudIgnoredUploadedAt,
  setCloudIgnoredUploadedAt,
} from '@/services/settings';
import type { CloudManifestMeta } from '@/types';

interface State {
  cloudMeta: CloudManifestMeta | null;
  showBanner: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Detects whether iCloud holds a newer manifest than this device last uploaded
 * (and from a different device), so Home can surface a "Backup mai nou pe iCloud"
 * banner offering restore.
 *
 * - Re-checks on mount and on AppState 'active'.
 * - Suppresses the banner for any cloud `uploadedAt` the user previously dismissed
 *   (stored via `setCloudIgnoredUploadedAt`).
 * - Never throws — failures are surfaced via `error` and `showBanner` stays `false`.
 *
 * @returns `{ cloudMeta, showBanner, loading, error, refresh, dismiss }`.
 */
export function useCloudRestoreDetector() {
  const [state, setState] = useState<State>({
    cloudMeta: null,
    showBanner: false,
    loading: true,
    error: null,
  });

  const check = useCallback(async () => {
    try {
      const enabled = await getCloudBackupEnabled();
      if (!enabled) {
        setState({ cloudMeta: null, showBanner: false, loading: false, error: null });
        return;
      }
      const cloudMeta = await readCloudMeta();
      if (!cloudMeta) {
        setState({ cloudMeta: null, showBanner: false, loading: false, error: null });
        return;
      }
      const localState = await getCloudState();
      const ignoredAt = (await getCloudIgnoredUploadedAt()) ?? 0;

      const isNewer =
        cloudMeta.uploadedAt > (localState.last_manifest_uploaded_at ?? 0) &&
        cloudMeta.deviceId !== localState.device_id &&
        cloudMeta.uploadedAt !== ignoredAt;

      setState({ cloudMeta, showBanner: isNewer, loading: false, error: null });
    } catch (e) {
      setState({
        cloudMeta: null,
        showBanner: false,
        loading: false,
        error: e instanceof Error ? e.message : 'Eroare necunoscută',
      });
    }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void check();
    });
    return () => {
      sub.remove();
    };
  }, [check]);

  const dismiss = useCallback(async () => {
    if (state.cloudMeta) {
      await setCloudIgnoredUploadedAt(state.cloudMeta.uploadedAt);
    }
    setState(s => ({ ...s, showBanner: false }));
  }, [state.cloudMeta]);

  return { ...state, refresh: check, dismiss };
}
