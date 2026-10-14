import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getStoredLocalModelId } from './localModelSelection';

// ─── Limită zilnică ────────────────────────────────────────────────────────────

export const DAILY_AI_LIMIT = 10;

/** Ghidul public „cum îți iei cheie API proprie", linkat în mesajul de limită. */
export const AI_KEY_GUIDE_URL = 'https://tudorabrudan.github.io/Dosar/support.html#cheie-api';

/**
 * Îndrumarea afișată ori de câte ori AI-ul e blocat de o limită — a noastră
 * (DAILY_AI_LIMIT) sau a providerului din spate (HTTP 429).
 *
 * Text UNIC, folosit în toate punctele: chat, analiză document, test conexiune.
 * Înainte, fiecare cale avea alt mesaj — chat-ul spunea doar „încearcă mai
 * târziu", fără nicio alternativă, iar analiza documentului trimitea în Setări
 * fără să spună ce să configureze acolo. Raportat pe device 2026-09-04.
 */
/** Trimitere scurtă la ghid, pentru mesajele care au deja explicația proprie. */
export const AI_CONFIG_HINT = `Setări → Asistent AI → „Cheie API proprie". Ghid: ${AI_KEY_GUIDE_URL}`;

export const AI_UNLIMITED_HINT =
  'Ai două variante, ambele nelimitate:\n\n' +
  '• Model local — rulează pe telefon, offline, datele nu pleacă nicăieri. ' +
  'Setări → Asistent AI → Model local.\n\n' +
  '• Cheie API proprie — de la Mistral (are plan gratuit) sau alt provider. ' +
  `Ghid pas cu pas: ${AI_KEY_GUIDE_URL}`;
export const AI_CONSENT_KEY = 'ai_assistant_consent_accepted';
const KEY_DAILY_USAGE_PREFIX = 'ai_daily_usage_';

function todayDateKey(): string {
  return KEY_DAILY_USAGE_PREFIX + new Date().toISOString().slice(0, 10);
}

export async function getAiUsageToday(): Promise<number> {
  const v = await AsyncStorage.getItem(todayDateKey());
  return v ? parseInt(v, 10) : 0;
}

export async function incrementAiUsage(): Promise<void> {
  const key = todayDateKey();
  const current = await getAiUsageToday();
  await AsyncStorage.setItem(key, String(current + 1));
}

export async function isAiLimitReached(): Promise<boolean> {
  const config = await getAiConfig();
  if (config.type !== 'builtin') return false;
  const used = await getAiUsageToday();
  return used >= DAILY_AI_LIMIT;
}

// ─── Tipuri ────────────────────────────────────────────────────────────────────

export type AiProviderType = 'none' | 'builtin' | 'external' | 'local';

export interface AiProviderConfig {
  type: AiProviderType;
  // Provider chat (text-only): chatbot, extracție text-only fallback.
  url: string;
  apiKey: string;
  model: string;
  /**
   * Provider OCR / vision (cereri cu imagine).
   * Permite folosirea unui provider COMPLET diferit pentru OCR (ex. chat pe Mistral
   * free + OCR pe Claude Haiku cu credit gratuit Anthropic; sau chat local + OCR
   * remote). Dacă oricare din cele 3 câmpuri (`visionUrl`, `visionApiKey`,
   * `visionModel`) e gol, fallback la provider-ul de chat când e capabil; altfel
   * vision indisponibil.
   */
  visionUrl: string;
  visionApiKey: string;
  visionModel: string;
  /**
   * Doar pentru `type === 'external'`: marchează că modelul de chat configurat
   * suportă imagini (ex: Pixtral, GPT-4o, Claude). Folosit de `canDoVision` pentru
   * a decide dacă butonul „Trimite la AI" e vizibil când nu există vision provider
   * separat. Default false — user-ul trebuie să bifeze explicit în Setări.
   */
  chatModelSupportsVision: boolean;
}

// ─── Cheie inclusă în aplicație ───────────────────────────────────────────────

/**
 * „Dosar AI" NU mai vorbește direct cu Mistral. Trece printr-un proxy propriu
 * (ai-proxy/, deployat pe Danube Rapids), care ține cheia Mistral pe server.
 *
 * Motivul: orice `EXPO_PUBLIC_*` ajunge compilat în bundle-ul din App Store,
 * deci cheia era extractibilă și folosibilă de oricine — exact ce s-a și
 * întâmplat (rate limit permanent pe cheia veche, 2026-09-07).
 *
 * Ce e mai jos NU e o cheie API: e un token de aplicație care doar deschide
 * poarta proxy-ului. Extras din bundle, nu dă acces la contul Mistral, e limitat
 * la 3 modele din whitelist și la o cotă zilnică, iar accesul poate fi tăiat
 * server-side fără release nou. Vezi ai-proxy/README.md.
 */
