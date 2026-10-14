/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Module native înlocuite cu implementări în memorie, pentru testele care rulează
 * fluxul real de backup iCloud (upload → manifest → restore). Se folosesc din
 * factory-ul lui `jest.mock`:
 *
 *   jest.mock('@/services/cloudStorage', () => require('../helpers/memoryMocks').memoryCloudStorage());
 *
 * Fiecare factory are propriul store și un `__reset()` (sau `__files` pentru iCloud).
 */

/** iCloud Documents: cale → conținut (utf8 sau base64, păstrat ca string). */
export function memoryCloudStorage() {
  const files = new Map<string, string>();
  return {
    __files: files,
    isAvailable: jest.fn(async () => true),
    exists: jest.fn(async (p: string) => files.has(p)),
    readFile: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    }),
    writeFile: jest.fn(async (p: string, data: string) => {
      files.set(p, data);
    }),
    deleteFile: jest.fn(async (p: string) => {
      files.delete(p);
    }),
    listDir: jest.fn(async (prefix: string) =>
      Array.from(files.keys())
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length))
        .filter(k => !k.includes('/'))
    ),
    ensureParentDir: jest.fn(async () => undefined),
    fileSize: jest.fn(async (p: string) => files.get(p)?.length ?? 0),
  };
}

export function memorySecureStore() {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    __reset: () => store.clear(),
  };
}

export function memoryAsyncStorage() {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
      multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, store.get(k) ?? null])),
      multiSet: jest.fn(async () => undefined),
      clear: jest.fn(async () => store.clear()),
    },
    __reset: () => store.clear(),
  };
}

/** expo-crypto cu random și SHA-256 reale (cheile și hash-urile trebuie să difere). */
export function nodeExpoCrypto() {
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const randomBytes = (n: number) => {
    const buf = nodeCrypto.randomBytes(n);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  return {
    getRandomBytes: jest.fn(randomBytes),
    getRandomBytesAsync: jest.fn(async (n: number) => randomBytes(n)),
    digestStringAsync: jest.fn(async (_alg: string, s: string) =>
      nodeCrypto.createHash('sha256').update(s).digest('hex')
    ),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex' },
    randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
  };
}
