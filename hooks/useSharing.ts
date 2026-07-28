import { useCallback, useEffect, useState } from 'react';

import type { EntityType } from '@/types';
import { getSharedEntities } from '@/services/sharing';
import type { SharedEntity, SharePermission } from '@/services/sharing';
import {
  friendlyCloudKitMessage,
  getShareDiagnostics,
  isCloudKitAvailable,
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
  sync(): Promise<void>;
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

  const sync = useCallback(async () => {
    setError(null);
    try {
      await syncSharedEntities();
      await refresh();
    } catch (e) {
      setError(friendlyCloudKitMessage(e));
    }
  }, [refresh]);

  // La mount: încarcă starea locală, apoi sincronizează. `sync()` descoperă
  // zonele partajate acceptate (participant) și trage datele — fără el, o
  // entitate partajată nu apare până la un refresh manual. `syncSharedEntities`
  // e no-op când iCloud nu e disponibil, deci apelul e sigur pe simulator.
  useEffect(() => {
    void refresh().then(() => sync());
  }, [refresh, sync]);

  return { shares, available, diagnostics, loading, error, refresh, share, revoke, sync };
}
