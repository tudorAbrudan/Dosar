import type { Document, VehicleFuelType } from '@/types';
import type { FuelStats } from './fuel';
import type { StatusSeverity } from '@/theme/colors';

const CRITICAL_DAYS = 7;

export type StatusItemRaw = {
  key: 'rca' | 'casco' | 'itp' | 'fuel';
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
  notificationDays: number;
  today: Date;
  fuelType?: VehicleFuelType;
};

function daysBetween(fromIso: string, to: Date): number {
  const [y, m, d] = fromIso.split('-').map(Number);
  const from = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((from - toUtc) / (1000 * 60 * 60 * 24));
}

function formatDaysRemaining(days: number): string {
  if (days < 0) return 'Expirat';
  if (days === 0) return 'Astăzi';
  if (days < 30) return `${days} ${days === 1 ? 'zi' : 'zile'}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'lună' : 'luni'}`;
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

/**
 * Pentru talon: returnează data ITP efectivă, fie din `expiry_date` (când OCR a
 * setat-o direct), fie din `metadata.itp_expiry_date` (format DD.MM.YYYY) ca
 * fallback pentru taloane create manual sau importate fără expiry_date.
 * Garantează că brick-ul ITP se actualizează imediat după upload-ul talonului,
 * indiferent de calea OCR/manuală.
 */
function getTalonItpIso(doc: Document): string | undefined {
  if (doc.expiry_date) return doc.expiry_date;
  const meta = doc.metadata?.itp_expiry_date;
  if (!meta) return undefined;
  const m = meta.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function pickLatestTalonItp(docs: Document[]): { doc: Document; iso: string } | undefined {
  let best: { doc: Document; iso: string } | undefined;
  for (const d of docs) {
    if (d.type !== 'talon') continue;
    const iso = getTalonItpIso(d);
    if (!iso) continue;
    if (!best || iso > best.iso) best = { doc: d, iso };
  }
  return best;
}

function buildDocItem(
  doc: Document,
  key: 'rca' | 'casco' | 'itp',
  label: string,
  notificationDays: number,
  today: Date,
  expiryIso?: string
): StatusItemRaw {
  const iso = expiryIso ?? doc.expiry_date!;
  const days = daysBetween(iso, today);
  return {
    key,
    label,
    value: formatDaysRemaining(days),
    subValue: formatIsoDateRo(iso),
    severity: severityFromDays(days, notificationDays),
    docId: doc.id,
  };
}

export function buildVehicleStatusItems(args: BuildArgs): StatusItemRaw[] {
  const items: StatusItemRaw[] = [];
  const { documents, fuelStats, notificationDays, today } = args;

  const rca = pickLatestDocWithExpiry(documents, 'rca');
  if (rca) items.push(buildDocItem(rca, 'rca', 'RCA', notificationDays, today));

  const casco = pickLatestDocWithExpiry(documents, 'casco');
  if (casco) items.push(buildDocItem(casco, 'casco', 'CASCO', notificationDays, today));

  // ITP: data e fie pe doc-ul ITP separat, fie pe talon (ștampila RAR).
  // Pentru talon acceptăm și `metadata.itp_expiry_date` ca fallback pentru cazurile
  // în care OCR-ul nu a populat `expiry_date` direct (intrare manuală, import).
  // Dacă există în ambele, alegem expirarea cea mai târzie. Click pe brick → doc-sursă.
  const itp = pickLatestDocWithExpiry(documents, 'itp');
  const talonPick = pickLatestTalonItp(documents);
  let itpSource: Document | undefined;
  let itpIso: string | undefined;
  if (itp && talonPick) {
    if (itp.expiry_date! >= talonPick.iso) {
      itpSource = itp;
      itpIso = itp.expiry_date;
    } else {
      itpSource = talonPick.doc;
      itpIso = talonPick.iso;
    }
  } else if (itp) {
    itpSource = itp;
    itpIso = itp.expiry_date;
  } else if (talonPick) {
    itpSource = talonPick.doc;
    itpIso = talonPick.iso;
  }
  if (itpSource && itpIso)
    items.push(buildDocItem(itpSource, 'itp', 'ITP', notificationDays, today, itpIso));

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
