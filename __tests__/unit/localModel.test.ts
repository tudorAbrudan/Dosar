/**
 * Unit tests pentru localModel — catalog și compatibilitate device.
 */

import { LOCAL_MODEL_CATALOG } from '@/services/localModel';

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
