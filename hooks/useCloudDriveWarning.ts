import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { isAvailable } from '@/services/cloudStorage';
import { getCloudBackupEnabled } from '@/services/settings';

export interface UseCloudDriveWarning {
  /** true = userul a cerut backup în iCloud, dar iOS nu ne dă containerul. */
  show: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Detectează starea „backup activat, dar iCloud Drive oprit din iOS".
 *
 * `cloudStorage.isAvailable()` întoarce false când containerul iCloud Documents
 * nu e accesibil — practic: iCloud Drive dezactivat pe telefon sau pentru Dosar,
 * ori cont iCloud delogat. Până acum asta se vedea DOAR ca „iCloud indisponibil"
 * într-un ecran în care intri doar dacă îl cauți, deci backup-ul putea sta oprit
 * săptămâni fără ca userul să afle (raportat 2026-07-30 — pe telefonul cu
 * eroarea de sincronizare, iCloud Drive era pur și simplu OFF).
 *
 * Re-verifică la `AppState → active`: după ce userul comută setarea în iOS și se
 * întoarce în aplicație, banner-ul dispare singur.
 *
 * Deliberat ușor (două citiri, fără rețea) — Home îl montează la fiecare
 * randare, spre deosebire de `useCloudBackup`, care citește meta din cloud,
 * cozile de upload și dimensiunea DB.
 */
export function useCloudDriveWarning(): UseCloudDriveWarning {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const enabled = await getCloudBackupEnabled();
      const available = enabled ? await isAvailable() : true;
      if (mountedRef.current) {
        setShow(enabled && !available);
        setError(null);
      }
    } catch (e) {
      // Nu blocăm Home pentru o verificare de status: fără certitudine, nu
      // afișăm avertizarea (un fals pozitiv ar fi mai rău decât tăcerea).
      if (mountedRef.current) {
        setShow(false);
        setError(e instanceof Error ? e.message : 'Eroare necunoscută');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void refresh();
    });
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [refresh]);

  return { show, loading, error, refresh };
}
