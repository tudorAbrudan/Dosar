/**
 * localModel.ts — Gestionează modele LLM locale (llama.rn / GGUF Q4_K_M).
 *
 * Responsabilități:
 * - Catalog static de modele (6 modele IT)
 * - Verificare compatibilitate device (RAM + generație iPhone)
 * - Download cu progress callback
 * - Persistență selecție în AsyncStorage
 * - Inferență via llama.rn
 * - Flag OCR local
 */

import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initLlama, LlamaContext } from 'llama.rn';
import type { AiMessage } from './aiProvider';

// ─── Tipuri ───────────────────────────────────────────────────────────────────

export interface LocalModelEntry {
  id: string;
  name: string;
  description: string;
  /** Dimensiune aproximativă în bytes */
  sizeBytes: number;
  /** Label afișat în UI, ex: "~1.5GB" */
  sizeLabel: string;
  /** RAM minim necesar în bytes */
  minRamBytes: number;
  /** Generație minimă iPhone (ex: 14 = iPhone 14) */
  minIphoneGen: number;
  /** Stele calitate 1–5 */
  qualityStars: number;
  /** Fereastra de context folosită la inițializare (tokeni) */
  nCtx: number;
  /** URL HuggingFace pentru descărcare fișier GGUF */
  downloadUrl: string;
}

export type DownloadProgressCallback = (
  progress: number,
  downloadedMb: number,
  totalMb: number
) => void;

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const LOCAL_MODEL_CATALOG: LocalModelEntry[] = [
  {
    id: 'ministral-3b',
    name: 'Ministral 3B IT',
    description:
      'Model Mistral compact, bun la urmarea instrucțiunilor. Context 16K tokeni. iPhone 14+.',
    sizeBytes: 2000 * 1024 * 1024,
    sizeLabel: '~2GB',
    minRamBytes: 5 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    nCtx: 16384,
    downloadUrl:
      'https://huggingface.co/bartowski/Ministral-3B-Instruct-GGUF/resolve/main/Ministral-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B IT',
    description:
      'Calitate maximă disponibilă local. Context 16K tokeni. Necesită iPhone 15 Pro+ și ~4GB spațiu liber.',
    sizeBytes: 4100 * 1024 * 1024,
    sizeLabel: '~4.1GB',
    minRamBytes: 7 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 5,
    nCtx: 16384,
    downloadUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  },
  // ── Gemma 4, tiered pe capacitatea device-ului ──────────────────────────────
  // head_dim 512 pe layerele globale → KV cache + compute buffers cresc rapid.
  // Pe A15/6GB, Q4_K_M (3.1GB) trecea plafonul de memorie la inferență (OOM Metal
  // apoi jetsam). Soluție: quant mai mic pe 6GB, quant/model mai mare pe 8GB.
  // n_ctx=8192 + n_ubatch mic (vezi initLocalModel) țin vârful sub prag.
  // Istoric complet: loguri OOM/jetsam 2026-06-30 → 2026-07-01.
  {
    id: 'gemma4-e2b-q3',
    name: 'Gemma 4 E2B (6GB)',
    description:
      'Google Gemma 4 E2B, cuantizare Q3_K_S — optimizată pentru telefoane de 6GB (iPhone 13/14 Pro). Modernă și eficientă, doar text. ~2.3GB spațiu liber.',
    sizeBytes: Math.round(2.28 * 1024 * 1024 * 1024),
    sizeLabel: '~2.3GB',
    minRamBytes: 5 * 1024 * 1024 * 1024,
    minIphoneGen: 13,
    qualityStars: 3,
    // Q3_K_S (2.28GB) e cu ~830MB mai mic decât Q4 → marjă de memorie pentru un
    // n_ctx mai mare. La 12288: working set GPU ~3.3GB (sub plafonul A15 ~4.3GB),
    // proces ~3.9GB (sub jetsam). Lasă loc note/OCR 500 în prompt. 2026-07-01.
    nCtx: 12288,
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q3_K_S.gguf',
  },
  {
    id: 'gemma4-e2b-q8',
    name: 'Gemma 4 E2B (calitate maximă)',
    description:
      'Google Gemma 4 E2B, cuantizare Q8_0 — calitate aproape identică cu modelul plin. Necesită iPhone 15 Pro+ (8GB). ~4.7GB spațiu liber. Doar text.',
    sizeBytes: Math.round(4.7 * 1024 * 1024 * 1024),
    sizeLabel: '~4.7GB',
    minRamBytes: 7 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 4,
    nCtx: 8192,
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q8_0.gguf',
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B IT',
    description:
      'Google Gemma 4 E4B — model mai mare și mai capabil decât E2B, cuantizare Q4_K_M. Necesită iPhone 15 Pro+ (8GB). ~4.6GB spațiu liber. Doar text.',
    sizeBytes: Math.round(4.64 * 1024 * 1024 * 1024),
    sizeLabel: '~4.6GB',
    minRamBytes: 7 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 5,
    nCtx: 8192,
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
  },
];

