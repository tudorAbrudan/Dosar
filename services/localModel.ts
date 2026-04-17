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
    description: 'Model Mistral compact, bun la urmarea instrucțiunilor. Context 8K tokeni. iPhone 14+.',
    sizeBytes: 2000 * 1024 * 1024,
    sizeLabel: '~2GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    nCtx: 8192,
    downloadUrl:
      'https://huggingface.co/bartowski/Ministral-3B-Instruct-GGUF/resolve/main/Ministral-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B IT',
    description: 'Calitate maximă disponibilă local. Context 8K tokeni. Necesită iPhone 15 Pro+ și ~4GB spațiu liber.',
    sizeBytes: 4100 * 1024 * 1024,
    sizeLabel: '~4.1GB',
    minRamBytes: 8 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 5,
    nCtx: 8192,
    downloadUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
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
export function getAllModels(): Array<LocalModelEntry & { incompatibilityReason: string | null }> {
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
  return AsyncStorage.getItem(KEY_SELECTED);
}

export async function setSelectedModelId(modelId: string): Promise<void> {
  await AsyncStorage.setItem(KEY_SELECTED, modelId);
}

export async function clearSelectedModelId(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SELECTED);
}


// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Creează un download resumable pentru modelul dat.
 * UI-ul apelează .downloadAsync() și poate apela .pauseAsync() pentru anulare.
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
    getModelPath(modelId),
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

export async function deleteModel(modelId: string): Promise<void> {
  const path = getModelPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
  const selected = await getSelectedModelId();
  if (selected === modelId) {
    await clearSelectedModelId();
  }
}

// ─── Inferență ───────────────────────────────────────────────────────────────

let _llamaContext: LlamaContext | null = null;
let _loadedModelId: string | null = null;

/**
 * Inițializează contextul llama.rn pentru modelul dat.
 * Dacă modelul este deja încărcat, nu face nimic.
 * Dacă un alt model este încărcat, eliberează contextul anterior.
 */
export async function initLocalModel(modelId: string): Promise<void> {
  if (_loadedModelId === modelId && _llamaContext !== null) return;

  if (_llamaContext !== null) {
    await _llamaContext.release();
    _llamaContext = null;
    _loadedModelId = null;
  }

  const path = getModelPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    throw new Error(`Modelul "${modelId}" nu este descărcat. Descarcă-l din Setări → Asistent AI.`);
  }

  // Verifică că fișierul nu e gol/corupt (minim 100MB)
  const MIN_VALID_SIZE = 100 * 1024 * 1024;
  if ((info as { size?: number }).size !== undefined && (info as { size: number }).size < MIN_VALID_SIZE) {
    throw new Error(
      'Fișierul modelului pare corupt sau incomplet. Șterge modelul din Setări → Asistent AI și descarcă-l din nou.'
    );
  }

  const modelEntry = LOCAL_MODEL_CATALOG.find(m => m.id === modelId);
  const nCtx = modelEntry?.nCtx ?? 32768;

  // Try GPU first, fall back to CPU if Metal not available
  try {
    _llamaContext = await initLlama({
      model: path,
      use_mlock: true,
      n_ctx: nCtx,
      n_gpu_layers: 99,
    });
  } catch {
    try {
      _llamaContext = await initLlama({
        model: path,
        use_mlock: true,
        n_ctx: nCtx,
        n_gpu_layers: 0,
      });
    } catch (e) {
      throw new Error(
        'Nu s-a putut încărca modelul AI local. Posibile cauze: fișier corupt, memorie insuficientă sau format incompatibil.\n\nÎncearcă: Setări → Asistent AI → șterge și descarcă din nou modelul.'
      );
    }
  }
  _loadedModelId = modelId;
}

/**
 * Rulează inferența cu modelul local activ.
 * Dacă modelul nu e inițializat, îl inițializează automat.
 */
export async function runLocalInference(
  messages: AiMessage[],
  maxTokens = 500
): Promise<string> {
  const selectedId = await getSelectedModelId();
  if (!selectedId) {
    throw new Error('Niciun model local selectat. Alege un model din Setări → Asistent AI.');
  }

  await initLocalModel(selectedId);

  const result = await _llamaContext!.completion({
    messages,
    n_predict: maxTokens,
    temperature: 0.3,
    stop: ['</s>', '<|end|>', '<|eot_id|>', '<end_of_turn>'],
  });

  return result.text.trim();
}

export async function disposeLocalModel(): Promise<void> {
  if (_llamaContext) {
    await _llamaContext.release();
    _llamaContext = null;
    _loadedModelId = null;
  }
}
