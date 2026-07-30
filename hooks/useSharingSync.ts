import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';

import { syncSharedEntities, takeReceivedShareNotices } from '@/services/cloudShare';
import { ENTITY_TYPE_LABELS } from '@/types';

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
/**
 * Anunță entitățile primite în sincronizarea curentă. Rulează DUPĂ pull, deci
 * `arrived` spune dacă navigarea are ce afișa. Fără acest pas, acceptarea unui
 * link (tap sau „Am un link") nu producea niciun semn în aplicație.
 */
async function announceReceivedShares(): Promise<void> {
  const notices = await takeReceivedShareNotices();
  for (const n of notices) {
    const name = n.title ?? ENTITY_TYPE_LABELS[n.entityType];
    // Navigarea din callback de Alert trece prin runAfterInteractions — altfel
    // iOS prinde snapshot în mijlocul dismiss-ului și ecranul rămâne alb
    // (.claude/lessons/2026-04-20-navigation-from-alert.md).
    const go = (href: string) => () =>
      InteractionManager.runAfterInteractions(() => router.push(href as never));
    if (n.arrived) {
      Alert.alert('Entitate primită', `„${name}" a fost partajată cu tine.`, [
        { text: 'Mai târziu', style: 'cancel' },
        { text: 'Vezi', onPress: go(`/(tabs)/entitati/${n.entityId}`) },
      ]);
    } else {
      Alert.alert(
        'Invitație primită',
        `Ai acces la „${name}", dar datele nu au ajuns încă. Verifică în Setări → Partajare.`,
        [
          { text: 'Mai târziu', style: 'cancel' },
          { text: 'Deschide', onPress: go('/partajare') },
        ]
      );
    }
  }
}

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
      await announceReceivedShares();
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
