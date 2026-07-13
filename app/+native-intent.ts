import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Interceptează URL-urile generate de Share Extension (…dataUrl=<cheie>…) și
 * redirecționează către ecranul „Adaugă document". Fără interceptare,
 * expo-router ar încerca să deschidă path-ul brut → +not-found.
 * (Fișier special expo-router: rulează la orice deep link, cold și warm start.)
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/(tabs)/documente/add';
    }
    return path;
  } catch {
    return '/';
  }
}
