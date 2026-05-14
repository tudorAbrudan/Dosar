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