const BUILTIN_API_KEY = process.env.EXPO_PUBLIC_DOSAR_AI_TOKEN ?? '';
const BUILTIN_URL = process.env.EXPO_PUBLIC_DOSAR_AI_URL ?? '';
// Pe canalul Dosar AI rulăm 3 modele Mistral, alese după sarcină:
// - chat conversațional (chatbot) → small (rapid, ieftin, suficient)
// - extracție de date din text (OCR JSON, fallback fără imagine) → large (precizie pe câmpuri/date)
// - extracție vision pe scris de mână / print termic (talon, ITP, bon carburant)
//   → pixtral large (singurul care citește ștampile scrise de mână)
// - extracție vision pe documente tipărite (majoritatea) → mistral small, care
//   are vision și costă un ordin de mărime mai puțin. Vezi `VisionTier`.
// Userii cu cheie proprie (`external`) sau model local folosesc modelul ales de ei.
/**
 * Identificator anonim de device, folosit DOAR ca găleată de contorizare în
 * proxy (limita zilnică per device). Nu pleacă nicăieri altundeva și nu conține
 * nimic despre user sau despre documentele lui.
 *
 * Fără el, proxy-ul cade pe IP — iar pe mobil operatorii pun mii de abonați în
 * spatele aceluiași IP prin CGNAT, deci userii legitimi și-ar consuma reciproc
 * cota și ar primi 429 pe nedrept.
 */
const KEY_AI_DEVICE_ID = 'ai_device_id';
let cachedDeviceId: string | null = null;

