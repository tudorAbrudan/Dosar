jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

let db: typeof import('@/services/db').db;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db;
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
