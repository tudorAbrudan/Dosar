import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { getDocumentsByEntity } from '@/services/documents';
import { computeFuelStats } from '@/services/fuel';
import { buildVehicleStatusItems, type StatusItemRaw } from '@/services/vehicleStatus';
import * as settings from '@/services/settings';
import type { Vehicle } from '@/types';

export type VehicleStatusItem = StatusItemRaw & {
  onPress: () => void;
};

export type UseVehicleStatusResult = {
  items: VehicleStatusItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useVehicleStatus(vehicle: Vehicle | undefined): UseVehicleStatusResult {
  const [items, setItems] = useState<VehicleStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vehicle) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [documents, fuelStats, visibleTypes, notifDays] = await Promise.all([
        getDocumentsByEntity('vehicle_id', vehicle.id),
        computeFuelStats(vehicle.id),
        settings.getVisibleDocTypes(),
        settings.getNotificationDays(),
      ]);
      const rawItems = buildVehicleStatusItems({
        documents,
        fuelStats,
        itpEnabled: visibleTypes.includes('itp'),
        notificationDays: notifDays,
        today: new Date(),
        fuelType: vehicle.fuel_type,
      });

      const vehicleId = vehicle.id;
      const vehicleName = vehicle.name;

      const withPress: VehicleStatusItem[] = rawItems.map(raw => {
        if (raw.key === 'service' || raw.key === 'fuel') {
          return {
            ...raw,
            onPress: () =>
              router.push(
                `/(tabs)/entitati/fuel?vehicleId=${vehicleId}&vehicleName=${encodeURIComponent(vehicleName)}`
              ),
          };
        }
        return {
          ...raw,
          onPress: () => {
            if (raw.docId) {
              router.push({
                pathname: '/(tabs)/documente/[id]',
                params: { id: raw.docId, from: 'entity', entityId: vehicleId },
              });
            }
          },
        };
      });

      setItems(withPress);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [vehicle]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, refresh: load };
}
