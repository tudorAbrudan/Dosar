/**
 * Tipuri de eroare pentru fluxul cloud sync (iCloud / Drive).
 *
 * Extras din `cloudSync.ts` pentru ca UI-ul (banner-uri în Setări Cloud) să
 * poată face `instanceof` și `detectQuotaError` să fie testabilă independent.
 */

/**
 * Aruncată când iCloud Drive refuză scrierea fiindcă quota contului e plină.
 * UI-ul afișează banner specific cu CTA către Setări iCloud.
 */
export class CloudQuotaError extends Error {
  constructor(
    message = 'iCloud-ul tău nu mai are spațiu liber. Eliberează spațiu sau extinde planul iCloud și încearcă din nou.'
  ) {
    super(message);
    this.name = 'CloudQuotaError';
  }
}

/**
 * Heuristică pentru a recunoaște erorile de quota plină din `react-native-cloud-storage`.
 * iOS poate raporta în mai multe moduri: `NSFileWriteOutOfSpaceError` (cod 640),
 * mesaj URLSession ("not enough space"), POSIX `ENOSPC`, sau text generic „quota".
 * Match-ul pe string e fragil între versiuni iOS — actualizează lista când apare alt mesaj.
 */
export function detectQuotaError(e: unknown): boolean {
  if (!e) return false;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (!msg) return false;
  if (msg.includes('quota')) return true;
  if (msg.includes('not enough space')) return true;
  if (msg.includes('insufficient') && msg.includes('space')) return true;
  if (msg.includes('no space left')) return true;
  if (msg.includes('out of space')) return true;
  if (msg.includes('storage is full') || msg.includes('storage full')) return true;
  if (msg.includes('nsfilewriteoutofspaceerror')) return true;
  if (msg.includes('enospc')) return true;
  if (/\bcode\s*=?\s*640\b/.test(msg)) return true;
  return false;
}
