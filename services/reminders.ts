import { db, generateId } from './db';
import { deleteCalendarEvent } from './calendar';
import type { Document, Reminder, ReminderSourceType } from '@/types';

interface ReminderRow {
  id: string;
  source_type: string;
  document_id: string | null;
  person_id: string | null;
  vehicle_id: string | null;
  property_id: string | null;
  animal_id: string | null;
  card_id: string | null;
  label: string;
  reminder_date: string;
  calendar_event_id: string | null;
  origin: string;
  created_at: string;
  dismissed_at: string | null;
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    source_type: row.source_type as Reminder['source_type'],
    document_id: row.document_id,
    person_id: row.person_id,
    vehicle_id: row.vehicle_id,
    property_id: row.property_id,
    animal_id: row.animal_id,
    card_id: row.card_id,
    label: row.label,
    reminder_date: row.reminder_date,
    calendar_event_id: row.calendar_event_id,
    origin: row.origin as Reminder['origin'],
    created_at: row.created_at,
    dismissed_at: row.dismissed_at,
  };
}

export async function createMedicalReminder(input: {
  documentId: string;
  personId: string;
  label: string;
  reminderDate: string;
  calendarEventId?: string;
}): Promise<Reminder> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO reminders (id, source_type, document_id, person_id, label, reminder_date, calendar_event_id, origin, created_at)
     VALUES (?, 'medical_ai', ?, ?, ?, ?, ?, 'ai', ?)`,
    [id, input.documentId, input.personId, input.label, input.reminderDate, input.calendarEventId ?? null, now]
  );
  const row = await db.getFirstAsync<ReminderRow>(
    'SELECT * FROM reminders WHERE id = ?',
    [id]
  );
  if (!row) throw new Error('Reminder creat dar nu poate fi citit');
  return rowToReminder(row);
}

export async function getRemindersForDocument(documentId: string): Promise<Reminder[]> {
  const rows = await db.getAllAsync<ReminderRow>(
    'SELECT * FROM reminders WHERE document_id = ? ORDER BY reminder_date ASC',
    [documentId]
  );
  return rows.map(rowToReminder);
}

export async function listActiveReminders(opts?: {
  fromDate?: string;
  sourceType?: ReminderSourceType;
}): Promise<Reminder[]> {
  const wheres: string[] = ['dismissed_at IS NULL'];
  const params: (string | number)[] = [];

  wheres.push(`(
    source_type != 'medical_ai'
    OR EXISTS (SELECT 1 FROM medical_record LIMIT 1)
  )`);

  if (opts?.fromDate) {
    wheres.push('reminder_date >= ?');
    params.push(opts.fromDate);
  }
  if (opts?.sourceType) {
    wheres.push('source_type = ?');
    params.push(opts.sourceType);
  }

  const sql = `SELECT * FROM reminders WHERE ${wheres.join(' AND ')} ORDER BY reminder_date ASC`;
  const rows = await db.getAllAsync<ReminderRow>(sql, params);
  return rows.map(rowToReminder);
}

export async function dismissReminder(id: string): Promise<void> {
  const row = await db.getFirstAsync<ReminderRow>(
    'SELECT * FROM reminders WHERE id = ?', [id]
  );
  if (!row) return;
  if (row.calendar_event_id) {
    await deleteCalendarEvent(row.calendar_event_id);
  }
  await db.runAsync(
    'UPDATE reminders SET dismissed_at = ? WHERE id = ?',
    [new Date().toISOString(), id]
  );
}

function deriveLabelFromDocument(doc: Document): string {
  const { DOCUMENT_TYPE_LABELS } = require('@/types');
  return (DOCUMENT_TYPE_LABELS as Record<string, string>)[doc.type] ?? 'Document';
}

export async function syncDocumentExpiryReminder(doc: Document): Promise<void> {
  if (!doc.expiry_date) return;

  const existing = await db.getFirstAsync<ReminderRow>(
    `SELECT id FROM reminders WHERE document_id = ? AND source_type = 'document_expiry'`,
    [doc.id]
  );

  const label = deriveLabelFromDocument(doc);
  const now = new Date().toISOString();

  if (existing) {
    await db.runAsync(
      `UPDATE reminders SET
         reminder_date = ?, label = ?,
         person_id = ?, vehicle_id = ?, property_id = ?, animal_id = ?, card_id = ?
       WHERE id = ?`,
      [
        doc.expiry_date, label,
        doc.person_id ?? null, doc.vehicle_id ?? null, doc.property_id ?? null,
        doc.animal_id ?? null, doc.card_id ?? null,
        existing.id,
      ]
    );
  } else {
    const id = generateId();
    await db.runAsync(
      `INSERT INTO reminders (
         id, source_type, document_id, person_id, vehicle_id, property_id, animal_id, card_id,
         label, reminder_date, origin, created_at
       ) VALUES (?, 'document_expiry', ?, ?, ?, ?, ?, ?, ?, ?, 'derived', ?)`,
      [
        id, doc.id,
        doc.person_id ?? null, doc.vehicle_id ?? null, doc.property_id ?? null,
        doc.animal_id ?? null, doc.card_id ?? null,
        label, doc.expiry_date, now,
      ]
    );
  }
}

export async function removeDocumentExpiryReminder(documentId: string): Promise<void> {
  await db.runAsync(
    `DELETE FROM reminders WHERE document_id = ? AND source_type = 'document_expiry'`,
    [documentId]
  );
}

export async function deleteRemindersByDocument(documentId: string): Promise<void> {
  const withEvents = await db.getAllAsync<{ calendar_event_id: string }>(
    'SELECT calendar_event_id FROM reminders WHERE document_id = ? AND calendar_event_id IS NOT NULL',
    [documentId]
  );
  for (const r of withEvents) {
    await deleteCalendarEvent(r.calendar_event_id);
  }
  await db.runAsync('DELETE FROM reminders WHERE document_id = ?', [documentId]);
}

export async function backfillDocumentExpiryReminders(): Promise<number> {
  const docsWithExpiry = await db.getAllAsync<{
    id: string; type: string; expiry_date: string;
    person_id: string | null; vehicle_id: string | null;
    property_id: string | null; animal_id: string | null; card_id: string | null;
  }>(
    `SELECT id, type, expiry_date, person_id, vehicle_id, property_id, animal_id, card_id
     FROM documents
     WHERE expiry_date IS NOT NULL
       AND id NOT IN (SELECT document_id FROM reminders WHERE source_type = 'document_expiry' AND document_id IS NOT NULL)`
  );

  const { DOCUMENT_TYPE_LABELS } = require('@/types');
  const now = new Date().toISOString();
  let inserted = 0;

  for (const doc of docsWithExpiry) {
    const id = generateId();
    const label = (DOCUMENT_TYPE_LABELS as Record<string, string>)[doc.type] ?? 'Document';
    await db.runAsync(
      `INSERT INTO reminders (
         id, source_type, document_id, person_id, vehicle_id, property_id, animal_id, card_id,
         label, reminder_date, origin, created_at
       ) VALUES (?, 'document_expiry', ?, ?, ?, ?, ?, ?, ?, ?, 'derived', ?)`,
      [
        id, doc.id, doc.person_id, doc.vehicle_id, doc.property_id, doc.animal_id, doc.card_id,
        label, doc.expiry_date, now,
      ]
    );
    inserted++;
  }
  return inserted;
}