// ─── Compatibilitate ─────────────────────────────────────────────────────────

/** Extrage numărul generației iPhone din modelName (ex: "iPhone 14 Pro" → 14). */
export function getIphoneGeneration(modelName: string | null): number {
  if (!modelName) return 0;
  const match = modelName.match(/iPhone\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Verifică dacă un model este compatibil cu device-ul.
 * ramBytes=null înseamnă că Device.totalMemory nu e disponibil (emulator) → compatibil.
 */
export function isModelCompatible(
  model: LocalModelEntry,
  ramBytes: number | null,
  iphoneGen: number
): boolean {
  if (ramBytes !== null && ramBytes < model.minRamBytes) return false;
  if (iphoneGen > 0 && iphoneGen < model.minIphoneGen) return false;
  return true;
}

/**
 * Returnează motivul incompatibilității sau null dacă e compatibil.
 */
export function getIncompatibilityReason(
  model: LocalModelEntry,
  ramBytes: number | null,
  iphoneGen: number
): string | null {
  const reasons: string[] = [];
  if (ramBytes !== null && ramBytes < model.minRamBytes) {
    const needGb = Math.round(model.minRamBytes / (1024 * 1024 * 1024));
    reasons.push(`necesită ${needGb}GB RAM`);
  }
  if (iphoneGen > 0 && iphoneGen < model.minIphoneGen) {
    reasons.push(`necesită iPhone ${model.minIphoneGen}+`);
  }
  return reasons.length > 0 ? reasons.join(', ') : null;
}

/**
 * Returnează toate modelele din catalog cu flag de compatibilitate.
 */
export function getAllModels(): (LocalModelEntry & { incompatibilityReason: string | null })[] {
  const ramBytes = Device.totalMemory;
  const iphoneGen = getIphoneGeneration(Device.modelName);
  return LOCAL_MODEL_CATALOG.map(m => ({
    ...m,
    incompatibilityReason: getIncompatibilityReason(m, ramBytes, iphoneGen),
  }));
}

/**
 * Returnează modelele din catalog compatibile cu device-ul curent.
 */
export function getCompatibleModels(): LocalModelEntry[] {
  const ramBytes = Device.totalMemory;
  const iphoneGen = getIphoneGeneration(Device.modelName);
  return LOCAL_MODEL_CATALOG.filter(m => isModelCompatible(m, ramBytes, iphoneGen));
}

// ─── Persistență ─────────────────────────────────────────────────────────────

const KEY_SELECTED = 'local_model_selected';

function getModelsDir(): string {
  return (FileSystem.documentDirectory ?? '') + 'models/';
}

export function getModelPath(modelId: string): string {
  return getModelsDir() + modelId + '.gguf';
}

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(getModelPath(modelId));
  return info.exists && !(info as { isDirectory?: boolean }).isDirectory;
}

export async function getSelectedModelId(): Promise<string | null> {
  const id = await AsyncStorage.getItem(KEY_SELECTED);
  // Ignoră o selecție care nu mai există în catalog (ex. model scos/redenumit
  // între versiuni). Altfel s-ar încerca încărcarea unui fișier orfan de pe disc.
  if (id && !LOCAL_MODEL_CATALOG.some(m => m.id === id)) return null;
  return id;
}

export async function setSelectedModelId(modelId: string): Promise<void> {
  await AsyncStorage.setItem(KEY_SELECTED, modelId);
}

export async function clearSelectedModelId(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SELECTED);
}

// ─── Download ────────────────────────────────────────────────────────────────

