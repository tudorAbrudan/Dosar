import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const BUNDLE_ID = 'com.ax.documente';
const ITUNES_URL = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=ro`;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const KEY_LAST_CHECK = 'update_last_check_ts';
const KEY_CACHED_VERSION = 'update_cached_version';
const KEY_CACHED_URL = 'update_cached_url';
const KEY_CACHED_RELEASE = 'update_cached_release_date';
const KEY_DISMISSED = 'update_dismissed_version';

export interface UpdateInfo {
  version: string;
  url: string;
  /** true dacă versiunea din App Store a fost lansată cu >30 de zile în urmă */
  mandatory: boolean;
}

function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

function isNewer(storeVer: string, installedVer: string): boolean {
  const a = storeVer.split('.').map(Number);
  const b = installedVer.split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/**
 * Verifică dacă există o versiune nouă în App Store.
 *
 * Reguli:
 * - iTunes API apelat cel mult o dată pe săptămână (cache AsyncStorage).
 * - Dacă nu e net sau API eșuează: returnează null (silențios).
 * - Dacă versiunea e la zi: returnează null.
 * - mandatory=false → banner dismissabil (versiunea nouă e recentă, <30 zile).
 * - mandatory=true  → blocare aplicație (versiunea nouă a fost disponibilă >30 zile).
 *   Starea dismissed este ignorată când mandatory=true.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const [dismissed, lastCheckStr, cachedVersion, cachedUrl, cachedRelease] =
      await AsyncStorage.multiGet([
        KEY_DISMISSED,
        KEY_LAST_CHECK,
        KEY_CACHED_VERSION,
        KEY_CACHED_URL,
        KEY_CACHED_RELEASE,
      ]).then(pairs => pairs.map(([, v]) => v));

    const now = Date.now();
    const cacheAge = lastCheckStr ? now - parseInt(lastCheckStr, 10) : Infinity;
    const cacheValid = cacheAge < WEEK_MS && !!cachedVersion && !!cachedUrl && !!cachedRelease;

    let storeVersion: string;
    let storeUrl: string;
    let releaseTs: number;
    // mandatory=true doar pe verificare live — niciodată din cache.
    // Dacă nu putem confirma live (offline, app dispărut din store, timeout),
    // utilizatorul poate folosi aplicația în continuare.
    let fromCache: boolean;

    if (cacheValid) {
      storeVersion = cachedVersion!;
      storeUrl = cachedUrl!;
      releaseTs = parseInt(cachedRelease!, 10);
      fromCache = true;
    } else {
      // Fetch iTunes (timeout 8s)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let data: {
        results?: Array<{
          version: string;
          trackViewUrl: string;
          currentVersionReleaseDate: string;
        }>;
      };
      try {
        const response = await fetch(ITUNES_URL, { signal: controller.signal });
        if (!response.ok) return null;
        data = (await response.json()) as typeof data;
      } finally {
        clearTimeout(timer);
      }

      const result = data.results?.[0];
      // Dacă app-ul nu mai e în App Store (results goale) → curăță cache, nicio blocare
      if (!result?.version || !result?.trackViewUrl) {
        await AsyncStorage.multiRemove([KEY_CACHED_VERSION, KEY_CACHED_URL, KEY_CACHED_RELEASE]);
        return null;
      }

      storeVersion = result.version;
      storeUrl = result.trackViewUrl;
      releaseTs = new Date(result.currentVersionReleaseDate ?? now).getTime();
      fromCache = false;

      await AsyncStorage.multiSet([
        [KEY_LAST_CHECK, String(now)],
        [KEY_CACHED_VERSION, storeVersion],
        [KEY_CACHED_URL, storeUrl],
        [KEY_CACHED_RELEASE, String(releaseTs)],
      ]);
    }

    // Versiunea instalată e la zi — nimic de făcut
    if (!isNewer(storeVersion, currentVersion())) return null;

    // mandatory doar dacă: verificare live confirmă + versiunea e disponibilă de >30 zile
    // Din cache → maxim banner dismissabil, niciodată blocare
    const mandatory = !fromCache && now - releaseTs > MONTH_MS;

    // Dacă e dismissat și NU e obligatoriu — respectă dorința utilizatorului
    if (!mandatory && dismissed === storeVersion) return null;

    return { version: storeVersion, url: storeUrl, mandatory };
  } catch {
    return null;
  }
}

/** Salvează că utilizatorul a dismissat bannerul pentru versiunea dată (ignorat dacă mandatory). */
export async function dismissUpdate(version: string): Promise<void> {
  await AsyncStorage.setItem(KEY_DISMISSED, version);
}

/**
 * Verificare forțată — ignoră cache-ul, face fetch direct la iTunes API.
 * Returnează UpdateInfo dacă există versiune nouă, null dacă e la zi sau eșuează.
 * Nu aplică logica de "dismissed" — afișează mereu rezultatul.
 */
export async function checkForUpdateForced(): Promise<UpdateInfo | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let data: {
      results?: Array<{
        version: string;
        trackViewUrl: string;
        currentVersionReleaseDate: string;
      }>;
    };
    try {
      const response = await fetch(ITUNES_URL, { signal: controller.signal });
      if (!response.ok) return null;
      data = (await response.json()) as typeof data;
    } finally {
      clearTimeout(timer);
    }

    const result = data.results?.[0];
    if (!result?.version || !result?.trackViewUrl) return null;

    const storeVersion = result.version;
    const storeUrl = result.trackViewUrl;
    const releaseTs = new Date(result.currentVersionReleaseDate ?? Date.now()).getTime();

    // Actualizează cache-ul
    const now = Date.now();
    await AsyncStorage.multiSet([
      [KEY_LAST_CHECK, String(now)],
      [KEY_CACHED_VERSION, storeVersion],
      [KEY_CACHED_URL, storeUrl],
      [KEY_CACHED_RELEASE, String(releaseTs)],
    ]);

    if (!isNewer(storeVersion, currentVersion())) return null;

    const mandatory = now - releaseTs > MONTH_MS;
    return { version: storeVersion, url: storeUrl, mandatory };
  } catch {
    return null;
  }
}
