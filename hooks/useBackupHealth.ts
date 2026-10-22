import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { isAvailable } from '@/services/cloudStorage';
import { isSessionUnlocked } from '@/services/cloudCrypto';
import { getCloudState } from '@/services/cloud/state';
import { deriveCloudStatus } from '@/services/cloud/status';
import { getCloudBackupEnabled, getCloudEncryptionEnabled } from '@/services/settings';
import type { CloudStatus } from '@/types';

export interface UseBackupHealth {
  status: CloudStatus;
  /** Ultimul manifest urcat de pe acest telefon (sau preluat la restaurare); null = niciodată. */
  lastBackupAt: number | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Starea backup-ului iCloud pentru rândul din Setări („Activ · ultimul backup azi,
 * 09:41", „Oprit", „Blocat · introdu parola"). Înainte rândul arăta același subtext
 * indiferent de stare și se citea ca titlul cardului (raportat 2026-10-22).
 *
 * Deliberat ușor, ca `useCloudDriveWarning`: doar citiri locale, fără meta-ul din
 * iCloud. Data vine din `cloud_state`, nu din coadă: fișierele în așteptare se văd
 * în ecranul iCloud Backup, aici contează când s-a salvat ultima dată tot.
 *
 * Se reîmprospătează la focus (revenire din ecranul iCloud Backup) și la
 * `AppState → active` (userul pornește iCloud Drive din iOS și se întoarce).
 */
export function useBackupHealth(): UseBackupHealth {
  const [status, setStatus] = useState<CloudStatus>('paused');
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const enabled = await getCloudBackupEnabled();
      const available = enabled ? await isAvailable() : true;
      const passwordRequired = (await getCloudEncryptionEnabled()) && !isSessionUnlocked();
      const { last_manifest_uploaded_at } = await getCloudState();
      if (!mountedRef.current) return;
      setStatus(
        deriveCloudStatus({
          available,
          enabled,
          passwordRequired,
          pendingCount: 0,
          lastUploadedAt: last_manifest_uploaded_at,
        })
      );
      setLastBackupAt(last_manifest_uploaded_at);
      setError(null);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    mountedRef.current = true;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void refresh();
    });
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [refresh]);

  return { status, lastBackupAt, loading, error, refresh };
}
