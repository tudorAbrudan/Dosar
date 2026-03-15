import { useMemo } from 'react';
import { DOCUMENT_TYPE_LABELS, STANDARD_DOC_TYPES } from '@/types';
import type { DocumentType } from '@/types';
import { useVisibilitySettings } from './useVisibilitySettings';

export interface DocTypeOption {
  value: DocumentType;
  label: string;
}

/**
 * Returnează tipurile de documente vizibile (filtrate după setările utilizatorului).
 * Include mereu 'altul' și 'custom' indiferent de setări.
 */
export function useFilteredDocTypes(): {
  docTypeOptions: DocTypeOption[];
  visibleDocTypes: DocumentType[];
  loading: boolean;
} {
  const { visibleDocTypes, loading } = useVisibilitySettings();

  const docTypeOptions = useMemo<DocTypeOption[]>(() => {
    return STANDARD_DOC_TYPES
      .filter(type => visibleDocTypes.includes(type) || type === 'altul')
      .map(type => ({ value: type, label: DOCUMENT_TYPE_LABELS[type] }));
  }, [visibleDocTypes]);

  return { docTypeOptions, visibleDocTypes, loading };
}
