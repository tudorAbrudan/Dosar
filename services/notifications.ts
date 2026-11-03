import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as settings from './settings';
import { getDocumentsExpiringIn } from './documents';
import { getCustomTypes } from './customTypes';
import { getDismissedExpiryDocumentIds } from './reminders';
import { getInsuranceOffer, getInsuranceOfferUrl } from './insuranceOffers';
import { getDocumentLabel } from '@/types';

const NOTIF_CHANNEL_ID = 'expirari';

/** Categoria notificărilor de asigurare: buton „Compară oferte" lângă tap-ul pe document. */
export const INSURANCE_NOTIF_CATEGORY = 'insurance_expiry';
export const INSURANCE_OFFER_ACTION = 'insurance_offer';

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
  await Notifications.setNotificationCategoryAsync(INSURANCE_NOTIF_CATEGORY, [
    {
      identifier: INSURANCE_OFFER_ACTION,
      buttonTitle: 'Compară oferte',
      options: { opensAppToForeground: true },
    },
  ]);

  const days = await settings.getNotificationDays();
  const [allDocs, customTypes, dismissedIds] = await Promise.all([
    getDocumentsExpiringIn(days),
    getCustomTypes(),
    getDismissedExpiryDocumentIds(),
  ]);
  // Reminder dismissed în tabul Expirări = userul a rezolvat/ignorat expirarea;
  // nu mai programăm nici notificarea locală pentru acel document.
  const docs = allDocs.filter(d => !dismissedIds.has(d.id));

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

    const offer = getInsuranceOffer(doc.type);
    const offerUrl = getInsuranceOfferUrl(doc.type, 'notificare');

    const docLabel = getDocumentLabel(doc, customTypes);
    const title = offer ? 'Asigurarea expiră curând' : 'Document expiră curând';
    const body = offer
      ? `${docLabel} expiră pe ${doc.expiry_date}. Compară oferte ${offer.product} pe asigra.ro`
      : `${docLabel} expiră pe ${doc.expiry_date}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // Tap pe notificare → documentul; butonul „Compară oferte" → offerUrl.
        data: {
          documentId: doc.id,
          screen: 'documente',
          ...(offerUrl ? { offerUrl } : {}),
        },
        ...(offerUrl ? { categoryIdentifier: INSURANCE_NOTIF_CATEGORY } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
        channelId: NOTIF_CHANNEL_ID,
      },
    });
  }
}
