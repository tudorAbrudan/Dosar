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
 * Întreabă userul dacă vrea reminder pentru data de expirare. La Da → adaugă
 * event în calendar + setează `documents.calendar_event_id`. La Nu → rulează
 * `onDone` direct.
 */
export function promptAddExpiryReminder(opts: ExpiryPromptOptions): void {
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
