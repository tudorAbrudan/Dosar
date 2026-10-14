/**
 * Acordul AI medical: valid doar pe textul curent de consimțământ, iar
 * întrerupătorul general din Setări e PORNIT implicit (până la 2026-10-13 era
 * oprit implicit și bloca tăcut acordurile date în dosare).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isMedicalAiConsentValid, MEDICAL_AI_CONSENT_VERSION } from '@/services/medicalRecord';
import { getAiMedicalAllowed } from '@/services/settings';
import { deriveThreadTitle } from '@/services/medicalChat';

describe('isMedicalAiConsentValid', () => {
  it('fără acord → invalid', () => {
    expect(isMedicalAiConsentValid({ ai_consent_at: null, ai_consent_version: 2 })).toBe(false);
  });

  it('acord pe textul vechi (v1, „fără server intermediar") → invalid, se cere din nou', () => {
    expect(
      isMedicalAiConsentValid({ ai_consent_at: '2026-09-01T00:00:00Z', ai_consent_version: 1 })
    ).toBe(false);
  });

  it('acord pe textul curent → valid', () => {
    expect(
      isMedicalAiConsentValid({
        ai_consent_at: '2026-10-13T00:00:00Z',
        ai_consent_version: MEDICAL_AI_CONSENT_VERSION,
      })
    ).toBe(true);
  });
});

describe('getAiMedicalAllowed — întrerupător pornit implicit', () => {
  it('nesetat → pornit', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    expect(await getAiMedicalAllowed()).toBe(true);
  });

  it('oprit explicit → oprit', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('false');
    expect(await getAiMedicalAllowed()).toBe(false);
  });
});

describe('deriveThreadTitle — titlul conversației fără cerere AI', () => {
  it('întrebare scurtă → întreagă', () => {
    expect(deriveThreadTitle('Ce hemoglobină am?')).toBe('Ce hemoglobină am?');
  });

  it('întrebare lungă → tăiată la cuvânt, cu „…"', () => {
    const t = deriveThreadTitle(
      'Cum a evoluat colesterolul HDL în ultimii trei ani față de valorile normale?'
    );
    expect(t.length).toBeLessThanOrEqual(41);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/\s…$/);
  });
});
