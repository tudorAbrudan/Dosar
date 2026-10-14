import { db, generateId } from './db';
import type { CreateRowOptions, FuelRecord, VehicleFuelType } from '@/types';

export type { FuelRecord };

export interface FuelStats {
  totalRecords: number;
  avgConsumptionL100?: number;
  totalLiters: number;
  totalCost: number;
  latestKm?: number;
  consumptionSparkline: number[];
}

type FuelRow = {
  id: string;
  vehicle_id: string | null;
  date: string;
  liters: number | null;
  km_total: number | null;
  price: number | null;
  currency: string;
  fuel_type: string | null;
  is_full: number;
  station: string | null;
  pump_number: string | null;
  created_at: string;
};

function mapRecord(r: FuelRow): FuelRecord {
  return {
    id: r.id,
    vehicle_id: r.vehicle_id ?? undefined,
    date: r.date,
    liters: r.liters ?? undefined,
    km_total: r.km_total ?? undefined,
    price: r.price ?? undefined,
    currency: r.currency || 'RON',
    fuel_type: (r.fuel_type as VehicleFuelType | null) ?? undefined,
    is_full: r.is_full === 1,
    station: r.station ?? undefined,
    pump_number: r.pump_number ?? undefined,
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

/**
 * Toate înregistrările (inclusiv cele fără vehicul — canistre, scop necunoscut).
 */
export async function getAllFuelRecords(): Promise<FuelRecord[]> {
  const rows = await db.getAllAsync<FuelRow>(
    'SELECT * FROM fuel_records ORDER BY date DESC, created_at DESC'
  );
  return rows.map(mapRecord);
}

export async function getFuelRecord(id: string): Promise<FuelRecord | null> {
  const row = await db.getFirstAsync<FuelRow>('SELECT * FROM fuel_records WHERE id = ?', [id]);
  return row ? mapRecord(row) : null;
}

export interface AddFuelRecordInput {
  date: string;
  liters?: number;
  km_total?: number;
  price?: number;
  currency?: string;
  fuel_type?: VehicleFuelType;
  is_full?: boolean; // default true
  station?: string;
  pump_number?: string;
}

/**
 * Înregistrare de alimentare legată de un vehicul. KM e opțional — dacă lipsește,
 * alimentarea intră în lanțul de calcul când se completează ulterior (vezi `computeConsumptionFromFullToFull`).
 */
export async function addFuelRecord(
  vehicleId: string,
  record: AddFuelRecordInput,
  opts: CreateRowOptions = {}
): Promise<FuelRecord> {
  return insertFuelRecord({ ...record, vehicle_id: vehicleId }, opts);
}

/**
 * Înregistrare de alimentare fără vehicul (canistră, scop necunoscut).
 * NU intră în calculul de consum al niciunui vehicul.
 */
export async function addCanisterFuelRecord(
  record: AddFuelRecordInput,
  opts: CreateRowOptions = {}
): Promise<FuelRecord> {
  return insertFuelRecord({ ...record, vehicle_id: undefined }, opts);
}

interface InsertInput extends AddFuelRecordInput {
  vehicle_id?: string;
}

async function insertFuelRecord(input: InsertInput, opts: CreateRowOptions): Promise<FuelRecord> {
  const id = opts.id ?? generateId();
  const created_at = new Date().toISOString();
  const isFull = input.is_full ?? true;
  const station = input.station?.trim() || null;
  const pump = input.pump_number?.trim() || null;
  const currency = input.currency || 'RON';

  await db.runAsync(
    `INSERT INTO fuel_records
       (id, vehicle_id, date, liters, km_total, price, currency, fuel_type,
        is_full, station, pump_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.vehicle_id ?? null,
      input.date,
      input.liters ?? null,
      input.km_total ?? null,
      input.price ?? null,
      currency,
      input.fuel_type ?? null,
      isFull ? 1 : 0,
      station,
      pump,
      created_at,
    ]
  );

  return {
    id,
    vehicle_id: input.vehicle_id,
    date: input.date,
    liters: input.liters,
    km_total: input.km_total,
    price: input.price,
    currency,
    fuel_type: input.fuel_type,
    is_full: isFull,
    station: station ?? undefined,
    pump_number: pump ?? undefined,
    created_at,
  };
}

export async function deleteFuelRecord(id: string): Promise<void> {
  await db.runAsync('DELETE FROM fuel_records WHERE id = ?', [id]);
}

export interface UpdateFuelRecordInput {
  date: string;
  liters?: number;
  km_total?: number;
  price?: number;
  currency?: string;
  fuel_type?: VehicleFuelType;
  is_full: boolean;
  station?: string;
  pump_number?: string;
  vehicle_id?: string | null;
}

export async function updateFuelRecord(id: string, fields: UpdateFuelRecordInput): Promise<void> {
  const station = fields.station?.trim() || null;
  const pump = fields.pump_number?.trim() || null;
  const currency = fields.currency || 'RON';

  // Construim un UPDATE flexibil pentru a permite vehicle_id să fie omis (păstrează valoarea curentă)
  const sets: string[] = [
    'date = ?',
    'liters = ?',
    'km_total = ?',
    'price = ?',
    'currency = ?',
    'fuel_type = ?',
    'is_full = ?',
    'station = ?',
    'pump_number = ?',
  ];
  const params: (string | number | null)[] = [
    fields.date,
    fields.liters ?? null,
    fields.km_total ?? null,
    fields.price ?? null,
    currency,
    fields.fuel_type ?? null,
    fields.is_full ? 1 : 0,
    station,
    pump,
  ];
  if (fields.vehicle_id !== undefined) {
    sets.push('vehicle_id = ?');
    params.push(fields.vehicle_id ?? null);
  }
  params.push(id);

  await db.runAsync(`UPDATE fuel_records SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Pure helper: calculează consumul mediu L/100km folosind metoda full-to-full.
 *
 * - Acceptă numai înregistrările cu `vehicle_id` setat (canistrele sunt excluse implicit
 *   pentru că apelantul filtrează după vehicul).
 * - Înregistrările `is_full=true` cu `km_total` lipsă sunt sărite ca pivoți (lanțul nu se închide
 *   pe ele) — dar litrii lor contribuie la fereastră dacă există KM la ambele capete.
 * - Înregistrările parțiale (`is_full=false`) contribuie cu litri la fereastra curentă, fără
 *   să deschidă fereastră nouă.
 *
 * @returns avgConsumptionL100 — media aritmetică a tuturor ferestrelor complete;
 *          sparkline — ultimele 8 valori (maxim) pentru graficul compact.
 */
export function computeConsumptionFromFullToFull(records: FuelRecord[]): {
  avgConsumptionL100?: number;
  sparkline: number[];
} {
  const sorted = [...records]
    .filter(r => r.liters !== undefined)
    .sort((a, b) => {
      const ak = a.km_total ?? Number.POSITIVE_INFINITY;
      const bk = b.km_total ?? Number.POSITIVE_INFINITY;
      if (ak !== bk) return ak - bk;
      return a.date.localeCompare(b.date);
    });

  const pivotIdx: number[] = [];
  sorted.forEach((r, i) => {
    if (r.is_full && r.km_total !== undefined) pivotIdx.push(i);
  });

  if (pivotIdx.length < 2) {
    return { avgConsumptionL100: undefined, sparkline: [] };
  }

  const windowConsumptions: number[] = [];
  for (let i = 1; i < pivotIdx.length; i++) {
    const aIdx = pivotIdx[i - 1];
    const bIdx = pivotIdx[i];
    const a = sorted[aIdx];
    const b = sorted[bIdx];
    let litersInWindow = 0;
    for (let j = aIdx + 1; j <= bIdx; j++) {
      litersInWindow += sorted[j].liters ?? 0;
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

export interface FuelIntervalStats {
  fromIso?: string;
  toIso: string;
  recordCount: number;
  fillupCount: number;
  totalDistance?: number;
  totalLiters: number;
  totalCost: number;
  avgConsumptionL100?: number;
  costPerKm?: number;
  avgKmBetweenFillups?: number;
  avgLitersPerFillup?: number;
  avgPricePerLiter?: number;
}

/**
 * Statistici pe un interval [fromIso, toIso]. fromIso = undefined → toate înregistrările.
 * toIso default = azi.
 */
export async function computeFuelIntervalStats(
  vehicleId: string,
  fromIso?: string,
  toIso?: string
): Promise<FuelIntervalStats> {
  const today = toIso ?? new Date().toISOString().slice(0, 10);
  const allRecords = await getFuelRecords(vehicleId);
  const filtered = allRecords.filter(r => {
    if (fromIso && r.date < fromIso) return false;
    if (r.date > today) return false;
    return true;
  });

  const totalLiters = filtered.reduce((s, r) => s + (r.liters ?? 0), 0);
  const totalCost = filtered.reduce((s, r) => s + (r.price ?? 0), 0);

  const withKm = [...filtered]
    .filter(r => r.km_total !== undefined)
    .sort((a, b) => (a.km_total ?? 0) - (b.km_total ?? 0));
  const totalDistance =
    withKm.length >= 2
      ? (withKm[withKm.length - 1].km_total ?? 0) - (withKm[0].km_total ?? 0)
      : undefined;

  const { avgConsumptionL100 } = computeConsumptionFromFullToFull(filtered);
  const costPerKm =
    totalDistance !== undefined && totalDistance > 0 ? totalCost / totalDistance : undefined;

  const fullRecords = filtered.filter(r => r.is_full);
  const avgKmBetweenFillups =
    totalDistance !== undefined && fullRecords.length > 1
      ? totalDistance / (fullRecords.length - 1)
      : undefined;

  const avgLitersPerFillup = filtered.length > 0 ? totalLiters / filtered.length : undefined;
  const avgPricePerLiter = totalLiters > 0 ? totalCost / totalLiters : undefined;

  return {
    fromIso,
    toIso: today,
    recordCount: filtered.length,
    fillupCount: fullRecords.length,
    totalDistance,
    totalLiters,
    totalCost,
    avgConsumptionL100,
    costPerKm,
    avgKmBetweenFillups,
    avgLitersPerFillup,
    avgPricePerLiter,
  };
}

export async function computeFuelStats(vehicleId: string): Promise<FuelStats> {
  const records = await getFuelRecords(vehicleId);

  const totalLiters = records.reduce((s, r) => s + (r.liters ?? 0), 0);
  const totalCost = records.reduce((s, r) => s + (r.price ?? 0), 0);

  const { avgConsumptionL100, sparkline } = computeConsumptionFromFullToFull(records);

  const withKm = [...records]
    .filter(r => r.km_total !== undefined)
    .sort((a, b) => (a.km_total ?? 0) - (b.km_total ?? 0));
  const latestKm = withKm.length > 0 ? withKm[withKm.length - 1].km_total : undefined;

  return {
    totalRecords: records.length,
    avgConsumptionL100,
    totalLiters,
    totalCost,
    latestKm,
    consumptionSparkline: sparkline,
  };
}
