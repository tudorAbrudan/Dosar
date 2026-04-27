/**
 * Criptare opțională end-to-end pentru backup-ul iCloud.
 *
 * - **Algoritm:** AES-256-GCM (autentificare via tag inclus în cipher).
 * - **Derivare cheie:** PBKDF2-HMAC-SHA256, 100.000 iterații, salt 16B random.
 * - **Verificare parolă:** un ciphertext fix (`VERIFY_PAYLOAD`) salvat în SecureStore;
 *   parola corectă re-decriptează acel payload, parola greșită aruncă.
 * - **Persistă** doar `salt` și `verify_ciphertext` în SecureStore. Parola nu e
 *   stocată niciodată — doar cheia derivată trăiește în memorie pe durata sesiunii.
 *
 * IV-ul (12B) e prefixat în fiecare ciphertext: layout `iv || cipher_with_tag`,
 * apoi base64. Decriptarea reextrage IV-ul. Aceeași schemă pentru toate API-urile
 * (string și base64).
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard

const SALT_KEY = 'cloud_encryption_salt';
const VERIFY_KEY = 'cloud_encryption_verify';
/**
 * Plaintext folosit pentru a confirma că o parolă unlock-uiește correct cheia
 * salvată. Stabil între versiuni — schimbarea invalidează verificările existente.
 */
const VERIFY_PAYLOAD = 'CLOUD_VERIFY_OK_v1';

/** Aruncă pentru a semnala că o operație de cloud necesită deblocarea cu parolă. */
export class PasswordRequiredError extends Error {
  constructor(message = 'Parolă necesară pentru a continua') {
    super(message);
    this.name = 'PasswordRequiredError';
  }
}

// ── Session key (in-memory, niciodată persistat) ──────────────────────────────

let _sessionKey: Uint8Array | null = null;

/** Setează cheia derivată curentă. Apelat după setup/unlock; null la lock. */
export function setSessionKey(key: Uint8Array | null): void {
  _sessionKey = key;
}

/** Returnează cheia activă sau null dacă sesiunea nu e deblocată. */
export function getSessionKey(): Uint8Array | null {
  return _sessionKey;
}

/** True dacă există o cheie în memorie (sesiunea e deblocată). */
export function isSessionUnlocked(): boolean {
  return _sessionKey !== null;
}

// ── Helpers binare/base64 ─────────────────────────────────────────────────────

/**
 * Generează un salt random de `SALT_LEN` octeți folosind expo-crypto.
 *
 * @throws când expo-crypto nu poate produce randomness (extrem de rar pe device).
 */
export function generateSalt(): Uint8Array {
  return Crypto.getRandomBytes(SALT_LEN);
}

function generateIV(): Uint8Array {
  return Crypto.getRandomBytes(IV_LEN);
}

