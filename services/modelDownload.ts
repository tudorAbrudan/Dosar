/**
 * modelDownload.ts — Manager unic pentru descărcarea modelelor locale.
 *
 * De ce există: descărcarea trebuie să continue când userul navighează mai
 * departe (avansează în onboarding, îl închide, trece prin taburi). Starea ținută
 * într-o componentă moare la demontare, iar un React Context moare când se închide
 * arborele care îl furnizează. Un singleton la nivel de modul supraviețuiește
 * ambelor.
 *
 * Limită cunoscută: `expo-file-system` nu folosește background URLSession, deci
 * iOS suspendă transferul când aplicația iese din prim-plan. Descărcarea e
 * resumable și se reia la revenire, dar NU progresează cu aplicația închisă.
 *
 * Sursă unică: atât onboarding-ul cât și Setări → Asistent AI trec pe aici.
 * Două descărcări simultane pe același fișier ar corupe rezultatul.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  createModelDownload,
  finalizeModelDownload,
  deleteModel,
  setSelectedModelId,
  LOCAL_MODEL_CATALOG,
} from './localModel';

export interface ModelDownloadState {
  /** Id-ul modelului care se descarcă, sau null dacă nu rulează nimic. */
  modelId: string | null;
  /** Numele afișabil al modelului în curs de descărcare. */
  modelName: string | null;
  /** 0–1. */
  progress: number;
  downloadedMb: number;
  totalMb: number;
  /** Mesaj în română, setat la eșec. Se curăță la următoarea pornire. */
  error: string | null;
  /** true cât timp transferul e activ. */
  active: boolean;
}

const IDLE: ModelDownloadState = {
  modelId: null,
  modelName: null,
  progress: 0,
  downloadedMb: 0,
  totalMb: 0,
  error: null,
  active: false,
};

let state: ModelDownloadState = { ...IDLE };
let resumable: ReturnType<typeof createModelDownload> | null = null;
const listeners = new Set<(s: ModelDownloadState) => void>();

function emit(): void {
  for (const l of listeners) l(state);
}

function setState(patch: Partial<ModelDownloadState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getDownloadState(): ModelDownloadState {
  return state;
}

/** Se dezabonează prin funcția întoarsă. Emite imediat starea curentă. */
export function subscribeDownload(cb: (s: ModelDownloadState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Pornește descărcarea. No-op dacă una e deja în curs (inclusiv pentru alt model)
 * — două transferuri simultane ar epuiza memoria și ar concura pe același folder.
 *
 * La succes selectează automat modelul: fără asta fișierul rămâne pe disc dar
 * `runLocalInference` nu-l folosește.
 */
export async function startModelDownload(modelId: string): Promise<boolean> {
  if (state.active) return false;
  const model = LOCAL_MODEL_CATALOG.find(m => m.id === modelId);
  if (!model) return false;

  setState({
    modelId,
    modelName: model.name,
    progress: 0,
    downloadedMb: 0,
    totalMb: model.sizeBytes / (1024 * 1024),
    error: null,
    active: true,
  });

  try {
    await FileSystem.makeDirectoryAsync((FileSystem.documentDirectory ?? '') + 'models/', {
      intermediates: true,
    });
    const dl = createModelDownload(modelId, (progress, downloadedMb, totalMb) => {
      setState({ progress, downloadedMb, totalMb });
    });
    resumable = dl;
    const res = await dl.downloadAsync();
    // undefined = anulat via cancelModelDownload, care a curățat deja fișierul.
    if (!res) return false;
    if (res.status !== 200) {
      throw new Error(`Descărcarea a eșuat (HTTP ${res.status}). Încearcă din nou.`);
    }
    await finalizeModelDownload(modelId);
    await setSelectedModelId(modelId);
    setState({ ...IDLE });
    return true;
  } catch (e) {
    await deleteModel(modelId).catch(() => undefined);
    setState({
      ...IDLE,
      error: e instanceof Error ? e.message : 'Descărcarea a eșuat.',
    });
    return false;
  } finally {
    resumable = null;
  }
}

/** Oprește descărcarea curentă și șterge fișierul parțial. */
export async function cancelModelDownload(): Promise<void> {
  const id = state.modelId;
  try {
    await resumable?.pauseAsync();
  } catch {
    // pauseAsync poate arunca dacă transferul s-a încheiat între timp
  }
  resumable = null;
  if (id) await deleteModel(id).catch(() => undefined);
  setState({ ...IDLE });
}

/** Curăță doar mesajul de eroare (după ce a fost afișat userului). */
export function clearDownloadError(): void {
  if (state.error !== null) setState({ error: null });
}