async function getAiDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await AsyncStorage.getItem(KEY_AI_DEVICE_ID);
  if (!id) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random()
      .toString(36)
      .slice(2, 12)}`;
    await AsyncStorage.setItem(KEY_AI_DEVICE_ID, id);
  }
  cachedDeviceId = id;
  return id;
}

/**
 * Header-ele suplimentare pentru provider-ul `builtin`. Pentru `external`
 * (cheia userului, direct la providerul lui) nu trimitem nimic în plus.
 */
async function builtinHeaders(type: AiProviderType): Promise<Record<string, string>> {
  if (type !== 'builtin') return {};
  return { 'X-Dosar-Device': await getAiDeviceId() };
}

/** Token-ul de acces la Dosar AI, pentru testul de conexiune din Setări. */
export function getBuiltinAiToken(): string {
  return BUILTIN_API_KEY;
}

const BUILTIN_MODEL = 'mistral-small-latest';
const BUILTIN_EXTRACTION_MODEL = 'mistral-large-latest';
const BUILTIN_VISION_MODEL = 'pixtral-large-latest';
const BUILTIN_VISION_MODEL_LIGHT = 'mistral-small-latest';

/**
 * Cât de „greu" trebuie să fie modelul vision pentru cererea curentă.
 * - `high` — scris de mână, ștampile, bonuri termice, serii minuscule.
 * - `light` — document tipărit clar (clasificare, facturi, analize, contracte).
 * Se aplică DOAR canalului `builtin` (Dosar AI); pe cheie proprie folosim modelul
 * configurat de user, indiferent de tier.
 */
export type VisionTier = 'light' | 'high';

// ─── Default-uri per provider ─────────────────────────────────────────────────

export const PROVIDER_DEFAULTS: Record<
  AiProviderType,
  { url: string; model: string; label: string }
> = {
  builtin: {
    url: BUILTIN_URL,
    model: BUILTIN_MODEL,
    label: 'Dosar AI',
  },
  external: {
    url: '',
    model: '',
    label: 'Cheie API proprie',
  },
  none: {
    url: '',
    model: '',
    label: 'Fără AI',
  },
  local: {
    url: '',
    model: '',
    label: 'Model local',
  },
};

const VALID_PROVIDER_TYPES = new Set<string>(Object.keys(PROVIDER_DEFAULTS));

/**
 * Cele 4 moduri, cu aceleași texte în onboarding și în Setări. Userul alege
 * „unde merg datele", nu un provider tehnic — de aceea fiecare mod spune
 * explicit ce pleacă de pe telefon (`dataFlow`).
 */
export interface AiModeOption {
  type: AiProviderType;
  title: string;
  summary: string;
  dataFlow: string;
}

export const AI_MODE_OPTIONS: readonly AiModeOption[] = [
  {
    type: 'local',
    title: PROVIDER_DEFAULTS.local.label,
    summary: 'Pe telefon · privat · nelimitat · merge și fără internet',
    dataFlow: 'Nimic nu pleacă de pe telefon. Descarci o singură dată un model AI.',
  },
  {
    type: 'builtin',
    title: PROVIDER_DEFAULTS.builtin.label,
    summary: `În cloud · ${DAILY_AI_LIMIT} cereri pe zi gratuit · fără configurare`,
    dataFlow:
      'Textul documentelor (și poza, doar când o trimiți tu) trece prin serverul Dosar AI ' +
      'către Mistral AI. Serverul nu păstrează conținutul cererilor.',
  },
  {
    type: 'external',
    title: PROVIDER_DEFAULTS.external.label,
    summary: 'În cloud · nelimitat · Mistral, OpenAI, Anthropic sau alt provider compatibil',
    dataFlow:
      'Datele pleacă direct de pe telefon la providerul ales de tine și sunt procesate ' +
      'conform politicii lui.',
  },
  {
    type: 'none',
    title: PROVIDER_DEFAULTS.none.label,
    summary: 'Aplicația funcționează complet, fără asistent și fără completare automată',
    dataFlow: 'Nimic nu se trimite nicăieri.',
  },
];

// ─── Ruta datelor ─────────────────────────────────────────────────────────────

/**
 * Unde ajung datele pentru configurația curentă — SINGURA sursă pentru
 * întrebarea „pleacă ceva de pe telefon?". Guard-urile de privacy, bara de
 * consimțământ și vizibilitatea butoanelor AI decid din ea.
 *
 * - `text`: chat + extracție din text. `device` = model local (llama.rn).
 * - `images`: cereri cu poza documentului. `none` = configurația nu citește
 *   imagini (cererea se face doar pe text). Un model local cu „provider OCR
 *   remote" trimite pozele în cloud chiar dacă textul rămâne pe telefon.
 */
export interface AiRoute {
  text: 'off' | 'device' | 'cloud';
  images: 'none' | 'cloud';
}

function hasSeparateVisionProvider(config: AiProviderConfig): boolean {
  return (
    config.visionUrl.trim() !== '' &&
    config.visionApiKey.trim() !== '' &&
    config.visionModel.trim() !== ''
  );
}

export function getAiRoute(config: AiProviderConfig): AiRoute {
  switch (config.type) {
    case 'none':
      return { text: 'off', images: 'none' };
    case 'local':
      return { text: 'device', images: hasSeparateVisionProvider(config) ? 'cloud' : 'none' };
    case 'builtin':
      return { text: 'cloud', images: 'cloud' };
    case 'external':
      return {
        text: 'cloud',
        images:
          hasSeparateVisionProvider(config) || config.chatModelSupportsVision ? 'cloud' : 'none',
      };
  }
}

/** True dacă măcar o parte din date (text sau poze) pleacă de pe telefon. */
export function aiRouteLeavesDevice(route: AiRoute): boolean {
  return route.text === 'cloud' || route.images === 'cloud';
}

export async function getCurrentAiRoute(): Promise<AiRoute> {
  return getAiRoute(await getAiConfig());
}

// ─── Chei stocare ─────────────────────────────────────────────────────────────

const KEY_PROVIDER_TYPE = 'ai_provider_type';
const KEY_PROVIDER_URL = 'ai_provider_url';
const KEY_PROVIDER_MODEL = 'ai_provider_model';
const KEY_PROVIDER_VISION_URL = 'ai_provider_vision_url';
const KEY_PROVIDER_VISION_MODEL = 'ai_provider_vision_model';
const KEY_CHAT_MODEL_SUPPORTS_VISION = 'ai_chat_model_supports_vision';
const SECURE_KEY_API_KEY = 'ai_provider_api_key';
const SECURE_KEY_VISION_API_KEY = 'ai_provider_vision_api_key';

// Snapshot persistent al configului „Cheie API proprie" (external). Stocat
// separat de configul activ, astfel încât comutarea spre „Dosar AI" și înapoi
// la „Cheie proprie" să NU piardă URL/model/vision pe care userul le-a setat.
// apiKey + visionApiKey rămân în SecureStore (independent de tip).
const KEY_EXT_SNAP_URL = 'ai_external_snapshot_url';
const KEY_EXT_SNAP_MODEL = 'ai_external_snapshot_model';
const KEY_EXT_SNAP_VISION_URL = 'ai_external_snapshot_vision_url';
const KEY_EXT_SNAP_VISION_MODEL = 'ai_external_snapshot_vision_model';
const KEY_EXT_SNAP_CHAT_VISION = 'ai_external_snapshot_chat_vision';

// ─── Citire / scriere config ──────────────────────────────────────────────────

export async function getAiConfig(): Promise<AiProviderConfig> {
  const [
    typeRaw,
    urlRaw,
    modelRaw,
    visionUrlRaw,
    visionModelRaw,
    chatVisionRaw,
    apiKey,
    visionApiKey,
  ] = await Promise.all([
    AsyncStorage.getItem(KEY_PROVIDER_TYPE),
    AsyncStorage.getItem(KEY_PROVIDER_URL),
    AsyncStorage.getItem(KEY_PROVIDER_MODEL),
    AsyncStorage.getItem(KEY_PROVIDER_VISION_URL),
    AsyncStorage.getItem(KEY_PROVIDER_VISION_MODEL),
    AsyncStorage.getItem(KEY_CHAT_MODEL_SUPPORTS_VISION),
    getAiApiKey(),
    getAiVisionApiKey(),
  ]);

  // Migrare valori vechi → external
  const legacyMap: Record<string, AiProviderType> = {
    mistral: 'external',
    openai: 'external',
    custom: 'external',
  };
  const rawType = typeRaw ?? 'builtin';
  const type: AiProviderType =
    legacyMap[rawType] ??
    (VALID_PROVIDER_TYPES.has(rawType) ? (rawType as AiProviderType) : 'builtin');

  // Persistă migrarea — scrie valoarea nouă în storage dacă era o valoare veche
  if (legacyMap[rawType]) {
    void AsyncStorage.setItem(KEY_PROVIDER_TYPE, type);
  }

  const defaults = PROVIDER_DEFAULTS[type];

  // Pentru modelul local, sursa de adevăr e selecția din localModel (scrisă la
  // descărcare și la alegerea din listă). `ai_provider_model` rămânea gol după
  // onboarding („Model local" → descărcare), iar chat-urile răspundeau „Modelul
  // local nu este selectat" deși modelul era instalat și bifat în Setări.
  let model = modelRaw ?? defaults.model;
  if (type === 'local') {
    model = (await getStoredLocalModelId()) ?? '';
  }

  return {
    type,
    url: urlRaw ?? defaults.url,
    model,
    visionUrl: visionUrlRaw ?? '',
    visionModel: visionModelRaw ?? '',
    chatModelSupportsVision: chatVisionRaw === 'true',
    apiKey,
    visionApiKey,
  };
}

export async function saveAiConfig(
  config: Pick<
    AiProviderConfig,
    'type' | 'url' | 'model' | 'visionUrl' | 'visionModel' | 'chatModelSupportsVision'
  >
): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_PROVIDER_TYPE, config.type],
    [KEY_PROVIDER_URL, config.url],
    [KEY_PROVIDER_MODEL, config.model],
    [KEY_PROVIDER_VISION_URL, config.visionUrl],
    [KEY_PROVIDER_VISION_MODEL, config.visionModel],
    [KEY_CHAT_MODEL_SUPPORTS_VISION, config.chatModelSupportsVision ? 'true' : 'false'],
  ]);
}

export async function getAiApiKey(): Promise<string> {
  const key = await SecureStore.getItemAsync(SECURE_KEY_API_KEY);
  return key ?? '';
}

export async function saveAiApiKey(key: string): Promise<void> {
  if (key) {
    await SecureStore.setItemAsync(SECURE_KEY_API_KEY, key);
  } else {
    await SecureStore.deleteItemAsync(SECURE_KEY_API_KEY);
  }
}

export async function getAiVisionApiKey(): Promise<string> {
  const key = await SecureStore.getItemAsync(SECURE_KEY_VISION_API_KEY);
  return key ?? '';
}

export async function saveAiVisionApiKey(key: string): Promise<void> {
  if (key) {
    await SecureStore.setItemAsync(SECURE_KEY_VISION_API_KEY, key);
  } else {
    await SecureStore.deleteItemAsync(SECURE_KEY_VISION_API_KEY);
  }
}

// ─── Snapshot config extern (persistă peste comutări de provider) ────────────

export interface ExternalChatSnapshot {
  url: string;
  model: string;
  apiKey: string;
  visionUrl: string;
  visionModel: string;
  visionApiKey: string;
  chatModelSupportsVision: boolean;
}

/**
 * Persistă config-ul „Cheie API proprie" (URL, model, vision*) separat de
 * config-ul activ. Apelat la fiecare Save din modalul AI ca să reziste
 * comutărilor între provideri și restart-urilor de app.
 *
 * `apiKey` și `visionApiKey` rămân în SecureStore (nu se duplică aici).
 */
export async function saveExternalChatSnapshot(
  snap: Omit<ExternalChatSnapshot, 'apiKey' | 'visionApiKey'>
): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_EXT_SNAP_URL, snap.url],
    [KEY_EXT_SNAP_MODEL, snap.model],
    [KEY_EXT_SNAP_VISION_URL, snap.visionUrl],
    [KEY_EXT_SNAP_VISION_MODEL, snap.visionModel],
    [KEY_EXT_SNAP_CHAT_VISION, snap.chatModelSupportsVision ? 'true' : 'false'],
  ]);
}

/**
 * Citește snapshot-ul „Cheie API proprie". Folosit la mount în Setări pentru a
 * pre-popula formularul când userul comută la „Cheie proprie", fără să piardă
 * ce setase anterior.
 */
export async function getExternalChatSnapshot(): Promise<ExternalChatSnapshot> {
  const [url, model, visionUrl, visionModel, chatVision, apiKey, visionApiKey] = await Promise.all([
    AsyncStorage.getItem(KEY_EXT_SNAP_URL),
    AsyncStorage.getItem(KEY_EXT_SNAP_MODEL),
    AsyncStorage.getItem(KEY_EXT_SNAP_VISION_URL),
    AsyncStorage.getItem(KEY_EXT_SNAP_VISION_MODEL),
    AsyncStorage.getItem(KEY_EXT_SNAP_CHAT_VISION),
    getAiApiKey(),
    getAiVisionApiKey(),
  ]);
  return {
    url: url ?? '',
    model: model ?? '',
    apiKey,
    visionUrl: visionUrl ?? '',
    visionModel: visionModel ?? '',
    visionApiKey,
    chatModelSupportsVision: chatVision === 'true',
  };
}

// ─── Validare config ──────────────────────────────────────────────────────────

/**
 * Validează configurația AI. Returnează un mesaj de eroare în română dacă ceva lipsește,
 * sau null dacă totul e ok pentru a face un request.
 */
export function validateConfig(config: AiProviderConfig): string | null {
  if (config.type === 'none') {
    return 'Asistentul AI este dezactivat. Activează-l din Setări → Asistent AI.';
  }
  if (config.type === 'external') {
    if (!config.url.trim()) {
      return 'URL-ul API lipsește. Verifică Setări → Asistent AI.';
    }
    if (!config.apiKey.trim()) {
      return 'Cheia API lipsește (probabil pierdută la reinstalarea aplicației). Re-introdu cheia din Setări → Asistent AI.';
    }
    if (!config.model.trim()) {
      return 'Modelul AI nu este setat. Verifică Setări → Asistent AI.';
    }
  }
  if (config.type === 'builtin' && (!BUILTIN_API_KEY || !BUILTIN_URL)) {
    return 'Dosar AI nu este disponibil în această versiune. Setează propria cheie API din Setări → Asistent AI.';
  }
  if (config.type === 'local' && !config.model.trim()) {
    return 'Modelul local nu este selectat. Verifică Setări → Asistent AI.';
  }
  return null;
}

/**
 * Întoarce true dacă configurația curentă poate procesa imagini (vision).
 * Folosit în ecranele de adăugare/editare document pentru a decide dacă butonul
 * „Trimite documentul la AI" e vizibil: configurația trebuie să fie validă și
 * ruta pozelor să fie `cloud` (vezi `getAiRoute`).
 */
export async function canDoVision(): Promise<boolean> {
  const config = await getAiConfig();
  return validateConfig(config) === null && getAiRoute(config).images === 'cloud';
}

// ─── Helper fetch cu timeout ──────────────────────────────────────────────────

// Text: 30s (răspunsuri scurte, modele rapide)
// Vision: 90s (documente medicale lungi cu OCR + extracție pot dura semnificativ mai mult)
const TEXT_REQUEST_TIMEOUT_MS = 30_000;
const VISION_REQUEST_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TEXT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error(
        `Cererea AI a expirat (>${secs}s). Cauze posibile:\n` +
          `• Document prea mare sau cu multe pagini\n` +
          `• Limită zilnică atinsă la provider (verifică în Setări → Asistent AI)\n` +
          `• Conexiune lentă sau pierdută\n` +
          `Reîncearcă cu un document mai mic sau completează manual câmpurile.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Transformă orice eroare dintr-un apel AI într-un mesaj în română, potrivit
 * pentru UI/istoric chat. Fără body-uri HTTP brute (JSON englez de la provider)
 * și fără „Network request failed" — acestea derutează și rămân persistate în
 * conversație. Mesajele deja umane (timeout-ul de mai sus, „Răspuns gol...",
 * erorile aiGuard/localModel în română) trec neatinse.
 */
