# Model local AI (llama.rn) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă suport pentru modele LLM locale (llama.rn) în aplicație, cu catalog de 6 modele filtrat per device, download cu progress, selector unificat AI în setări și onboarding, și opțiune OCR local.

**Architecture:** `'local'` și `'none'` se adaugă în `AiProviderType` existent. Un nou serviciu `services/localModel.ts` gestionează catalogul, compatibilitatea device-ului, download-ul GGUF, inferența via `llama.rn` și persistența în AsyncStorage. `sendAiRequest` din `aiProvider.ts` rutează spre `localModel.runLocalInference()` când `type === 'local'`. UI-ul din `setari.tsx` înlocuiește chip-urile de provider cu un selector radio unificat ce include toate configurările AI + catalogul de modele locale. `OnboardingWizard` înlocuiește toggle-ul cu 4 opțiuni + link spre site static.

**Tech Stack:** `llama.rn` (llama.cpp, GGUF Q4_K_M), `expo-device` (RAM + model device), `expo-file-system/legacy` (download + stocare modele), `@react-native-async-storage/async-storage` (persistență selecție), React Native / Expo / TypeScript, Jest.

---

## Structura fișierelor

| Fișier | Tip | Responsabilitate |
|--------|-----|-----------------|
| `services/localModel.ts` | NOU | Catalog, compatibilitate, download, inferență, OCR flag |
| `services/aiProvider.ts` | MODIFICAT | Adaugă `'local'` + `'none'` în tip și routing |
| `services/aiOcrMapper.ts` | MODIFICAT | Verifică OCR local flag înainte de `sendAiRequest` |
| `app/(tabs)/setari.tsx` | MODIFICAT | Selector AI unificat + catalog modele + download UI + OCR toggle |
| `components/OnboardingWizard.tsx` | MODIFICAT | Pas AI cu 4 opțiuni + link docs |
| `docs/index.html` | MODIFICAT | Secțiune `id="asistent-ai"` cu detalii complete |
| `__tests__/setup.ts` | MODIFICAT | Mock-uri pentru `expo-device` și `llama.rn` |
| `__tests__/unit/localModel.test.ts` | NOU | Unit tests compatibilitate + catalog |
| `__tests__/smoke/services.test.ts` | MODIFICAT | Smoke test pentru `localModel` |

---

## Task 1: Instalare pachete și actualizare mock-uri

**Files:**
- Modify: `package.json`
- Modify: `__tests__/setup.ts`
- Modify: `__tests__/smoke/services.test.ts`

- [ ] **Step 1: Instalare expo-device și llama.rn**

```bash
cd /Users/ax/work/documents/app
npx expo install expo-device
npm install llama.rn
```

- [ ] **Step 2: Rebuild nativ (necesar pentru llama.rn)**

```bash
npm run prebuild
```

Verifică că `ios/Podfile` conține `llama_rn`. Dacă există erori de compilare la pod install, verifică că Xcode Command Line Tools sunt la zi (`xcode-select --install`).

- [ ] **Step 3: Adaugă mock-uri în `__tests__/setup.ts`**

Adaugă la sfârșitul fișierului `__tests__/setup.ts` (după mock-urile existente):

```typescript
jest.mock('expo-device', () => ({
  totalMemory: 6 * 1024 * 1024 * 1024, // 6GB — iPhone 14 Pro
  modelName: 'iPhone 14 Pro',
}));

jest.mock('llama.rn', () => ({
  initLlama: jest.fn().mockResolvedValue({
    completion: jest.fn().mockResolvedValue({ text: 'răspuns mock' }),
    release: jest.fn().mockResolvedValue(undefined),
  }),
}));
```

Adaugă și `createDownloadResumable` în mock-ul existent `expo-file-system/legacy` (cel deja în setup.ts — găsește linia cu `documentDirectory` și adaugă):

```typescript
createDownloadResumable: jest.fn(() => ({
  downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///test/Documents/models/test.gguf' }),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
})),
```

- [ ] **Step 4: Smoke test pentru `localModel`**

În `__tests__/smoke/services.test.ts`, adaugă după ultimul `it(`:

```typescript
it('localModel se importă fără erori', () => {
  expect(() => require('@/services/localModel')).not.toThrow();
});
```

- [ ] **Step 5: Rulează testele existente să confirmi că tot trece**

```bash
npm test
```

Expected: toate testele existente trec (inclusiv noul smoke test dacă fișierul nu există încă — va pica cu „Cannot find module", ceea ce e ok — va trece după Task 2).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json __tests__/setup.ts __tests__/smoke/services.test.ts
git commit -m "chore: install expo-device + llama.rn, add test mocks"
```

---

## Task 2: `services/localModel.ts` — tipuri și catalog

**Files:**
- Create: `services/localModel.ts`
- Create: `__tests__/unit/localModel.test.ts`

- [ ] **Step 1: Creează `services/localModel.ts` cu tipuri și catalog**

```typescript
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

import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
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
    id: 'llama3-1b',
    name: 'Llama 3.2 1B IT',
    description: 'Cel mai mic și mai rapid. Bun pentru întrebări simple și căutări. Ocupă puțin spațiu.',
    sizeBytes: 800 * 1024 * 1024,
    sizeLabel: '~800MB',
    minRamBytes: 4 * 1024 * 1024 * 1024,
    minIphoneGen: 12,
    qualityStars: 2,
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-2b',
    name: 'Gemma 4 2B IT',
    description:
      'Model Google de ultimă generație. Excelent la documente, răspunsuri precise. Recomandat pentru iPhone 13+.',
    sizeBytes: 1500 * 1024 * 1024,
    sizeLabel: '~1.5GB',
    minRamBytes: 4 * 1024 * 1024 * 1024,
    minIphoneGen: 13,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-4-2b-it-GGUF/resolve/main/gemma-4-2b-it-Q4_K_M.gguf',
  },
  {
    id: 'phi3-mini',
    name: 'Phi-3 Mini 3.8B IT',
    description: 'Model Microsoft, optimizat pentru raționament și extracție date structurate.',
    sizeBytes: 2300 * 1024 * 1024,
    sizeLabel: '~2.3GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-GGUF/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf',
  },
  {
    id: 'ministral-3b',
    name: 'Ministral 3B IT',
    description: 'Model Mistral compact. Bun la urmarea instrucțiunilor și extracție date.',
    sizeBytes: 2000 * 1024 * 1024,
    sizeLabel: '~2GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/Ministral-3B-Instruct-GGUF/resolve/main/Ministral-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-4b',
    name: 'Gemma 4 4B IT',
    description: 'Versiunea extinsă Gemma 4. Calitate maximă în clasa 4B. Recomandat pentru iPhone 14+.',
    sizeBytes: 2500 * 1024 * 1024,
    sizeLabel: '~2.5GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 5,
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-4-4b-it-GGUF/resolve/main/gemma-4-4b-it-Q4_K_M.gguf',
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B IT',
    description: 'Calitate maximă disponibilă local. Necesită iPhone 15 Pro+ și ~4GB spațiu liber.',
    sizeBytes: 4100 * 1024 * 1024,
    sizeLabel: '~4.1GB',
    minRamBytes: 8 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 5,
    downloadUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  },
];
```

- [ ] **Step 2: Scrie testul pentru catalog**

Creează `__tests__/unit/localModel.test.ts`:

```typescript
/**
 * Unit tests pentru localModel — catalog și compatibilitate device.
 */

