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

  /**
   * Cheia providerului din spate. Numele `MISTRAL_*` sunt păstrate ca alias ca
   * să nu pice serviciul la o redenumire de variabile în timpul unui incident.
   */
  apiKey: process.env.AI_UPSTREAM_API_KEY ?? process.env.MISTRAL_API_KEY ?? '',
  upstreamUrl: (
    process.env.AI_UPSTREAM_URL ??
    process.env.MISTRAL_URL ??
    'https://api.mistral.ai/v1'
  ).replace(/\/$/, ''),

  /**
   * Traducere nume de model: ce trimite aplicația → ce cere providerul.
   *
   * Aplicația publicată în App Store trimite numele Mistral, compilate în
   * bundle. Maparea aici înseamnă că putem schimba providerul fără release și
   * fără ca userii să actualizeze ceva. Numele „mistral-*" devin astfel
   * etichete pentru ROLURI (chat / extracție / vision), nu pentru furnizor —
   * urâte, dar stabile. Se curăță la un release normal.
   *
   * Gol = fără traducere (numele merg ca atare la provider).
   */
  modelMap: (() => {
    const raw = process.env.MODEL_MAP;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('nu e obiect');
      }
      return parsed;
    } catch (e) {
      throw new Error(`MODEL_MAP nu e JSON valid: ${e instanceof Error ? e.message : e}`);
    }
  })(),

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

  /**
   * `reasoning_effort` trimis providerului. Gol = parametrul nu se trimite.
   *
   * De ce contează: modelele care gândesc (Gemini 3.x) consumă raționamentul
   * din ACELAȘI `max_tokens`. Aplicația publicată trimite 500-1500, crezând că
   * tot bugetul e pentru răspuns — măsurat, o extracție simplă cheltuie ~280
   * pe gândire, iar la prompturi OCR reale ar trunchia JSON-ul sau ar întoarce
   * răspuns gol (`finish_reason: length`, `completion_tokens: 0`).
   *
   * Cu `none`, gândirea e 0 și `max_tokens` redevine ce crede aplicația că e.
   * Dacă scade calitatea la extracție, `low` e treapta următoare.
   */
  reasoningEffort: process.env.UPSTREAM_REASONING_EFFORT ?? '',

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
