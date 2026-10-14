/**
 * „Backup acum": fișierele din coadă, apoi manifestul, apoi snapshot-ul — cu un
 * rezultat explicit. Înainte, ecranul citea starea hook-ului din render-ul de
 * dinainte de apăsare și afișa „Backup finalizat." și când backup-ul eșua.
 */
import * as cloudStorage from '../cloudStorage';
import {
  isCloudBackupFromOtherDevice,
  maybeSnapshot,
  processQueue,
  uploadManifestIfChanged,
  type BackupProgress,
} from '../cloudSync';
import { isSessionUnlocked, PasswordRequiredError } from '../cloudCrypto';
import {
  getCloudEncryptionEnabled,
  getCloudSnapshotFrequency,
  getCloudSnapshotRetention,
} from '../settings';
import { CloudQuotaError } from './errors';
import { getFailedCount, getPendingCount } from './stats';

export interface BackupNowResult {
  /** Tot ce era de urcat a ajuns în iCloud, inclusiv manifestul. */
  ok: boolean;
  /** S-a urcat ceva (fișiere sau manifest); false = iCloud era deja la zi. */
  changed: boolean;
  /**
   * Nimic nou de urcat, iar backup-ul din iCloud e de pe alt telefon (mai nou decât
   * ultimul de aici) — nu a fost suprascris.
   */
  otherDeviceBackup: boolean;
  /** Fișiere rămase neurcate după rulare (eșuate acum sau blocate definitiv). */
  failedFiles: number;
  /** Motivul eșecului, pentru afișare; null când backup-ul a rulat până la capăt. */
  error: string | null;
  /** Backup criptat cu sesiunea blocată: nu s-a urcat nimic, trebuie cerută parola. */
  passwordRequired: boolean;
  /** iCloud plin: UI-ul afișează banner-ul dedicat. */
  quotaExceeded: boolean;
}

/**
 * Rulează un backup complet și spune exact ce s-a întâmplat. Nu aruncă.
 *
 * Cu criptarea activă și sesiunea blocată se oprește înainte de coadă, ca să nu
 * consume încercările fișierelor cu „Parolă necesară".
 */
export async function runBackupNow(
  onProgress?: (p: BackupProgress) => void
): Promise<BackupNowResult> {
  const result: BackupNowResult = {
    ok: false,
    changed: false,
    otherDeviceBackup: false,
    failedFiles: 0,
    error: null,
    passwordRequired: false,
    quotaExceeded: false,
  };
  try {
    if (!(await cloudStorage.isAvailable())) {
      result.error = 'iCloud nu este disponibil. Verifică dacă iCloud Drive e pornit.';
      return result;
    }
    if ((await getCloudEncryptionEnabled()) && !isSessionUnlocked()) {
      throw new PasswordRequiredError('Parolă necesară pentru backup criptat');
    }
    let last: BackupProgress = {
      phase: 'files',
      current: 0,
      total: 0,
      bytesDone: 0,
      bytesTotal: 0,
    };
    await processQueue(p => {
      last = p;
      onProgress?.(p);
    });
    result.changed = last.total > 0;
    onProgress?.({ ...last, phase: 'manifest' });
    if (await uploadManifestIfChanged()) result.changed = true;
    else if (!result.changed) result.otherDeviceBackup = await isCloudBackupFromOtherDevice();
    onProgress?.({ ...last, phase: 'snapshot' });
    await maybeSnapshot(await getCloudSnapshotFrequency(), await getCloudSnapshotRetention());
  } catch (e) {
    result.passwordRequired = e instanceof PasswordRequiredError;
    result.quotaExceeded = e instanceof CloudQuotaError;
    result.error = e instanceof Error ? e.message : 'Eroare necunoscută';
  }
  try {
    result.failedFiles = (await getPendingCount()) + (await getFailedCount());
  } catch {
    // numărătoarea e doar informativă; rezultatul rămâne valid fără ea
  }
  result.ok = result.error === null && result.failedFiles === 0;
  return result;
}
