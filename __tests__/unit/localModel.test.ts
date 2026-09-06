/**
 * Unit tests pentru localModel — catalog și compatibilitate device.
 */

import {
  LOCAL_MODEL_CATALOG,
  stripReasoning,
  LocalModelEntry,
  getIphoneGeneration,
  isModelCompatible,
  getCompatibleModels,
} from '@/services/localModel';

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('LOCAL_MODEL_CATALOG', () => {
  it('conține exact 5 modele', () => {
    expect(LOCAL_MODEL_CATALOG).toHaveLength(5);
  });

  it('fiecare model are id unic', () => {
    const ids = LOCAL_MODEL_CATALOG.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
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
      expect(model.nCtx).toBeGreaterThan(0);
    }
  });

  it('nBatch, când e specificat, e o putere a lui 2 între 128 și 512', () => {
    // n_ubatch prea mare = vârf de memorie la prefill = jetsam pe 6GB.
    // Vezi PREFILL_BATCH_DEFAULT în services/localModel.ts.
    for (const model of LOCAL_MODEL_CATALOG) {
      if (model.nBatch === undefined) continue;
      expect([128, 256, 512]).toContain(model.nBatch);
    }
  });

  it('URL-urile sunt de pe HuggingFace', () => {
    for (const model of LOCAL_MODEL_CATALOG) {
      expect(model.downloadUrl).toContain('huggingface.co');
    }
  });
});

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
  // Fixture-uri sintetice, NU intrări din catalog. Testele de aici verifică
  // logica de compatibilitate, nu conținutul catalogului — indexarea pozițională
  // (`LOCAL_MODEL_CATALOG[0]`) le lega de ordinea modelelor și le rupea la
  // fiecare adăugare/scoatere. Vezi curățarea Ministral/Mistral 7B, 2026-09-03.
  const baseModel: Omit<LocalModelEntry, 'minRamBytes' | 'minIphoneGen'> = {
    id: 'fixture',
    name: 'Fixture',
    description: 'Model sintetic pentru teste',
    sizeBytes: 2 * 1024 * 1024 * 1024,
    sizeLabel: '~2GB',
    qualityStars: 4,
    nCtx: 8192,
    downloadUrl: 'https://huggingface.co/fixture/model.gguf',
  };
  /** Prag mic: 5GiB RAM, iPhone 14+ */
  const modelGen14: LocalModelEntry = {
    ...baseModel,
    minRamBytes: 5 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
  };
  /** Prag mare: 7GiB RAM, iPhone 15+ */
  const modelGen15: LocalModelEntry = {
    ...baseModel,
    minRamBytes: 7 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
  };

  // Real device values: iOS NSProcessInfo.physicalMemory reports less than marketed RAM
  const RAM_IPHONE14PRO = 5905580032; // iPhone 14 Pro (marketed 6GB) — real reported value
  const RAM_IPHONE15PRO = 8053063680; // iPhone 15 Pro (marketed 8GB) — real reported value
  const RAM_6GIB = 6 * 1024 * 1024 * 1024; // idealized binary value

  it('compatibil: prag 5GiB/gen14 pe iPhone 14 Pro (valoare RAM reală)', () => {
    expect(isModelCompatible(modelGen14, RAM_IPHONE14PRO, 14)).toBe(true);
  });

  it('compatibil: prag 5GiB/gen14 pe iPhone 14 cu RAM idealizat 6GiB', () => {
    expect(isModelCompatible(modelGen14, RAM_6GIB, 14)).toBe(true);
  });

  it('incompatibil: prag 5GiB/gen14 pe telefon cu 4GB RAM', () => {
    expect(isModelCompatible(modelGen14, 4 * 1024 * 1024 * 1024, 14)).toBe(false);
  });

  it('incompatibil: generație prea mică (iPhone 13 < 14)', () => {
    expect(isModelCompatible(modelGen14, RAM_IPHONE14PRO, 13)).toBe(false);
  });

  it('compatibil: prag 7GiB/gen15 pe iPhone 15 Pro (valoare RAM reală)', () => {
    expect(isModelCompatible(modelGen15, RAM_IPHONE15PRO, 15)).toBe(true);
  });

  it('incompatibil: prag 7GiB/gen15 pe iPhone 15 standard (6GB RAM)', () => {
    expect(isModelCompatible(modelGen15, RAM_IPHONE14PRO, 15)).toBe(false);
  });

  it('compatibil cu RAM null → true (emulator/dev)', () => {
    expect(isModelCompatible(modelGen14, null, 14)).toBe(true);
  });
});

describe('getCompatibleModels', () => {
  // Mock in setup.ts sets: totalMemory=5905580032 (iPhone 14 Pro real value), modelName='iPhone 14 Pro'
  it('returnează doar modele compatibile cu iPhone 14 Pro', () => {
    const compatible = getCompatibleModels();
    for (const model of compatible) {
      expect(model.minRamBytes).toBeLessThanOrEqual(5905580032);
      expect(model.minIphoneGen).toBeLessThanOrEqual(14);
    }
  });

  it('exclude gemma4-e4b (necesită 8GB RAM)', () => {
    const compatible = getCompatibleModels();
    expect(compatible.find(m => m.id === 'gemma4-e4b')).toBeUndefined();
  });

  it('include qwen35-2b', () => {
    const compatible = getCompatibleModels();
    expect(compatible.find(m => m.id === 'qwen35-2b')).toBeDefined();
  });
});

