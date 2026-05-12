/**
 * @jest-environment node
 */

// SecureStore mock cu state real (păstrează valorile între apeluri).
// expo-crypto mock cu getRandomBytes care produce bytes distincte de fiecare dată.
import {
  ensureMedicalMasterKey,
  encryptField,
  decryptField,
  hasMedicalMasterKey,
  resetMedicalMasterKeyForTests,
  exportMasterKeyBase64,
  importMasterKeyBase64,
} from '@/services/medicalCrypto';

const secureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => secureStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    secureStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete secureStore[k];
  }),
}));

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    getRandomBytes: (n: number) => {
      // Produce bytes distincte la fiecare apel ca să respecte invariantul
      // „IV/key distincte". Folosim un counter + un offset random-ish.
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (counter * 31 + i * 7 + Date.now()) & 0xff;
      counter++;
      // Un mic delay logic ca să asigure unicitatea chiar și în loop sincron rapid.
      counter += 13;
      return out;
    },
  };
});

describe('medicalCrypto', () => {
  beforeEach(async () => {
    for (const k of Object.keys(secureStore)) delete secureStore[k];
    await resetMedicalMasterKeyForTests();
  });

  it('round-trips a string with AAD', async () => {
    await ensureMedicalMasterKey();
    const blob = await encryptField('HDL colesterol', 'rec-123');
    const plain = await decryptField(blob, 'rec-123');
    expect(plain).toBe('HDL colesterol');
  });

  it('fails decrypt with wrong AAD', async () => {
    await ensureMedicalMasterKey();
    const blob = await encryptField('valoare secret', 'rec-A');
    await expect(decryptField(blob, 'rec-B')).rejects.toThrow();
  });

  it('produces different ciphertexts for same plaintext (random IV)', async () => {
    await ensureMedicalMasterKey();
    const a = await encryptField('TSH', 'rec-1');
    const b = await encryptField('TSH', 'rec-1');
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('hasMedicalMasterKey reflects state', async () => {
    expect(await hasMedicalMasterKey()).toBe(false);
    await ensureMedicalMasterKey();
    expect(await hasMedicalMasterKey()).toBe(true);
  });

  it('exports and imports master key (round-trip)', async () => {
    await ensureMedicalMasterKey();
    const blob = await encryptField('Hemoglobină', 'rec-X');
    const exported = await exportMasterKeyBase64();

    // Simulate device reinstall: clear cached key and store, then import.
    await resetMedicalMasterKeyForTests();
    expect(await hasMedicalMasterKey()).toBe(false);

    await importMasterKeyBase64(exported);
    const plain = await decryptField(blob, 'rec-X');
    expect(plain).toBe('Hemoglobină');
  });

  it('rejects imported key with wrong length', async () => {
    await expect(importMasterKeyBase64('abcd')).rejects.toThrow();
  });
});