import { LOCAL_MODEL_CATALOG, LocalModelEntry } from '@/services/localModel';

describe('LOCAL_MODEL_CATALOG', () => {
  it('conține exact 6 modele', () => {
    expect(LOCAL_MODEL_CATALOG).toHaveLength(6);
  });

  it('fiecare model are id unic', () => {
    const ids = LOCAL_MODEL_CATALOG.map(m => m.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('fiecare model are câmpurile obligatorii completate', () => {
    for (const model of LOCAL_MODEL_CATALOG) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.description).toBeTruthy();
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.sizeLabel).toBeTruthy();
      expect(model.minRamBytes).toBeGreaterThan(0);
      expect(model.minIphoneGen).toBeGreaterThan(0);
      expect(model.qualityStars).toBeGreaterThanOrEqual(1);
      expect(model.qualityStars).toBeLessThanOrEqual(5);
      expect(model.downloadUrl).toMatch(/^https:\/\//);
    }
  });

  it('URL-urile sunt de pe HuggingFace', () => {
    for (const model of LOCAL_MODEL_CATALOG) {
      expect(model.downloadUrl).toContain('huggingface.co');
    }
  });
});
```

- [ ] **Step 3: Rulează testele**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: 4 teste PASS.

- [ ] **Step 4: Commit**

```bash
git add services/localModel.ts __tests__/unit/localModel.test.ts
git commit -m "feat(localModel): add LocalModelEntry type and 6-model catalog"
```

---

## Task 3: `services/localModel.ts` — compatibilitate device

**Files:**
- Modify: `services/localModel.ts`
- Modify: `__tests__/unit/localModel.test.ts`

- [ ] **Step 1: Scrie testele pentru compatibilitate (TDD)**

Adaugă în `__tests__/unit/localModel.test.ts`:

```typescript
import {
  LOCAL_MODEL_CATALOG,
  LocalModelEntry,
  getIphoneGeneration,
  isModelCompatible,
  getCompatibleModels,
} from '@/services/localModel';

describe('getIphoneGeneration', () => {
  it('extrage numărul din "iPhone 14 Pro"', () => {
    expect(getIphoneGeneration('iPhone 14 Pro')).toBe(14);
  });

  it('extrage numărul din "iPhone 12"', () => {
    expect(getIphoneGeneration('iPhone 12')).toBe(12);
  });

  it('extrage numărul din "iPhone 15 Pro Max"', () => {
    expect(getIphoneGeneration('iPhone 15 Pro Max')).toBe(15);
  });

  it('returnează 0 pentru null', () => {
    expect(getIphoneGeneration(null)).toBe(0);
  });

  it('returnează 0 pentru string non-iPhone', () => {
    expect(getIphoneGeneration('iPad Pro')).toBe(0);
  });
});

describe('isModelCompatible', () => {
  const model4GB: LocalModelEntry = {
    ...LOCAL_MODEL_CATALOG[0], // llama3-1b: minRam=4GB, minGen=12
  };
  const model6GB: LocalModelEntry = {
    ...LOCAL_MODEL_CATALOG[2], // phi3-mini: minRam=6GB, minGen=14
  };
  const model8GB: LocalModelEntry = {
    ...LOCAL_MODEL_CATALOG[5], // mistral-7b: minRam=8GB, minGen=15
  };

  const RAM_4GB = 4 * 1024 * 1024 * 1024;
  const RAM_6GB = 6 * 1024 * 1024 * 1024;
  const RAM_8GB = 8 * 1024 * 1024 * 1024;

  it('compatibil: 4GB RAM + iPhone 12 + model 4GB/gen12', () => {
    expect(isModelCompatible(model4GB, RAM_4GB, 12)).toBe(true);
  });

  it('incompatibil: RAM insuficient (3GB < 4GB)', () => {
    expect(isModelCompatible(model4GB, 3 * 1024 * 1024 * 1024, 14)).toBe(false);
  });

  it('incompatibil: generație prea mică (iPhone 11 < 12)', () => {
    expect(isModelCompatible(model4GB, RAM_6GB, 11)).toBe(false);
  });

  it('incompatibil: model 6GB pe telefon cu 4GB RAM', () => {
    expect(isModelCompatible(model6GB, RAM_4GB, 14)).toBe(false);
  });

  it('compatibil: model 6GB pe iPhone 14 cu 6GB RAM', () => {
    expect(isModelCompatible(model6GB, RAM_6GB, 14)).toBe(true);
  });

  it('compatibil: model 8GB pe iPhone 15 Pro (8GB)', () => {
    expect(isModelCompatible(model8GB, RAM_8GB, 15)).toBe(true);
  });

  it('incompatibil: model 8GB pe iPhone 15 standard (6GB)', () => {
    expect(isModelCompatible(model8GB, RAM_6GB, 15)).toBe(false);
  });

  it('compatibil cu RAM null → true (emulator/dev)', () => {
    expect(isModelCompatible(model4GB, null, 12)).toBe(true);
  });
});

describe('getCompatibleModels', () => {
  // Mock-ul din setup.ts setează: totalMemory=6GB, modelName='iPhone 14 Pro'
  it('returnează doar modele cu minRam≤6GB și minGen≤14', () => {
    const compatible = getCompatibleModels();
    for (const model of compatible) {
      expect(model.minRamBytes).toBeLessThanOrEqual(6 * 1024 * 1024 * 1024);
      expect(model.minIphoneGen).toBeLessThanOrEqual(14);
    }
  });

  it('exclude mistral-7b (necesită 8GB RAM)', () => {
    const compatible = getCompatibleModels();
    expect(compatible.find(m => m.id === 'mistral-7b')).toBeUndefined();
  });

  it('include llama3-1b și gemma4-2b (minGen≤14, minRam≤6GB)', () => {
    const compatible = getCompatibleModels();
    expect(compatible.find(m => m.id === 'llama3-1b')).toBeDefined();
    expect(compatible.find(m => m.id === 'gemma4-2b')).toBeDefined();
  });
});
```

- [ ] **Step 2: Rulează să confirmi că pică**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: FAIL (funcțiile nu există încă).

- [ ] **Step 3: Implementează funcțiile în `services/localModel.ts`**

Adaugă după blocul de catalog:

```typescript
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
 * Returnează modelele din catalog compatibile cu device-ul curent.
 * Modelele incompatibile sunt EXCLUSE complet (nu dezactivate).
 */
export function getCompatibleModels(): LocalModelEntry[] {
  const ramBytes = Device.totalMemory;
  const iphoneGen = getIphoneGeneration(Device.modelName);
  return LOCAL_MODEL_CATALOG.filter(m => isModelCompatible(m, ramBytes, iphoneGen));
}
```

- [ ] **Step 4: Rulează testele să confirmi că trec**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: toate testele PASS.

- [ ] **Step 5: Commit**

```bash
git add services/localModel.ts __tests__/unit/localModel.test.ts
git commit -m "feat(localModel): device compatibility check and catalog filtering"
```

---

## Task 4: `services/localModel.ts` — download și persistență

**Files:**
- Modify: `services/localModel.ts`
- Modify: `__tests__/unit/localModel.test.ts`

- [ ] **Step 1: Scrie testele (TDD)**

Adaugă în `__tests__/unit/localModel.test.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const AS = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const FS = FileSystem as jest.Mocked<typeof FileSystem>;

describe('isModelDownloaded', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returnează false când fișierul nu există', async () => {
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    const { isModelDownloaded } = require('@/services/localModel');
    expect(await isModelDownloaded('llama3-1b')).toBe(false);
  });

  it('returnează true când fișierul există', async () => {
    (FS.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false });
    const { isModelDownloaded } = require('@/services/localModel');
    expect(await isModelDownloaded('llama3-1b')).toBe(true);
  });
});

