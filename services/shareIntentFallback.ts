import { ShareIntentModule, getScheme, getShareExtensionKey } from 'expo-share-intent';

/**
 * iOS 27 livrează aplicației URL-ul extensiei de share ca `acte:///`, fără hostul
 * `dataUrl=<cheie>` și fără fragmentul `#media|#file`. Biblioteca expo-share-intent
 * și `+native-intent.ts` se bazează pe acel URL, deci share-ul nu mai ajungea la
 * ecranul „Adaugă document" (extensia scria corect datele în App Group).
 *
 * Aici cerem modulului nativ datele lăsate de extensie cu un URL sintetic, fără să
 * depindem de URL-ul primit de la sistem. Dacă nu e nimic în App Group, modulul nu
 * emite niciun eveniment. Imaginile sunt `media`, PDF-urile `file`.
 */
export async function pullPendingShareIntent(): Promise<void> {
  const base = `${getScheme()}://dataUrl=${getShareExtensionKey()}`;
  for (const type of ['media', 'file']) {
    try {
      await ShareIntentModule?.getShareIntent(`${base}#${type}`);
    } catch {
      // fără date în App Group / modul indisponibil → nimic de preluat
    }
  }
}
