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

/** Există măcar o alegere salvată („Permite" / „Nu întreba din nou") pe un tip sensibil. */
export async function hasAnyPerTypeConsent(): Promise<boolean> {
  const choices = await Promise.all(getSensitiveDocTypes().map(getPerTypeConsent));
  return choices.some(c => c !== null);
}

/**
 * Șterge toate alegerile per tip sensibil — la următoarea trimitere userul e
 * întrebat din nou. Ținta textului „Poți schimba din Setări" din aiGuard.
 */
export async function clearAllPerTypeConsents(): Promise<void> {
  await Promise.all(getSensitiveDocTypes().map(clearPerTypeConsent));
}