// AsyncStorage mock has __esModule: true so the default import gives the mock object directly.
const AsyncStorageMock = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe('isModelDownloaded', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returnează false când fișierul nu există', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    const { isModelDownloaded } = require('@/services/localModel');
    expect(await isModelDownloaded('llama3-3b')).toBe(false);
  });

  it('returnează true când fișierul există', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, isDirectory: false });
    const { isModelDownloaded } = require('@/services/localModel');
    expect(await isModelDownloaded('llama3-3b')).toBe(true);
  });
});

describe('getSelectedModelId / setSelectedModelId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returnează null când nu e setat nimic', async () => {
    AsyncStorageMock.getItem.mockResolvedValue(null);
    const { getSelectedModelId } = require('@/services/localModel');
    expect(await getSelectedModelId()).toBeNull();
  });

  it('returnează id-ul salvat dacă există în catalog', async () => {
    AsyncStorageMock.getItem.mockResolvedValue('qwen35-2b');
    const { getSelectedModelId } = require('@/services/localModel');
    expect(await getSelectedModelId()).toBe('qwen35-2b');
  });

  it('returnează null dacă id-ul salvat nu mai există în catalog', async () => {
    AsyncStorageMock.getItem.mockResolvedValue('gemma4-e2b'); // id vechi, scos din catalog
    const { getSelectedModelId } = require('@/services/localModel');
    expect(await getSelectedModelId()).toBeNull();
  });

  it('salvează id-ul în AsyncStorage', async () => {
    const { setSelectedModelId } = require('@/services/localModel');
    await setSelectedModelId('llama3-3b');
    expect(AsyncStorageMock.setItem).toHaveBeenCalledWith('local_model_selected', 'llama3-3b');
  });
});

describe('releaseModelForBackground', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const llama = require('llama.rn') as { initLlama: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    AsyncStorageMock.getItem.mockResolvedValue('qwen35-2b');
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      size: 2 * 1024 * 1024 * 1024, // 2GB, peste pragul de validare
    });
    const { disposeLocalModel } = require('@/services/localModel');
    await disposeLocalModel(); // stare curată între teste
  });

  it('returnează false când niciun model nu e încărcat', async () => {
    const { releaseModelForBackground } = require('@/services/localModel');
    expect(await releaseModelForBackground()).toBe(false);
  });

  it('eliberează contextul după ce un model a fost încărcat (idempotent)', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    llama.initLlama.mockResolvedValueOnce({
      completion: jest.fn().mockResolvedValue({ text: 'x' }),
      release,
    });
    const { initLocalModel, releaseModelForBackground } = require('@/services/localModel');
    await initLocalModel('qwen35-2b');

    expect(await releaseModelForBackground()).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);

    // a doua oară: deja eliberat → no-op
    expect(await releaseModelForBackground()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('NU eliberează cât timp o inferență e în curs (ar crăpa nativ)', async () => {
    let resolveCompletion: (v: { text: string }) => void = () => {};
    const completion = jest.fn(
      () =>
        new Promise<{ text: string }>(res => {
          resolveCompletion = res;
        })
    );
    const release = jest.fn().mockResolvedValue(undefined);
    llama.initLlama.mockResolvedValueOnce({ completion, release });

    const mod = require('@/services/localModel');
    await mod.initLocalModel('qwen35-2b'); // preload cu contextul controlabil

    const inference = mod.runLocalInference([{ role: 'user', content: 'salut' }]);
    // flush microtasks până când completion e apelat (inferență „în curs")
    for (let i = 0; i < 20 && completion.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(completion).toHaveBeenCalled();

    // cât rulează inferența, release e blocat
    expect(await mod.releaseModelForBackground()).toBe(false);
    expect(release).not.toHaveBeenCalled();

    resolveCompletion({ text: 'gata' });
    await inference;

    // după ce inferența s-a terminat, eliberarea reușește
    expect(await mod.releaseModelForBackground()).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('stripReasoning — formate de „thinking"', () => {
  it('elimină blocul [Start thinking] ... [End thinking]', () => {
    // Gemma 4 și LFM2.5 emit acest format, în engleză, oricare ar fi limba
    // promptului. Verificat pe GGUF 2026-09-04.
    const raw = '[Start thinking]\nThe user wants...\n[End thinking]\n\nNr: B 123 XYZ';
    expect(stripReasoning(raw)).toBe('Nr: B 123 XYZ');
  });

  it('elimină un bloc rămas deschis (răspuns trunchiat de n_predict)', () => {
    expect(stripReasoning('[Start thinking]\nreasoning care nu se termina')).toBe('');
  });

  it('păstrează neatins textul fără marcaje', () => {
    expect(stripReasoning('Silvia are 40 de ani.')).toBe('Silvia are 40 de ani.');
  });

  it('elimină în continuare formatul Gemma <|channel>', () => {
    expect(stripReasoning('<|channel>thought bla<channel|>Raspuns')).toBe('Raspuns');
  });
});