function utf8ToBytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s);
  }
  // Fallback (RN < hermes-with-textencoder) — UTF-8 manual.
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
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b1 = bytes[i++];
    if (b1 < 0x80) {
      s += String.fromCharCode(b1);
    } else if ((b1 & 0xe0) === 0xc0) {
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
  // Fallback pentru RN unde btoa lipsește.
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

// ── KDF + AES-GCM ─────────────────────────────────────────────────────────────

/**
 * Derivă o cheie AES-256 din parolă + salt cu PBKDF2-HMAC-SHA256, 100k iterații.
 * Operația e CPU-intensivă (>100ms pe device); apelează doar la setup/unlock.
 *
 * @throws când `@noble/hashes` aruncă (ar fi un bug, nu o eroare așteptată).
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return await pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LEN,
  });
}

/**
 * Encriptează un string UTF-8 cu cheia dată. Ciphertext-ul include IV-ul
 * (layout `iv || cipher_with_tag`) și e returnat ca base64.
 *
 * @throws dacă `@noble/ciphers` eșuează (key length greșit etc.).
 */
export async function encryptString(plaintext: string, key: Uint8Array): Promise<string> {
  const iv = generateIV();
  const cipher = gcm(key, iv).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

/**
 * Decriptează un blob produs de `encryptString`. La tag mismatch (parolă greșită
 * sau date corupte) `@noble/ciphers` aruncă — apelantul ar trebui să prindă și să
 * convertească la `PasswordRequiredError` dacă contextul indică unlock.
 *
 * @throws când IV-ul lipsește, ciphertext-ul e prea scurt sau tag-ul GCM nu se verifică.
 */
export async function decryptString(b64Cipher: string, key: Uint8Array): Promise<string> {
  const buf = base64ToBytes(b64Cipher);
  if (buf.length <= IV_LEN) {
    throw new Error('Date criptate invalide');
  }
  const iv = buf.subarray(0, IV_LEN);
  const cipher = buf.subarray(IV_LEN);
  const plain = gcm(key, iv).decrypt(cipher);
  return bytesToUtf8(plain);
}

/**
 * Encriptează un payload base64 (ex. conținutul unui fișier binar). Plaintext-ul
 * de intrare e base64 → decodificat la bytes → encriptat → re-encodat ca base64.
 *
 * @throws când base64-ul e invalid sau encriptarea eșuează.
 */
export async function encryptBase64(b64Plain: string, key: Uint8Array): Promise<string> {
  const iv = generateIV();
  const cipher = gcm(key, iv).encrypt(base64ToBytes(b64Plain));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64(out);
}

/**
 * Inversul `encryptBase64`. Returnează plaintext-ul original ca base64
 * (gata de scris pe disc cu `expo-file-system` encoding `base64`).
 *
 * @throws când datele sunt prea scurte, base64-ul invalid sau tag-ul nu se verifică.
 */
export async function decryptToBase64(b64Cipher: string, key: Uint8Array): Promise<string> {
  const buf = base64ToBytes(b64Cipher);
  if (buf.length <= IV_LEN) {
    throw new Error('Date criptate invalide');
  }
  const iv = buf.subarray(0, IV_LEN);
  const cipher = buf.subarray(IV_LEN);
  const plain = gcm(key, iv).decrypt(cipher);
  return bytesToBase64(plain);
}

// ── Setup / Unlock / Clear ────────────────────────────────────────────────────

/**
 * Configurează o parolă nouă. Generează salt random, derivă cheia, encriptează
 * `VERIFY_PAYLOAD` și persistă (salt + verify ciphertext) în SecureStore.
 * Returnează cheia derivată ca apelantul s-o seteze imediat ca session key.
 *
 * Apelarea repetată **suprascrie** setup-ul anterior — orice backup criptat cu
 * parola veche devine indecriptabil. Apelantul (UI) trebuie să avertizeze.
 *
 * @throws când scrierea în SecureStore eșuează sau derivarea/encriptarea aruncă.
 */
export async function setupPassword(password: string): Promise<Uint8Array> {
  if (!password || password.length < 6) {
    throw new Error('Parola trebuie să aibă cel puțin 6 caractere');
  }
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const verifyCipher = await encryptString(VERIFY_PAYLOAD, key);
  await SecureStore.setItemAsync(SALT_KEY, bytesToBase64(salt));
  await SecureStore.setItemAsync(VERIFY_KEY, verifyCipher);
  return key;
}

/**
 * Verifică o parolă contra setup-ului persistat. Re-derivă cheia, încearcă să
 * decripteze `VERIFY_PAYLOAD` salvat. Match → returnează cheia (apelantul o setează
 * ca session key). Mismatch / tag invalid → aruncă cu mesaj românesc.
 *
 * @throws cu „Parolă incorectă" la tag mismatch, „Criptarea nu este configurată"
 *   dacă `setupPassword` n-a fost apelat, sau citire SecureStore eșuează.
 */
export async function unlockWithPassword(password: string): Promise<Uint8Array> {
  const saltB64 = await SecureStore.getItemAsync(SALT_KEY);
  const verifyCipher = await SecureStore.getItemAsync(VERIFY_KEY);
  if (!saltB64 || !verifyCipher) {
    throw new Error('Criptarea nu este configurată');
  }
  const salt = base64ToBytes(saltB64);
  const key = await deriveKey(password, salt);
  let plain: string;
  try {
    plain = await decryptString(verifyCipher, key);
  } catch {
    throw new Error('Parolă incorectă');
  }
  if (plain !== VERIFY_PAYLOAD) {
    throw new Error('Parolă incorectă');
  }
  return key;
}

/**
 * Șterge tot setup-ul de criptare (salt + verify) și clear-uiește session key-ul.
 * Apelat la dezactivarea criptării din Setări.
 *
 * @throws când SecureStore.deleteItemAsync eșuează (rar).
 */
export async function clearPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(SALT_KEY);
  await SecureStore.deleteItemAsync(VERIFY_KEY);
  setSessionKey(null);
}

/**
 * True dacă există un setup persistat în SecureStore (indiferent dacă sesiunea
 * curentă e deblocată sau nu).
 */
export async function isConfigured(): Promise<boolean> {
  const saltB64 = await SecureStore.getItemAsync(SALT_KEY);
  const verifyCipher = await SecureStore.getItemAsync(VERIFY_KEY);
  return !!(saltB64 && verifyCipher);
}
