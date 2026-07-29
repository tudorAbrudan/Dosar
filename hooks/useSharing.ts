import { useCallback, useEffect, useState } from 'react';

import type { EntityType } from '@/types';
import { getSharedEntities } from '@/services/sharing';
import type { SharedEntity, SharePermission } from '@/services/sharing';
import { on } from '@/services/events';
import {
  acceptShareByURL,
  friendlyCloudKitMessage,
  getShareDiagnostics,
  isCloudKitAvailable,
  leaveEntityShare,
  revokeEntityShare,
  shareEntity,
  syncSharedEntities,
} from '@/services/cloudShare';
import type { ShareZoneDiagnostic } from '@/services/cloudShare';

export interface ShareDiagnostics {
  zones: ShareZoneDiagnostic[];
  pendingPushCount: number;
  stuckCount: number;
}

const EMPTY_DIAGNOSTICS: ShareDiagnostics = { zones: [], pendingPushCount: 0, stuckCount: 0 };

export interface UseSharing {
  shares: SharedEntity[];
  available: boolean;
  diagnostics: ShareDiagnostics;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  share(entityType: EntityType, entityId: string, permission?: SharePermission): Promise<void>;
  revoke(entityType: EntityType, entityId: string): Promise<void>;
  leave(entityType: EntityType, entityId: string): Promise<void>;
  sync(): Promise<void>;
  acceptByURL(url: string): Promise<void>;
}

export function useSharing(): UseSharing {
  const [shares, setShares] = useState<SharedEntity[]>([]);
  const [available, setAvailable] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ShareDiagnostics>(EMPTY_DIAGNOSTICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAvailable(await isCloudKitAvailable());
      setShares(await getSharedEntities());
      setDiagnostics(await getShareDiagnostics());
    } catch (e) {
      setError(friendlyCloudKitMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const share = useCallback(
    async (entityType: EntityType, entityId: string, permission: SharePermission = 'read') => {
      setError(null);
      try {
        await shareEntity(entityType, entityId, permission);
        await refresh();
      } catch (e) {
        setError(friendlyCloudKitMessage(e));
        throw e;
      }
    },
    [refresh]
  );

  const revoke = useCallback(
    async (entityType: EntityType, entityId: string) => {
      setError(null);
      try {
        await revokeEntityShare(entityType, entityId);
        await refresh();
      } catch (e) {
        setError(friendlyCloudKitMessage(e));
        throw e;
      }
    },
    [refresh]
  );

  const leave = useCallback(
    async (entityType: EntityType, entityId: string) => {
      setError(null);
      try {
        await leaveEntityShare(entityType, entityId);
        await refresh();
      } catch (e) {
        setError(friendlyCloudKitMessage(e));
        throw e;
      }
    },
    [refresh]
  );

  const sync = useCallback(async () => {
    setError(null);
    try {
      await syncSharedEntities();
      await refresh();
    } catch (e) {
      setError(friendlyCloudKitMessage(e));
    }
  }, [refresh]);

  const acceptByURL = useCallback(
    async (url: string) => {
      setError(null);
      try {
        await acceptShareByURL(url);
        await refresh();
      } catch (e) {
        setError(friendlyCloudKitMessage(e));
        throw e;
      }
    },
    [refresh]
  );

  // La mount: încarcă starea locală, apoi sincronizează. `sync()` descoperă
  // zonele partajate acceptate (participant) și trage datele — fără el, o
  // entitate partajată nu apare până la un refresh manual. `syncSharedEntities`
  // e no-op când iCloud nu e disponibil, deci apelul e sigur pe simulator.
  useEffect(() => {
    void refresh().then(() => sync());
  }, [refresh, sync]);

  return {
    shares,
    available,
    diagnostics,
    loading,
    error,
    refresh,
    share,
    revoke,
    leave,
    sync,
    acceptByURL,
  };
}

export interface UseSharedEntityMap {
  map: Map<string, SharedEntity>;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Variantă ușoară pentru afișare pură (badge „partajată" în lista de entități) —
 * DOAR citire locală SQLite (`getSharedEntities`), fără `isCloudKitAvailable`/
 * `syncSharedEntities`. Ecranul Partajare (`useSharing` de mai sus) e cel care
 * declanșează sync-ul CloudKit la mount; a repeta asta aici ar dubla apelurile
 * native de fiecare dată când userul deschide tab-ul Entități.
 */
export function useSharedEntityMap(): UseSharedEntityMap {
  const [map, setMap] = useState<Map<string, SharedEntity>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const shares = await getSharedEntities();
      setMap(new Map(shares.map(s => [`${s.entity_type}:${s.entity_id}`, s])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = on('sharing:changed', () => void refresh());
    return () => off();
  }, [refresh]);

  return { map, loading, error, refresh };
}
