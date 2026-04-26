import { db, generateId } from './db';
import type { FuelRecord, VehicleFuelType } from '@/types';
import { getCategoryByKey } from './categories';

// Re-export FuelRecord pentru codul existent care îl importă din '@/services/fuel'.
// Sursa de adevăr pentru tip e `types/index.ts`.
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
  account_id: string | null;
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
    account_id: r.account_id ?? undefined,
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
 * Util pentru detectorul de orfani și pentru lista globală a tranzacțiilor de tip „alimentare".
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
  account_id?: string;
}

/**
 * Înregistrare de alimentare legată de un vehicul. KM e opțional — dacă lipsește,
 * alimentarea intră în lanțul de calcul când se completează ulterior (vezi `computeConsumptionFromFullToFull`).
 */
export async function addFuelRecord(
  vehicleId: string,
  record: AddFuelRecordInput
): Promise<FuelRecord> {
  return insertFuelRecord({ ...record, vehicle_id: vehicleId });
}

/**
 * Înregistrare de alimentare fără vehicul (canistră, scop necunoscut).
 * NU intră în calculul de consum al niciunui vehicul. Apare doar ca cheltuială.
 */
export async function addCanisterFuelRecord(record: AddFuelRecordInput): Promise<FuelRecord> {
  return insertFuelRecord({ ...record, vehicle_id: undefined });
}

interface InsertInput extends AddFuelRecordInput {
  vehicle_id?: string;
}

/**
 * Sincronizează tranzacția financiară pentru o înregistrare de alimentare.
 *
 * Standardizare: dacă alimentarea are `account_id` și `price > 0`, ține în
 * `transactions` o tranzacție-cheltuială cu `fuel_record_id` setat (sursa
 * `'fuel'`, categoria sistem `vehicle`). Dacă nu mai are cont sau preț, șterge
 * tranzacția. Astfel hub-ul „Gestiune financiară" reflectă automat alimentările.
 */
async function syncFuelTransaction(record: FuelRecord, vehicleName?: string): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM transactions WHERE fuel_record_id = ?',
    [record.id]
  );

  const hasFinancialEffect = !!record.account_id && (record.price ?? 0) > 0;
  if (!hasFinancialEffect) {
    if (existing) {
      await db.runAsync('DELETE FROM transactions WHERE id = ?', [existing.id]);
    }
    return;
  }

  // Forțăm tranzacția în moneda contului — soldul e exprimat în account.currency,
  // o tranzacție în altă monedă fără curs FX ar contamina balanța. Dacă userul
  // a marcat fuel.currency != account.currency, asumăm că suma `price` e deja
  // în moneda contului (cazul realist: cont RON, alimentare lângă graniță, dar
  // userul a plătit cu cardul → banca o vede tot RON). Ne logăm warn-ul.
  const accountId = record.account_id as string;
  const account = await db
    .getFirstAsync<{ currency: string }>('SELECT currency FROM financial_accounts WHERE id = ?', [
      accountId,
    ])
    .catch(() => null);
  const accountCurrency = account?.currency || 'RON';
  if (record.currency && record.currency !== accountCurrency) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fuel] alimentare ${record.id} are currency=${record.currency} dar contul e ${accountCurrency}; presupunem că suma e în moneda contului.`
    );
  }
  const currency = accountCurrency;
  const amount = -(record.price ?? 0);
  const amount_ron = currency === 'RON' ? amount : null;

  if (existing) {
    // Actualizăm DOAR câmpurile „obiective" (account, dată, sumă, monedă).
    // Description / merchant / category pot fi personalizate de user în ecranul
    // de tranzacție — nu le suprascriem. Sursa rămâne 'fuel'.
    await db.runAsync(
      `UPDATE transactions
         SET account_id = ?, date = ?, amount = ?, currency = ?, amount_ron = ?, source = 'fuel'
       WHERE id = ?`,
      [record.account_id ?? null, record.date, amount, currency, amount_ron, existing.id]
    );
  } else {
    const category = await getCategoryByKey('vehicle').catch(() => null);
    const merchant = record.station?.trim() || null;
    const fuelLabel = record.fuel_type ?? 'carburant';
    const description = vehicleName
      ? `Alimentare ${fuelLabel} — ${vehicleName}`
      : `Alimentare ${fuelLabel}`;
    const txId = generateId();
    const created_at = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount, currency, amount_ron, description, merchant,
          category_id, source, statement_id, fuel_record_id,
          is_internal_transfer, linked_transaction_id, is_refund, duplicate_of_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fuel', NULL, ?, 0, NULL, 0, NULL, NULL, ?)`,
      [
        txId,
        record.account_id ?? null,
        record.date,
        amount,
        currency,
        amount_ron,
        description,
        merchant,
        category?.id ?? null,
        record.id,
        created_at,
      ]
    );
  }
}

