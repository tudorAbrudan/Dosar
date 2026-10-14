/**
 * Gate-urile AI (services/aiGuard.ts) — regresiile din analiza 2026-10-13:
 * - completarea automată la atașare trimitea în cloud textul + poza documentelor
 *   medicale și a buletinelor, fără niciun gate (`ensureAutoAiAllowed`);
 * - modelul local + provider de imagini în cloud era tratat ca „nimic nu pleacă";
 * - bonul de carburant / factura de utilități trimiteau poza fără acord
 *   (`getScanAiAccess`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Alert, type AlertButton } from 'react-native';
import {
  ensureAiAnalysisAllowed,
  ensureAutoAiAllowed,
  filterMedicalCandidatesForAi,
  getScanAiAccess,
} from '@/services/aiGuard';

jest.mock('@/services/medicalRecord', () => {
  const actual = jest.requireActual('@/services/medicalRecord');
  return {
    ...actual,
    getMedicalRecord: jest.fn(async () => null),
    getMedicalRecordByPersonId: jest.fn(async () => null),
  };
});

const store = new Map<string, string>();
const secure = new Map<string, string>();

function useConfig(cfg: Record<string, string>, secrets: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(cfg)) store.set(k, v);
  for (const [k, v] of Object.entries(secrets)) secure.set(k, v);
}

const LOCAL = { ai_provider_type: 'local', local_model_selected: 'qwen35-2b' };
const LOCAL_WITH_CLOUD_IMAGES = {
  ...LOCAL,
  ai_provider_vision_url: 'https://api.mistral.ai/v1',
  ai_provider_vision_model: 'pixtral-12b-2409',
};
const EXTERNAL = {
  ai_provider_type: 'external',
  ai_provider_url: 'https://api.mistral.ai/v1',
  ai_provider_model: 'mistral-small-latest',
};
const KEYS = { ai_provider_api_key: 'sk-test', ai_provider_vision_api_key: 'sk-vision' };
const CONSENT = { ai_assistant_consent_accepted: 'true' };

beforeEach(() => {
  store.clear();
  secure.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) =>
    store.has(k) ? store.get(k) : null
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) =>
    secure.has(k) ? secure.get(k) : null
  );
});

describe('ensureAiAnalysisAllowed (butonul manual)', () => {
  it('model local simplu: documentul medical rămâne pe telefon → permis', async () => {
    useConfig(LOCAL);
    expect((await ensureAiAnalysisAllowed({ docType: 'analize_medicale' })).allowed).toBe(true);
  });

  it('model local + poze în cloud: documentul medical fără acord pe dosar → blocat', async () => {
    useConfig(LOCAL_WITH_CLOUD_IMAGES, KEYS);
    const r = await ensureAiAnalysisAllowed({ docType: 'analize_medicale' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/acord/);
  });

  it('model local + poze în cloud: buletinul cere acord per tip', async () => {
    useConfig(LOCAL_WITH_CLOUD_IMAGES, KEYS);
    const spy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons?: AlertButton[]) =>
        buttons?.find(b => b.text === 'Nu acum')?.onPress?.()
      );
    expect((await ensureAiAnalysisAllowed({ docType: 'buletin' })).allowed).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ensureAutoAiAllowed (completarea automată)', () => {
  it('model local → nu rulează (jetsam + nimic automat în cloud)', async () => {
    useConfig({ ...LOCAL, ...CONSENT });
    expect((await ensureAutoAiAllowed({ docType: 'factura' })).allowed).toBe(false);
  });

  it('cloud fără acord → nu rulează', async () => {
    useConfig(EXTERNAL, KEYS);
    expect((await ensureAutoAiAllowed({ docType: 'factura' })).allowed).toBe(false);
  });

  it('cloud cu acord, document obișnuit → rulează', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT }, KEYS);
    expect((await ensureAutoAiAllowed({ docType: 'factura' })).allowed).toBe(true);
  });

  it('cloud cu acord, document medical fără dosar consimțit → nu rulează, fără alertă', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT }, KEYS);
    const r = await ensureAutoAiAllowed({ docType: 'analize_medicale' });
    expect(r).toEqual({ allowed: false });
  });

  it('cloud cu acord, buletin refuzat anterior („Nu întreba din nou") → nu rulează', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT, ocr_llm_type_buletin: 'deny' }, KEYS);
    expect((await ensureAutoAiAllowed({ docType: 'buletin' })).allowed).toBe(false);
  });

  it('cloud cu acord, buletin permis anterior → rulează', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT, ocr_llm_type_buletin: 'allow' }, KEYS);
    expect((await ensureAutoAiAllowed({ docType: 'buletin' })).allowed).toBe(true);
  });
});

describe('getScanAiAccess (bon carburant / factură utilități)', () => {
  it('Fără AI → doar regex', async () => {
    useConfig({ ai_provider_type: 'none' });
    expect(await getScanAiAccess()).toEqual({ useAi: false, withImage: false });
  });

  it('model local simplu → AI pe telefon, fără poză', async () => {
    useConfig(LOCAL);
    expect(await getScanAiAccess()).toEqual({ useAi: true, withImage: false });
  });

  it('cheie proprie fără acord → doar regex', async () => {
    useConfig(EXTERNAL, KEYS);
    expect(await getScanAiAccess()).toEqual({ useAi: false, withImage: false });
  });

  it('cheie proprie doar-text, cu acord → AI fără poză', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT }, KEYS);
    expect(await getScanAiAccess()).toEqual({ useAi: true, withImage: false });
  });

  it('cheie proprie care citește imagini, cu acord → AI cu poză', async () => {
    useConfig({ ...EXTERNAL, ...CONSENT, ai_chat_model_supports_vision: 'true' }, KEYS);
    expect(await getScanAiAccess()).toEqual({ useAi: true, withImage: true });
  });
});

describe('filterMedicalCandidatesForAi', () => {
  it('model local + poze în cloud: scoate tipurile medicale din clasificare', async () => {
    useConfig(LOCAL_WITH_CLOUD_IMAGES, KEYS);
    const out = await filterMedicalCandidatesForAi(['factura', 'analize_medicale'], []);
    expect(out).toEqual(['factura']);
  });
});
