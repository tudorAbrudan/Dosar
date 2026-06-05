import type { Document, VehicleFuelType } from '@/types';
import type { FuelStats } from './fuel';
import type { StatusSeverity } from '@/theme/colors';

const CRITICAL_DAYS = 7;

export type StatusItemRaw = {
  key: 'rca' | 'casco' | 'itp' | 'vigneta' | 'fuel';
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

function resolveItpExpiry(documents: Document[]): { doc: Document; iso: string } | undefined {
  const itp = pickLatestDocWithExpiry(documents, 'itp');
  const talonPick = pickLatestTalonItp(documents);
  if (itp && talonPick) {
    return itp.expiry_date! >= talonPick.iso
      ? { doc: itp, iso: itp.expiry_date! }
      : { doc: talonPick.doc, iso: talonPick.iso };
  }
  if (itp) return { doc: itp, iso: itp.expiry_date! };
  if (talonPick) return { doc: talonPick.doc, iso: talonPick.iso };
  return undefined;
}

function buildDocItem(
  doc: Document,
  key: 'rca' | 'casco' | 'itp' | 'vigneta',
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
  const itpResolved = resolveItpExpiry(documents);
  if (itpResolved)
    items.push(buildDocItem(itpResolved.doc, 'itp', 'ITP', notificationDays, today, itpResolved.iso));

  const vigneta = pickLatestDocWithExpiry(documents, 'vigneta');
  if (vigneta) items.push(buildDocItem(vigneta, 'vigneta', 'Rovinietă', notificationDays, today));

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

export type LegalObligationKey = 'rca' | 'itp' | 'vigneta';
export type LegalObligationStatus = 'ok' | 'expiring' | 'expired' | 'missing';
export type LegalObligation = {
  key: LegalObligationKey;
  label: string;
  status: LegalObligationStatus;
  expiryIso?: string;
  daysRemaining?: number;
  docId?: string;
};

const LEGAL_LABELS: Record<LegalObligationKey, string> = {
  rca: 'RCA',
  itp: 'ITP',
  vigneta: 'Rovinietă',
};

function resolveLegalExpiry(
  documents: Document[],
  key: LegalObligationKey
): { iso: string; docId: string } | undefined {
  if (key === 'itp') {
    const r = resolveItpExpiry(documents);
    return r ? { iso: r.iso, docId: r.doc.id } : undefined;
  }
  const doc = pickLatestDocWithExpiry(documents, key);
  return doc ? { iso: doc.expiry_date!, docId: doc.id } : undefined;
}

export function buildVehicleLegalStatus(
  documents: Document[],
  today: Date,
  notificationDays: number
): LegalObligation[] {
  const keys: LegalObligationKey[] = ['rca', 'itp', 'vigneta'];
  return keys.map(key => {
    const r = resolveLegalExpiry(documents, key);
    if (!r) return { key, label: LEGAL_LABELS[key], status: 'missing' as const };
    const days = daysBetween(r.iso, today);
    const status: LegalObligationStatus =
      days < 0 ? 'expired' : days <= notificationDays ? 'expiring' : 'ok';
    return {
      key,
      label: LEGAL_LABELS[key],
      status,
      expiryIso: r.iso,
      daysRemaining: days,
      docId: r.docId,
    };
  });
}
