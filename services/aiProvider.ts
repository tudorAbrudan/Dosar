import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// ─── Limită zilnică ────────────────────────────────────────────────────────────

export const DAILY_AI_LIMIT = 20;
export const AI_CONSENT_KEY = 'ai_assistant_consent_accepted';
const KEY_DAILY_USAGE_PREFIX = 'ai_daily_usage_';

function todayDateKey(): string {
  return KEY_DAILY_USAGE_PREFIX + new Date().toISOString().slice(0, 10);
}

export async function getAiUsageToday(): Promise<number> {
  const v = await AsyncStorage.getItem(todayDateKey());
  return v ? parseInt(v, 10) : 0;
}

export async function incrementAiUsage(): Promise<void> {
  const key = todayDateKey();
  const current = await getAiUsageToday();
  await AsyncStorage.setItem(key, String(current + 1));
}

export async function isAiLimitReached(): Promise<boolean> {
  const config = await getAiConfig();
  if (config.type !== 'builtin') return false;
  const used = await getAiUsageToday();
  return used >= DAILY_AI_LIMIT;
}

// ─── Tipuri ────────────────────────────────────────────────────────────────────

export type AiProviderType = 'none' | 'builtin' | 'external' | 'local';

export interface AiProviderConfig {
  type: AiProviderType;
  url: string;
  apiKey: string;
  model: string;
}

// ─── Cheie inclusă în aplicație ───────────────────────────────────────────────

const BUILTIN_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY ?? '';
const BUILTIN_URL = 'https://api.mistral.ai/v1';
const BUILTIN_MODEL = 'mistral-small-latest';

// ─── Default-uri per provider ─────────────────────────────────────────────────

export const PROVIDER_DEFAULTS: Record<
  AiProviderType,
  { url: string; model: string; label: string }
> = {
  builtin: {
    url: BUILTIN_URL,
    model: BUILTIN_MODEL,
    label: 'Dosar AI',
  },
  external: {
    url: '',
    model: '',
    label: 'Cheie API proprie',
  },
  none: {
    url: '',
    model: '',
    label: 'Fără AI',
  },
  local: {
    url: '',
    model: '',
    label: 'Model local',
  },
};

const VALID_PROVIDER_TYPES = new Set<string>(Object.keys(PROVIDER_DEFAULTS));

// ─── Chei stocare ─────────────────────────────────────────────────────────────

const KEY_PROVIDER_TYPE = 'ai_provider_type';
const KEY_PROVIDER_URL = 'ai_provider_url';
const KEY_PROVIDER_MODEL = 'ai_provider_model';
const SECURE_KEY_API_KEY = 'ai_provider_api_key';

// ─── Citire / scriere config ──────────────────────────────────────────────────

export async function getAiConfig(): Promise<AiProviderConfig> {
  const [typeRaw, urlRaw, modelRaw, apiKey] = await Promise.all([
    AsyncStorage.getItem(KEY_PROVIDER_TYPE),
    AsyncStorage.getItem(KEY_PROVIDER_URL),
    AsyncStorage.getItem(KEY_PROVIDER_MODEL),
    getAiApiKey(),
  ]);

  // Migrare valori vechi → external
  const legacyMap: Record<string, AiProviderType> = {
    mistral: 'external',
    openai: 'external',
    custom: 'external',
  };
  const rawType = typeRaw ?? 'builtin';
  const type: AiProviderType =
    legacyMap[rawType] ??
    (VALID_PROVIDER_TYPES.has(rawType) ? (rawType as AiProviderType) : 'builtin');

  // Persistă migrarea — scrie valoarea nouă în storage dacă era o valoare veche
  if (legacyMap[rawType]) {
    void AsyncStorage.setItem(KEY_PROVIDER_TYPE, type);
  }

  const defaults = PROVIDER_DEFAULTS[type];

  return {
    type,
    url: urlRaw ?? defaults.url,
    model: modelRaw ?? defaults.model,
    apiKey,
  };
}

export async function saveAiConfig(
  config: Pick<AiProviderConfig, 'type' | 'url' | 'model'>
): Promise<void> {
  await AsyncStorage.multiSet([
    [KEY_PROVIDER_TYPE, config.type],
    [KEY_PROVIDER_URL, config.url],
    [KEY_PROVIDER_MODEL, config.model],
  ]);
}

export async function getAiApiKey(): Promise<string> {
  const key = await SecureStore.getItemAsync(SECURE_KEY_API_KEY);
  return key ?? '';
}

export async function saveAiApiKey(key: string): Promise<void> {
  if (key) {
    await SecureStore.setItemAsync(SECURE_KEY_API_KEY, key);
  } else {
    await SecureStore.deleteItemAsync(SECURE_KEY_API_KEY);
  }
}

// ─── Tipuri mesaje OpenAI-compatible ─────────────────────────────────────────

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: Array<{ message: { content: string } }>;
}

// ─── Trimitere cerere AI (OpenAI-compatible) ──────────────────────────────────

export async function sendAiRequest(messages: AiMessage[], maxTokens = 500): Promise<string> {
  const config = await getAiConfig();

  // Fără AI
  if (config.type === 'none') {
    throw new Error(
      'Asistentul AI este dezactivat. Activează-l din Setări → Asistent AI.'
    );
  }

  // Model local (llama.rn / GGUF)
  if (config.type === 'local') {
    const { runLocalInference } = await import('./localModel');
    return runLocalInference(messages, maxTokens);
  }

  const apiKey = config.type === 'builtin' ? BUILTIN_API_KEY : config.apiKey;

  if (!apiKey) {
    throw new Error(
      'Nu este configurată nicio cheie API. Mergi la Setări → Asistent AI pentru a adăuga cheia.'
    );
  }

  // Verifică limita zilnică doar pentru cheia built-in
  if (config.type === 'builtin') {
    const used = await getAiUsageToday();
    if (used >= DAILY_AI_LIMIT) {
      throw new Error(
        `Ai atins limita de ${DAILY_AI_LIMIT} interogări AI/zi cu cheia Dosar AI.\n\nPoți folosi nelimitat configurând propria cheie API din Setări → Asistent AI.`
      );
    }
  }

  const baseUrl = (config.type === 'builtin' ? BUILTIN_URL : config.url).replace(/\/$/, '');
  const model = config.type === 'builtin' ? BUILTIN_MODEL : config.model;
  const endpoint = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Eroare AI (${response.status}): ${errText || 'Răspuns invalid de la server'}`);
  }

  const data = (await response.json()) as OpenAiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Răspuns gol de la asistentul AI.');
  }

  // Incrementează contorul zilnic (doar pentru builtin)
  if (config.type === 'builtin') {
    await incrementAiUsage();
  }

  return content;
}
