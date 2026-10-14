/**
 * Ruta datelor AI (`getAiRoute`) — sursa unică pentru „pleacă ceva de pe telefon?".
 *
 * Regresii acoperite (analiza 2026-10-13):
 * - modelul local cu „provider OCR remote" era tratat ca „nimic nu pleacă", deși
 *   pozele mergeau în cloud fără acord;
 * - după onboarding cu „Model local", configul avea `model: ''` și chat-urile
 *   răspundeau „Modelul local nu este selectat" deși modelul era instalat.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  aiRouteLeavesDevice,
  getAiConfig,
  getAiRoute,
  validateConfig,
  canDoVision,
  type AiProviderConfig,
} from '@/services/aiProvider';

const base: AiProviderConfig = {
  type: 'none',
  url: '',
  apiKey: '',
  model: '',
  visionUrl: '',
  visionApiKey: '',
  visionModel: '',
  chatModelSupportsVision: false,
};
const vision = { visionUrl: 'https://v.example/v1', visionApiKey: 'k', visionModel: 'pixtral' };

describe('getAiRoute', () => {
  it('Fără AI: nimic nu rulează', () => {
    const r = getAiRoute(base);
    expect(r).toEqual({ text: 'off', images: 'none' });
    expect(aiRouteLeavesDevice(r)).toBe(false);
  });

  it('model local simplu: totul pe telefon', () => {
    const r = getAiRoute({ ...base, type: 'local', model: 'qwen35-2b' });
    expect(r).toEqual({ text: 'device', images: 'none' });
    expect(aiRouteLeavesDevice(r)).toBe(false);
  });

  it('model local + provider de imagini: pozele pleacă în cloud', () => {
    const r = getAiRoute({ ...base, type: 'local', model: 'qwen35-2b', ...vision });
    expect(r).toEqual({ text: 'device', images: 'cloud' });
    expect(aiRouteLeavesDevice(r)).toBe(true);
  });

  it('cheie proprie doar-text: textul în cloud, fără poze', () => {
    const r = getAiRoute({ ...base, type: 'external', url: 'u', apiKey: 'k', model: 'm' });
    expect(r).toEqual({ text: 'cloud', images: 'none' });
  });

  it('cheie proprie cu model care citește imagini', () => {
    const r = getAiRoute({
      ...base,
      type: 'external',
      url: 'u',
      apiKey: 'k',
      model: 'm',
      chatModelSupportsVision: true,
    });
    expect(r).toEqual({ text: 'cloud', images: 'cloud' });
  });

  it('Dosar AI: totul în cloud', () => {
    expect(getAiRoute({ ...base, type: 'builtin' })).toEqual({ text: 'cloud', images: 'cloud' });
  });
});

describe('getAiConfig — modelul local vine din selecția localModel', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) =>
      store.has(k) ? store.get(k) : null
    );
  });

  it('config salvat la onboarding cu model gol → folosește modelul descărcat', async () => {
    store.set('ai_provider_type', 'local');
    store.set('ai_provider_model', '');
    store.set('local_model_selected', 'qwen35-2b');
    const cfg = await getAiConfig();
    expect(cfg.model).toBe('qwen35-2b');
    expect(validateConfig(cfg)).toBeNull();
  });

  it('fără model selectat → mesajul „nu este selectat"', async () => {
    store.set('ai_provider_type', 'local');
    const cfg = await getAiConfig();
    expect(validateConfig(cfg)).toMatch(/nu este selectat/);
  });

  it('canDoVision: Fără AI cu câmpuri vision rămase → false', async () => {
    store.set('ai_provider_type', 'none');
    store.set('ai_provider_vision_url', 'https://v.example/v1');
    store.set('ai_provider_vision_model', 'pixtral');
    expect(await canDoVision()).toBe(false);
  });
});
