/**
 * Configurare proxy — totul din env, nimic hardcodat.
 *
 * Singurul secret e MISTRAL_API_KEY. Restul sunt plafoane: sunt aici ca să le
 * poți strânge fără redeploy de cod și, mai ales, fără release în App Store.
 */

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} trebuie să fie un număr pozitiv, am primit: ${raw}`);
  }
  return n;
};

export const config = {
  port: num('PORT', 8080),

  /** Cheia Mistral. Setată ca secret în Rapids, NU în cod. */
  apiKey: process.env.MISTRAL_API_KEY ?? '',
  upstreamUrl: (process.env.MISTRAL_URL ?? 'https://api.mistral.ai/v1').replace(/\/$/, ''),

  /**
   * Token partajat cu aplicația (header X-Dosar-Key). Obfuscare, NU securitate:
   * ajunge în bundle, deci poate fi extras. Rostul lui e să facă apelul trivial
   * („am găsit URL-ul, dau curl") să nu meargă. Dacă e gol, verificarea e oprită.
   */
  appToken: process.env.PROXY_APP_TOKEN ?? '',

  /**
   * Modele permise. Orice altceva e respins cu 403 — altfel cine extrage
   * URL-ul îți rulează mistral-large pe banii tăi.
   * Lista trebuie să corespundă cu BUILTIN_* din services/aiProvider.ts.
   */
  allowedModels: new Set(
    (process.env.ALLOWED_MODELS ??
      'mistral-small-latest,mistral-large-latest,pixtral-large-latest')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  ),

  /** Plafon dur pe max_tokens, indiferent ce cere clientul. */
  maxTokensCap: num('MAX_TOKENS_CAP', 4000),

  /** Corp maxim acceptat. Cererile vision trimit imagini base64 → generos. */
  maxBodyBytes: num('MAX_BODY_BYTES', 12 * 1024 * 1024),

  /** Cereri/zi per device. Oglindește DAILY_AI_LIMIT din aplicație. */
  perDeviceDailyLimit: num('PER_DEVICE_DAILY_LIMIT', 10),

  /** Plafon global de cereri/zi pentru tot serviciul. Vezi limits.js. */
  globalDailyLimit: num('GLOBAL_DAILY_LIMIT', 5000),

  /** Timeout către Mistral. Vision e lent. */
  upstreamTimeoutMs: num('UPSTREAM_TIMEOUT_MS', 120_000),
};

export function assertConfigured() {
  if (!config.apiKey) {
    throw new Error('MISTRAL_API_KEY lipsește. Setează-l ca secret în Rapids.');
  }
}