export function humanizeAiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw) return 'A apărut o eroare. Verifică conexiunea la internet și încearcă din nou.';

  // Fereastra de context a modelului LOCAL s-a umplut. Mesajul brut al llama.cpp
  // („Context is full") ajungea ca atare în interfață: englezesc, tehnic și fără
  // nicio cale de ieșire. Un model din cloud are context de zeci de ori mai mare,
  // deci cheia proprie chiar rezolvă problema. Raportat pe device 2026-09-04.
  if (/context is full|context.{0,10}exceeded|too many tokens|context length/i.test(raw)) {
    return (
      'Întrebarea depășește cât poate ține minte modelul local deodată.\n\n' +
      'Încearcă o întrebare mai scurtă sau despre o singură entitate ' +
      '(folosește @ ca să te referi la o persoană sau la o mașină anume).\n\n' +
      `Pentru context mult mai mare, treci pe un model din cloud cu cheia ta. ${AI_CONFIG_HINT}`
    );
  }

  // Erori de rețea RN (TypeError: Network request failed) — engleză, tehnice.
  if (/network request failed|failed to fetch/i.test(raw)) {
    return 'Fără conexiune la internet. Verifică rețeaua și încearcă din nou.';
  }

  // Fișierul imaginii lipsește de la calea din DB — tipic după o reinstalare sau
  // un restore care schimbă UUID-ul containerului iOS. Mesajul brut e o cale
  // `/var/mobile/Containers/...` inutilă pentru user; îl trimitem la reparare.
  if (/does not exist|no such file|isn't readable|readAsStringAsync/i.test(raw)) {
    return (
      'Fișierul imaginii nu se găsește pe telefon. Mergi în Setări → Backup și restaurare → ' +
      '„Repară fișierele documentelor" și încearcă din nou.'
    );
  }

  // Erorile noastre `Eroare AI (<status>): <body brut>` — mapăm status-ul,
  // aruncăm body-ul (poate conține JSON englez de la provider).
  const statusMatch = raw.match(/^Eroare AI \((\d{3})\)/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401 || status === 403) {
      return 'Cheie API invalidă sau expirată. Verifică în Setări → Asistent AI.';
    }
    if (status === 429) {
      // Limita providerului din spate (cheia Dosar AI e comună tuturor
      // utilizatorilor), nu contorul nostru zilnic. Aceeași îndrumare: userul
      // n-are cum să distingă între cele două, și oricum are aceleași soluții.
      return `Serviciul AI inclus e ocupat acum (limită atinsă la provider).\n\n${AI_UNLIMITED_HINT}`;
    }
    if (status >= 500) {
      return 'Serviciul AI e temporar indisponibil. Încearcă din nou în câteva minute.';
    }
    if (status === 402) {
      return `Contul de la providerul AI nu mai are credit.\n\n${AI_UNLIMITED_HINT}`;
    }
    return (
      `Providerul AI a refuzat cererea (cod ${status}). Verifică configurarea din ` +
      `Setări → Asistent AI.\n\n${AI_UNLIMITED_HINT}`
    );
  }

  // Mesaj deja în română (ale noastre) sau necunoscut dar scurt → îl păstrăm;
  // ce e lung/tehnic se trunchiază ca să nu umple conversația.
  if (raw.length <= 200) return raw;
  return `${raw.slice(0, 160)}…`;
}

