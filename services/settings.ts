import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_NOTIF_DAYS = 'settings_notif_days';
const KEY_APP_LOCK_ENABLED = 'app_lock_enabled';
const KEY_APP_LOCK_PIN = 'app_lock_pin';
const KEY_PUSH_ENABLED = 'settings_push_enabled';
const KEY_CONCEDIU_TOTAL = 'settings_concediu_total';
const KEY_CONCEDIU_UTILIZATE = 'settings_concediu_utilizate';

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

export async function getConcediuTotal(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_CONCEDIU_TOTAL);
  if (v == null) return 21;
  const n = parseInt(v, 10);
  return isNaN(n) ? 21 : Math.max(0, n);
}

export async function setConcediuTotal(days: number): Promise<void> {
  await AsyncStorage.setItem(KEY_CONCEDIU_TOTAL, String(Math.max(0, days)));
}

export async function getConcediuUtilizate(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_CONCEDIU_UTILIZATE);
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

export async function setConcediuUtilizate(days: number): Promise<void> {
  await AsyncStorage.setItem(KEY_CONCEDIU_UTILIZATE, String(Math.max(0, days)));
}
