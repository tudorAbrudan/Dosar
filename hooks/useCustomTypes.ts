import { useState, useEffect, useCallback } from 'react';
import type { CustomDocumentType } from '@/types';
import * as customTypesService from '@/services/customTypes';

export function useCustomTypes() {
  const [customTypes, setCustomTypes] = useState<CustomDocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const types = await customTypesService.getCustomTypes();
      setCustomTypes(types);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu s-au putut încărca tipurile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createCustomType = useCallback(async (name: string) => {
    const ct = await customTypesService.createCustomType(name);
    setCustomTypes(prev => [...prev, ct]);
    return ct;
  }, []);

  const deleteCustomType = useCallback(async (id: string) => {
    await customTypesService.deleteCustomType(id);
    setCustomTypes(prev => prev.filter(ct => ct.id !== id));
  }, []);

  return { customTypes, loading, error, refresh, createCustomType, deleteCustomType };
}
