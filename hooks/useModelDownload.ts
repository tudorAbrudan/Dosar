/**
 * useModelDownload — starea descărcării de model local, partajată între ecrane.
 *
 * Se abonează la singleton-ul din `services/modelDownload.ts`, deci onboarding-ul,
 * banner-ul de pe Acasă și Setări → Asistent AI văd exact aceeași descărcare.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  subscribeDownload,
  getDownloadState,
  startModelDownload,
  cancelModelDownload,
  clearDownloadError,
  type ModelDownloadState,
} from '@/services/modelDownload';

export interface UseModelDownload extends ModelDownloadState {
  /** true cât timp un transfer e activ (alias pentru `active`, contract hooks). */
  loading: boolean;
  /** Mesaj de eroare în română, null dacă e OK (contract hooks). */
  error: string | null;
  start: (modelId: string) => Promise<boolean>;
  cancel: () => Promise<void>;
  clearError: () => void;
  /** Re-citește starea din singleton (contract hooks). */
  refresh: () => Promise<void>;
}

export function useModelDownload(): UseModelDownload {
  const [state, setState] = useState<ModelDownloadState>(() => getDownloadState());

  useEffect(() => subscribeDownload(setState), []);

  const refresh = useCallback(async () => {
    setState(getDownloadState());
  }, []);

  return {
    ...state,
    loading: state.active,
    error: state.error,
    start: startModelDownload,
    cancel: cancelModelDownload,
    clearError: clearDownloadError,
    refresh,
  };
}