describe('getSelectedModelId / setSelectedModelId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returnează null când nu e setat nimic', async () => {
    AS.getItem = jest.fn().mockResolvedValue(null);
    const { getSelectedModelId } = require('@/services/localModel');
    expect(await getSelectedModelId()).toBeNull();
  });

  it('returnează id-ul salvat', async () => {
    AS.getItem = jest.fn().mockResolvedValue('phi3-mini');
    const { getSelectedModelId } = require('@/services/localModel');
    expect(await getSelectedModelId()).toBe('phi3-mini');
  });

  it('salvează id-ul în AsyncStorage', async () => {
    AS.setItem = jest.fn().mockResolvedValue(undefined);
    const { setSelectedModelId } = require('@/services/localModel');
    await setSelectedModelId('gemma4-2b');
    expect(AS.setItem).toHaveBeenCalledWith('local_model_selected', 'gemma4-2b');
  });
});
```

- [ ] **Step 2: Rulează să confirmi că pică**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: FAIL pe noile teste.

- [ ] **Step 3: Implementează funcțiile de persistență și download în `services/localModel.ts`**

Adaugă după blocul compatibilitate:

```typescript
// ─── Persistență ─────────────────────────────────────────────────────────────

const KEY_SELECTED = 'local_model_selected';
const KEY_OCR_ENABLED = 'local_model_ocr_enabled';

function getModelsDir(): string {
  return (FileSystem.documentDirectory ?? '') + 'models/';
}

export function getModelPath(modelId: string): string {
  return getModelsDir() + modelId + '.gguf';
}

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(getModelPath(modelId));
  return info.exists && !info.isDirectory;
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

export async function isLocalOcrEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_OCR_ENABLED);
  return v === 'true';
}

