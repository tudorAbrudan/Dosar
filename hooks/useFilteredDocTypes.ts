import { useMemo } from 'react';
import { DOCUMENT_TYPE_LABELS, STANDARD_DOC_TYPES, ENTITY_DOCUMENT_TYPES } from '@/types';
import type { DocumentType, EntityType } from '@/types';
import { useVisibilitySettings } from './useVisibilitySettings';

export interface DocTypeOption {
  value: DocumentType;
  label: string;
}

export interface UseFilteredDocTypesOptions {
  /**
   * Dacă documentul în curs de adăugare/editare e atașat la una sau mai multe entități,
   * picker-ul afișează **toate tipurile relevante** pentru acele entități, ignorând
   * setarea globală de vizibilitate (`DEFAULT_VISIBLE_DOC_TYPES`).
   *
   * Asta înseamnă că un user care e pe ecranul „adaugă document pe proprietate"
   * vede automat PAD, cadastru, impozit_proprietate etc., chiar dacă le-a dezactivat
   * din Setări pentru lista globală.
   *
   * Fără acest parametru → comportament clasic, filtrat pe setări.
   */
  entityTypes?: EntityType[];
}

/**
 * Returnează tipurile de documente vizibile (filtrate după setările utilizatorului
 * sau, în context de entitate, după tipurile relevante pentru acea entitate).
 *
 * Include mereu `'altul'` ca fallback.
 */
export function useFilteredDocTypes(options?: UseFilteredDocTypesOptions): {
  docTypeOptions: DocTypeOption[];
  visibleDocTypes: DocumentType[];
  loading: boolean;
} {
  const { visibleDocTypes: settingsVisible, loading } = useVisibilitySettings();
  const entityTypes = options?.entityTypes;

  const visibleDocTypes = useMemo<DocumentType[]>(() => {
    if (entityTypes && entityTypes.length > 0) {
      // Combină tipurile relevante pentru toate entitățile atașate (păstrează ordinea
      // din STANDARD_DOC_TYPES pentru afișare consistentă).
      const relevant = new Set<DocumentType>();
      for (const et of entityTypes) {
        for (const t of ENTITY_DOCUMENT_TYPES[et]) {
          relevant.add(t);
        }
      }
      return STANDARD_DOC_TYPES.filter(t => relevant.has(t) || t === 'altul');
    }
    return STANDARD_DOC_TYPES.filter(t => settingsVisible.includes(t) || t === 'altul');
  }, [entityTypes, settingsVisible]);

  const docTypeOptions = useMemo<DocTypeOption[]>(
    () => visibleDocTypes.map(value => ({ value, label: DOCUMENT_TYPE_LABELS[value] })),
    [visibleDocTypes]
  );

  return { docTypeOptions, visibleDocTypes, loading };
}
