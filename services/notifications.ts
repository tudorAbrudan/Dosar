import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as settings from './settings';
import { getDocumentsExpiringIn } from './documents';
import { getCustomTypes } from './customTypes';
import { getDocumentLabel } from '@/types';

const NOTIF_CHANNEL_ID = 'expirari';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensureChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIF_CHANNEL_ID, {
      name: 'Expirări documente',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Programează notificări locale pentru documentele care expiră în următoarele N zile.
 * O notificare per document, la ora 9:00 în ziua cu "N zile înainte de expirare".
 * Respectă setările: zile înainte + push on/off.
 */
export async function scheduleExpirationReminders(): Promise<void> {
  const pushEnabled = await settings.getPushEnabled();
  if (!pushEnabled) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }

  const granted = await requestNotificationPermission();
  if (!granted) return;

  await ensureChannel();

  const days = await settings.getNotificationDays();
  const [docs, customTypes] = await Promise.all([
    getDocumentsExpiringIn(days),
    getCustomTypes(),
  ]);

  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const doc of docs) {
    if (!doc.expiry_date) continue;
    const expiry = new Date(doc.expiry_date + 'T12:00:00');
    const reminderDate = new Date(expiry);
    reminderDate.setDate(reminderDate.getDate() - days);
    reminderDate.setHours(9, 0, 0, 0);

    if (reminderDate.getTime() < now.getTime()) continue;

    const asigraUrls: Partial<Record<string, string>> = {
      rca: 'https://asigra.ro',
      casco: 'https://asigra.ro',
    };
    const asigraUrl = asigraUrls[doc.type];
    const isInsurance = !!asigraUrl;

    const docLabel = getDocumentLabel(doc, customTypes);
    const title = isInsurance ? 'Asigurarea expiră curând' : 'Document expiră curând';
    const body = isInsurance
      ? `${docLabel} expiră pe ${doc.expiry_date}. Compară prețuri pe asigra.ro`
      : `${docLabel} expiră pe ${doc.expiry_date}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          documentId: doc.id,
          screen: 'documente',
          ...(asigraUrl ? { url: asigraUrl } : {}),
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
        channelId: NOTIF_CHANNEL_ID,
      },
    });
  }
}
