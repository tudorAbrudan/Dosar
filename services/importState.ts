/**
 * Starea unui import / restaurare în curs și coordonarea lui cu sync-ul de partajare.
 *
 * Modul frunză, fără importuri: entities, documents, cloudShare și hook-urile citesc
 * de aici dacă rulează un import, fără să importe backup.ts sau cloudShare.ts doar
 * pentru un flag (fiecare astfel de import închidea un ciclu de require).
 */

// Contoare, nu boolean: două importuri care se suprapun (restaurare + import ZIP) nu
// închid flag-ul unul altuia — primul terminat lăsa restaurarea fără gardă.
let importsRunning = 0;
let restoresRunning = 0;
let shareSyncInFlight: Promise<void> | null = null;

/**
 * True cât rulează `applyManifest` (restaurare din cloud SAU import ZIP). Serviciile
 * de documente nu re-pun în coada de upload fișierele care vin din manifest.
 */
export function isImportInProgress(): boolean {
  return importsRunning > 0;
}

/**
 * True doar cât rulează o restaurare cu înlocuire (wipeFirst). Restaurarea păstrează
 * ID-urile originale, deci rândurile ei se potrivesc cu registrul de partajare: dacă
 * mutațiile ar fi împinse în zonele CloudKit, starea din backup ar suprascrie datele
 * mai noi din zonă (la participant: datele owner-ului). Hook-urile de partajare din
 * entities/documents verifică flag-ul SINCRON, la locul apelului.
 */
export function isRestoreInProgress(): boolean {
  return restoresRunning > 0;
}

/** Marchează începutul unui import; întoarce funcția care îl încheie (o singură dată). */
export function beginImport(options: { restore: boolean }): () => void {
  importsRunning++;
  if (options.restore) restoresRunning++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    importsRunning--;
    if (options.restore) restoresRunning--;
  };
}

/** Un singur sync de partajare odată: al doilea apelant primește rularea în curs. */
export function runShareSyncExclusive(run: () => Promise<void>): Promise<void> {
  if (shareSyncInFlight) return shareSyncInFlight;
  const current = run().finally(() => {
    if (shareSyncInFlight === current) shareSyncInFlight = null;
  });
  shareSyncInFlight = current;
  return current;
}

/** Așteaptă sync-ul de partajare în curs (dacă există), fără să-i propage eroarea. */
export async function waitForShareSyncIdle(): Promise<void> {
  if (shareSyncInFlight) await shareSyncInFlight.catch(() => {});
}