async function getVehicleName(vehicleId?: string | null): Promise<string | undefined> {
  if (!vehicleId) return undefined;
  const v = await db
    .getFirstAsync<{ name: string }>('SELECT name FROM vehicles WHERE id = ?', [vehicleId])
    .catch(() => null);
  return v?.name ?? undefined;
}

async function insertFuelRecord(input: InsertInput): Promise<FuelRecord> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const isFull = input.is_full ?? true;
  const station = input.station?.trim() || null;
  const pump = input.pump_number?.trim() || null;
  const currency = input.currency || 'RON';

  await db.runAsync(
    `INSERT INTO fuel_records
       (id, vehicle_id, account_id, date, liters, km_total, price, currency, fuel_type,
        is_full, station, pump_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.vehicle_id ?? null,
      input.account_id ?? null,
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

  const result: FuelRecord = {
    id,
    vehicle_id: input.vehicle_id,
    account_id: input.account_id,
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

  try {
    await syncFuelTransaction(result, await getVehicleName(input.vehicle_id));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[fuel] insertFuelRecord: nu s-a putut sincroniza tranzacția:', e);
  }

  return result;
}

export async function deleteFuelRecord(id: string): Promise<void> {
  // Șterge tranzacția financiară asociată (dacă există) înainte de a șterge alimentarea.
  await db.runAsync('DELETE FROM transactions WHERE fuel_record_id = ?', [id]);
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
  account_id?: string | null;
  vehicle_id?: string | null;
}

export async function updateFuelRecord(id: string, fields: UpdateFuelRecordInput): Promise<void> {
  const station = fields.station?.trim() || null;
  const pump = fields.pump_number?.trim() || null;
  const currency = fields.currency || 'RON';

  // Construim un UPDATE flexibil pentru a permite vehicle_id/account_id să fie omise (păstrează valoarea curentă)
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
  if (fields.account_id !== undefined) {
    sets.push('account_id = ?');
    params.push(fields.account_id ?? null);
  }
  if (fields.vehicle_id !== undefined) {
    sets.push('vehicle_id = ?');
    params.push(fields.vehicle_id ?? null);
  }
  params.push(id);

  await db.runAsync(`UPDATE fuel_records SET ${sets.join(', ')} WHERE id = ?`, params);

  const updated = await getFuelRecord(id);
  if (updated) {
    try {
      await syncFuelTransaction(updated, await getVehicleName(updated.vehicle_id));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[fuel] updateFuelRecord: nu s-a putut sincroniza tranzacția:', e);
    }
  }
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
  // Sortăm cronologic; folosim KM când există, altfel data ca tie-break
  const sorted = [...records]
    .filter(r => r.liters !== undefined)
    .sort((a, b) => {
      const ak = a.km_total ?? Number.POSITIVE_INFINITY;
      const bk = b.km_total ?? Number.POSITIVE_INFINITY;
      if (ak !== bk) return ak - bk;
      return a.date.localeCompare(b.date);
    });

  // Pivoții pentru calcul: only is_full=true ȘI km_total cunoscut
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
