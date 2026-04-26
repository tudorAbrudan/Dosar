import { useState, useEffect, useCallback } from 'react';
import type { EntityType, DocumentType } from '@/types';
import { ALL_ENTITY_TYPES, STANDARD_DOC_TYPES } from '@/types';
import * as settings from '@/services/settings';
import { migrateFinanceHubVisibility } from '@/services/financeHubMigration';

export function useVisibilitySettings() {
  const [visibleEntityTypes, setVisibleEntityTypesState] = useState<EntityType[]>([
    ...ALL_ENTITY_TYPES,
  ]);
  const [visibleDocTypes, setVisibleDocTypesState] = useState<DocumentType[]>([
    ...STANDARD_DOC_TYPES,
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await migrateFinanceHubVisibility();
      const [entities, docs] = await Promise.all([
        settings.getVisibleEntityTypes(),
        settings.getVisibleDocTypes(),
      ]);
      setVisibleEntityTypesState(entities);
      setVisibleDocTypesState(docs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu s-au putut încărca setările');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateVisibleEntityTypes = useCallback(async (types: EntityType[]) => {
    await settings.setVisibleEntityTypes(types);
    setVisibleEntityTypesState(types);
  }, []);

  const updateVisibleDocTypes = useCallback(async (types: DocumentType[]) => {
    await settings.setVisibleDocTypes(types);
    setVisibleDocTypesState(types);
  }, []);

  return {
    visibleEntityTypes,
    visibleDocTypes,
    loading,
    error,
    refresh,
    updateVisibleEntityTypes,
    updateVisibleDocTypes,
  };
}
