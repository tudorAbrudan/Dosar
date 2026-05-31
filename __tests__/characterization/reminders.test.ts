jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

let db: typeof import('@/services/db').db;
let remindersService: typeof import('@/services/reminders');

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db;
    remindersService = require('@/services/reminders');
  });
});

describe('reminders table schema', () => {
  it('exists with expected columns', async () => {
    const rows = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(reminders)"
    );
    const cols = rows.map(r => r.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'source_type', 'document_id',
      'person_id', 'vehicle_id', 'property_id', 'animal_id', 'card_id',
      'label', 'reminder_date', 'calendar_event_id',
      'origin', 'created_at', 'dismissed_at',
    ]));
  });

  it('has index on reminder_date', async () => {
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reminders'"
    );
    expect(rows.map(r => r.name)).toEqual(expect.arrayContaining([
      'idx_reminders_date',
      'idx_reminders_source',
      'idx_reminders_document',
    ]));
  });
});

describe('listActiveReminders visibility', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM medical_record');
    // Re-seed parent rows for FK
    await db.runAsync(`INSERT OR IGNORE INTO documents (id, type, created_at) VALUES ('doc-1', 'analize', '2026-01-01T00:00:00Z'), ('doc-2', 'rca', '2026-01-01T00:00:00Z')`);
    await db.runAsync(`INSERT OR IGNORE INTO persons (id, name, created_at) VALUES ('p-1', 'Tudor', '2026-01-01T00:00:00Z')`);
  });

  it('hides medical_ai reminders when no medical_record exists', async () => {
    await remindersService.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'X', reminderDate: '2026-06-01',
    });
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES ('r-doc', 'document_expiry', 'doc-2', 'RCA', '2026-06-05', 'derived', '2026-01-01T00:00:00Z')`
    );

    const list = await remindersService.listActiveReminders();
    expect(list).toHaveLength(1);
    expect(list[0].source_type).toBe('document_expiry');
  });

  it('shows medical_ai reminders when medical_record exists', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, name, encryption_key_ref, created_at, updated_at)
       VALUES ('mr-1', 'p-1', 'Tudor', 'key-ref-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    await remindersService.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'X', reminderDate: '2026-06-01',
    });

    const list = await remindersService.listActiveReminders();
    expect(list).toHaveLength(1);
    expect(list[0].source_type).toBe('medical_ai');
  });

  it('filters out dismissed reminders', async () => {
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at, dismissed_at)
       VALUES ('r-1', 'document_expiry', 'doc-1', 'X', '2026-06-01', 'derived', '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')`
    );
    const list = await remindersService.listActiveReminders();
    expect(list).toHaveLength(0);
  });

  it('sorts by reminder_date ascending', async () => {
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES ('a', 'document_expiry', 'doc-1', 'Later', '2026-08-01', 'derived', '2026-01-01T00:00:00Z'),
              ('b', 'document_expiry', 'doc-2', 'Earlier', '2026-06-01', 'derived', '2026-01-01T00:00:00Z')`
    );
    const list = await remindersService.listActiveReminders();
    expect(list.map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('createMedicalReminder + getRemindersForDocument', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    // Seed parent rows required by FK constraints on reminders.document_id
    await db.runAsync(
      `INSERT OR IGNORE INTO documents (id, type, created_at) VALUES ('doc-1', 'other', '2026-01-01T00:00:00.000Z')`
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO persons (id, name, created_at) VALUES ('person-1', 'Test Person', '2026-01-01T00:00:00.000Z')`
    );
  });

  it('creates a medical_ai reminder and reads it back', async () => {
    const created = await remindersService.createMedicalReminder({
      documentId: 'doc-1',
      personId: 'person-1',
      label: 'Control cardiolog',
      reminderDate: '2026-06-15',
      calendarEventId: 'cal-evt-1',
    });

    expect(created.source_type).toBe('medical_ai');
    expect(created.origin).toBe('ai');
    expect(created.calendar_event_id).toBe('cal-evt-1');
    expect(created.dismissed_at).toBeNull();

    const list = await remindersService.getRemindersForDocument('doc-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });
});