/** Calea temporară de download: fișierul final apare abia după finalize. */
function getModelPartPath(modelId: string): string {
  return getModelPath(modelId) + '.part';
}

/**
 * Creează un download resumable pentru modelul dat. Descarcă într-un fișier
 * temporar `<id>.gguf.part` — un download întrerupt (app omorât, crash) nu lasă
 * niciodată un GGUF parțial pe calea finală, deci `isModelDownloaded` nu poate
 * raporta fals „descărcat".
 * UI-ul apelează .downloadAsync() (undefined = anulat via .pauseAsync()),
 * verifică status-ul HTTP, apoi cheamă finalizeModelDownload(modelId).
 * La anulare, UI-ul trebuie să apeleze deleteModel(modelId) pentru curățare.
 */
export function createModelDownload(
  modelId: string,
  onProgress: DownloadProgressCallback
): ReturnType<typeof FileSystem.createDownloadResumable> {
  const model = LOCAL_MODEL_CATALOG.find(m => m.id === modelId);
  if (!model) throw new Error(`Model necunoscut: ${modelId}`);

  return FileSystem.createDownloadResumable(
    model.downloadUrl,
    getModelPartPath(modelId),
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : model.sizeBytes;
      const progress = totalBytesWritten / total;
      const downloadedMb = totalBytesWritten / (1024 * 1024);
      const totalMb = total / (1024 * 1024);
      onProgress(progress, downloadedMb, totalMb);
    }
  );
}

/**
 * Promovează fișierul temporar `.part` pe calea finală, după un download
 * complet (status HTTP verificat de caller). Abia de aici modelul devine
 * vizibil pentru isModelDownloaded/initLocalModel.
 */
export async function finalizeModelDownload(modelId: string): Promise<void> {
  const partPath = getModelPartPath(modelId);
  const info = await FileSystem.getInfoAsync(partPath);
  if (!info.exists) {
    throw new Error('Fișierul descărcat lipsește. Reia descărcarea.');
  }
  await FileSystem.moveAsync({ from: partPath, to: getModelPath(modelId) });
}

export async function deleteModel(modelId: string): Promise<void> {
  for (const path of [getModelPath(modelId), getModelPartPath(modelId)]) {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  }
  const selected = await getSelectedModelId();
  if (selected === modelId) {
    await clearSelectedModelId();
  }
}

export interface OrphanModelFile {
  /** Nume fișier (ex: "gemma-e2b.gguf") */
  name: string;
  sizeBytes: number;
}

/**
 * Listează fișierele `.gguf` din folderul `models/` care NU corespund unui id
 * din catalogul curent. Apar când catalogul s-a schimbat în timp (modele
 * scoase, redenumite) iar fișierele descărcate de versiuni vechi rămân pe disc
 * fără să mai fie referite de UI. Pot ocupa câțiva GB.
 */