// ─── Tipuri mesaje OpenAI-compatible ─────────────────────────────────────────

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: { message: { content: string } }[];
}

// ─── Eroare specială: depășire context (folosită de mappers pentru fallback chunked) ─

export class AiContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiContextOverflowError';
  }
}

const OVERFLOW_PATTERNS = [
  /context.{0,20}length/i,
  /max.{0,5}tokens?/i,
  /token.{0,10}limit/i,
  /payload.{0,10}too.{0,5}large/i,
  /request.{0,10}too.{0,5}large/i,
  /too many tokens/i,
];

function isOverflowResponse(status: number, errText: string): boolean {
  if (status === 413) return true;
  if (status === 400 || status === 422) {
    return OVERFLOW_PATTERNS.some(rx => rx.test(errText));
  }
  return false;
}

// ─── Trimitere cerere AI cu imagine (vision) ──────────────────────────────────

/**
 * Trimite o cerere AI cu una sau mai multe imagini (Mistral vision / OpenAI-compatible).
 * Aruncă eroare clară pentru modele locale (nu suportă vision azi).
 * Aruncă `AiContextOverflowError` dacă serverul răspunde cu „context length exceeded"
 * sau payload prea mare — apelantul poate decide să spargă în chunks.
 */
export async function sendAiRequestWithImage(
  systemPrompt: string,
  userText: string,
  imageBase64: string | string[],
  imageMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  maxTokens = 600,
  visionTier: VisionTier = 'high'
): Promise<string> {
  const config = await getAiConfig();

  const validationError = validateConfig(config);
  if (validationError) throw new Error(validationError);

  // Configurația nu citește imagini (model local fără provider OCR remote, sau
  // cheie proprie cu model doar-text): cererea se face doar pe text. Păstrat
  // pentru aiOcrMapper / ocrLlmExtractor care contează pe acest comportament.
  // Înainte, cheia proprie doar-text primea oricum imaginea și cererea pica.
  if (getAiRoute(config).images !== 'cloud') {
    const arr = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
    const userTextWithNote =
      arr.length > 0
        ? `${userText}\n\n[Notă: modelul configurat nu citește imagini — răspunde pe baza textului furnizat.]`
        : userText;
    return sendAiRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userTextWithNote },
      ],
      maxTokens,
      'extraction'
    );
  }

  // Provider remote: eliberează contextul local dacă mai e încărcat (no-op dacă
  // nu). Schimbarea provider-ului în Setări → Asistent AI nu mai impune restart.
  const { disposeLocalModel } = await import('./localModel');
  await disposeLocalModel().catch(() => {});

  if (config.type === 'builtin') {
    const used = await getAiUsageToday();
    if (used >= DAILY_AI_LIMIT) {
      throw new Error(
        `Ai atins limita de ${DAILY_AI_LIMIT} interogări pe zi cu Dosar AI.\n\n${AI_UNLIMITED_HINT}`
      );
    }
  }

  // Dacă userul a configurat un provider OCR complet separat (URL + cheie + model
  // TOATE completate), îl folosim pentru cererile cu imagine — indiferent de tipul
  // de chat. Permite scenarii: chat Mistral free + OCR Anthropic, chat local +
  // OCR remote, etc. Dacă oricare câmp e gol, fallback la provider-ul de chat.
  const useSeparateVisionProvider = hasSeparateVisionProvider(config);

  const apiKey =
    config.type === 'builtin'
      ? BUILTIN_API_KEY
      : useSeparateVisionProvider
        ? config.visionApiKey
        : config.apiKey;

  const baseUrl = (
    config.type === 'builtin'
      ? BUILTIN_URL
      : useSeparateVisionProvider
        ? config.visionUrl
        : config.url
  ).replace(/\/$/, '');

  const model =
    config.type === 'builtin'
      ? visionTier === 'light'
        ? BUILTIN_VISION_MODEL_LIGHT
        : BUILTIN_VISION_MODEL
      : useSeparateVisionProvider
        ? config.visionModel
        : config.model;
  const endpoint = `${baseUrl}/chat/completions`;

  const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  const imageBlocks = images.map(b64 => ({
    type: 'image_url' as const,
    image_url: { url: `data:${imageMimeType};base64,${b64}` },
  }));

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(await builtinHeaders(config.type)),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: userText }],
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    },
    VISION_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (isOverflowResponse(response.status, errText)) {
      throw new AiContextOverflowError(
        `Cererea AI depășește contextul (${response.status}): ${errText.slice(0, 200) || 'context length exceeded'}`
      );
    }
    throw new Error(`Eroare AI (${response.status}): ${errText || 'Răspuns invalid de la server'}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Răspuns gol de la asistentul AI.');

  if (config.type === 'builtin') await incrementAiUsage();

  return content;
}

// ─── Trimitere cerere AI (OpenAI-compatible) ──────────────────────────────────

export type AiRequestPurpose = 'chat' | 'extraction';

export async function sendAiRequest(
  messages: AiMessage[],
  maxTokens = 500,
  purpose: AiRequestPurpose = 'chat'
): Promise<string> {
  const config = await getAiConfig();

  const validationError = validateConfig(config);
  if (validationError) throw new Error(validationError);

  // Model local (llama.rn / GGUF)
  if (config.type === 'local') {
    const { runLocalInference } = await import('./localModel');
    return runLocalInference(messages, maxTokens);
  }

  // Eliberează contextul llama dacă mai e încărcat (no-op dacă nu) — schimbarea
  // provider-ului din Setări nu mai impune restart de app. Fără asta, câțiva GB
  // de RAM (modelul + KV cache) rămân ocupați și pot bloca fetch-ul HTTPS la
  // modele mari sub presiune de memorie.
  const { disposeLocalModel } = await import('./localModel');
  await disposeLocalModel().catch(() => {});

  const apiKey = config.type === 'builtin' ? BUILTIN_API_KEY : config.apiKey;

  // Verifică limita zilnică doar pentru cheia built-in
  if (config.type === 'builtin') {
    const used = await getAiUsageToday();
    if (used >= DAILY_AI_LIMIT) {
      throw new Error(
        `Ai atins limita de ${DAILY_AI_LIMIT} interogări pe zi cu Dosar AI.\n\n${AI_UNLIMITED_HINT}`
      );
    }
  }

  const baseUrl = (config.type === 'builtin' ? BUILTIN_URL : config.url).replace(/\/$/, '');
  const model =
    config.type === 'builtin'
      ? purpose === 'extraction'
        ? BUILTIN_EXTRACTION_MODEL
        : BUILTIN_MODEL
      : config.model;
  const endpoint = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(await builtinHeaders(config.type)),
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Eroare AI (${response.status}): ${errText || 'Răspuns invalid de la server'}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Răspuns gol de la asistentul AI.');
  }

  // Incrementează contorul zilnic (doar pentru builtin)
  if (config.type === 'builtin') {
    await incrementAiUsage();
  }

  return content;
}

// ─── Cine răspunde (afișat în chat-uri) ───────────────────────────────────────

export interface AiAnswererStatus {
  /** null = AI-ul poate răspunde acum; altfel motivul, în română. */
  unavailableReason: string | null;
  /** Cine răspunde și unde, ex. „Model local, pe telefon · Qwen 3.5 2B". */
  label: string;
  /** Răspunsurile din chat se generează pe telefon (nimic nu pleacă). */
  onDevice: boolean;
}

/**
 * Descrierea afișată deasupra ambelor chat-uri, ca userul să știe mereu ce
 * model îi răspunde și dacă întrebarea pleacă de pe telefon.
 */
export async function describeAiAnswerer(): Promise<AiAnswererStatus> {
  const config = await getAiConfig();
  const unavailableReason = validateConfig(config);
  const onDevice = getAiRoute(config).text === 'device';
  switch (config.type) {
    case 'none':
      return { unavailableReason, label: PROVIDER_DEFAULTS.none.label, onDevice: false };
    case 'local': {
      const { LOCAL_MODEL_CATALOG } = await import('./localModel');
      const name = LOCAL_MODEL_CATALOG.find(m => m.id === config.model)?.name;
      return {
        unavailableReason,
        label: `${PROVIDER_DEFAULTS.local.label}, pe telefon${name ? ` · ${name}` : ''}`,
        onDevice,
      };
    }
    case 'builtin': {
      const left = Math.max(0, DAILY_AI_LIMIT - (await getAiUsageToday()));
      return {
        unavailableReason,
        label: `${PROVIDER_DEFAULTS.builtin.label}, în cloud · ${left} din ${DAILY_AI_LIMIT} cereri rămase azi`,
        onDevice,
      };
    }
    case 'external':
      return {
        unavailableReason,
        label: `${PROVIDER_DEFAULTS.external.label}, în cloud${config.model ? ` · ${config.model}` : ''}`,
        onDevice,
      };
  }
}
