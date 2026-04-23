import { db, generateId } from './db';

export interface FuelRecord {
  id: string;
  vehicle_id: string;
  date: string; // AAAA-LL-ZZ
  liters?: number;
  km_total?: number;
  price?: number;
  is_full: boolean;
  created_at: string;
}

export interface VehicleFuelSettings {
  vehicle_id: string;
  service_km_interval: number; // km între revizii, default 10000
  last_service_km?: number;
  last_service_date?: string;
}

export interface FuelStats {
  totalRecords: number;
  avgConsumptionL100?: number;
  totalLiters: number;
  totalCost: number;
  latestKm?: number;
  needsService: boolean;
  kmUntilService?: number;
  consumptionSparkline: number[];
}

type FuelRow = {
  id: string;
  vehicle_id: string;
  date: string;
  liters: number | null;
  km_total: number | null;
  price: number | null;
  is_full: number; // SQLite boolean = 0 sau 1
  created_at: string;
};

type SettingsRow = {
  vehicle_id: string;
  service_km_interval: number;
  last_service_km: number | null;
  last_service_date: string | null;
};

function mapRecord(r: FuelRow): FuelRecord {
  return {
    id: r.id,
    vehicle_id: r.vehicle_id,
    date: r.date,
    liters: r.liters ?? undefined,
    km_total: r.km_total ?? undefined,
    price: r.price ?? undefined,
    is_full: r.is_full === 1,
    created_at: r.created_at,
  };
}

export async function getFuelRecords(vehicleId: string): Promise<FuelRecord[]> {
  const rows = await db.getAllAsync<FuelRow>(
    'SELECT * FROM fuel_records WHERE vehicle_id = ? ORDER BY date DESC, created_at DESC',
    [vehicleId]
  );
  return rows.map(mapRecord);
}

export async function addFuelRecord(
  vehicleId: string,
  record: {
    date: string;
    liters?: number;
    km_total?: number;
    price?: number;
    is_full?: boolean; // default true
  }
): Promise<FuelRecord> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const isFull = record.is_full ?? true;
  await db.runAsync(
    'INSERT INTO fuel_records (id, vehicle_id, date, liters, km_total, price, is_full, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      vehicleId,
      record.date,
      record.liters ?? null,
      record.km_total ?? null,
      record.price ?? null,
      isFull ? 1 : 0,
      created_at,
    ]
  );
  return {
    id,
    vehicle_id: vehicleId,
    date: record.date,
    liters: record.liters,
    km_total: record.km_total,
    price: record.price,
    is_full: isFull,
    created_at,
  };
}

export async function deleteFuelRecord(id: string): Promise<void> {
  await db.runAsync('DELETE FROM fuel_records WHERE id = ?', [id]);
}

export async function getFuelSettings(vehicleId: string): Promise<VehicleFuelSettings> {
  const row = await db.getFirstAsync<SettingsRow>(
    'SELECT * FROM vehicle_fuel_settings WHERE vehicle_id = ?',
    [vehicleId]
  );
  if (!row) {
    return { vehicle_id: vehicleId, service_km_interval: 10000 };
  }
  return {
    vehicle_id: vehicleId,
    service_km_interval: row.service_km_interval,
    last_service_km: row.last_service_km ?? undefined,
    last_service_date: row.last_service_date ?? undefined,
  };
}

export async function saveFuelSettings(
  vehicleId: string,
  settings: Partial<VehicleFuelSettings>
): Promise<void> {
  const updated_at = new Date().toISOString();
  // Upsert
  const existing = await db.getFirstAsync<{ vehicle_id: string }>(
    'SELECT vehicle_id FROM vehicle_fuel_settings WHERE vehicle_id = ?',
    [vehicleId]
  );
  if (existing) {
    await db.runAsync(
      'UPDATE vehicle_fuel_settings SET service_km_interval = ?, last_service_km = ?, last_service_date = ?, updated_at = ? WHERE vehicle_id = ?',
      [
        settings.service_km_interval ?? 10000,
        settings.last_service_km ?? null,
        settings.last_service_date ?? null,
        updated_at,
        vehicleId,
      ]
    );
  } else {
    await db.runAsync(
      'INSERT INTO vehicle_fuel_settings (vehicle_id, service_km_interval, last_service_km, last_service_date, updated_at) VALUES (?, ?, ?, ?, ?)',
      [
        vehicleId,
        settings.service_km_interval ?? 10000,
        settings.last_service_km ?? null,
        settings.last_service_date ?? null,
        updated_at,
      ]
    );
  }
}

