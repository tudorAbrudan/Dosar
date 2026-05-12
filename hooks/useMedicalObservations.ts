import { useEffect, useState, useCallback } from 'react';
import {
  groupByName,
  type ObservationGroup,
  countNeedsReview,
  listObservationsByRecord,
  type ListObservationsFilter,
} from '@/services/medicalObservations';
import { on as subscribe } from '@/services/events';
import type { MedicalObservation } from '@/types';

interface UseMedicalObservationsState {
  loading: boolean;
  error: string | null;
  groups: ObservationGroup[];
  needsReviewCount: number;
  refresh(): Promise<void>;
}

export function useMedicalObservations(recordId: string | null): UseMedicalObservationsState {
  const [groups, setGroups] = useState<ObservationGroup[]>([]);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!recordId) {
      setGroups([]);
      setNeedsReviewCount(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [g, n] = await Promise.all([groupByName(recordId), countNeedsReview(recordId)]);
      setGroups(g);
      setNeedsReviewCount(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = subscribe('entities:changed', () => {
      refresh();
    });
    return () => off();
  }, [refresh]);

  return { loading, error, groups, needsReviewCount, refresh };
}

interface UseObservationListState {
  loading: boolean;
  error: string | null;
  observations: MedicalObservation[];
  refresh(): Promise<void>;
}

/** Variantă fără group-by — pentru ecranul de review observații. */
export function useObservationsForReview(recordId: string | null): UseObservationListState {
  const [observations, setObservations] = useState<MedicalObservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!recordId) {
      setObservations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const filter: ListObservationsFilter = { needsReviewOnly: true };
      setObservations(await listObservationsByRecord(recordId, filter));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = subscribe('entities:changed', () => {
      refresh();
    });
    return () => off();
  }, [refresh]);

  return { loading, error, observations, refresh };
}
