import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { EntityType, DocumentType } from '@/types';
import { ALL_ENTITY_TYPES, STANDARD_DOC_TYPES } from '@/types';

const KEY_NOTIF_DAYS = 'settings_notif_days';
const KEY_APP_LOCK_ENABLED = 'app_lock_enabled';
const KEY_APP_LOCK_PIN = 'app_lock_pin';
const KEY_PUSH_ENABLED = 'settings_push_enabled';

export async function getNotificationDays(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_NOTIF_DAYS);
  if (v == null) return 7;
  const n = parseInt(v, 10);
  return isNaN(n) ? 7 : Math.max(1, Math.min(90, n));
}

export async function setNotificationDays(days: number): Promise<void> {
  const v = Math.max(1, Math.min(90, days));
  await AsyncStorage.setItem(KEY_NOTIF_DAYS, String(v));
}

export async function getPushEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_PUSH_ENABLED);
  return v !== 'false';
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_PUSH_ENABLED, enabled ? 'true' : 'false');
}

export async function getAppLockEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const v = await SecureStore.getItemAsync(KEY_APP_LOCK_ENABLED);
  return v === 'true';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(KEY_APP_LOCK_ENABLED, enabled ? 'true' : 'false');
}

export async function getAppLockPin(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return await SecureStore.getItemAsync(KEY_APP_LOCK_PIN);
}

export async function setAppLockPin(pin: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (pin.length < 4) throw new Error('PIN-ul trebuie să aibă cel puțin 4 cifre.');
  await SecureStore.setItemAsync(KEY_APP_LOCK_PIN, pin);
}

export async function clearAppLockPin(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(KEY_APP_LOCK_PIN);
}

// ── Vizibilitate entități și tipuri de documente ──────────────────────────────

const KEY_VISIBLE_ENTITY_TYPES = 'settings_visible_entity_types';
const KEY_VISIBLE_DOC_TYPES = 'settings_visible_doc_types';

export async function getVisibleEntityTypes(): Promise<EntityType[]> {
  const v = await AsyncStorage.getItem(KEY_VISIBLE_ENTITY_TYPES);
  if (!v) return [...ALL_ENTITY_TYPES];
  try {
    const parsed = JSON.parse(v) as EntityType[];
    return parsed.length > 0 ? parsed : [...ALL_ENTITY_TYPES];
  } catch {
    return [...ALL_ENTITY_TYPES];
  }
}

export async function setVisibleEntityTypes(types: EntityType[]): Promise<void> {
  await AsyncStorage.setItem(KEY_VISIBLE_ENTITY_TYPES, JSON.stringify(types));
}

export async function getVisibleDocTypes(): Promise<DocumentType[]> {
  const v = await AsyncStorage.getItem(KEY_VISIBLE_DOC_TYPES);
  if (!v) return [...STANDARD_DOC_TYPES];
  try {
    const parsed = JSON.parse(v) as DocumentType[];
    return parsed.length > 0 ? parsed : [...STANDARD_DOC_TYPES];
  } catch {
    return [...STANDARD_DOC_TYPES];
  }
}

export async function setVisibleDocTypes(types: DocumentType[]): Promise<void> {
  await AsyncStorage.setItem(KEY_VISIBLE_DOC_TYPES, JSON.stringify(types));
}

// ── Onboarding ────────────────────────────────────────────────────────────────

const KEY_ONBOARDING_DONE = 'settings_onboarding_done';

export async function isOnboardingDone(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_ONBOARDING_DONE);
  return v === 'true';
}

export async function setOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(KEY_ONBOARDING_DONE, 'true');
}
