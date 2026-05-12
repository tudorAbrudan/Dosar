import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DocumentType } from '@/types';

export type OcrSensitivity = 'general' | 'sensitive';
export type OcrConsentChoice = 'allow' | 'deny';

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
  if (SENSITIVE_TYPES.has(type)) return 'sensitive';
  return 'general';
}

const KEY_PER_TYPE_PREFIX = 'ocr_llm_type_';

// Preferință per tip (null = nu a ales niciodată)
export async function getPerTypeConsent(type: DocumentType): Promise<OcrConsentChoice | null> {
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

const KEY_IMAGE_AI_CONSENT = 'ocr_image_ai_consent';

// Consent global pentru trimiterea imaginilor la AI (null = nu a ales niciodată)
export async function getImageAiConsent(): Promise<boolean | null> {
  const v = await AsyncStorage.getItem(KEY_IMAGE_AI_CONSENT);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

export async function setImageAiConsent(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_IMAGE_AI_CONSENT, value ? 'true' : 'false');
}
