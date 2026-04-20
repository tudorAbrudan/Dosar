import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DocumentType } from '@/types';

export type OcrSensitivity = 'general' | 'sensitive' | 'medical';
export type OcrConsentChoice = 'allow' | 'deny';

// GDPR Art. 9 – categorie specială: niciodată persistat, ask every time
const MEDICAL_TYPES = new Set<DocumentType>([
  'reteta_medicala',
  'analize_medicale',
]);

// Date personale identificabile – necesită confirmare explicită la prima utilizare
const SENSITIVE_TYPES = new Set<DocumentType>([
  'buletin',
  'pasaport',
  'permis_auto',
  'talon',
  'carte_auto',
  'rca',
  'casco',
  'itp',
  'vigneta',
  'act_proprietate',
  'cadastru',
  'card',
  'pad',
  'impozit_proprietate',
]);

export function getSensitiveDocTypes(): DocumentType[] {
  return [...SENSITIVE_TYPES] as DocumentType[];
}

export function getDocTypeSensitivity(type: DocumentType): OcrSensitivity {
  if (MEDICAL_TYPES.has(type)) return 'medical';
  if (SENSITIVE_TYPES.has(type)) return 'sensitive';
  return 'general';
}

const KEY_GLOBAL_GENERAL = 'ocr_llm_global_general';
const KEY_PER_TYPE_PREFIX = 'ocr_llm_type_';

// Global toggle: ON by default pentru documente generale
export async function getGlobalLlmOcrEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_GLOBAL_GENERAL);
  return v !== 'false';
}

export async function setGlobalLlmOcrEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_GLOBAL_GENERAL, enabled ? 'true' : 'false');
}

// Preferință per tip (null = nu a ales niciodată)
export async function getPerTypeConsent(
  type: DocumentType
): Promise<OcrConsentChoice | null> {
  const v = await AsyncStorage.getItem(KEY_PER_TYPE_PREFIX + type);
  if (v === 'allow' || v === 'deny') return v;
  return null;
}

export async function setPerTypeConsent(
  type: DocumentType,
  choice: OcrConsentChoice
): Promise<void> {
  await AsyncStorage.setItem(KEY_PER_TYPE_PREFIX + type, choice);
}

export async function clearPerTypeConsent(type: DocumentType): Promise<void> {
  await AsyncStorage.removeItem(KEY_PER_TYPE_PREFIX + type);
}

// Rezolvă dacă LLM OCR e activat pentru un tip la momentul curent
export async function resolveLlmOcrEnabled(type: DocumentType): Promise<boolean> {
  const sensitivity = getDocTypeSensitivity(type);

  // Medical: niciodată ON by default
  if (sensitivity === 'medical') return false;

  // Per-type override (orice tip poate fi suprascris explicit)
  const perType = await getPerTypeConsent(type);
  if (perType !== null) return perType === 'allow';

  // Sensitive: default OFF dacă nu e explicit 'allow'
  if (sensitivity === 'sensitive') return false;

  // General: urmează setarea globală
  return getGlobalLlmOcrEnabled();
}
