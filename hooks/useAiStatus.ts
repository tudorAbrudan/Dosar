import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { describeAiAnswerer, type AiAnswererStatus } from '@/services/aiProvider';

interface UseAiStatusState extends AiAnswererStatus {
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Starea AI-ului pentru ecranele de chat: dacă poate răspunde și cine răspunde.
 * Se reîmprospătează la fiecare focus — userul poate schimba modul din Setări și
 * se întoarce în chat.
 */
export function useAiStatus(): UseAiStatusState {
  const [status, setStatus] = useState<AiAnswererStatus>({
    unavailableReason: null,
    label: '',
    onDevice: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await describeAiAnswerer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
      setError(msg);
      setStatus({
        unavailableReason: 'Nu s-a putut verifica configurația AI. Deschide Setări → Asistent AI.',
        label: '',
        onDevice: false,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { ...status, loading, error, refresh };
}
