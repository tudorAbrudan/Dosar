import type { Document, VehicleFuelType } from '@/types';
import type { FuelStats } from './fuel';
import type { StatusSeverity } from '@/theme/colors';

const CRITICAL_DAYS = 7;
const CRITICAL_SERVICE_KM = 500;
const WARNING_SERVICE_KM = 1500;

export type StatusItemRaw = {
  key: 'rca' | 'casco' | 'itp' | 'service' | 'fuel';
  label: string;
  value: string;
  unit?: string;
  subValue?: string;
  severity: StatusSeverity;
  sparkline?: number[];
  docId?: string;
  fuelType?: VehicleFuelType;
};

type BuildArgs = {
  documents: Document[];
  fuelStats: FuelStats;
  itpEnabled: boolean;
  notificationDays: number;
  today: Date;
  fuelType?: VehicleFuelType;
};

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso + 'T00:00:00.000Z');
  const ms = from.getTime() - to.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function formatDaysRemaining(days: number): string {
  if (days < 0) return 'Expirat';
  if (days === 0) return 'Astăzi';
  if (days < 30) return `${days} ${days === 1 ? 'zi' : 'zile'}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'lună' : 'luni'}`;
}

function formatKm(km: number): string {
  return `${km.toLocaleString('ro-RO').replace(/,/g, ' ')} km`;
}

function formatIsoDateRo(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function severityFromDays(days: number, notificationDays: number): StatusSeverity {
  if (days <= CRITICAL_DAYS) return 'critical';
  if (days <= notificationDays) return 'warning';
  return 'ok';
}

function pickLatestDocWithExpiry(docs: Document[], type: Document['type']): Document | undefined {
  const matches = docs.filter(d => d.type === type && d.expiry_date);
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, d) =>
    (d.expiry_date ?? '') > (latest.expiry_date ?? '') ? d : latest
  );
}

function buildDocItem(
  doc: Document,
  key: 'rca' | 'casco' | 'itp',
  label: string,
  notificationDays: number,
  today: Date
): StatusItemRaw {
  const days = daysBetween(doc.expiry_date!, today);
  return {
    key,
    label,
    value: formatDaysRemaining(days),
    subValue: formatIsoDateRo(doc.expiry_date!),
    severity: severityFromDays(days, notificationDays),
    docId: doc.id,
  };
}

export function buildVehicleStatusItems(args: BuildArgs): StatusItemRaw[] {
  const items: StatusItemRaw[] = [];
  const { documents, fuelStats, itpEnabled, notificationDays, today } = args;

  const rca = pickLatestDocWithExpiry(documents, 'rca');
  if (rca) items.push(buildDocItem(rca, 'rca', 'RCA', notificationDays, today));

  const casco = pickLatestDocWithExpiry(documents, 'casco');
  if (casco) items.push(buildDocItem(casco, 'casco', 'CASCO', notificationDays, today));

  if (itpEnabled) {
    const itp = pickLatestDocWithExpiry(documents, 'itp');
    if (itp) items.push(buildDocItem(itp, 'itp', 'ITP', notificationDays, today));
  }

  if (fuelStats.kmUntilService !== undefined && fuelStats.latestKm !== undefined) {
    const km = fuelStats.kmUntilService;
    let severity: StatusSeverity;
    let value: string;
    if (fuelStats.needsService || km <= 0) {
      severity = 'critical';
      value = 'Depășit';
    } else if (km <= CRITICAL_SERVICE_KM) {
      severity = 'critical';
      value = formatKm(km);
    } else if (km <= WARNING_SERVICE_KM) {
      severity = 'warning';
      value = formatKm(km);
    } else {
      severity = 'ok';
      value = formatKm(km);
    }
    items.push({
      key: 'service',
      label: 'REVIZIE',
      value,
      subValue: fuelStats.latestKm ? `la ${formatKm(fuelStats.latestKm)}` : undefined,
      severity,
    });
  }

  if (fuelStats.avgConsumptionL100 !== undefined) {
    items.push({
      key: 'fuel',
      label: 'CONSUM',
      value: fuelStats.avgConsumptionL100.toFixed(1),
      unit: 'L/100km',
      severity: 'ok',
      sparkline: fuelStats.consumptionSparkline,
      fuelType: args.fuelType,
    });
  }

  return items;
}