export async function setLocalOcrEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_OCR_ENABLED, enabled ? 'true' : 'false');
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Descarcă un model GGUF pe device.
 * Returnează obiectul downloadResumable astfel încât UI-ul poate apela pauseAsync() pentru cancel.
 * La cancel, apelează deleteModel(modelId) pentru a curăța fișierul parțial.
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
```

- [ ] **Step 4: Rulează testele**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: toate testele PASS.

- [ ] **Step 5: Commit**

```bash
git add services/localModel.ts __tests__/unit/localModel.test.ts
git commit -m "feat(localModel): download management, persistence, OCR flag"
```

---

## Task 5: `services/localModel.ts` — inferență llama.rn

**Files:**
- Modify: `services/localModel.ts`
- Modify: `__tests__/smoke/services.test.ts`

- [ ] **Step 1: Implementează inferența în `services/localModel.ts`**

Adaugă la finalul fișierului:

```typescript
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

  _llamaContext = await initLlama({
    model: path,
    use_mlock: true,
    n_ctx: 2048,
    n_gpu_layers: 99,
  });
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
```

- [ ] **Step 2: Verifică smoke test**

```bash
npm test -- --testPathPattern="smoke"
```

Expected: „localModel se importă fără erori" PASS.

- [ ] **Step 3: Commit**

```bash
git add services/localModel.ts
git commit -m "feat(localModel): llama.rn inference - initLocalModel, runLocalInference, dispose"
```

---

## Task 6: `services/aiProvider.ts` — adaugă `'local'` și `'none'`

**Files:**
- Modify: `services/aiProvider.ts`
- Modify: `__tests__/unit/localModel.test.ts`

- [ ] **Step 1: Scrie testele pentru routing (TDD)**

Adaugă în `__tests__/unit/localModel.test.ts`:

```typescript
describe('sendAiRequest — routing local și none', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('aruncă eroare clară când type=none', async () => {
    jest.mock('@react-native-async-storage/async-storage', () => ({
      default: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn(),
        multiSet: jest.fn(),
      },
    }));
    jest.mock('expo-secure-store', () => ({
      getItemAsync: jest.fn().mockResolvedValue(null),
    }));
    const { getAiConfig } = require('@/services/aiProvider');
    // Forțăm config type=none prin mock AsyncStorage
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    AsyncStorage.getItem = jest.fn().mockImplementation((key: string) => {
      if (key === 'ai_provider_type') return Promise.resolve('none');
      return Promise.resolve(null);
    });
    const { sendAiRequest } = require('@/services/aiProvider');
    await expect(sendAiRequest([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'dezactivat'
    );
  });
});
```

- [ ] **Step 2: Rulează să confirmi că pică**

```bash
npm test -- --testPathPattern="localModel"
```

Expected: FAIL pe noul test (tipul 'none' nu există încă).

- [ ] **Step 3: Modifică `services/aiProvider.ts`**

**3a.** Schimbă linia cu `AiProviderType`:

```typescript
// ÎNAINTE:
export type AiProviderType = 'builtin' | 'mistral' | 'openai' | 'custom';

// DUPĂ:
export type AiProviderType = 'none' | 'builtin' | 'mistral' | 'openai' | 'custom' | 'local';
```

**3b.** Adaugă în `PROVIDER_DEFAULTS`:

```typescript
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
```

**3c.** La începutul funcției `sendAiRequest`, înaintea blocului cu `apiKey`, adaugă:

```typescript
  // Fără AI
  if (config.type === 'none') {
    throw new Error(
      'Asistentul AI este dezactivat. Activează-l din Setări → Asistent AI.'
    );
  }

  // Model local
  if (config.type === 'local') {
    const { runLocalInference } = await import('./localModel');
    return runLocalInference(messages, maxTokens);
  }
```

- [ ] **Step 4: Rulează testele**

```bash
npm test
```

Expected: toate testele PASS (inclusiv noul test pentru 'none').

- [ ] **Step 5: Commit**

```bash
git add services/aiProvider.ts __tests__/unit/localModel.test.ts
git commit -m "feat(aiProvider): add 'local' and 'none' provider types with routing"
```

---

## Task 7: `services/aiOcrMapper.ts` — integrare OCR local

**Files:**
- Modify: `services/aiOcrMapper.ts`

- [ ] **Step 1: Citește capătul funcției `mapOcrWithAi` din `services/aiOcrMapper.ts`**

Găsește linia unde `sendAiRequest` este apelat în `aiOcrMapper.ts`. De obicei e un apel de genul:
```typescript
const response = await sendAiRequest(messages, maxTokens);
```

- [ ] **Step 2: Înlocuiește apelul `sendAiRequest` cu un apel care verifică flag-ul OCR local**

Adaugă importul la topul fișierului `aiOcrMapper.ts`:

```typescript
import { isLocalOcrEnabled, runLocalInference } from './localModel';
```

Găsește și înlocuiește apelul `sendAiRequest(messages, ...)` cu:

```typescript
const useLocalOcr = await isLocalOcrEnabled();
const aiResponse = useLocalOcr
  ? await runLocalInference(messages, maxTokens).catch(() => sendAiRequest(messages, maxTokens))
  : await sendAiRequest(messages, maxTokens);
```

Înlocuiește toate referințele ulterioare la variabila anterioară (ex. `response`) cu `aiResponse`.

> **Notă:** `.catch(() => sendAiRequest(...))` — dacă modelul local nu e disponibil (nedescarcat, crash), fallback la cloud. Aceasta e singura excepție de la privacy-first: OCR e un feature secundar și un fallback silențios e mai bun decât un crash la scanarea unui document.

- [ ] **Step 3: Verifică că testele nu sunt rupte**

```bash
npm test
```

Expected: toate testele PASS.

- [ ] **Step 4: Commit**

```bash
git add services/aiOcrMapper.ts
git commit -m "feat(aiOcrMapper): route OCR through local model when flag is enabled"
```

---

## Task 8: `app/(tabs)/setari.tsx` — UI selector AI + catalog modele

**Files:**
- Modify: `app/(tabs)/setari.tsx`

> Aceasta este o modificare mare de UI. Testarea se face manual pe simulator/device. Rulează `npm run type-check` după fiecare pas.

- [ ] **Step 1: Adaugă importurile noi în `setari.tsx`**

La blocul de imports existente, adaugă:

```typescript
import * as localModel from '@/services/localModel';
import type { LocalModelEntry } from '@/services/localModel';
```

- [ ] **Step 2: Adaugă state pentru modelele locale**

În blocul de state (lângă `aiProviderType`, `aiProviderUrl`, etc.), adaugă:

```typescript
const [compatibleModels, setCompatibleModels] = useState<LocalModelEntry[]>([]);
const [downloadedModelIds, setDownloadedModelIds] = useState<string[]>([]);
const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
const [downloadProgress, setDownloadProgress] = useState(0);
const [downloadedMb, setDownloadedMb] = useState(0);
const [downloadTotalMb, setDownloadTotalMb] = useState(0);
const [localOcrEnabled, setLocalOcrEnabledState] = useState(false);
const downloadResumableRef = useRef<ReturnType<typeof localModel.createModelDownload> | null>(null);
```

Adaugă `useRef` la importul de React dacă não está lá:
```typescript
import React, { useEffect, useRef, useState } from 'react';
```

- [ ] **Step 3: Încarcă datele locale în `useEffect`**

În `useEffect` existent (cel care apelează `settings.getNotificationDays()` etc.), adaugă:

```typescript
    // Modele locale
    const models = localModel.getCompatibleModels();
    setCompatibleModels(models);
    const downloaded: string[] = [];
    for (const m of models) {
      if (await localModel.isModelDownloaded(m.id)) downloaded.push(m.id);
    }
    setDownloadedModelIds(downloaded);
    localModel.isLocalOcrEnabled().then(setLocalOcrEnabledState);
