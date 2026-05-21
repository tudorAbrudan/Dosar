import { useEffect, useState, useCallback } from 'react';
import {
  getMedicalRecord,
  getMedicalRecordStats,
  type MedicalRecordStats,
} from '@/services/medicalRecord';
import { on as subscribe } from '@/services/events';
import type { MedicalRecord } from '@/types';

interface UseMedicalRecordState {
  loading: boolean;
  error: string | null;
  record: MedicalRecord | null;
  stats: MedicalRecordStats | null;
  refresh(): Promise<void>;
}

export function useMedicalRecord(id: string | null): UseMedicalRecordState {
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [stats, setStats] = useState<MedicalRecordStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) {
      setRecord(null);
      setStats(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await getMedicalRecord(id);
      setRecord(r);
      setStats(r ? await getMedicalRecordStats(id) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = subscribe('entities:changed', () => {
      refresh();
    });
    return () => off();
  }, [refresh]);

  return { loading, error, record, stats, refresh };
}