export async function listOrphanModels(): Promise<OrphanModelFile[]> {
  const dir = getModelsDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return [];
  let files: string[];
  try {
    files = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
  const knownFiles = new Set(LOCAL_MODEL_CATALOG.map(m => `${m.id}.gguf`));
  const orphans: OrphanModelFile[] = [];
  for (const name of files) {
    if (!name.endsWith('.gguf')) continue;
    if (knownFiles.has(name)) continue;
    try {
      const info = await FileSystem.getInfoAsync(dir + name);
      const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
      orphans.push({ name, sizeBytes: size });
    } catch {
      // skip — nu blochează lista pentru un singur fișier corupt
    }
  }
  return orphans;
}

/**
 * Șterge toate fișierele orphan returnate de `listOrphanModels`. Returnează
 * câți au fost șterși și câți bytes s-au eliberat (best-effort — un fișier
 * care nu poate fi șters nu blochează restul).
 */
export async function deleteOrphanModels(): Promise<{
  deletedCount: number;
  freedBytes: number;
}> {
  const dir = getModelsDir();
  const orphans = await listOrphanModels();
  let deletedCount = 0;
  let freedBytes = 0;
  for (const o of orphans) {
    try {
      await FileSystem.deleteAsync(dir + o.name, { idempotent: true });
      deletedCount++;
      freedBytes += o.sizeBytes;
    } catch {
      // skip — best-effort
    }
  }
  return { deletedCount, freedBytes };
}

// ─── Inferență ───────────────────────────────────────────────────────────────

let _llamaContext: LlamaContext | null = null;
let _loadedModelId: string | null = null;

/**
 * Numărul de inferențe în curs. Modelul nu se eliberează cât e > 0 — un
 * `release()` în mijlocul unui `completion()` crapă nativ. Toate căile de
 * inferență (chatbot, medicalChat, aiClassifier, ocrLlmExtractor) trec prin
 * `runLocalInference`, deci un singur contor acoperă tot.
 */
let _inferenceInFlight = 0;

/**
 * Încărcarea unui model e în curs (`initLlama` rulează). În fereastra asta
 * `_llamaContext` e încă null, deci `releaseModelForBackground` n-ar avea ce
 * elibera — dar modelul de ~2-3GB tocmai se rezidențiază. Dacă app-ul trece în
 * background aici, marcăm cererea și eliberăm imediat ce load-ul se termină.
 */
let _initInFlight = false;
let _disposeRequestedDuringInit = false;

/**
 * Inițializează contextul llama.rn pentru modelul dat.
 * Dacă modelul este deja încărcat, nu face nimic.
 * Dacă un alt model este încărcat, eliberează contextul anterior.
 */
export async function initLocalModel(modelId: string): Promise<void> {
  if (_loadedModelId === modelId && _llamaContext !== null) return;

  // Prin disposeLocalModel, nu release direct: dacă o inferență pe modelul vechi
  // e încă în zbor, contextul e parcat și eliberat la finalul ei (release direct
  // mid-completion crapă nativ).
  await disposeLocalModel();

  const path = getModelPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    throw new Error(`Modelul "${modelId}" nu este descărcat. Descarcă-l din Setări → Asistent AI.`);
  }

  // Verifică că fișierul nu e gol/corupt (minim 100MB)
  const MIN_VALID_SIZE = 100 * 1024 * 1024;
  if (
    (info as { size?: number }).size !== undefined &&
    (info as { size: number }).size < MIN_VALID_SIZE
  ) {
    throw new Error(
      'Fișierul modelului pare corupt sau incomplet. Șterge modelul din Setări → Asistent AI și descarcă-l din nou.'
    );
  }

  const modelEntry = LOCAL_MODEL_CATALOG.find(m => m.id === modelId);
  const nCtx = modelEntry?.nCtx ?? 32768;

  // ctx_shift = true: la depășirea n_ctx, llama trunchiază automat tokeni vechi
  // în loc să arunce „Context is full". Acceptabil pentru aplicație: la fiecare
  // mesaj reconstruim system prompt-ul integral, deci pierderea unui turn vechi
  // e nesemnificativă față de un crash dur.
  _disposeRequestedDuringInit = false;
  _initInFlight = true;
  try {
    try {
      _llamaContext = await initLlama({
        model: path,
        use_mlock: false,
        n_ctx: nCtx,
        n_gpu_layers: 99,
        ctx_shift: true,
        // Prefill-ul în bucăți mici reduce vârful de memorie al buffer-ului de
        // compute → evită jetsam pe device-uri de 6GB (modelul de ~2-3GB e deja la
        // limită). Compromis: prefill mai lent. Vezi crash jetsam 2026-06-30/07-01.
        n_batch: 128,
        n_ubatch: 128,
      });
    } catch {
      // GPU (Metal) a eșuat → reîncearcă pe CPU (mai lent, dar fără OOM Metal).
      _llamaContext = await initLlama({
        model: path,
        use_mlock: false,
        n_ctx: nCtx,
        n_gpu_layers: 0,
        ctx_shift: true,
        n_batch: 128,
        n_ubatch: 128,
      });
    }
    _loadedModelId = modelId;
  } catch {
    throw new Error(
      'Nu s-a putut încărca modelul AI local. Posibile cauze: fișier corupt, memorie insuficientă sau format incompatibil.\n\nÎncearcă: Setări → Asistent AI → șterge și descarcă din nou modelul.'
    );
  } finally {
    _initInFlight = false;
  }

  // App-ul a trecut în background în timpul încărcării → eliberează acum, altfel
  // ~2-3GB rămân rezidenți cu procesul suspendat și iOS îl omoară (jetsam).
  if (_disposeRequestedDuringInit) {
    _disposeRequestedDuringInit = false;
    await disposeLocalModel();
  }
}

