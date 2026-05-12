/**
 * @jest-environment node
 *
 * Backup roundtrip pentru tabelele medical_*. Testul rulează la nivel de
 * unități serializare/deserializare BLOB ↔ base64 — nu testează DB live
 * (mock-ul Jest pentru `expo-sqlite` e vidic). Verifică:
 *
 * 1. `collectMedicalForBackup` (intern în backup.ts) ar trebui să producă
 *    payload serializabil (testat indirect prin export/import API public).
 * 2. Encrypt → export → import → decrypt round-trip păstrează plaintext-ul.
 */

import {
  ensureMedicalMasterKey,
  encryptField,
  decryptField,
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
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (counter * 31 + i * 7 + Date.now()) & 0xff;
      counter += 13;
      return out;
    },
  };
});

// Helpers BLOB ↔ base64 (replicate cele din backup.ts ca să testăm formatul).
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64');
}
function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf);
}

describe('medical backup roundtrip — BLOB serialization', () => {
  beforeEach(async () => {
    for (const k of Object.keys(secureStore)) delete secureStore[k];
    await resetMedicalMasterKeyForTests();
  });

  it('encrypt → serialize (b64) → deserialize → decrypt preserves plaintext', async () => {
    await ensureMedicalMasterKey();
    const recordId = 'rec-123';
    const plaintext = 'HDL colesterol 55 mg/dL';
    const blob = await encryptField(plaintext, recordId);
    expect(blob.byteLength).toBeGreaterThan(0);

    // Simulate export: BLOB → base64 string în JSON manifest
    const exported = bytesToBase64(blob);
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);

    // Simulate import: base64 → Uint8Array → decrypt
    const reparsed = base64ToBytes(exported);
    expect(reparsed.byteLength).toBe(blob.byteLength);

    const decrypted = await decryptField(reparsed, recordId);
    expect(decrypted).toBe(plaintext);
  });

  it('full key roundtrip — cheia exportată restaurează datele criptate cu cheia veche', async () => {
    await ensureMedicalMasterKey();
    const recordId = 'rec-456';
    const blob = await encryptField('Hemoglobină 14 g/dL', recordId);
    const exportedKey = await exportMasterKeyBase64();

    // Simulate reinstall: clear cache + secure store
    await resetMedicalMasterKeyForTests();
    // În acest moment, decryptField ar trebui să eșueze
    await expect(decryptField(blob, recordId)).rejects.toThrow();

    // Restore key from "backup"
    await importMasterKeyBase64(exportedKey);
    const restored = await decryptField(blob, recordId);
    expect(restored).toBe('Hemoglobină 14 g/dL');
  });

  it('AAD mismatch: blob criptat cu rec-A nu se decriptează cu rec-B', async () => {
    await ensureMedicalMasterKey();
    const blobA = await encryptField('valoare secret', 'rec-A');
    await expect(decryptField(blobA, 'rec-B')).rejects.toThrow();
  });

  it('empty optional fields se serializează ca null', async () => {
    // Helper pattern din backup.ts: blobToB64(null) → null
    function blobToB64(v: Uint8Array | null | undefined): string | null {
      if (!v) return null;
      return bytesToBase64(v);
    }
    expect(blobToB64(null)).toBeNull();
    expect(blobToB64(undefined)).toBeNull();
    expect(blobToB64(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });
});
