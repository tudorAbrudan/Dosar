import { Platform } from 'react-native';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, VehicleMaintenanceTask } from '@/types';
import { APP_STORE_URL } from '@/constants/AppLinks';

// expo-calendar necesită build nativ (expo prebuild + expo run:ios).
// Importăm cu require pentru a nu crăpa app-ul dacă modulul nativ nu e linkat.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CalendarModule = (() => {
  try {
    return require('expo-calendar');
  } catch {
    return null;
  }
})();

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

  const calendars: {
    id: string;
    allowsModifications: boolean;
    accessLevel?: string;
    source?: { name?: string; isLocalAccount?: boolean };
  }[] = await CalendarModule.getCalendarsAsync(CalendarModule.EntityTypes.EVENT);

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
    const deepLink = opts.documentId ? `acte:///documente/${opts.documentId}` : null;
    const noteLines = [
      `Tip: ${typeLabel}`,
      opts.entityName ? `Entitate: ${opts.entityName}` : null,
      `Expiră: ${opts.expiryDate}`,
      opts.note ? `Notă: ${opts.note}` : null,
      asigraUrl ? `Compară oferte: ${asigraUrl}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale · https://tudorabrudan.github.io/Dosar/',
    ]
      .filter(Boolean)
      .join('\n');
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
      url: opts.documentId ? `acte:///documente/${opts.documentId}` : undefined,
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

/**
 * Actualizează un eveniment de expirare existent (titlu, notes, dată, alarm).
 * Dacă eventul a fost șters manual din Calendar.app, recreează silent.
 * Returnează ID-ul (același sau nou).
 */
export async function updateExpiryCalendarEvent(
  eventId: string,
  opts: CalendarEventOptions
): Promise<string | null> {
  if (!CalendarModule) return null;

  try {
    const typeLabel = DOCUMENT_TYPE_LABELS[opts.docType] ?? opts.docType;
    const title = opts.entityName
      ? `Expiră ${typeLabel} – ${opts.entityName}`
      : `Expiră ${typeLabel}`;

    const asigraUrl = ASIGRA_TYPES[opts.docType];
    const deepLink = opts.documentId ? `acte:///documente/${opts.documentId}` : null;
    const notes = [
      `Tip: ${typeLabel}`,
      opts.entityName ? `Entitate: ${opts.entityName}` : null,
      `Expiră: ${opts.expiryDate}`,
      opts.note ? `Notă: ${opts.note}` : null,
      asigraUrl ? `Compară oferte: ${asigraUrl}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale · https://tudorabrudan.github.io/Dosar/',
    ]
      .filter(Boolean)
      .join('\n');

    const [year, month, day] = opts.expiryDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, 9, 0, 0);
    const endDate = new Date(year, month - 1, day, 10, 0, 0);

    await CalendarModule.updateEventAsync(eventId, {
      title,
      notes,
      startDate,
      endDate,
      alarms: [{ relativeOffset: -REMINDER_DAYS_BEFORE * 24 * 60 }],
      url: opts.documentId ? `acte:///documente/${opts.documentId}` : undefined,
      timeZone: 'Europe/Bucharest',
    });
    return eventId;
  } catch {
    // Eveniment șters din calendar de utilizator → creează unul nou
    return addExpiryCalendarEvent(opts);
  }
}

/**
 * Actualizează un eveniment de bilet existent.
 * Dacă a fost șters manual din Calendar.app, recreează silent.
 */
export async function updateBiletCalendarEvent(
  eventId: string,
  opts: EventCalendarOptions
): Promise<string | null> {
  if (!CalendarModule) return null;

  try {
    let year: number, month: number, day: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(opts.eventDate)) {
      [year, month, day] = opts.eventDate.split('-').map(Number);
    } else {
      const m = opts.eventDate.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
      if (!m) return null;
      day = Number(m[1]);
      month = Number(m[2]);
      year = Number(m[3]);
    }

    const startDate = new Date(year, month - 1, day, 10, 0, 0);
    const endDate = new Date(year, month - 1, day, 12, 0, 0);

    const deepLink = opts.documentId ? `acte:///documente/${opts.documentId}` : null;
    const notes = [
      opts.venue ? `Locație / Rută: ${opts.venue}` : null,
      opts.note ? `Notă: ${opts.note}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale · https://tudorabrudan.github.io/Dosar/',
    ]
      .filter(Boolean)
      .join('\n');

    await CalendarModule.updateEventAsync(eventId, {
      title: opts.title,
      notes,
      startDate,
      endDate,
      alarms: [{ relativeOffset: -24 * 60 }, { relativeOffset: -2 * 60 }],
      url: opts.documentId ? `acte:///documente/${opts.documentId}` : undefined,
      timeZone: 'Europe/Bucharest',
    });
    return eventId;
  } catch {
    return addEventToCalendar(opts);
  }
}

/** Șterge un eveniment generic din calendar (silent fail dacă nu există). */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (!CalendarModule) return;
  try {
    await CalendarModule.deleteEventAsync(eventId);
  } catch {
    // deja șters sau calendar inaccesibil
  }
}

