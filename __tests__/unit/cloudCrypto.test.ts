/**
 * Teste pentru `services/cloudCrypto.ts`.
 *
 * Mock-urile globale din `__tests__/setup.ts`:
 *  - `expo-crypto.getRandomBytesAsync` returnează zero-uri (insuficient pentru noi).
 *  - `expo-secure-store` are toate metodele stub-uite la null/undefined.
 *
 * Aici suprascriem ambele:
 *  - `expo-crypto.getRandomBytes` → `node:crypto.randomBytes` (random real).
 *  - `expo-secure-store` → un Map in-memory ca să simulăm persistența.
 */

// Re-mock expo-crypto cu getRandomBytes folosind node:crypto.
// Suprascriem mock-ul global din setup.ts pentru acest test file.
// `jest.mock` factory rulează înainte de import-uri; folosim `require` lazy
// (nodeCrypto) pentru a respecta regula „no out-of-scope variables".
jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCryptoLazy = require('crypto') as typeof import('crypto');
  const randomBytes = (n: number) => {
    const buf = nodeCryptoLazy.randomBytes(n);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  return {
    getRandomBytes: jest.fn(randomBytes),
    getRandomBytesAsync: jest.fn(async (n: number) => randomBytes(n)),
    digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex' },
    randomUUID: jest.fn(() => 'mock-uuid'),
  };
});

// In-memory SecureStore.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __reset: () => store.clear(),
  };
});

// eslint-disable-next-line import/first -- jest.mock factories must precede imports.
import {
  PasswordRequiredError,
  clearPassword,
  decryptString,
  decryptToBase64,
  deriveKey,
  encryptBase64,
  encryptString,
  generateSalt,
  isConfigured,
  isSessionUnlocked,
  setSessionKey,
  setupPassword,
  unlockWithPassword,
} from '@/services/cloudCrypto';

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const sec = require('expo-secure-store') as { __reset: () => void };
  sec.__reset();
  setSessionKey(null);
});

describe('cloudCrypto — pure crypto helpers', () => {
  it('round-trips a string with correct password', async () => {
    const salt = generateSalt();
    const key = await deriveKey('parola-mea', salt);
    const cipher = await encryptString('Salut, lume!', key);
    const plain = await decryptString(cipher, key);
    expect(plain).toBe('Salut, lume!');
  });

  it('throws on wrong password (decryptString rejects on tag mismatch)', async () => {
    const salt = generateSalt();
    const key = await deriveKey('parola-corecta', salt);
    const cipher = await encryptString('secret', key);

    const wrongKey = await deriveKey('parola-gresita', salt);
    await expect(decryptString(cipher, wrongKey)).rejects.toThrow();
  });

  it('produces different ciphertexts for same plaintext (random IV)', async () => {
    const salt = generateSalt();
    const key = await deriveKey('parola', salt);
    const c1 = await encryptString('același mesaj', key);
    const c2 = await encryptString('același mesaj', key);
    expect(c1).not.toBe(c2);
    // Ambele decriptează la același plaintext.
    expect(await decryptString(c1, key)).toBe(await decryptString(c2, key));
  });

  it('encryptBase64 → decryptToBase64 round-trip preserves bytes', async () => {
    const salt = generateSalt();
    const key = await deriveKey('parola', salt);
    // 256 bytes random ca payload binar.
    const original = new Uint8Array(256);
    for (let i = 0; i < original.length; i++) original[i] = i;
    const b64 = Buffer.from(original).toString('base64');

    const cipher = await encryptBase64(b64, key);
    const decrypted = await decryptToBase64(cipher, key);

    const decoded = new Uint8Array(Buffer.from(decrypted, 'base64'));
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBe(original[i]);
    }
  });

  it('decryptString rejects on truncated/short input', async () => {
    const salt = generateSalt();
    const key = await deriveKey('parola', salt);
    await expect(decryptString('YWJj', key)).rejects.toThrow(/invalide|invalid/i);
  });
});

describe('cloudCrypto — setup/unlock with SecureStore', () => {
  it('setupPassword + unlockWithPassword with same password returns equal key bytes', async () => {
    const k1 = await setupPassword('parola-mea-buna');
    const k2 = await unlockWithPassword('parola-mea-buna');
    expect(k1.length).toBe(32);
    expect(k2.length).toBe(32);
    expect(Buffer.from(k1).toString('hex')).toBe(Buffer.from(k2).toString('hex'));
  });

  it('unlockWithPassword with wrong password rejects with "Parolă incorectă"', async () => {
    await setupPassword('parola-buna');
    await expect(unlockWithPassword('parola-rea')).rejects.toThrow('Parolă incorectă');
  });

  it('unlockWithPassword without setup rejects with "Criptarea nu este configurată"', async () => {
    await expect(unlockWithPassword('orice')).rejects.toThrow('Criptarea nu este configurată');
  });

  it('isConfigured reflects setup state', async () => {
    expect(await isConfigured()).toBe(false);
    await setupPassword('parola-test-123');
    expect(await isConfigured()).toBe(true);
    await clearPassword();
    expect(await isConfigured()).toBe(false);
  });

  it('clearPassword shutters session key and persisted setup', async () => {
    const key = await setupPassword('parola-test');
    setSessionKey(key);
    expect(isSessionUnlocked()).toBe(true);
    await clearPassword();
    expect(isSessionUnlocked()).toBe(false);
    expect(await isConfigured()).toBe(false);
  });

  it('setupPassword rejects too-short passwords', async () => {
    await expect(setupPassword('ab')).rejects.toThrow(/cel puțin 6/);
  });
});

describe('cloudCrypto — PasswordRequiredError shape', () => {
  it('is an Error subclass with proper name', () => {
    const e = new PasswordRequiredError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PasswordRequiredError');
  });

  it('uses default Romanian message when none provided', () => {
    const e = new PasswordRequiredError();
    expect(e.message).toMatch(/Parolă/);
  });
});
