import { useCallback, useEffect, useRef, useState } from 'react';

import type { EntityType } from '@/types';
import { isDocumentReadOnlyForMe, isEntityReadOnlyForMe } from '@/services/sharing';
import { on } from '@/services/events';

export interface UseShareReadOnly {
  readOnly: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * True dacă entitatea e primită de la cineva ca share read-only (nu pot edita).
 * Re-verifică live pe `sharing:changed` — dacă owner-ul revocă sau schimbă
 * permisiunea cât userul e pe ecran, gate-ul se actualizează fără remount.
 */
export function useEntityReadOnly(entityType: EntityType, entityId: string): UseShareReadOnly {
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setLoading(true);
    try {
      const result = await isEntityReadOnlyForMe(entityType, entityId);
      if (mountedRef.current) {
        setReadOnly(result);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const off = on('sharing:changed', () => void refresh());
    return () => {
      mountedRef.current = false;
      off();
    };
  }, [refresh]);

  return { readOnly, loading, error, refresh };
}

/** La fel ca `useEntityReadOnly`, dar pentru documente (conservativ — vezi `isDocumentReadOnlyForMe`). */
export function useDocumentReadOnly(documentId: string): UseShareReadOnly {
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setLoading(true);
    try {
      const result = await isDocumentReadOnlyForMe(documentId);
      if (mountedRef.current) {
        setReadOnly(result);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const off = on('sharing:changed', () => void refresh());
    return () => {
      mountedRef.current = false;
      off();
    };
  }, [refresh]);

  return { readOnly, loading, error, refresh };
}
