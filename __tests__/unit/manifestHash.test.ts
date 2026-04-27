import { buildCanonicalManifest, hashManifest, hashManifestAsync } from '@/services/manifestHash';

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

  it('arrays with mixed/missing id are kept in insertion order (no sort)', () => {
    // Documentat: regula „sort by id" se aplică DOAR dacă fiecare element are id string.
    const mixed = { items: [{ id: 'b' }, { id: 1 }, { id: 'a' }] };
    const c = buildCanonicalManifest(mixed);
    const idxB = c.indexOf('"id":"b"');
    const idxNum = c.indexOf('"id":1');
    const idxA = c.indexOf('"id":"a"');
    expect(idxB).toBeLessThan(idxNum);
    expect(idxNum).toBeLessThan(idxA);
  });
});

describe('hashManifest sync vs hashManifestAsync runtime equivalence', () => {
  // Override the global expo-crypto mock (which returns 'mock-hash') with a
  // node:crypto-backed implementation, so the runtime async path can be
  // verified against the pure-JS sync path. Without this, the two
  // implementations could silently diverge and Task 6's dedup would break.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoCryptoMock = require('expo-crypto') as { digestStringAsync: jest.Mock };
  const originalImpl = expoCryptoMock.digestStringAsync.getMockImplementation();

  beforeAll(() => {
    expoCryptoMock.digestStringAsync.mockImplementation((_alg: string, s: string) =>
      Promise.resolve(nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex'))
    );
  });

  afterAll(() => {
    if (originalImpl) {
      expoCryptoMock.digestStringAsync.mockImplementation(originalImpl);
    } else {
      expoCryptoMock.digestStringAsync.mockResolvedValue('mock-hash');
    }
  });

  it.each([
    ['empty string', ''],
    ['ascii', 'hello world'],
    ['unicode', 'șț ăâî 日本語'],
    ['multi-block (>64 bytes)', 'a'.repeat(200)],
    ['canonical sample', '{"v":1,"items":[{"id":"a"},{"id":"b"}]}'],
  ])('produces identical SHA-256 hex for %s', async (_label, input) => {
    const expected = nodeCrypto.createHash('sha256').update(input, 'utf8').digest('hex');
    expect(hashManifest(input)).toBe(expected);
    expect(await hashManifestAsync(input)).toBe(expected);
  });
});
