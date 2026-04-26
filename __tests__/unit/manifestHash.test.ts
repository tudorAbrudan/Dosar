import { buildCanonicalManifest, hashManifest } from '@/services/manifestHash';

describe('manifestHash', () => {
  const sampleData = {
    version: 1,
    persons: [
      { id: 'b', name: 'Beta', created_at: '2026-01-01' },
      { id: 'a', name: 'Alpha', created_at: '2026-01-02' },
    ],
    documents: [],
    properties: [],
    vehicles: [],
    cards: [],
    animals: [],
    companies: [],
    customTypes: [],
    documentPages: [],
    fuelRecords: [],
    fileMap: { 'documents/x.jpg': 'Alpha/CI/x.jpg' },
  };

  it('produces deterministic JSON regardless of key order', () => {
    const reordered = {
      fileMap: sampleData.fileMap,
      version: 1,
      vehicles: [],
      properties: [],
      persons: [
        { name: 'Beta', created_at: '2026-01-01', id: 'b' },
        { created_at: '2026-01-02', id: 'a', name: 'Alpha' },
      ],
      documents: [],
      cards: [],
      animals: [],
      companies: [],
      customTypes: [],
      documentPages: [],
      fuelRecords: [],
    };
    expect(buildCanonicalManifest(sampleData)).toBe(buildCanonicalManifest(reordered));
  });

  it('sorts arrays by id', () => {
    const canonical = buildCanonicalManifest(sampleData);
    const idxA = canonical.indexOf('"id":"a"');
    const idxB = canonical.indexOf('"id":"b"');
    expect(idxA).toBeLessThan(idxB);
  });

  it('produces same hash for equivalent manifests', () => {
    const a = hashManifest(buildCanonicalManifest(sampleData));
    const reordered = { ...sampleData, persons: [...sampleData.persons].reverse() };
    const b = hashManifest(buildCanonicalManifest(reordered));
    expect(a).toBe(b);
  });

  it('produces different hash when content changes', () => {
    const a = hashManifest(buildCanonicalManifest(sampleData));
    const modified = {
      ...sampleData,
      persons: [...sampleData.persons, { id: 'c', name: 'Gamma', created_at: '2026-01-03' }],
    };
    const b = hashManifest(buildCanonicalManifest(modified));
    expect(a).not.toBe(b);
  });

  it('hash is 64 hex chars (SHA-256)', () => {
    const h = hashManifest(buildCanonicalManifest(sampleData));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
