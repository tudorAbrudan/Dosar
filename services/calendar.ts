import { Platform } from 'react-native';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType } from '@/types';

// expo-calendar necesită build nativ (expo prebuild + expo run:ios).
// Importăm cu require pentru a nu crăpa app-ul dacă modulul nativ nu e linkat.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CalendarModule = (() => { try { return require('expo-calendar'); } catch { return null; } })();

const REMINDER_DAYS_BEFORE = 14;

const ASIGRA_URL = 'https://asigra.ro';

/** Tipuri pentru care afișăm link-ul asigra.ro */
const ASIGRA_TYPES: Partial<Record<DocumentType, string>> = {
  rca: ASIGRA_URL,
  casco: ASIGRA_URL,
  itp: ASIGRA_URL,
};

async function getDefaultCalendarId(): Promise<string | null> {
  if (!CalendarModule) return null;

  const { status } = await CalendarModule.requestCalendarPermissionsAsync();
  if (status !== 'granted') return null;

  const calendars: Array<{
    id: string;
    allowsModifications: boolean;
    accessLevel?: string;
    source?: { name?: string; isLocalAccount?: boolean };
  }> = await CalendarModule.getCalendarsAsync(CalendarModule.EntityTypes.EVENT);

  if (Platform.OS === 'ios') {
    const icloud = calendars.find(c => c.source?.name === 'iCloud' && c.allowsModifications);
    const local = calendars.find(c => c.source?.isLocalAccount && c.allowsModifications);
    return (icloud ?? local ?? calendars.find(c => c.allowsModifications))?.id ?? null;
  }

  const google = calendars.find(c => c.accessLevel === 'owner' && c.allowsModifications);
  return (google ?? calendars.find(c => c.allowsModifications))?.id ?? null;
}

export interface CalendarEventOptions {
  docType: DocumentType;
  expiryDate: string; // AAAA-LL-ZZ
  entityName?: string;
  documentId?: string;
  note?: string;
}

/**
 * Adaugă un eveniment în calendar cu reminder cu 14 zile înainte de expirare.
 * Pentru RCA și ITP include link asigra.ro în descriere.
 * Returnează ID-ul evenimentului sau null dacă calendarul nu e disponibil.
 */
export async function addExpiryCalendarEvent(opts: CalendarEventOptions): Promise<string | null> {
  if (!CalendarModule) return null;

  try {
    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    const typeLabel = DOCUMENT_TYPE_LABELS[opts.docType] ?? opts.docType;
    const title = opts.entityName
      ? `Expiră ${typeLabel} – ${opts.entityName}`
      : `Expiră ${typeLabel}`;

    const asigraUrl = ASIGRA_TYPES[opts.docType];
    const deepLink = opts.documentId ? `app:///documente/${opts.documentId}` : null;
    const noteLines = [
      `Tip: ${typeLabel}`,
      opts.entityName ? `Entitate: ${opts.entityName}` : null,
      `Expiră: ${opts.expiryDate}`,
      opts.note ? `Notă: ${opts.note}` : null,
      asigraUrl ? `Compară oferte: ${asigraUrl}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale.',
    ].filter(Boolean).join('\n');
    const notes = noteLines;

    const [year, month, day] = opts.expiryDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, 9, 0, 0);
    const endDate = new Date(year, month - 1, day, 10, 0, 0);

    const eventId = await CalendarModule.createEventAsync(calendarId, {
      title,
      notes,
      startDate,
      endDate,
      alarms: [{ relativeOffset: -REMINDER_DAYS_BEFORE * 24 * 60 }],
      url: opts.documentId ? `app:///documente/${opts.documentId}` : undefined,
      timeZone: 'Europe/Bucharest',
    });
    return eventId ?? null;
  } catch {
    return null;
  }
}

/** Returnează true dacă modulul nativ de calendar e disponibil (build nativ, nu Expo Go) */
export function isCalendarAvailable(): boolean {
  return CalendarModule !== null;
}

export interface EventCalendarOptions {
  title: string;          // ex: "Concert Coldplay"
  eventDate: string;      // AAAA-LL-ZZ sau ZZ.LL.AAAA
  venue?: string;         // locație / rută
  note?: string;
  documentId?: string;
}

/**
 * Adaugă un eveniment în calendar pentru un bilet (concert, zbor, tren etc.).
 * Reminder: cu 1 zi înainte și cu 2 ore înainte.
 */
export async function addEventToCalendar(opts: EventCalendarOptions): Promise<string | null> {
  if (!CalendarModule) return null;

  try {
    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    // Parsează data: acceptă AAAA-LL-ZZ sau ZZ.LL.AAAA
    let year: number, month: number, day: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(opts.eventDate)) {
      [year, month, day] = opts.eventDate.split('-').map(Number);
    } else {
      const m = opts.eventDate.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
      if (!m) return null;
      day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
    }

    const startDate = new Date(year, month - 1, day, 10, 0, 0);
    const endDate = new Date(year, month - 1, day, 12, 0, 0);

    const deepLink = opts.documentId ? `app:///documente/${opts.documentId}` : null;
    const noteLines = [
      opts.venue ? `Locație / Rută: ${opts.venue}` : null,
      opts.note ? `Notă: ${opts.note}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale.',
    ].filter(Boolean).join('\n');

    const eventId = await CalendarModule.createEventAsync(calendarId, {
      title: opts.title,
      notes: noteLines,
      startDate,
      endDate,
      alarms: [
        { relativeOffset: -24 * 60 },  // 1 zi înainte
        { relativeOffset: -2 * 60 },   // 2 ore înainte
      ],
      url: opts.documentId ? `app:///documente/${opts.documentId}` : undefined,
      timeZone: 'Europe/Bucharest',
    });
    return eventId ?? null;
  } catch {
    return null;
  }
}
