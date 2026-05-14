import { useEffect, useState, useCallback } from 'react';
import type { DocumentType } from '@/types';
import { useVisibilitySettings } from './useVisibilitySettings';

const AUTO_DISMISS_MS = 5000;

/**
 * Activează automat un tip de document detectat de AI care nu e bifat în Setări.
 *
 * Flow:
 * 1. AI detectează tip X. UI apelează `activateIfNeeded(X, contextVisibleTypes)`.
 * 2. Dacă X e deja vizibil în context → no-op, clearează banner-ul anterior.
 * 3. Dacă X nu e vizibil → adaugă în setări via `updateVisibleDocTypes`, setează
 *    `autoActivatedType` (UI afișează banner verde de confirmare).
 * 4. Banner-ul dispare automat după 5s.
 *
 * UI-ul rămâne responsabil să apeleze `setType(X)` separat — hook-ul ăsta NU
 * setează tipul formularului, doar gestionează vizibilitatea + feedback.
 */
export function useAutoActivateDocType(): {
  autoActivatedType: DocumentType | null;
  setAutoActivatedType: (t: DocumentType | null) => void;
  activateIfNeeded: (type: DocumentType, contextVisible: DocumentType[]) => Promise<void>;
} {
  const { visibleDocTypes, updateVisibleDocTypes } = useVisibilitySettings();
  const [autoActivatedType, setAutoActivatedType] = useState<DocumentType | null>(null);

  useEffect(() => {
    if (!autoActivatedType) return;
    const id = setTimeout(() => setAutoActivatedType(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [autoActivatedType]);

  const activateIfNeeded = useCallback(
    async (type: DocumentType, contextVisible: DocumentType[]): Promise<void> => {
      if (contextVisible.includes(type)) {
        setAutoActivatedType(null);
        return;
      }
      try {
        if (!visibleDocTypes.includes(type)) {
          await updateVisibleDocTypes([...visibleDocTypes, type]);
        }
        setAutoActivatedType(type);
      } catch {
        /* dacă persistarea eșuează, păstrăm flow-ul fără banner */
      }
    },
    [visibleDocTypes, updateVisibleDocTypes]
  );

  return { autoActivatedType, setAutoActivatedType, activateIfNeeded };
}
