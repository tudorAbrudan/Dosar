import {
  DOC_TYPE_AI_REGISTRY,
  getRegistryEntry,
  buildClassifierCatalog,
} from '@/services/aiTypeRegistry';
import { STANDARD_DOC_TYPES } from '@/types';

describe('aiTypeRegistry', () => {
  it('has an entry for every standard doc type except altul/custom fallbacks', () => {
    for (const type of STANDARD_DOC_TYPES) {
      if (type === 'altul') continue;
      expect(DOC_TYPE_AI_REGISTRY[type]).toBeDefined();
      expect(DOC_TYPE_AI_REGISTRY[type]!.label).toBeTruthy();
      expect(DOC_TYPE_AI_REGISTRY[type]!.aliases.length).toBeGreaterThan(0);
      expect(DOC_TYPE_AI_REGISTRY[type]!.description).toBeTruthy();
    }
  });

  it('PAD entry includes Romanian synonyms for property insurance', () => {
    const pad = getRegistryEntry('pad');
    expect(pad.aliases.some(a => /locuință|locuinta|casă|casa/i.test(a))).toBe(true);
  });

  it('asigurare_personala entry covers life, health and travel synonyms', () => {
    const ap = getRegistryEntry('asigurare_personala');
    const blob = ap.aliases.join(' ').toLowerCase();
    expect(blob).toMatch(/viață|viata/);
    expect(blob).toMatch(/sănătate|sanatate|medical/);
    expect(blob).toMatch(/călătorie|calatorie|voiaj/);
  });

  it('buildClassifierCatalog returns markdown-style list of all candidates', () => {
    const md = buildClassifierCatalog(['pad', 'rca']);
    expect(md).toContain('pad');
    expect(md).toContain('rca');
    expect(md).toContain('PAD');
    expect(md).toContain('RCA');
  });
});
