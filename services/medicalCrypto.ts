/**
 * Criptare AES-256-GCM per câmp pentru dosarul medical.
 *
 * - Cheie master 256-bit random, generată o dată per device, păstrată în
 *   `expo-secure-store` (Keychain hardware-backed pe iOS).
 * - AAD = `medical_record.id` — previne mutarea unui blob criptat între dosare.
 * - Format blob: `[IV:12B][CIPHERTEXT][TAG:16B]` ca Uint8Array (BLOB în SQLite).
 *
 * NU folosim PBKDF2 — cheia nu vine dintr-o parolă user, ci e random per device.
 * Backup-ul include opțional cheia (după prompt explicit) ca să poată fi
 * restaurată pe alt device.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { gcm } from '@noble/ciphers/aes.js';

/** ID-ul cheii curente — stocat pe `medical_record.encryption_key_ref` ca să
 * putem rota cheia în viitor (v2 → migrare blob-uri vechi → schimb ref). */
export const MEDICAL_MASTER_KEY_REF = 'medical_master_key_v1';
const MASTER_KEY_REF = MEDICAL_MASTER_KEY_REF;
const IV_LEN = 12;
const KEY_LEN = 32;

let _cachedKey: Uint8Array | null = null;

function utf8ToBytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f)
        );
        i++;
        continue;
      }
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b1 = bytes[i++];
    if (b1 < 0x80) s += String.fromCharCode(b1);
    else if ((b1 & 0xe0) === 0xc0) {
      const b2 = bytes[i++];
      s += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
    } else if ((b1 & 0xf0) === 0xe0) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      s += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
    } else {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      const cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      const off = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return s;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return globalThis.btoa(bin);
  }
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      B64_CHARS[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    const n = rem === 2 ? (bytes[i] << 16) | (bytes[i + 1] << 8) : bytes[i] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
    out += rem === 2 ? B64_CHARS[(n >> 6) & 63] + '=' : '==';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLen = (len * 3) / 4 - padding;
  const out = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = B64_CHARS.indexOf(clean[i]);
    const c2 = B64_CHARS.indexOf(clean[i + 1]);
    const c3 = clean[i + 2] === '=' ? 0 : B64_CHARS.indexOf(clean[i + 2]);
    const c4 = clean[i + 3] === '=' ? 0 : B64_CHARS.indexOf(clean[i + 3]);
    const n = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (p < byteLen) out[p++] = (n >> 16) & 0xff;
    if (p < byteLen) out[p++] = (n >> 8) & 0xff;
    if (p < byteLen) out[p++] = n & 0xff;
  }
  return out;
}

async function loadKeyFromStore(): Promise<Uint8Array | null> {
  const b64 = await SecureStore.getItemAsync(MASTER_KEY_REF);
  if (!b64) return null;
  return base64ToBytes(b64);
}

