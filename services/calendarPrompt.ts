/**
 * Helper-i pentru flow-ul „Adaugă în calendar?" — Alert + add event + persist
 * `calendar_event_id` în SQLite.
 *
 * Folosit identic în `documente/add.tsx` și `documente/edit.tsx` la save.
 */
import { Alert } from 'react-native';

import {
  addEventToCalendar,
  addExpiryCalendarEvent,
} from './calendar';
import { setDocumentCalendarEventId } from './documents';
import type { DocumentType } from '@/types';

interface ExpiryPromptOptions {
  documentId: string;
  docType: DocumentType;
  expiryDate: string;
  entityName: string | undefined;
  note: string | undefined;
  /** Label de afișat în titlul evenimentului — opțional, vezi
   *  `CalendarEventOptions.displayLabel`. */
  displayLabel?: string;
  /** Rulat după ce userul răspunde, indiferent de alegere (Nu / Adăugat). */
  onDone: () => void;
}

interface EventPromptOptions {
  documentId: string;
  eventDate: string;
  /** Categorie + venue → titlu („Concert – Sala Palatului"); fallback „Eveniment". */
  title: string;
  venue: string | undefined;
  note: string | undefined;
  onDone: () => void;
}

/**
 * `true` dacă data ISO (`YYYY-MM-DD`) e strict înainte de ziua curentă (locală).
 * Azi sau viitor → `false`. String gol / ne-parsabil → `false` (nu suprimă promptul).
 *
 * Folosit ca să NU oferim reminder de calendar pentru date deja trecute — un
 * reminder pentru o dată din trecut e inutil, indiferent de tipul documentului
 * (medical, auto, normal etc.).
 */
export function isPastDate(iso: string): boolean {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

/**
 * Întreabă userul dacă vrea reminder pentru data de expirare. La Da → adaugă
 * event în calendar + setează `documents.calendar_event_id`. La Nu → rulează
 * `onDone` direct. Dacă data a trecut deja, NU oferă reminder (rulează `onDone`).
 */
export function promptAddExpiryReminder(opts: ExpiryPromptOptions): void {
  if (isPastDate(opts.expiryDate)) {
    opts.onDone();
    return;
  }
  Alert.alert(
    'Adaugă în calendar?',
    `Vrei să adaugi un reminder în calendar pentru expirarea pe ${opts.expiryDate}?`,
    [
      { text: 'Nu', style: 'cancel', onPress: opts.onDone },
      {
        text: 'Adaugă',
        onPress: async () => {
          const id = await addExpiryCalendarEvent({
            docType: opts.docType,
            expiryDate: opts.expiryDate,
            entityName: opts.entityName,
            documentId: opts.documentId,
            note: opts.note,
            displayLabel: opts.displayLabel,
          });
          if (id) {
            await setDocumentCalendarEventId(opts.documentId, id);
          } else {
            Alert.alert(
              'Eroare',
              'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.'
            );
          }
          opts.onDone();
        },
      },
    ]
  );
}

/**
 * Întreabă userul dacă vrea reminder pentru data unui eveniment (bilet etc.).
 * La Da → adaugă în calendar + setează `documents.calendar_event_id`. La Nu →
 * rulează `onDone` direct.
 */
export function promptAddEventReminder(opts: EventPromptOptions): void {
  if (isPastDate(opts.eventDate)) {
    opts.onDone();
    return;
  }
  Alert.alert(
    'Adaugă în calendar?',
    `Vrei reminder pentru evenimentul din ${opts.eventDate}?`,
    [
      { text: 'Nu', style: 'cancel', onPress: opts.onDone },
      {
        text: 'Adaugă',
        onPress: async () => {
          const id = await addEventToCalendar({
            title: opts.title,
            eventDate: opts.eventDate,
            venue: opts.venue,
            note: opts.note,
            documentId: opts.documentId,
          });
          if (id) await setDocumentCalendarEventId(opts.documentId, id);
          opts.onDone();
        },
      },
    ]
  );
}
