import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { EntityType, DocumentType, SnapshotFrequency } from '@/types';
import { ALL_ENTITY_TYPES, STANDARD_DOC_TYPES, DEFAULT_VISIBLE_DOC_TYPES } from '@/types';
import { emit } from './events';

const KEY_NOTIF_DAYS = 'settings_notif_days';
const KEY_APP_LOCK_ENABLED = 'app_lock_enabled';
const KEY_APP_LOCK_PIN = 'app_lock_pin';
const KEY_PUSH_ENABLED = 'settings_push_enabled';
const KEY_CLOUD_BACKUP_ENABLED = 'cloud_backup_enabled';
const KEY_CLOUD_IGNORED_UPLOADED_AT = 'cloud_ignored_uploaded_at';
const KEY_CLOUD_SNAPSHOT_FREQUENCY = 'cloud_snapshot_frequency';
const KEY_CLOUD_SNAPSHOT_RETENTION = 'cloud_snapshot_retention';
const KEY_CLOUD_ENCRYPTION_ENABLED = 'cloud_encryption_enabled';
const KEY_AI_MEDICAL_ALLOWED = 'ai_medical_allowed';
const KEY_CLOUD_BACKUP_INCLUDES_MEDICAL_KEY = 'cloud_backup_includes_medical_key';
const KEY_MEDICAL_FTS_VERSION = 'medical_fts_version';

const VALID_FREQUENCIES: readonly SnapshotFrequency[] = [
  'off',
  'daily',
  'every3days',
  'weekly',
  'monthly',
];

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

export async function getCloudBackupEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_BACKUP_ENABLED);
  return v === 'true';
}

export async function setCloudBackupEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_BACKUP_ENABLED, enabled ? 'true' : 'false');
}

export async function getCloudIgnoredUploadedAt(): Promise<number | null> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_IGNORED_UPLOADED_AT);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function setCloudIgnoredUploadedAt(timestamp: number): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_IGNORED_UPLOADED_AT, String(timestamp));
}

export async function getCloudSnapshotFrequency(): Promise<SnapshotFrequency> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_SNAPSHOT_FREQUENCY);
  return VALID_FREQUENCIES.includes(v as SnapshotFrequency) ? (v as SnapshotFrequency) : 'weekly';
}

export async function setCloudSnapshotFrequency(value: SnapshotFrequency): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_SNAPSHOT_FREQUENCY, value);
}

export async function getCloudSnapshotRetention(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_SNAPSHOT_RETENTION);
  if (v == null) return 4;
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(20, Math.trunc(n)));
}

export async function setCloudSnapshotRetention(value: number): Promise<void> {
  const clamped = Math.max(1, Math.min(20, Math.trunc(value)));
  await AsyncStorage.setItem(KEY_CLOUD_SNAPSHOT_RETENTION, String(clamped));
}

export async function getCloudEncryptionEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_ENCRYPTION_ENABLED);
  return v === 'true';
}

export async function setCloudEncryptionEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_ENCRYPTION_ENABLED, enabled ? 'true' : 'false');
}

/**
 * Toggle global pentru asistentul AI medical. Dezactivat = chat-ul medical e
 * inaccesibil pe orice dosar (override la `medical_record.ai_consent_at`).
 */
export async function getAiMedicalAllowed(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_AI_MEDICAL_ALLOWED);
  return v === 'true';
}

export async function setAiMedicalAllowed(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_AI_MEDICAL_ALLOWED, enabled ? 'true' : 'false');
  emit('settings:changed');
}

/**
 * Dacă true, cheia master AES medicală e inclusă în manifest-ul cloud (criptat
 * apoi cu parola cloud). Default OFF — user trebuie să accepte explicit.
 */
export async function getCloudBackupIncludesMedicalKey(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_BACKUP_INCLUDES_MEDICAL_KEY);
  return v === 'true';
}

export async function setCloudBackupIncludesMedicalKey(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_BACKUP_INCLUDES_MEDICAL_KEY, enabled ? 'true' : 'false');
  emit('settings:changed');
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
  emit('settings:changed');
}

export async function getVisibleDocTypes(): Promise<DocumentType[]> {
  const v = await AsyncStorage.getItem(KEY_VISIBLE_DOC_TYPES);
  if (!v) return [...DEFAULT_VISIBLE_DOC_TYPES];
  try {
    const parsed = JSON.parse(v) as DocumentType[];
    return parsed.length > 0 ? parsed : [...DEFAULT_VISIBLE_DOC_TYPES];
  } catch {
    return [...DEFAULT_VISIBLE_DOC_TYPES];
  }
}

export async function setVisibleDocTypes(types: DocumentType[]): Promise<void> {
  await AsyncStorage.setItem(KEY_VISIBLE_DOC_TYPES, JSON.stringify(types));
  emit('settings:changed');
}

// ── Sugestii pe Acasă ─────────────────────────────────────────────────────────

const KEY_SHOW_ORPHANS_ON_HOME = 'settings_show_orphans_on_home';

export async function getShowOrphansOnHome(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_SHOW_ORPHANS_ON_HOME);
  return v !== 'false';
}

export async function setShowOrphansOnHome(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_SHOW_ORPHANS_ON_HOME, enabled ? 'true' : 'false');
  emit('settings:changed');
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

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(KEY_ONBOARDING_DONE);
  await AsyncStorage.setItem(KEY_VISIBLE_DOC_TYPES, JSON.stringify([...DEFAULT_VISIBLE_DOC_TYPES]));
  await AsyncStorage.setItem(KEY_VISIBLE_ENTITY_TYPES, JSON.stringify([...ALL_ENTITY_TYPES]));
}

// ── Temă ──────────────────────────────────────────────────────────────────────

export type ThemePreference = 'light' | 'dark' | 'auto';

const KEY_THEME_PREFERENCE = 'settings_theme_preference';

export async function getThemePreference(): Promise<ThemePreference> {
  const v = await AsyncStorage.getItem(KEY_THEME_PREFERENCE);
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return 'auto';
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(KEY_THEME_PREFERENCE, pref);
}

/**
 * Versiunea curentă a indexului FTS5 medical. Incrementată când schimbăm
 * structura chunks-urilor (ex: adăugare chunks pentru `doc.note` = v2).
 * `ensureFtsIndexUpToDate` din `medicalFts` rebuild-uiește dacă versiunea
 * stocată e mai mică.
 */
export async function getMedicalFtsVersion(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_MEDICAL_FTS_VERSION);
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

export async function setMedicalFtsVersion(version: number): Promise<void> {
  await AsyncStorage.setItem(KEY_MEDICAL_FTS_VERSION, String(version));
}
