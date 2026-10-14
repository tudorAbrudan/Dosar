/**
 * Starea afișată a backup-ului iCloud, derivată din fapte locale ieftine.
 * Funcție pură, testabilă fără iCloud.
 */
import type { CloudStatus } from '@/types';

export interface CloudStatusInput {
  available: boolean;
  enabled: boolean;
  /** Criptarea e activă, dar parola n-a fost introdusă de la pornirea aplicației. */
  passwordRequired: boolean;
  pendingCount: number;
  /** `uploadedAt` din meta-ul din iCloud; null = nu există încă un manifest. */
  lastUploadedAt: number | null;
}

/**
 * Ordinea contează: un backup criptat blocat nu urcă nimic, deci „Parolă necesară"
 * bate „Se sincronizează..." (fișierele rămân în coadă la nesfârșit), iar fără
 * manifest în iCloud nu există nimic de restaurat, chiar dacă pozele au urcat.
 */
export function deriveCloudStatus(s: CloudStatusInput): CloudStatus {
  if (!s.available) return 'unavailable';
  if (!s.enabled) return 'paused';
  if (s.passwordRequired) return 'needsPassword';
  if (s.pendingCount > 0) return 'uploading';
  if (s.lastUploadedAt === null) return 'noBackup';
  return 'idle';
}