```

- [ ] **Step 4: Adaugă funcțiile de download și ștergere**

Adaugă după `handleAiProviderSelect` (sau oriunde în blocul de handlers):

```typescript
  const handleDownloadModel = async (modelId: string) => {
    const model = compatibleModels.find(m => m.id === modelId);
    if (!model) return;

    Alert.alert(
      'Descarcă model',
      `${model.name} ocupă ${model.sizeLabel}. Asigură-te că ai spațiu liber și o conexiune Wi-Fi. Continui?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Descarcă',
          onPress: async () => {
            setDownloadingModelId(modelId);
            setDownloadProgress(0);
            try {
              await FileSystem.makeDirectoryAsync(
                (FileSystem.documentDirectory ?? '') + 'models/',
                { intermediates: true }
              );
              const resumable = localModel.createModelDownload(
                modelId,
                (progress, dlMb, totalMb) => {
                  setDownloadProgress(progress);
                  setDownloadedMb(dlMb);
                  setDownloadTotalMb(totalMb);
                }
              );
              downloadResumableRef.current = resumable;
              await resumable.downloadAsync();
              setDownloadedModelIds(prev => [...prev, modelId]);
              await localModel.setSelectedModelId(modelId);
              setAiProviderType('local');
              await aiProvider.saveAiConfig({ type: 'local', url: '', model: modelId });
            } catch (e) {
              await localModel.deleteModel(modelId);
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Descărcarea a eșuat.');
            } finally {
              setDownloadingModelId(null);
              downloadResumableRef.current = null;
            }
          },
        },
      ]
    );
  };

  const handleCancelDownload = async () => {
    if (downloadResumableRef.current) {
      await downloadResumableRef.current.pauseAsync().catch(() => {});
      downloadResumableRef.current = null;
    }
    if (downloadingModelId) {
      await localModel.deleteModel(downloadingModelId);
    }
    setDownloadingModelId(null);
    setDownloadProgress(0);
  };

  const handleDeleteModel = (modelId: string) => {
    const model = compatibleModels.find(m => m.id === modelId);
    Alert.alert(
      'Șterge model',
      `Ești sigur că vrei să ștergi ${model?.name ?? modelId}? Va trebui să îl descarci din nou.`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            await localModel.deleteModel(modelId);
            setDownloadedModelIds(prev => prev.filter(id => id !== modelId));
            const selected = await localModel.getSelectedModelId();
            if (selected === modelId) {
              setAiProviderType('builtin');
              await aiProvider.saveAiConfig({
                type: 'builtin',
                url: aiProvider.PROVIDER_DEFAULTS.builtin.url,
                model: aiProvider.PROVIDER_DEFAULTS.builtin.model,
              });
            }
          },
        },
      ]
    );
  };

  const handleLocalOcrToggle = async (value: boolean) => {
    setLocalOcrEnabledState(value);
    await localModel.setLocalOcrEnabled(value);
  };
```

- [ ] **Step 5: Înlocuiește UI-ul provider selector din modal**

În modal-ul AI (cel cu `{/* Selector provider */}`), înlocuiește întregul bloc chip selector cu un selector radio unificat. Găsește secțiunea care începe cu:

```typescript
{/* Selector provider */}
<RNView>
  <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Provider</RNText>
  <RNView style={styles.chipRow}>
    {(Object.keys(aiProvider.PROVIDER_DEFAULTS) as AiProviderType[]).map(type => (
```

Înlocuiește **tot blocul** până la `</RNView>` (al doilea) inclusiv cu:

```tsx
{/* Selector AI unificat */}
<RNView>
  <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>Configurare asistent AI</RNText>
  {/* Opțiuni cloud + none */}
  {(['none', 'builtin', 'mistral', 'openai', 'custom'] as AiProviderType[]).map(type => (
    <Pressable
      key={type}
      style={[
        styles.aiRadioRow,
        { borderColor: aiProviderType === type ? primary : C.border, backgroundColor: C.card },
      ]}
      onPress={() => handleAiProviderSelect(type)}
    >
      <RNView style={[
        styles.aiRadioDot,
        { borderColor: aiProviderType === type ? primary : C.border },
      ]}>
        {aiProviderType === type && (
          <RNView style={[styles.aiRadioDotInner, { backgroundColor: primary }]} />
        )}
      </RNView>
      <RNText style={[styles.chipText, { color: C.text }]}>
        {aiProvider.PROVIDER_DEFAULTS[type].label}
      </RNText>
    </Pressable>
  ))}
  {/* Modele locale descărcate */}
  {downloadedModelIds.length > 0 && (
    <>
      <RNText style={[styles.aiLabel, { color: C.textSecondary, marginTop: 8 }]}>
        Modele locale instalate
      </RNText>
      {downloadedModelIds.map(modelId => {
        const model = compatibleModels.find(m => m.id === modelId);
        if (!model) return null;
        const isActive = aiProviderType === 'local' && (
          /* selected model */ true
        );
        return (
          <Pressable
            key={modelId}
            style={[
              styles.aiRadioRow,
              { borderColor: aiProviderType === 'local' ? primary : C.border, backgroundColor: C.card },
            ]}
            onPress={async () => {
              await localModel.setSelectedModelId(modelId);
              handleAiProviderSelect('local');
            }}
          >
            <RNView style={[
              styles.aiRadioDot,
              { borderColor: aiProviderType === 'local' ? primary : C.border },
            ]}>
              {aiProviderType === 'local' && (
                <RNView style={[styles.aiRadioDotInner, { backgroundColor: primary }]} />
              )}
            </RNView>
            <RNView style={{ flex: 1 }}>
              <RNText style={[styles.chipText, { color: C.text }]}>{model.name}</RNText>
              <RNText style={[styles.aiLabel, { color: C.textSecondary, marginTop: 0 }]}>
                {'★'.repeat(model.qualityStars)} · {model.sizeLabel}
              </RNText>
            </RNView>
          </Pressable>
        );
      })}
    </>
  )}
</RNView>
```

- [ ] **Step 6: Adaugă secțiunea catalog modele locale sub selector**

Imediat după blocul selector (după `</RNView>` al selectorului), adaugă:

```tsx
{/* Catalog modele locale — doar modele compatibile */}
{compatibleModels.length > 0 && (
  <RNView>
    <RNText style={[styles.aiLabel, { color: C.textSecondary }]}>
      Modele locale disponibile pentru telefonul tău
    </RNText>
    {compatibleModels.map(model => {
      const isDownloaded = downloadedModelIds.includes(model.id);
      const isDownloading = downloadingModelId === model.id;
      return (
        <RNView
          key={model.id}
          style={[styles.modelCard, { backgroundColor: C.card, borderColor: C.border }]}
        >
          <RNView style={styles.modelCardHeader}>
            <RNView style={{ flex: 1 }}>
              <RNText style={[styles.aiToggleLabel, { color: C.text }]}>{model.name}</RNText>
              <RNText style={[styles.aiLabel, { color: C.textSecondary, marginTop: 2 }]}>
                {'★'.repeat(model.qualityStars)}{'☆'.repeat(5 - model.qualityStars)} · {model.sizeLabel}
              </RNText>
            </RNView>
            {isDownloaded && !isDownloading && (
              <Pressable onPress={() => handleDeleteModel(model.id)} hitSlop={8}>
                <RNText style={[styles.aiLabel, { color: '#e74c3c' }]}>Șterge</RNText>
              </Pressable>
            )}
            {!isDownloaded && !isDownloading && (
              <Pressable
                onPress={() => handleDownloadModel(model.id)}
                style={[styles.downloadBtn, { backgroundColor: primary }]}
              >
                <RNText style={styles.downloadBtnText}>Descarcă</RNText>
              </Pressable>
            )}
          </RNView>
          <RNText style={[styles.aiToggleSub, { color: C.textSecondary }]}>
            {model.description}
          </RNText>
          {isDownloading && (
            <RNView style={{ marginTop: 8 }}>
              <RNView style={[styles.progressBar, { backgroundColor: C.border }]}>
                <RNView
                  style={[
                    styles.progressFill,
                    { backgroundColor: primary, width: `${Math.round(downloadProgress * 100)}%` },
                  ]}
                />
              </RNView>
              <RNText style={[styles.aiLabel, { color: C.textSecondary, marginTop: 4 }]}>
                {Math.round(downloadedMb)}MB / {Math.round(downloadTotalMb)}MB (
                {Math.round(downloadProgress * 100)}%)
              </RNText>
              <Pressable onPress={handleCancelDownload} style={{ marginTop: 4 }}>
                <RNText style={[styles.aiLabel, { color: '#e74c3c' }]}>Anulează</RNText>
              </Pressable>
            </RNView>
          )}
          {isDownloaded && (
            <RNText style={[styles.aiLabel, { color: '#27ae60', marginTop: 4 }]}>
              ✓ Instalat
            </RNText>
          )}
        </RNView>
      );
    })}
    {/* OCR toggle — vizibil doar când există cel puțin un model descărcat */}
    {downloadedModelIds.length > 0 && (
      <RNView style={[styles.aiToggleCard, { backgroundColor: C.card, borderColor: C.border, marginTop: 8 }]}>
        <RNView style={styles.aiToggleText}>
          <RNText style={[styles.aiToggleLabel, { color: C.text }]}>
            Folosește și pentru OCR documente
          </RNText>
          <RNText style={[styles.aiToggleSub, { color: C.textSecondary }]}>
            Extragerea datelor la scanarea documentelor se face local, fără cloud
          </RNText>
        </RNView>
        <Switch
          value={localOcrEnabled}
          onValueChange={handleLocalOcrToggle}
          trackColor={{ false: '#ccc', true: primary }}
        />
      </RNView>
    )}
  </RNView>
)}
```

- [ ] **Step 7: Adaugă stilurile noi în `StyleSheet.create`**

Găsește `StyleSheet.create({` și adaugă la finalul obiectului de stiluri:

```typescript
  aiRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  aiRadioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiRadioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modelCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  modelCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  downloadBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
```

- [ ] **Step 8: Rulează type-check**

```bash
npm run type-check
```

Corectează orice erori TypeScript.

- [ ] **Step 9: Testează pe simulator**

```bash
npm run ios
```

Verifică:
- Deschide Setări → Asistent AI → modal se deschide
- Selectorul radio afișează: Fără AI, Dosar AI, Mistral AI, OpenAI, Custom
- Catalogul de modele apare sub selector
- Butonul „Descarcă" există pe fiecare model

- [ ] **Step 10: Commit**

```bash
git add app/\(tabs\)/setari.tsx
git commit -m "feat(setari): unified AI selector, local model catalog, download progress, OCR toggle"
```

---

## Task 9: `components/OnboardingWizard.tsx` — pas AI actualizat

**Files:**
- Modify: `components/OnboardingWizard.tsx`

- [ ] **Step 1: Adaugă `AiProviderType` și constanta URL docs în imports/constante**

La topul fișierului, adaugă:

```typescript
import type { AiProviderType } from '@/services/aiProvider';
import * as aiProvider from '@/services/aiProvider';
```

Adaugă lângă `MISTRAL_CONSOLE_URL`:

```typescript
const DOCS_AI_URL = 'https://dosar.app/index.html#asistent-ai'; // URL site static
```

(Ajustează URL-ul când site-ul e publicat; pentru acum e un placeholder real.)

- [ ] **Step 2: Înlocuiește state `aiEnabled` cu `aiProviderChoice`**

Găsește:
```typescript
const [aiEnabled, setAiEnabled] = useState(true);
```

Înlocuiește cu:
```typescript
const [aiProviderChoice, setAiProviderChoice] = useState<AiProviderType>('builtin');
```

- [ ] **Step 3: Actualizează logica de finalizare onboarding**

Găsește:
```typescript
await AsyncStorage.setItem(AI_CONSENT_KEY, aiEnabled ? 'true' : 'false');
```

Înlocuiește cu:
```typescript
const aiActive = aiProviderChoice !== 'none';
await AsyncStorage.setItem(AI_CONSENT_KEY, aiActive ? 'true' : 'false');
await aiProvider.saveAiConfig({
  type: aiProviderChoice,
  url: aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.url ?? '',
  model: aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.model ?? '',
});
```

- [ ] **Step 4: Actualizează summary step**

Găsește:
```typescript
{aiEnabled ? 'Activat (20 interogări/zi gratuit)' : 'Dezactivat'}
```

Înlocuiește cu:
```typescript
{aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.label ?? aiProviderChoice}
```

- [ ] **Step 5: Înlocuiește conținutul `step === AI_STEP`**

Găsește blocul:
```typescript
{step === AI_STEP && (
  <View style={styles.aiBlock}>
    ...
  </View>
)}
```

Înlocuiește **tot conținutul** blocului `<View style={styles.aiBlock}>` cu:

```tsx
{step === AI_STEP && (
  <View style={styles.aiBlock}>
    {[
      {
        type: 'builtin' as AiProviderType,
        title: 'Dosar AI (recomandat)',
        desc: 'Cloud · 20 interogări/zi gratuit · Pornești imediat, fără configurare',
      },
      {
        type: 'mistral' as AiProviderType,
        title: 'Cheie API proprie',
        desc: 'Cloud · Nelimitat · Mistral sau OpenAI · Necesită cont gratuit',
      },
      {
        type: 'local' as AiProviderType,
        title: 'Model local',
        desc: 'Pe device · Privat · Nelimitat · Offline · Download 800MB–4GB din Setări',
      },
      {
        type: 'none' as AiProviderType,
        title: 'Fără AI',
        desc: 'Aplicația funcționează complet offline, fără asistent',
      },
    ].map(option => (
      <Pressable
        key={option.type}
        style={[
          styles.aiToggleCard,
          {
            backgroundColor: C.card,
            borderColor: aiProviderChoice === option.type ? C.primary : C.border,
          },
        ]}
        onPress={() => setAiProviderChoice(option.type)}
      >
        <View style={styles.aiToggleText}>
          <Text style={[styles.aiToggleLabel, { color: C.text }]}>{option.title}</Text>
          <Text style={[styles.aiToggleSub, { color: C.textSecondary }]}>{option.desc}</Text>
          {option.type === 'mistral' && aiProviderChoice === 'mistral' && (
            <Pressable onPress={() => Linking.openURL(MISTRAL_CONSOLE_URL)} style={{ marginTop: 6 }}>
              <Text style={[styles.link, { color: C.primary }]}>
                Creează cheie gratuită → mistral.ai
              </Text>
            </Pressable>
          )}
        </View>
        <View
          style={[
            styles.aiRadioDot,
            { borderColor: aiProviderChoice === option.type ? C.primary : C.border },
          ]}
        >
          {aiProviderChoice === option.type && (
            <View style={[styles.aiRadioDotInner, { backgroundColor: C.primary }]} />
          )}
        </View>
      </Pressable>
    ))}

    <Pressable
      onPress={() => Linking.openURL(DOCS_AI_URL)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: 8 }]}
    >
      <Text style={[styles.link, { color: C.primary }]}>
        Află mai multe despre opțiunile AI →
      </Text>
    </Pressable>
  </View>
)}
```

- [ ] **Step 6: Adaugă stilurile `aiRadioDot` și `aiRadioDotInner` în StyleSheet al OnboardingWizard**

Găsește `StyleSheet.create` și adaugă:

```typescript
  aiRadioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiRadioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
```

- [ ] **Step 7: Rulează type-check și testează**

```bash
npm run type-check
npm run ios
```

Verifică în onboarding: pasul AI afișează cele 4 opțiuni, selectarea schimbă bordura, link-ul spre docs funcționează.

- [ ] **Step 8: Commit**

```bash
git add components/OnboardingWizard.tsx
git commit -m "feat(onboarding): replace AI toggle with 4-option selector + docs link"
```

---

## Task 10: `docs/index.html` — secțiunea `#asistent-ai`

**Files:**
- Modify: `docs/index.html`

- [ ] **Step 1: Citește `docs/index.html` pentru a înțelege structura existentă**

Identifică: cum sunt structurate secțiunile (clase CSS, taguri folosite), unde se termină conținutul principal.

- [ ] **Step 2: Adaugă secțiunea înaintea tag-ului `</main>` sau înaintea footer-ului**

Găsește `</main>` sau `<footer` și inserează înainte:

```html
<!-- ASISTENT AI -->
<section id="asistent-ai" style="padding: 48px 24px; max-width: 800px; margin: 0 auto;">
  <h2 style="font-size: 28px; font-weight: 700; margin-bottom: 8px;">Asistent AI</h2>
  <p style="color: #666; margin-bottom: 32px;">
    Dosar include un asistent AI care te ajută să găsești documente, să afli date și
    să extragi informații din documente scanate. Poți alege cum să îl folosești.
  </p>

  <!-- Cele 4 configurări -->
  <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Configurări disponibile</h3>
  <div style="display: grid; gap: 16px; margin-bottom: 40px;">
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Dosar AI (recomandat)</strong>
      <p style="margin: 8px 0 0; color: #444;">
        Folosește serviciul AI inclus în aplicație (Mistral AI). Nu necesită configurare.
        20 interogări gratuite pe zi — suficient pentru utilizare normală.
      </p>
    </div>
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Cheie API proprie</strong>
      <p style="margin: 8px 0 0; color: #444;">
        Folosești propriul cont Mistral AI sau OpenAI — nelimitat.
        Cheia API este gratuită pe <a href="https://console.mistral.ai/api-keys" target="_blank" style="color: #9EB567;">mistral.ai</a>:
        creează cont → API Keys → Create new key → copiaz-o în Setări → Asistent AI.
      </p>
    </div>
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Model local</strong>
      <p style="margin: 8px 0 0; color: #444;">
        Rulează un model LLM direct pe telefon. <strong>Privat</strong> (datele nu pleacă nicăieri),
        <strong>nelimitat</strong>, funcționează <strong>offline</strong>.
        Necesită descărcarea modelului (800MB–4GB). Se configurează din Setări → Asistent AI.
      </p>
    </div>
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Fără AI</strong>
      <p style="margin: 8px 0 0; color: #444;">
        Aplicația funcționează complet offline, fără nicio funcție de inteligență artificială.
        Toate celelalte funcții sunt disponibile.
      </p>
    </div>
  </div>

  <!-- Tabel modele locale -->
  <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Modele locale disponibile</h3>
  <p style="color: #666; margin-bottom: 16px;">
    Aplicația afișează <strong>doar modelele compatibile cu telefonul tău</strong> — nu vei vedea
    modele care nu pot rula pe device-ul tău.
  </p>
  <div style="overflow-x: auto; margin-bottom: 40px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="text-align: left; padding: 10px 12px; border-bottom: 2px solid #e0e0e0;">Model</th>
          <th style="text-align: left; padding: 10px 12px; border-bottom: 2px solid #e0e0e0;">Calitate</th>
          <th style="text-align: left; padding: 10px 12px; border-bottom: 2px solid #e0e0e0;">Dimensiune</th>
          <th style="text-align: left; padding: 10px 12px; border-bottom: 2px solid #e0e0e0;">Telefon minim</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;"><strong>Llama 3.2 1B IT</strong><br><span style="color:#666; font-size:12px;">Rapid, bun pentru întrebări simple</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">★★☆☆☆</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">~800MB</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">iPhone 12+</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;"><strong>Gemma 4 2B IT</strong><br><span style="color:#666; font-size:12px;">Model Google, excelent la documente</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">★★★★☆</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">~1.5GB</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">iPhone 13+</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;"><strong>Phi-3 Mini 3.8B IT</strong><br><span style="color:#666; font-size:12px;">Microsoft, extracție date structurate</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">★★★★☆</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">~2.3GB</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">iPhone 14+</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;"><strong>Ministral 3B IT</strong><br><span style="color:#666; font-size:12px;">Mistral compact, urmarea instrucțiunilor</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">★★★★☆</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">~2GB</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">iPhone 14+</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;"><strong>Gemma 4 4B IT</strong><br><span style="color:#666; font-size:12px;">Gemma extins, calitate maximă 4B</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">★★★★★</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">~2.5GB</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0;">iPhone 14+</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px;"><strong>Mistral 7B IT</strong><br><span style="color:#666; font-size:12px;">Calitate maximă, telefoane high-end</span></td>
          <td style="padding: 10px 12px;">★★★★★</td>
          <td style="padding: 10px 12px;">~4.1GB</td>
          <td style="padding: 10px 12px;">iPhone 15 Pro+</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Cloud vs Local -->
  <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Cloud vs Model local</h3>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 40px;">
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Cloud (Dosar AI / Cheie proprie)</strong>
      <ul style="margin: 12px 0 0; padding-left: 20px; color: #444; line-height: 1.8;">
        <li>Pornești imediat</li>
        <li>Nu ocupă spațiu pe telefon</li>
        <li>Necesită internet</li>
        <li>Date trimise la provider AI</li>
      </ul>
    </div>
    <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 20px;">
      <strong>Model local</strong>
      <ul style="margin: 12px 0 0; padding-left: 20px; color: #444; line-height: 1.8;">
        <li>100% privat — datele nu pleacă</li>
        <li>Funcționează offline</li>
        <li>Nelimitat</li>
        <li>Download inițial 800MB–4GB</li>
        <li>Poate fi mai lent pe telefoane vechi</li>
      </ul>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Verifică că anchor-ul funcționează**

Deschide `docs/index.html` în browser local. Navighează la `index.html#asistent-ai`. Secțiunea trebuie să fie vizibilă și accesibilă direct.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html
git commit -m "docs: add #asistent-ai section with model catalog and cloud vs local comparison"
```

---

## Self-review

**Spec coverage:**
- ✅ 6 modele instruction-tuned (Llama 3.2 1B, Gemma 4 2B/4B, Phi-3 Mini, Ministral 3B, Mistral 7B)
- ✅ Catalog filtrat per device (incompatibilele ascunse, nu dezactivate)
- ✅ Compatibilitate: RAM + generație iPhone
- ✅ Download cu progress (MB + %) + buton anulare
- ✅ Stocare `documentDirectory/models/`
- ✅ Ștergere model
- ✅ Switch între toate config-urile AI (none/builtin/mistral/openai/custom/local)
- ✅ Toggle OCR local
- ✅ Onboarding: 4 opțiuni + link mistral.ai + link docs `#asistent-ai`
- ✅ Site static: secțiune `id="asistent-ai"` cu tabel modele, cloud vs local, instrucțiuni cheie Mistral

**Consistency check:**
- `LocalModelEntry.id` folosit consistent în toate task-urile
- `createModelDownload` (nu `downloadModel`) — returnează `downloadResumable`, apelat în Task 8
- `runLocalInference(messages, maxTokens)` — semnatură identică în Task 5 și în `aiProvider.ts` Task 6
- `isLocalOcrEnabled()` / `setLocalOcrEnabled()` — folosit în Task 4 și Task 7

**Note implementare:**
- URL-urile Gemma 4 GGUF (`bartowski/gemma-4-*-GGUF`) — verifică că există pe HuggingFace înainte de release; Gemma 4 a fost lansat în aprilie 2025 și comunitatea uploădează GGUF rapid
- `llama.rn` nu suportă simulatorul iOS (fără GPU) — testează inferența pe device fizic
- Smoke test va pica cu eroare de native module pe CI dacă `llama.rn` nu e mockat corect — mock-ul din Task 1 Step 3 rezolvă asta