/**
 * Pure helper: calculează consumul mediu L/100km folosind metoda full-to-full.
 * Un bon parțial (is_full=false) contribuie cu litri la fereastra până la următorul plin complet,
 * dar nu deschide o fereastră nouă.
 *
 * @returns avgConsumptionL100 — media aritmetică a tuturor ferestrelor complete;
 *          sparkline — ultimele 8 valori (maxim) pentru graficul compact.
 */
export function computeConsumptionFromFullToFull(records: FuelRecord[]): {
  avgConsumptionL100?: number;
  sparkline: number[];
} {
  const withKm = records
    .filter(r => r.km_total !== undefined && r.liters !== undefined)
    .sort((a, b) => (a.km_total ?? 0) - (b.km_total ?? 0));

  const fullIdx: number[] = [];
  withKm.forEach((r, i) => {
    if (r.is_full) fullIdx.push(i);
  });

  if (fullIdx.length < 2) {
    return { avgConsumptionL100: undefined, sparkline: [] };
  }

  const windowConsumptions: number[] = [];
  for (let i = 1; i < fullIdx.length; i++) {
    const aIdx = fullIdx[i - 1];
    const bIdx = fullIdx[i];
    const a = withKm[aIdx];
    const b = withKm[bIdx];
    let litersInWindow = 0;
    for (let j = aIdx + 1; j <= bIdx; j++) {
      litersInWindow += withKm[j].liters ?? 0;
    }
    const kmInWindow = (b.km_total ?? 0) - (a.km_total ?? 0);
    if (kmInWindow > 0 && litersInWindow > 0) {
      windowConsumptions.push((litersInWindow / kmInWindow) * 100);
    }
  }

  if (windowConsumptions.length === 0) {
    return { avgConsumptionL100: undefined, sparkline: [] };
  }

  const avg = windowConsumptions.reduce((s, v) => s + v, 0) / windowConsumptions.length;
  return {
    avgConsumptionL100: avg,
    sparkline: windowConsumptions.slice(-8),
  };
}

export async function computeFuelStats(vehicleId: string): Promise<FuelStats> {
  const records = await getFuelRecords(vehicleId);
  const settings = await getFuelSettings(vehicleId);

  const totalLiters = records.reduce((s, r) => s + (r.liters ?? 0), 0);
  const totalCost = records.reduce((s, r) => s + (r.price ?? 0), 0);

  const { avgConsumptionL100, sparkline } = computeConsumptionFromFullToFull(records);

  const withKm = [...records]
    .filter(r => r.km_total !== undefined)
    .sort((a, b) => (a.km_total ?? 0) - (b.km_total ?? 0));
  const latestKm = withKm.length > 0 ? withKm[withKm.length - 1].km_total : undefined;

  let needsService = false;
  let kmUntilService: number | undefined;
  if (latestKm !== undefined && settings.last_service_km !== undefined) {
    kmUntilService = settings.last_service_km + settings.service_km_interval - latestKm;
    needsService = kmUntilService <= 0;
  } else if (latestKm !== undefined && settings.last_service_km === undefined) {
    // Nu s-a setat ultima revizie — nu alertăm
  }

  return {
    totalRecords: records.length,
    avgConsumptionL100,
    totalLiters,
    totalCost,
    latestKm,
    needsService,
    kmUntilService,
    consumptionSparkline: sparkline,
  };
}