export interface EventCalendarOptions {
  title: string; // ex: "Concert Coldplay"
  eventDate: string; // AAAA-LL-ZZ sau ZZ.LL.AAAA
  venue?: string; // locație / rută
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
      day = Number(m[1]);
      month = Number(m[2]);
      year = Number(m[3]);
    }

    const startDate = new Date(year, month - 1, day, 10, 0, 0);
    const endDate = new Date(year, month - 1, day, 12, 0, 0);

    const deepLink = opts.documentId ? `acte:///documente/${opts.documentId}` : null;
    const noteLines = [
      opts.venue ? `Locație / Rută: ${opts.venue}` : null,
      opts.note ? `Notă: ${opts.note}` : null,
      deepLink ? `Deschide în Acte: ${deepLink}` : null,
      'Adăugat de Acte – Documente Personale · https://tudorabrudan.github.io/Dosar/',
    ]
      .filter(Boolean)
      .join('\n');

    const eventId = await CalendarModule.createEventAsync(calendarId, {
      title: opts.title,
      notes: noteLines,
      startDate,
      endDate,
      alarms: [
        { relativeOffset: -24 * 60 }, // 1 zi înainte
        { relativeOffset: -2 * 60 }, // 2 ore înainte
      ],
      url: opts.documentId ? `acte:///documente/${opts.documentId}` : undefined,
      timeZone: 'Europe/Bucharest',
    });
    return eventId ?? null;
  } catch {
    return null;
  }
}

// Calcul: data scadenței pentru task-ul de mentenanță, pe baza trigger_months
function computeMaintenanceDueDate(task: VehicleMaintenanceTask): Date | null {
  if (task.trigger_months == null) return null;
  const base = task.last_done_date ? new Date(task.last_done_date) : new Date(task.createdAt);
  const due = new Date(base);
  due.setMonth(due.getMonth() + task.trigger_months);
  return due;
}

function buildMaintenanceNotes(task: VehicleMaintenanceTask, vehicleName: string): string {
  const lines: string[] = [`Vehicul: ${vehicleName}`, `Intervenție: ${task.name}`];
  if (task.trigger_km != null) {
    const baseKm = task.last_done_km ?? 0;
    const nextKm = baseKm + task.trigger_km;
    lines.push(
      `Prag km: ${task.trigger_km.toLocaleString('ro-RO')} km (următorul la ${nextKm.toLocaleString('ro-RO')} km)`
    );
    lines.push(
      'Dacă ai atins deja pragul de km și ai făcut intervenția, marchează task-ul ca efectuat în aplicație — reminderul va fi actualizat automat.'
    );
  }
  if (task.note) {
    lines.push(`Notă: ${task.note}`);
  }
  lines.push('');
  lines.push(`Reamintire de la Dosar · ${APP_STORE_URL}`);
  return lines.join('\n');
}

/**
 * Creează un eveniment de calendar pentru un task de mentenanță cu trigger_months.
 * Reminder: cu 7 zile înainte și în ziua scadenței (dimineața).
 * Returnează ID-ul evenimentului sau null dacă nu se poate crea (permisiune/calendar indisponibil).
 */
export async function addMaintenanceCalendarEvent(
  task: VehicleMaintenanceTask,
  vehicleName: string
): Promise<string | null> {
  if (!CalendarModule) return null;
  const dueDate = computeMaintenanceDueDate(task);
  if (!dueDate) return null;

  try {
    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    const startDate = new Date(dueDate);
    startDate.setHours(9, 0, 0, 0);
    const endDate = new Date(dueDate);
    endDate.setHours(10, 0, 0, 0);

    const eventId = await CalendarModule.createEventAsync(calendarId, {
      title: `🔧 ${vehicleName} – ${task.name}`,
      notes: buildMaintenanceNotes(task, vehicleName),
      startDate,
      endDate,
      alarms: [
        { relativeOffset: -7 * 24 * 60 }, // 7 zile înainte
        { relativeOffset: 0 }, // la ora scadenței
      ],
      url: APP_STORE_URL,
      timeZone: 'Europe/Bucharest',
    });
    return eventId ?? null;
  } catch {
    return null;
  }
}

/**
 * Actualizează un eveniment de calendar existent pentru un task de mentenanță.
 * Dacă task-ul nu mai are trigger_months, șterge evenimentul.
 * Returnează ID-ul evenimentului (același sau nou, după caz) sau null dacă s-a șters.
 */
export async function updateMaintenanceCalendarEvent(
  eventId: string,
  task: VehicleMaintenanceTask,
  vehicleName: string
): Promise<string | null> {
  if (!CalendarModule) return null;

  const dueDate = computeMaintenanceDueDate(task);
  if (!dueDate) {
    await deleteMaintenanceCalendarEvent(eventId);
    return null;
  }

  try {
    const startDate = new Date(dueDate);
    startDate.setHours(9, 0, 0, 0);
    const endDate = new Date(dueDate);
    endDate.setHours(10, 0, 0, 0);

    await CalendarModule.updateEventAsync(eventId, {
      title: `🔧 ${vehicleName} – ${task.name}`,
      notes: buildMaintenanceNotes(task, vehicleName),
      startDate,
      endDate,
      alarms: [{ relativeOffset: -7 * 24 * 60 }, { relativeOffset: 0 }],
      url: APP_STORE_URL,
      timeZone: 'Europe/Bucharest',
    });
    return eventId;
  } catch {
    // Eveniment șters din calendar de utilizator → creează unul nou
    return addMaintenanceCalendarEvent(task, vehicleName);
  }
}

/** Șterge un eveniment de calendar. Silent fail dacă nu există. */
export async function deleteMaintenanceCalendarEvent(eventId: string): Promise<void> {
  if (!CalendarModule) return;
  try {
    await CalendarModule.deleteEventAsync(eventId);
  } catch {
    // deja șters sau calendar inaccesibil
  }
}