async function saveKeyToStore(key: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(MASTER_KEY_REF, bytesToBase64(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Asigură că există o cheie master pe device. La primul apel generează random
 * și o salvează în SecureStore. La apelurile următoare o încarcă în cache.
 *
 * @throws când SecureStore eșuează (rare, ex: device-ul nu are biometrics setup).
 */
export async function ensureMedicalMasterKey(): Promise<void> {
  if (_cachedKey) return;
  let key = await loadKeyFromStore();
  if (!key) {
    key = Crypto.getRandomBytes(KEY_LEN);
    await saveKeyToStore(key);
  }
  _cachedKey = key;
}

export async function hasMedicalMasterKey(): Promise<boolean> {
  if (_cachedKey) return true;
  const b64 = await SecureStore.getItemAsync(MASTER_KEY_REF);
  return b64 !== null;
}

/**
 * Șterge cheia din cache și din SecureStore. NU șterge datele criptate
 * existente — acelea devin necitite. Folosit la testare și la „șterge tot
 * dosarul medical".
 */
export async function deleteMedicalMasterKey(): Promise<void> {
  _cachedKey = null;
  await SecureStore.deleteItemAsync(MASTER_KEY_REF);
}

/** Doar pentru teste — resetează state-ul în memorie. */
export async function resetMedicalMasterKeyForTests(): Promise<void> {
  _cachedKey = null;
  await SecureStore.deleteItemAsync(MASTER_KEY_REF);
}

function getKeyOrThrow(): Uint8Array {
  if (!_cachedKey) {
    throw new Error('Cheia medicală nu e încărcată. Apelează ensureMedicalMasterKey() întâi.');
  }
  return _cachedKey;
}

/**
 * Criptează un string cu AAD = ID-ul dosarului medical.
 *
 * Format: `[IV:12][CIPHERTEXT+TAG]`.
 * AAD previne mutarea blob-urilor între dosare (decryptarea cu alt AAD eșuează).
 */
export async function encryptField(
  plaintext: string,
  medicalRecordId: string
): Promise<Uint8Array> {
  await ensureMedicalMasterKey();
  const key = getKeyOrThrow();
  const iv = Crypto.getRandomBytes(IV_LEN);
  const aad = utf8ToBytes(medicalRecordId);
  const cipher = gcm(key, iv, aad).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

/**
 * Decriptează un blob produs de `encryptField`. Aruncă dacă AAD-ul diferă sau
 * dacă cheia nu mai e disponibilă (cheie pierdută → date nerecuperabile fără
 * backup).
 */
export async function decryptField(blob: Uint8Array, medicalRecordId: string): Promise<string> {
  await ensureMedicalMasterKey();
  const key = getKeyOrThrow();
  if (blob.length < IV_LEN + 16) {
    throw new Error('Blob criptat invalid (prea scurt).');
  }
  const iv = blob.subarray(0, IV_LEN);
  const cipher = blob.subarray(IV_LEN);
  const aad = utf8ToBytes(medicalRecordId);
  const plain = gcm(key, iv, aad).decrypt(cipher);
  return bytesToUtf8(plain);
}

/**
 * Variantă safe — întoarce null la eroare în loc să arunce. Folosit la
 * decriptarea defensivă în listare unde un singur blob corupt nu trebuie să
 * spargă întregul ecran.
 */
export async function decryptFieldOrNull(
  blob: Uint8Array | null,
  medicalRecordId: string
): Promise<string | null> {
  if (!blob || blob.length === 0) return null;
  try {
    return await decryptField(blob, medicalRecordId);
  } catch {
    return null;
  }
}

/**
 * Variantă pentru câmpuri opționale: dacă plaintext-ul e null/undefined,
 * întoarce null (fără criptare). Altfel cripteaza normal.
 */
export async function encryptFieldOpt(
  plaintext: string | null | undefined,
  medicalRecordId: string
): Promise<Uint8Array | null> {
  if (plaintext == null || plaintext === '') return null;
  return encryptField(plaintext, medicalRecordId);
}

/**
 * Variantă pentru câmpuri opționale la decriptare: dacă blob-ul e null,
 * întoarce null. Aruncă la AAD mismatch (folosit acolo unde semnalarea
 * coruptiei e dorită; pentru fallback silent foloseste `decryptFieldOrNull`).
 */
export async function decryptFieldOpt(
  blob: Uint8Array | null | undefined,
  medicalRecordId: string
): Promise<string | null> {
  if (!blob || blob.length === 0) return null;
  return decryptField(blob, medicalRecordId);
}

/**
 * Exportă cheia master ca base64 (pentru includere opt-in în backup cloud sau
 * afișare manuală user). Aruncă dacă nu există cheie.
 */
export async function exportMasterKeyBase64(): Promise<string> {
  await ensureMedicalMasterKey();
  const key = getKeyOrThrow();
  return bytesToBase64(key);
}

/**
 * Importă o cheie master existentă (din backup cloud sau introdusă manual).
 * Suprascrie cheia curentă în SecureStore. Folosit la restore cross-device.
 */
export async function importMasterKeyBase64(b64: string): Promise<void> {
  const key = base64ToBytes(b64);
  if (key.length !== KEY_LEN) {
    throw new Error(
      `Cheia importată are dimensiune greșită: ${key.length} bytes (așteptat ${KEY_LEN}).`
    );
  }
  _cachedKey = key;
  await saveKeyToStore(key);
}
