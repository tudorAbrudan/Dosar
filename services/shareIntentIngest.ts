/**
 * Validare și clasificare a fișierelor primite prin iOS Share Extension
 * (expo-share-intent). Pur — import type-only, zero dependențe runtime.
 *
 * iOS nu poate restrânge activation rules la „doar PDF" (regula acceptă
 * orice fișier), așa că filtrarea de tip se face aici, în aplicație.
 */
import type { ShareIntentFile } from 'expo-share-intent';

export const MAX_SHARED_IMAGES = 10;

export type ShareIngestPlan = {
  /** Imagini, în ordinea primită (devin pagini, fiecare prin cropper). */
  images: ShareIntentFile[];
  /** Maxim un PDF (activation rule permite 1; defensiv și aici). */
  pdf: ShareIntentFile | null;
  /** Tipuri nesuportate sau peste limită — raportate userului. */
  ignored: ShareIntentFile[];
};

function isImage(file: ShareIntentFile): boolean {
  return typeof file.mimeType === 'string' && file.mimeType.startsWith('image/');
}

function isPdf(file: ShareIntentFile): boolean {
  return (
    file.mimeType === 'application/pdf' ||
    (typeof file.fileName === 'string' && file.fileName.toLowerCase().endsWith('.pdf'))
  );
}

export function planShareIngest(files: ShareIntentFile[]): ShareIngestPlan {
  const plan: ShareIngestPlan = { images: [], pdf: null, ignored: [] };
  for (const file of files) {
    if (isImage(file) && plan.images.length < MAX_SHARED_IMAGES) {
      plan.images.push(file);
    } else if (isPdf(file) && plan.pdf === null) {
      plan.pdf = file;
    } else {
      plan.ignored.push(file);
    }
  }
  return plan;
}

export function describeIgnored(plan: ShareIngestPlan): string | null {
  if (plan.ignored.length === 0) return null;
  const names = plan.ignored
    .map(f => f.fileName)
    .filter(Boolean)
    .join(', ');
  return (
    `Dosar acceptă doar imagini (maxim ${MAX_SHARED_IMAGES}) și un PDF. ` +
    `Fișiere ignorate: ${names || String(plan.ignored.length)}.`
  );
}

/** Path-urile din App Group pot veni fără schemă — normalizează la file:// URI. */
export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}