/**
 * Forțează alternarea user/assistant în array-ul de mesaje. Template-urile Jinja
 * ale modelelor locale (ex. Mistral 7B Instruct) refuză cu excepție explicită
 * mesaje consecutive cu același rol. Această normalizare:
 * - păstrează `system` ca atare;
 * - îmbină perechi consecutive de același rol într-un singur mesaj.
 *
 * Acoperă scenariul în care un mesaj user a fost salvat în DB dar răspunsul
 * assistant a eșuat (sau a fost șters manual), lăsând două user-uri lipite.
 */
export function normalizeMessagesForLocal(messages: AiMessage[]): AiMessage[] {
  const result: AiMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }
  return result;
}

/**
 * Curăță lanțul de raționament („thinking") scurs în text. Gemma 4 emite blocuri
 * `<|channel>thought ... <channel|>{răspuns}`. Dacă parsarea nativă a reasoning-ului
 * nu le prinde (tag-uri ne-standard), le eliminăm noi și păstrăm doar răspunsul.
 */
export function stripReasoning(text: string): string {
  let t = text;
  // Bloc complet thinking → răspuns: păstrează ce e după <channel|>
  t = t.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');
  // Markeri reziduali de canal (deschideri fără pereche, format trunchiat)
  t = t.replace(/<\/?\|?channel\|?>/g, '');
  // Tag explicit de thinking dacă rămâne deschis fără închidere
  t = t.replace(/<\|channel>thought[\s\S]*$/g, '');
  return t.trim();
}

/**
 * Coadă de serializare pentru inferență. `llama.cpp`/`llama.rn` NU suportă
 * două `completion()` concurente pe același context — corup starea internă a
 * sampler-ului (heap corruption nativ, SIGABRT în `initSampling()`).
 *
 * De ce se poate ajunge la două apeluri concurente în JS deși fiecare callsite
 * face `await sendAiRequest(...)`: unele fluxuri pornesc o a doua inferență
 * fire-and-forget (ex. `medicalChat.autoRenameAfterFirstExchange`, apelat fără
 * `await` după ce `sendMessage` s-a rezolvat deja). UI-ul consideră trimiterea
 * „terminată" și userul poate trimite imediat un mesaj nou → al doilea
 * `runLocalInference` pornește cât primul (title-gen) e încă activ pe același
 * `_llamaContext`. Cu provider remote (HTTP) e inofensiv; cu contextul nativ
 * local, crapă. Coada de mai jos forțează execuție strict secvențială,
 * indiferent de câte apeluri concurente pornesc din JS.
 * Crash confirmat din .ips device: 2026-07-26.
 */
let _inferenceQueue: Promise<void> = Promise.resolve();

