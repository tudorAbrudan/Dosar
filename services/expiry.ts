export const STALE_EXPIRED_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function atMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysUntilExpiry(expiryDate: string, now: Date = new Date()): number {
  const exp = atMidnight(new Date(expiryDate));
  const today = atMidnight(now);
  return Math.round((exp - today) / MS_PER_DAY);
}

export function isExpired(expiryDate: string, now: Date = new Date()): boolean {
  return daysUntilExpiry(expiryDate, now) < 0;
}

export function isStaleExpired(expiryDate: string, now: Date = new Date()): boolean {
  return daysUntilExpiry(expiryDate, now) < -STALE_EXPIRED_DAYS;
}
