/**
 * Unit tests pentru localModel — catalog și compatibilitate device.
 */

import {
  LOCAL_MODEL_CATALOG,
  LocalModelEntry,
  getIphoneGeneration,
  isModelCompatible,
  getCompatibleModels,
} from '@/services/localModel';

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
  const model4GB: LocalModelEntry = { ...LOCAL_MODEL_CATALOG[0] }; // llama3-1b: minRam=4GB, minGen=12
  const model6GB: LocalModelEntry = { ...LOCAL_MODEL_CATALOG[2] }; // phi3-mini: minRam=6GB, minGen=14
  const model8GB: LocalModelEntry = { ...LOCAL_MODEL_CATALOG[5] }; // mistral-7b: minRam=8GB, minGen=15

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
  // Mock in setup.ts sets: totalMemory=6GB, modelName='iPhone 14 Pro'
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

  it('include llama3-1b și gemma4-2b', () => {
    const compatible = getCompatibleModels();
    expect(compatible.find(m => m.id === 'llama3-1b')).toBeDefined();
    expect(compatible.find(m => m.id === 'gemma4-2b')).toBeDefined();
  });
});
