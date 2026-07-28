import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { syncSharedEntities } from '@/services/cloudShare';

/**
 * Hook global pentru sincronizarea live a partajării CloudKit. Mount-at o
 * singură dată în `RootLayoutNav` (lângă `useCloudBackup()`).
 *
 * Trigger-e (silent push = accelerator, NU garanție — throttling iOS, Low
 * Power Mode, force-quit; garanția de liveness e `AppState → active`):
 * - la mount (cold start)
 * - `AppState → active`
 * - `onRemoteChange` (silent push CloudKit / accept share / cont schimbat,
 *   emise de modulul nativ — vezi `ExpoCloudKitShareAppDelegate`)
 *
 * Import lazy al modulului nativ (poate lipsi pre-prebuild, la fel ca în
 * `cloudShare.ts`'s `native()`). Nu aruncă niciodată — eșecurile sunt expuse
 * prin `error`.
 */
export function useSharingSync() {
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (mountedRef.current) setLoading(true);
    try {
      await syncSharedEntities();
      if (mountedRef.current) setError(null);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void refresh();
    });

    let remoteChangeSub: { remove(): void } | null = null;
    import('@/modules/expo-cloudkit-share/src')
      .then(m => {
        if (!mountedRef.current) return;
        remoteChangeSub = m.addRemoteChangeListener(() => void refresh());
      })
      .catch(() => {
        // modulul nu e (încă) linkat — pre-prebuild, safe pe simulator.
      });

    return () => {
      mountedRef.current = false;
      appStateSub.remove();
      remoteChangeSub?.remove();
    };
  }, [refresh]);

  return { loading, error, refresh };
}
