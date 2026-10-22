/**
 * Formatare bytes pentru UI (progres upload/download, estimare backup size).
 *
 * Extras din `cloudSync.ts` pentru reutilizare independentă (Onboarding,
 * CloudRestoreProgress, Setări Cloud). Pură — fără side effects.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const MONTHS_SHORT = [
  'ian.',
  'feb.',
  'mar.',
  'apr.',
  'mai',
  'iun.',
  'iul.',
  'aug.',
  'sept.',
  'oct.',
  'nov.',
  'dec.',
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Data ultimului backup pentru rândul de stare din Setări: „azi, 09:41",
 * „ieri, 18:20", „12 oct." sau „12 oct. 2025". Fără Intl, ca să nu depindă
 * de datele de localizare din Hermes.
 */
export function formatLastBackup(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay(d, today)) return `azi, ${time}`;
  if (sameDay(d, yesterday)) return `ieri, ${time}`;
  const day = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}