export function runLocalInference(messages: AiMessage[], maxTokens = 500): Promise<string> {
  const task = _inferenceQueue.then(() => runLocalInferenceExclusive(messages, maxTokens));
  // Coada continuă indiferent de rezultatul acestui task — un eșec nu trebuie
  // să blocheze inferențele următoare. `.then` cu ambele ramuri în loc de
  // `.catch` ca să nu producă un unhandled rejection separat pe ramura de eroare.
  _inferenceQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function runLocalInferenceExclusive(
  messages: AiMessage[],
  maxTokens: number
): Promise<string> {
  const selectedId = await getSelectedModelId();
  if (!selectedId) {
    throw new Error('Niciun model local selectat. Alege un model din Setări → Asistent AI.');
  }

  await initLocalModel(selectedId);

  // Contextul poate fi null dacă app-ul a intrat în background în timpul
  // încărcării (dispose-when-ready din initLocalModel). Aruncăm o eroare
  // retryabilă în loc să crăpăm pe `_llamaContext!.completion()`.
  if (!_llamaContext) {
    throw new Error('Modelul a fost eliberat (app în fundal). Deschide asistentul din nou.');
  }

  const normalized = normalizeMessagesForLocal(messages);

  _inferenceInFlight++;
  try {
    const result = await _llamaContext.completion({
      messages: normalized,
      n_predict: maxTokens,
      temperature: 0.3,
      stop: ['</s>', '<|end|>', '<|eot_id|>', '<end_of_turn>'],
      // Modele cu „thinking" (ex. Gemma 4) emit un lanț de raționament în canale
      // separate. Cerem llama.cpp să-l parseze și să nu-l genereze deloc.
      enable_thinking: false,
      reasoning_format: 'auto',
    });

    // `content` = text filtrat (fără reasoning_content/tool_calls); `text` = brut.
    // Preferăm content; cădem pe text dacă lipsește (modele fără reasoning).
    const raw = result.content?.trim() ? result.content : result.text;
    const cleaned = stripReasoning(raw);
    // NU întoarce string gol: ar fi salvat ca mesaj assistant fără content și ar
    // strica thread-ul (API-uri stricte precum Mistral resping mesaje goale cu 400).
    if (!cleaned) {
      throw new Error('Modelul local nu a generat un răspuns. Încearcă din nou sau reformulează.');
    }
    return cleaned;
  } finally {
    _inferenceInFlight--;
    if (_inferenceInFlight === 0 && _pendingReleaseContexts.length > 0) {
      const toRelease = _pendingReleaseContexts;
      _pendingReleaseContexts = [];
      // Fire-and-forget: caller-ul dispose-ului n-a așteptat oricum (a primit
      // return imediat); eșecul release-ului e doar logat, nu propagat.
      for (const ctx of toRelease) {
        void ctx.release().catch(e =>
          console.warn('[localModel] dispose amânat a eșuat:', e instanceof Error ? e.message : e)
        );
      }
    }
  }
}

/**
 * Contexte cu dispose cerut în timpul unei inferențe (ex. userul comută
 * provider-ul pe remote în Setări în timp ce extracția medicală batch rulează
 * pe modelul local). `release()` în mijlocul unui `completion()` crapă nativ —
 * parcăm contextul aici (și `_llamaContext` devine null imediat, deci un
 * init ulterior încarcă curat alt model) și eliberăm la finalul inferenței
 * curente (finally din runLocalInference). Listă, nu un singur slot: acoperă
 * și un switch de model urmat de încă un dispose înainte să se golească.
 */
let _pendingReleaseContexts: LlamaContext[] = [];

export async function disposeLocalModel(): Promise<void> {
  if (_llamaContext && _inferenceInFlight > 0) {
    _pendingReleaseContexts.push(_llamaContext);
    _llamaContext = null;
    _loadedModelId = null;
    return;
  }
  if (_llamaContext) {
    await _llamaContext.release();
    _llamaContext = null;
    _loadedModelId = null;
  }
}

/**
 * Eliberează modelul când app-ul intră în background.
 *
 * Motiv: contextul llama.rn ține câțiva GB de model GGUF rezidenți în RAM. iOS
 * omoară agresiv (jetsam) procesele cu memorie mare aflate în background, ceea
 * ce produce „app-ul se închide instant când îl readuc în prim-plan" (procesul
 * e deja mort; abia a doua deschidere e un cold start curat). Descărcând modelul
 * la trecerea în background scădem amprenta de memorie sub pragul de jetsam.
 *
 * Re-inițializarea e lazy: `runLocalInference` cheamă `initLocalModel` la
 * următoarea folosire a AI-ului, deci singurul cost e o reîncărcare de câteva
 * secunde data viitoare când deschizi asistentul.
 *
 * No-op (returnează `false`) dacă o inferență e în curs — `release()` în mijlocul
 * unui `completion()` ar crăpa nativ.
 *
 * Dacă modelul se ÎNCARCĂ chiar acum (`initLlama` în curs, `_llamaContext` încă
 * null), nu putem elibera un context inexistent — marcăm cererea, iar
 * `initLocalModel` eliberează imediat ce load-ul se termină. Acoperă fereastra
 * cu memorie maximă (load-ul unui GGUF de 2-3GB), cea mai expusă la jetsam.
 *
 * Returnează `true` doar dacă a eliberat efectiv contextul acum.
 */
export async function releaseModelForBackground(): Promise<boolean> {
  if (_inferenceInFlight > 0) return false;
  if (_initInFlight) {
    _disposeRequestedDuringInit = true;
    return false;
  }
  if (!_llamaContext) return false;
  await disposeLocalModel();
  return true;
}
