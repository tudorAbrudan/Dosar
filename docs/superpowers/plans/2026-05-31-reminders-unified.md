# Remindere unificate în tab-ul Expirări — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă un tabel SQLite unificat `reminders` care alimentează tab-ul Expirări atât cu expirări de documente cât și cu remindere medicale aprobate de AI; păstrează `documents.expiry_date` ca sursă de adevăr sincronizată automat.

**Architecture:** Tabel nou `reminders` (one row per visible reminder), service `reminders.ts` cu API CRUD + sync helpers, hook `useReminders` cu event-bus refresh, un component `ReminderCard` unic care randează ambele tipuri. Migrare backfill idempotentă pentru utilizatorii existenți. Calendarul iOS rămâne fire-and-forget pentru reminderele medicale.

**Tech Stack:** TypeScript, expo-sqlite (`getAllAsync`/`runAsync`), expo-calendar, Jest characterization tests cu better-sqlite3 in-memory, custom audit scripts (Node fs).

**Spec sursă:** `docs/superpowers/specs/2026-05-31-reminders-unified-design.md`

---

## File Structure

**Create:**
- `services/reminders.ts` — API CRUD + sync helpers
- `hooks/useReminders.ts` — hook standard `{reminders, loading, error, refresh}`
- `components/reminders/ReminderCard.tsx` — render unic pentru ambele tipuri
- `__tests__/characterization/reminders.test.ts` — schema + sync + visibility tests
- `scripts/reminder-consistency-audit.js` — audit warning-only

**Modify:**
- `types/index.ts` — interface `Reminder` + type aliases
- `services/db.ts` — CREATE TABLE reminders + indexuri + backfill helper
- `services/documents.ts` — hooks în create/update/delete pentru sync
- `services/backup.ts` — exportBackup + applyManifest pentru reminders
- `services/cloudSync.ts` — buildManifestPayload + restore pentru reminders
- `services/appKnowledge.ts` — secțiune „Remindere" pentru chatbot
- `app/(tabs)/expirari.tsx` — refactor sursa de date
- `app/(tabs)/documente/[id].tsx` — secțiune „Remindere active" + buton șterge
- `components/medical/MedicalRemindersModal.tsx` — apel createMedicalReminder
- `scripts/knowledge-audit.js` — `ENTRIES.services.reminders`
- `__tests__/characterization/backup.test.ts` — extindere pentru reminders
- `__tests__/characterization/db.test.ts` — extindere pentru reminders + backfill

**Test files run by:** `npm run test:characterization`
**Audits run by:** `npm run audit` (include type-check + audit scripts + characterization tests)

---

## Task 1: Adaugă interface `Reminder` și types în `types/index.ts`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Adaugă interface și types la sfârșitul fișierului `types/index.ts`**

Localizează grupa de exports pentru entități medicale (după interface-urile existente). Adaugă:

```typescript
// ============ REMINDERS ============

export type ReminderSourceType = 'document_expiry' | 'medical_ai';
export type ReminderOrigin = 'ai' | 'derived' | 'manual';

export interface Reminder {
  id: string;
  source_type: ReminderSourceType;
  document_id: string | null;
  person_id: string | null;
  vehicle_id: string | null;
  property_id: string | null;
  animal_id: string | null;
  card_id: string | null;
  label: string;
  reminder_date: string;          // YYYY-MM-DD
  calendar_event_id: string | null;
  origin: ReminderOrigin;
  created_at: string;
  dismissed_at: string | null;
}
```

- [ ] **Step 2: Verifică type-check pass**

```bash
cd app && npm run type-check
```

Expected: zero erori.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "types: add Reminder interface and type aliases"
```

---

## Task 2: Adaugă tabel `reminders` și indexuri în `services/db.ts`

**Files:**
- Modify: `services/db.ts` (în blocul `try { db.execSync(...) }` unde se declară tabele)
- Test: `__tests__/characterization/reminders.test.ts` (creează nou)

- [ ] **Step 1: Creează fișierul test `__tests__/characterization/reminders.test.ts` cu test pentru schema**

```typescript
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
```

- [ ] **Step 2: Rulează testul — trebuie să cadă (tabel inexistent)**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts
```

Expected: FAIL (PRAGMA returnează listă goală sau eroare).

- [ ] **Step 3: Adaugă CREATE TABLE în `services/db.ts`**

Localizează blocul `db.execSync(\`...\`)` din `initDb()` unde sunt declarate `medical_observations` și tabelele medicale (în jurul liniilor 200-280 conform pattern-ului). După ultimul `CREATE INDEX` din acel bloc adaugă:

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  person_id TEXT,
  vehicle_id TEXT,
  property_id TEXT,
  animal_id TEXT,
  card_id TEXT,
  label TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  calendar_event_id TEXT,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dismissed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_date ON reminders(reminder_date);
CREATE INDEX IF NOT EXISTS idx_reminders_source ON reminders(source_type);
CREATE INDEX IF NOT EXISTS idx_reminders_document ON reminders(document_id);
```

Notă: `ON DELETE CASCADE` pentru `document_id` asigură cleanup automat când documentul e șters via SQLite foreign keys (presupune `PRAGMA foreign_keys = ON` — verifică în db.ts; dacă lipsește, vezi Task 8 unde adăugăm DELETE manual ca backup).

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts
```

Expected: PASS (toate testele schema).

- [ ] **Step 5: Rulează auditele pentru a confirma că tabelul nu e DROP-uit destructiv**

```bash
cd app && node scripts/db-destructive-init-audit.js --strict
cd app && node scripts/alter-table-trycatch-audit.js --strict
```

Expected: ambele 0 violations.

- [ ] **Step 6: Commit**

```bash
git add services/db.ts __tests__/characterization/reminders.test.ts
git commit -m "db: add reminders table with indexes"
```

---

## Task 3: Schelet `services/reminders.ts` cu `createMedicalReminder` și `getRemindersForDocument`

**Files:**
- Create: `services/reminders.ts`
- Test: `__tests__/characterization/reminders.test.ts` (extinde)

- [ ] **Step 1: Adaugă test pentru createMedicalReminder + getRemindersForDocument**

În `__tests__/characterization/reminders.test.ts`, adaugă un nou `describe` la sfârșit:

```typescript
describe('createMedicalReminder + getRemindersForDocument', () => {
  let reminders: typeof import('@/services/reminders');

  beforeAll(() => {
    jest.isolateModules(() => {
      reminders = require('@/services/reminders');
    });
  });

  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
  });

  it('creates a medical_ai reminder and reads it back', async () => {
    const created = await reminders.createMedicalReminder({
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

    const list = await reminders.getRemindersForDocument('doc-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă (modul inexistent)**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "createMedicalReminder"
```

Expected: FAIL (Cannot find module '@/services/reminders').

- [ ] **Step 3: Creează `services/reminders.ts`**

```typescript
import { db, generateId } from './db';
import type { Reminder } from '@/types';

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
    'SELECT * FROM reminders WHERE id = ?', [id]
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
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "createMedicalReminder"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add createMedicalReminder + getRemindersForDocument"
```

---

## Task 4: Adaugă `listActiveReminders` cu vizibilitate condiționată pe `medical_record`

**Files:**
- Modify: `services/reminders.ts`
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test**

În `__tests__/characterization/reminders.test.ts`, adaugă în `describe('createMedicalReminder + getRemindersForDocument')` un nou describe:

```typescript
describe('listActiveReminders visibility', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM medical_record');
  });

  it('hides medical_ai reminders when no medical_record exists', async () => {
    await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'X', reminderDate: '2026-06-01',
    });
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES ('r-doc', 'document_expiry', 'doc-2', 'RCA', '2026-06-05', 'derived', '2026-01-01T00:00:00Z')`
    );

    const list = await reminders.listActiveReminders();
    expect(list).toHaveLength(1);
    expect(list[0].source_type).toBe('document_expiry');
  });

  it('shows medical_ai reminders when medical_record exists', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'X', reminderDate: '2026-06-01',
    });

    const list = await reminders.listActiveReminders();
    expect(list).toHaveLength(1);
    expect(list[0].source_type).toBe('medical_ai');
  });

  it('filters out dismissed reminders', async () => {
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at, dismissed_at)
       VALUES ('r-1', 'document_expiry', 'doc-1', 'X', '2026-06-01', 'derived', '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')`
    );
    const list = await reminders.listActiveReminders();
    expect(list).toHaveLength(0);
  });

  it('sorts by reminder_date ascending', async () => {
    await db.runAsync(
      `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
       VALUES ('a', 'document_expiry', 'd1', 'Later', '2026-08-01', 'derived', '2026-01-01T00:00:00Z'),
              ('b', 'document_expiry', 'd2', 'Earlier', '2026-06-01', 'derived', '2026-01-01T00:00:00Z')`
    );
    const list = await reminders.listActiveReminders();
    expect(list.map(r => r.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "listActiveReminders visibility"
```

Expected: FAIL (listActiveReminders nu există).

- [ ] **Step 3: Adaugă funcția în `services/reminders.ts`**

```typescript
import type { ReminderSourceType } from '@/types';

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
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "listActiveReminders visibility"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add listActiveReminders with medical visibility gating"
```

---

## Task 5: Adaugă `dismissReminder` (soft-delete + șterge calendar event)

**Files:**
- Modify: `services/reminders.ts`
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test**

```typescript
describe('dismissReminder', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM medical_record');
  });

  it('sets dismissed_at and keeps the row', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    const r = await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'X', reminderDate: '2026-06-01',
    });

    await reminders.dismissReminder(r.id);

    const all = await db.getAllAsync<{ dismissed_at: string | null }>(
      'SELECT dismissed_at FROM reminders WHERE id = ?', [r.id]
    );
    expect(all).toHaveLength(1);
    expect(all[0].dismissed_at).not.toBeNull();

    const list = await reminders.listActiveReminders();
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "dismissReminder"
```

Expected: FAIL.

- [ ] **Step 3: Adaugă funcția în `services/reminders.ts`**

Adaugă import sus în fișier:
```typescript
import { deleteCalendarEvent } from './calendar';
```

Adaugă funcția la sfârșit:
```typescript
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
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

Notă: `deleteCalendarEvent` deja se închide în try/catch intern (vezi `services/calendar.ts`). În test, `CalendarModule` e null pe mediu Jest → no-op. Funcționează.

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "dismissReminder"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add dismissReminder (soft-delete + calendar cleanup)"
```

---

## Task 6: Adaugă `syncDocumentExpiryReminder` și `removeDocumentExpiryReminder`

**Files:**
- Modify: `services/reminders.ts`
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test**

```typescript
describe('syncDocumentExpiryReminder', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
  });

  it('inserts a new derived reminder if none exists', async () => {
    const doc = {
      id: 'doc-1',
      type: 'rca',
      expiry_date: '2026-09-10',
      vehicle_id: 'v-1',
      created_at: '2026-01-01T00:00:00Z',
    } as any;
    await reminders.syncDocumentExpiryReminder(doc);

    const all = await db.getAllAsync<ReminderRow>(
      'SELECT * FROM reminders WHERE document_id = ?', ['doc-1']
    );
    expect(all).toHaveLength(1);
    expect(all[0].source_type).toBe('document_expiry');
    expect(all[0].origin).toBe('derived');
    expect(all[0].reminder_date).toBe('2026-09-10');
    expect(all[0].vehicle_id).toBe('v-1');
    expect(all[0].calendar_event_id).toBeNull();
  });

  it('updates existing derived reminder if date changes', async () => {
    const doc = {
      id: 'doc-1', type: 'rca', expiry_date: '2026-09-10',
      vehicle_id: 'v-1', created_at: '2026-01-01T00:00:00Z',
    } as any;
    await reminders.syncDocumentExpiryReminder(doc);
    doc.expiry_date = '2026-12-31';
    await reminders.syncDocumentExpiryReminder(doc);

    const all = await db.getAllAsync<ReminderRow>(
      'SELECT * FROM reminders WHERE document_id = ?', ['doc-1']
    );
    expect(all).toHaveLength(1);
    expect(all[0].reminder_date).toBe('2026-12-31');
  });

  it('does NOT touch medical_ai reminders on the same document', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'Control', reminderDate: '2026-07-01',
    });
    const doc = {
      id: 'doc-1', type: 'analize', expiry_date: '2026-09-10',
      person_id: 'p-1', created_at: '2026-01-01T00:00:00Z',
    } as any;
    await reminders.syncDocumentExpiryReminder(doc);

    const all = await db.getAllAsync<ReminderRow>(
      'SELECT * FROM reminders WHERE document_id = ? ORDER BY source_type', ['doc-1']
    );
    expect(all).toHaveLength(2);
    expect(all.map(r => r.source_type).sort()).toEqual(['document_expiry', 'medical_ai']);
  });
});

describe('removeDocumentExpiryReminder', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
  });

  it('deletes only the derived row, not medical_ai', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'Control', reminderDate: '2026-07-01',
    });
    const doc = {
      id: 'doc-1', type: 'analize', expiry_date: '2026-09-10',
      person_id: 'p-1', created_at: '2026-01-01T00:00:00Z',
    } as any;
    await reminders.syncDocumentExpiryReminder(doc);

    await reminders.removeDocumentExpiryReminder('doc-1');

    const all = await db.getAllAsync<ReminderRow>(
      'SELECT * FROM reminders WHERE document_id = ?', ['doc-1']
    );
    expect(all).toHaveLength(1);
    expect(all[0].source_type).toBe('medical_ai');
  });
});
```

- [ ] **Step 2: Rulează testele — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "syncDocumentExpiryReminder"
```

Expected: FAIL.

- [ ] **Step 3: Adaugă funcțiile în `services/reminders.ts`**

```typescript
import type { Document } from '@/types';

function deriveLabelFromDocument(doc: Document): string {
  // Foloseste DOCUMENT_TYPE_LABELS pentru label uman
  // Lazy require pentru a evita ciclu de import
  const { DOCUMENT_TYPE_LABELS } = require('@/types');
  return DOCUMENT_TYPE_LABELS[doc.type] ?? 'Document';
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
```

- [ ] **Step 4: Rulează testele — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "DocumentExpiry"
```

Expected: PASS (toate sub-testele).

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add sync/remove document expiry reminder helpers"
```

---

## Task 7: Adaugă `deleteRemindersByDocument` (cascade hard-delete la ștergere document)

**Files:**
- Modify: `services/reminders.ts`
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test**

```typescript
describe('deleteRemindersByDocument', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM medical_record');
  });

  it('deletes ALL reminders for a document (medical_ai + derived)', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    await reminders.createMedicalReminder({
      documentId: 'doc-1', personId: 'p-1', label: 'Control', reminderDate: '2026-07-01',
    });
    await reminders.syncDocumentExpiryReminder({
      id: 'doc-1', type: 'analize', expiry_date: '2026-09-10',
      person_id: 'p-1', created_at: '2026-01-01T00:00:00Z',
    } as any);

    await reminders.deleteRemindersByDocument('doc-1');

    const all = await db.getAllAsync<ReminderRow>(
      'SELECT * FROM reminders WHERE document_id = ?', ['doc-1']
    );
    expect(all).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "deleteRemindersByDocument"
```

Expected: FAIL.

- [ ] **Step 3: Adaugă funcția în `services/reminders.ts`**

```typescript
export async function deleteRemindersByDocument(documentId: string): Promise<void> {
  // Best-effort cleanup events calendar pentru reminderele cu calendar_event_id
  const withEvents = await db.getAllAsync<{ calendar_event_id: string }>(
    'SELECT calendar_event_id FROM reminders WHERE document_id = ? AND calendar_event_id IS NOT NULL',
    [documentId]
  );
  for (const r of withEvents) {
    await deleteCalendarEvent(r.calendar_event_id);
  }
  await db.runAsync('DELETE FROM reminders WHERE document_id = ?', [documentId]);
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "deleteRemindersByDocument"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add deleteRemindersByDocument cascade helper"
```

---

## Task 8: Adaugă `backfillDocumentExpiryReminders` și apelează din `initDb`

**Files:**
- Modify: `services/reminders.ts`
- Modify: `services/db.ts` (apel în `initDb()` la sfârșit)
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test**

```typescript
describe('backfillDocumentExpiryReminders', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM documents');
  });

  it('creates derived reminders for documents with expiry_date', async () => {
    await db.runAsync(
      `INSERT INTO documents (id, type, expiry_date, vehicle_id, created_at)
       VALUES ('d1', 'rca', '2026-09-10', 'v1', '2026-01-01T00:00:00Z'),
              ('d2', 'itp', '2026-11-15', 'v1', '2026-01-01T00:00:00Z'),
              ('d3', 'note', NULL, NULL, '2026-01-01T00:00:00Z')`
    );

    const count = await reminders.backfillDocumentExpiryReminders();
    expect(count).toBe(2);

    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE source_type = 'document_expiry' ORDER BY document_id`
    );
    expect(all).toHaveLength(2);
    expect(all.map(r => r.document_id).sort()).toEqual(['d1', 'd2']);
  });

  it('is idempotent (second run inserts 0 rows)', async () => {
    await db.runAsync(
      `INSERT INTO documents (id, type, expiry_date, created_at)
       VALUES ('d1', 'rca', '2026-09-10', '2026-01-01T00:00:00Z')`
    );
    await reminders.backfillDocumentExpiryReminders();
    const count = await reminders.backfillDocumentExpiryReminders();
    expect(count).toBe(0);

    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = 'd1'`
    );
    expect(all).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "backfillDocumentExpiryReminders"
```

Expected: FAIL.

- [ ] **Step 3: Adaugă funcția în `services/reminders.ts`**

```typescript
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
    const label = DOCUMENT_TYPE_LABELS[doc.type] ?? 'Document';
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
```

- [ ] **Step 4: Apelează din `initDb()` în `services/db.ts`**

Localizează funcția `initDb()` în `services/db.ts`. La sfârșit, după blocurile try/catch pentru ALTER TABLE, adaugă:

```typescript
// Backfill remindere derivate din documente existente (idempotent)
try {
  const { backfillDocumentExpiryReminders } = require('./reminders');
  await backfillDocumentExpiryReminders();
} catch (e) {
  // log dar nu blochează init
  console.warn('[initDb] backfillDocumentExpiryReminders failed:', e instanceof Error ? e.message : e);
}
```

Notă: `require` lazy pentru a evita ciclu de import (reminders.ts importă din db.ts).

- [ ] **Step 5: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "backfillDocumentExpiryReminders"
```

Expected: PASS.

- [ ] **Step 6: Rulează full characterization suite**

```bash
cd app && npm run test:characterization
```

Expected: toate testele pass.

- [ ] **Step 7: Commit**

```bash
git add services/reminders.ts services/db.ts __tests__/characterization/reminders.test.ts
git commit -m "reminders: add idempotent backfill + initDb integration"
```

---

## Task 9: Hook-uri în `services/documents.ts` pentru sync expiry → reminders

**Files:**
- Modify: `services/documents.ts`
- Test: `__tests__/characterization/reminders.test.ts`

- [ ] **Step 1: Adaugă test integrare**

```typescript
describe('documents.ts ↔ reminders sync', () => {
  let documents: typeof import('@/services/documents');

  beforeAll(() => {
    jest.isolateModules(() => {
      documents = require('@/services/documents');
    });
  });

  beforeEach(async () => {
    await db.runAsync('DELETE FROM reminders');
    await db.runAsync('DELETE FROM documents');
  });

  it('creates a derived reminder when a document with expiry_date is created', async () => {
    const doc = await documents.createDocument({
      type: 'rca' as any,
      expiry_date: '2026-09-10',
      vehicle_id: 'v-1',
    });
    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = ? AND source_type = 'document_expiry'`,
      [doc.id]
    );
    expect(all).toHaveLength(1);
    expect(all[0].reminder_date).toBe('2026-09-10');
  });

  it('does NOT create a derived reminder for a document without expiry_date', async () => {
    const doc = await documents.createDocument({
      type: 'note' as any,
      note: 'Nimic',
    });
    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = ?`, [doc.id]
    );
    expect(all).toHaveLength(0);
  });

  it('updates derived reminder when expiry_date changes', async () => {
    const doc = await documents.createDocument({
      type: 'rca' as any, expiry_date: '2026-09-10', vehicle_id: 'v-1',
    });
    await documents.updateDocument(doc.id, { expiry_date: '2026-12-31' });
    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = ?`, [doc.id]
    );
    expect(all).toHaveLength(1);
    expect(all[0].reminder_date).toBe('2026-12-31');
  });

  it('removes derived reminder when expiry_date is cleared', async () => {
    const doc = await documents.createDocument({
      type: 'rca' as any, expiry_date: '2026-09-10', vehicle_id: 'v-1',
    });
    await documents.updateDocument(doc.id, { expiry_date: null as any });
    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = ?`, [doc.id]
    );
    expect(all).toHaveLength(0);
  });

  it('cascades delete to all reminders when document is deleted', async () => {
    await db.runAsync(
      `INSERT INTO medical_record (id, person_id, created_at, updated_at)
       VALUES ('mr-1', 'p-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    const doc = await documents.createDocument({
      type: 'analize' as any, expiry_date: '2026-09-10', person_id: 'p-1',
    });
    await reminders.createMedicalReminder({
      documentId: doc.id, personId: 'p-1', label: 'Control', reminderDate: '2026-07-01',
    });
    await documents.deleteDocument(doc.id);
    const all = await db.getAllAsync<ReminderRow>(
      `SELECT * FROM reminders WHERE document_id = ?`, [doc.id]
    );
    expect(all).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să cadă (lipsesc sync calls)**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "documents.ts"
```

Expected: FAIL (rândurile nu apar în reminders după create/update/delete).

- [ ] **Step 3: Modifică `services/documents.ts`**

Adaugă imports la începutul fișierului:
```typescript
import {
  syncDocumentExpiryReminder,
  removeDocumentExpiryReminder,
  deleteRemindersByDocument,
} from './reminders';
```

În `createDocument()`, după INSERT și înainte de return, adaugă:
```typescript
if (doc.expiry_date) {
  await syncDocumentExpiryReminder(doc);
}
```

În `updateDocument()`, după UPDATE, înainte de return:
```typescript
const updated = await getDocumentById(id); // sau echivalent existent
if (updated) {
  if (updated.expiry_date) {
    await syncDocumentExpiryReminder(updated);
  } else {
    await removeDocumentExpiryReminder(id);
  }
}
```

Adaptează la API-ul actual de `updateDocument` — dacă fișierul deja face fetch după update, refolosește acel obiect.

În `deleteDocument()`, la început (înainte de DELETE FROM documents):
```typescript
await deleteRemindersByDocument(id);
```

Notă: dacă `ON DELETE CASCADE` funcționează (PRAGMA foreign_keys=ON), apelul explicit din `deleteDocument` e redundant pentru SQLite — dar îl păstrăm pentru a putea șterge și events calendar (best-effort, vezi Task 7) înainte de DELETE.

- [ ] **Step 4: Rulează testele — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/reminders.test.ts -t "documents.ts"
```

Expected: PASS (toate sub-testele).

- [ ] **Step 5: Verifică nu am stricat alte teste pe documents**

```bash
cd app && npm run test:characterization
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add services/documents.ts __tests__/characterization/reminders.test.ts
git commit -m "documents: sync expiry_date with reminders on create/update/delete"
```

---

## Task 10: Propagare `reminders` în `services/backup.ts`

**Files:**
- Modify: `services/backup.ts`
- Test: `__tests__/characterization/backup.test.ts` (extinde)

- [ ] **Step 1: Adaugă test roundtrip în `__tests__/characterization/backup.test.ts`**

Localizează grupa `describe('exportBackup + applyManifest roundtrip')` (sau echivalent). Adaugă test:

```typescript
it('preserves reminders rows in export/import roundtrip', async () => {
  await db.runAsync(
    `INSERT INTO reminders (id, source_type, document_id, person_id, label, reminder_date, calendar_event_id, origin, created_at)
     VALUES ('r-1', 'medical_ai', 'd-1', 'p-1', 'Control', '2026-07-01', 'cal-1', 'ai', '2026-01-01T00:00:00Z'),
            ('r-2', 'document_expiry', 'd-2', NULL, 'RCA', '2026-09-10', NULL, 'derived', '2026-01-01T00:00:00Z')`
  );

  const manifest = await backup.exportBackup({ inMemory: true });
  // sau echivalent — verifică pattern-ul existent din restul testelor

  await db.runAsync('DELETE FROM reminders');
  await backup.applyManifest(manifest);

  const restored = await db.getAllAsync<ReminderRow>(
    'SELECT * FROM reminders ORDER BY id'
  );
  expect(restored).toHaveLength(2);
  expect(restored[0].source_type).toBe('medical_ai');
  expect(restored[1].source_type).toBe('document_expiry');
});
```

Notă: pattern-ul exact pentru `exportBackup({ inMemory: true })` — verifică testele existente din `backup.test.ts` (vezi cum apelează azi). Adaptează semnătura conform.

- [ ] **Step 2: Rulează testul — trebuie să cadă (reminders nu sunt în payload)**

```bash
cd app && npx jest __tests__/characterization/backup.test.ts -t "reminders rows in export"
```

Expected: FAIL (`restored` are 0 rânduri).

- [ ] **Step 3: Modifică `services/backup.ts`**

Localizează `exportBackup()`. În `Promise.all` care colectează entitățile, adaugă:
```typescript
const reminders = await db.getAllAsync<Reminder>('SELECT * FROM reminders');
```

În obiectul `payload: BackupManifest`, adaugă câmpul:
```typescript
reminders,
```

Și incrementează `version` (ex: de la 8 la 9). Adaugă comentariu deasupra câmpului `version`:
```typescript
// v9: adăugat tabel reminders (medical_ai + document_expiry derivat)
```

Actualizează interfața `BackupManifest` (în același fișier sau în `types/`) ca să includă:
```typescript
reminders?: Reminder[]; // opțional pentru compatibilitate cu backup-uri vechi
```

În `applyManifest()`, localizează blocul care iterează entitățile la restore. Adaugă (după blocurile existente):
```typescript
if (Array.isArray(payload.reminders)) {
  for (const r of payload.reminders) {
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO reminders (
           id, source_type, document_id, person_id, vehicle_id, property_id, animal_id, card_id,
           label, reminder_date, calendar_event_id, origin, created_at, dismissed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id, r.source_type, r.document_id,
          r.person_id, r.vehicle_id, r.property_id, r.animal_id, r.card_id,
          r.label, r.reminder_date, r.calendar_event_id,
          r.origin, r.created_at, r.dismissed_at,
        ]
      );
    } catch (e) {
      console.warn('[applyManifest] reminder skip:', r.id, e);
    }
  }
}
```

În funcția de `wipe` (dacă există — verifică pattern-ul existent):
```typescript
await db.runAsync('DELETE FROM reminders');
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/backup.test.ts -t "reminders rows in export"
```

Expected: PASS.

- [ ] **Step 5: Rulează backup-audit ca să confirme că `reminders` e prezent în toate cele 3 locuri**

```bash
cd app && node scripts/backup-audit.js --strict
```

Expected: 0 violations (poate detecta că lipsește din cloudSync.ts → e Task 11).

Dacă raportează lipsă din cloudSync, e așteptat — continuă la Task 11. Pentru Task 10 e suficient ca în db.ts + backup.ts să fie prezent.

- [ ] **Step 6: Commit**

```bash
git add services/backup.ts __tests__/characterization/backup.test.ts
git commit -m "backup: include reminders in export and applyManifest (v9)"
```

---

## Task 11: Propagare `reminders` în `services/cloudSync.ts`

**Files:**
- Modify: `services/cloudSync.ts`
- Test: `__tests__/characterization/cloudSync.test.ts` (extinde dacă există roundtrip)

- [ ] **Step 1: Adaugă test similar cu Task 10 dacă există suite pentru cloudSync**

Verifică `__tests__/characterization/cloudSync.test.ts`. Dacă există pattern de roundtrip, adaugă test paralel pentru `reminders`:

```typescript
it('includes reminders in manifest payload', async () => {
  await db.runAsync(
    `INSERT INTO reminders (id, source_type, document_id, label, reminder_date, origin, created_at)
     VALUES ('r-1', 'medical_ai', 'd-1', 'Control', '2026-07-01', 'ai', '2026-01-01T00:00:00Z')`
  );
  const payload = await cloudSync.buildManifestPayload();
  expect(payload.reminders).toHaveLength(1);
  expect(payload.reminders[0].id).toBe('r-1');
});
```

Dacă suite-ul nu există sau e diferit, sari peste step 1 și 2 și treci direct la Step 3.

- [ ] **Step 2: Rulează testul (dacă scris) — trebuie să cadă**

```bash
cd app && npx jest __tests__/characterization/cloudSync.test.ts -t "reminders"
```

Expected: FAIL.

- [ ] **Step 3: Modifică `services/cloudSync.ts`**

Localizează `buildManifestPayload()`. În `Promise.all` adaugă:
```typescript
const reminders = await db.getAllAsync<Reminder>('SELECT * FROM reminders');
```

În obiectul `payload: ManifestPayload`, adaugă:
```typescript
reminders,
```

Adaugă în interface `ManifestPayload`:
```typescript
reminders: Reminder[];
```

Incrementează `MANIFEST_VERSION` (dacă există constanta) cu 1.

Pentru restore (dacă `cloudSync.ts` are funcție proprie de aplicare manifest, nu doar delegă la `backup.applyManifest`) — adaugă același bloc ca în Task 10.

- [ ] **Step 4: Rulează testul (dacă scris) — trebuie să treacă**

```bash
cd app && npx jest __tests__/characterization/cloudSync.test.ts -t "reminders"
```

Expected: PASS.

- [ ] **Step 5: Rulează backup-audit final — trebuie să fie verde**

```bash
cd app && node scripts/backup-audit.js --strict
```

Expected: 0 violations (reminders prezent în db.ts + backup.ts + cloudSync.ts).

- [ ] **Step 6: Commit**

```bash
git add services/cloudSync.ts __tests__/characterization/cloudSync.test.ts
git commit -m "cloudSync: include reminders in manifest payload"
```

---

## Task 12: Adaugă event emit la modificări de reminders

**Files:**
- Modify: `services/reminders.ts`

- [ ] **Step 1: Verifică pattern emit existent**

Citește `services/events.ts` ca să confirmi că `emit(eventType)` există. Verifică ce eventType folosesc alte servicii (ex: `documents:changed`).

- [ ] **Step 2: Adaugă import și emit în `services/reminders.ts`**

La sfârșitul fiecărei funcții care modifică DB-ul (`createMedicalReminder`, `dismissReminder`, `syncDocumentExpiryReminder`, `removeDocumentExpiryReminder`, `deleteRemindersByDocument`, `backfillDocumentExpiryReminders`), adaugă înainte de return:

```typescript
import { emit } from './events';
// ... în fiecare funcție:
emit('reminders:changed');
```

Pentru `backfillDocumentExpiryReminders` — emit doar dacă `inserted > 0`.

- [ ] **Step 3: Type-check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 4: Rulează full suite pentru a confirma că nu am stricat ceva**

```bash
cd app && npm run test:characterization
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add services/reminders.ts
git commit -m "reminders: emit reminders:changed event on every mutation"
```

---

## Task 13: Creează `hooks/useReminders.ts`

**Files:**
- Create: `hooks/useReminders.ts`

- [ ] **Step 1: Creează `hooks/useReminders.ts`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import * as remindersService from '@/services/reminders';
import { on } from '@/services/events';
import type { Reminder } from '@/types';

export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await remindersService.listActiveReminders();
      setReminders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcarea reminderelor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('reminders:changed', () => refresh());
    return () => off();
  }, [refresh]);

  // Refresh și la documents:changed (cazul syncDocumentExpiryReminder din documents.ts)
  useEffect(() => {
    const off = on('documents:changed', () => refresh());
    return () => off();
  }, [refresh]);

  return { reminders, loading, error, refresh };
}
```

- [ ] **Step 2: Verifică hook-contract-audit**

```bash
cd app && node scripts/hook-contract-audit.js
```

Expected: `useReminders` NU apare în lista de hooks care nu respectă contractul (returnează `{loading, error, refresh}`).

- [ ] **Step 3: Type-check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 4: Commit**

```bash
git add hooks/useReminders.ts
git commit -m "hooks: add useReminders with refresh on events:changed"
```

---

## Task 14: Creează `components/reminders/ReminderCard.tsx`

**Files:**
- Create: `components/reminders/ReminderCard.tsx`

- [ ] **Step 1: Citește renderCard actual din `app/(tabs)/expirari.tsx`**

Localizează funcția `renderCard` (sau echivalent) care construiește un item din lista actuală. Notează:
- Importurile pentru icon (`DOC_ICON`, `DOC_ICON_BG`, `DOC_ICON_COLOR`)
- Resolverul de entitate (`resolveDocumentEntityName` din `useEntities`)
- Logica de badge status (Expirat / X zile)
- Border-left logic

- [ ] **Step 2: Creează componentul**

```typescript
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';
import { DOC_ICON } from '@/theme/docTypeIcons';
import { DOC_ICON_BG, DOC_ICON_COLOR } from '@/theme/docTypeColors';
import { useEntities } from '@/hooks/useEntities';
import { useDocuments } from '@/hooks/useDocuments';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Reminder } from '@/types';

interface ReminderCardProps {
  reminder: Reminder;
  onPress?: (r: Reminder) => void;
}

function getDaysUntil(date: string): number {
  const target = new Date(date).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getStatusBadge(reminderDate: string): { label: string; color: string } {
  const days = getDaysUntil(reminderDate);
  if (days < 0) return { label: `Expirat acum ${-days} zile`, color: statusColors.critical };
  if (days === 0) return { label: 'Astăzi', color: statusColors.critical };
  if (days <= 7) return { label: `În ${days} zile`, color: statusColors.warning };
  if (days <= 30) return { label: `În ${days} zile`, color: statusColors.ok };
  return { label: new Date(reminderDate).toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }), color: statusColors.ok };
}

export function ReminderCard({ reminder, onPress }: ReminderCardProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { resolveEntityName, persons } = useEntities();
  const { documents } = useDocuments();

  const document = reminder.document_id
    ? documents.find(d => d.id === reminder.document_id)
    : null;

  const isMedical = reminder.source_type === 'medical_ai';

  // Icon + culoare
  let iconName: string;
  let iconBg: string;
  let iconColor: string;
  if (isMedical) {
    iconName = 'medkit';
    iconBg = primary + '20'; // tint cu alpha pe primary; ajustabil în iOS Simulator
    iconColor = primary;
  } else if (document) {
    iconName = DOC_ICON[document.type] ?? 'document';
    iconBg = DOC_ICON_BG[document.type] ?? palette.surface;
    iconColor = DOC_ICON_COLOR[document.type] ?? palette.text;
  } else {
    iconName = 'document';
    iconBg = palette.surface;
    iconColor = palette.text;
  }

  // Titlu + subtitlu
  let title: string;
  let subtitle: string;
  if (isMedical) {
    title = reminder.label;
    const personName = reminder.person_id
      ? persons.find(p => p.id === reminder.person_id)?.name ?? '—'
      : '—';
    subtitle = `Dosar medical — ${personName}`;
  } else if (document) {
    title = DOCUMENT_TYPE_LABELS[document.type] ?? 'Document';
    subtitle = resolveEntityName({ entityType: 'person', entityId: document.person_id ?? '' }) ?? '';
    // Resolverul exact depinde de API — adaptează la pattern-ul din expirari.tsx existent
  } else {
    title = reminder.label;
    subtitle = '';
  }

  const badge = getStatusBadge(reminder.reminder_date);

  return (
    <Pressable
      onPress={() => onPress?.(reminder)}
      style={[styles.card, { backgroundColor: palette.card, borderLeftColor: badge.color }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName as any} size={24} color={iconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={[styles.badge, { backgroundColor: badge.color + '20' }]}>
        <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 4,
    marginVertical: 4,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  content: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: '500' },
});
```

Notă: API-ul exact pentru `resolveDocumentEntityName` și formatul de status badge — adaptează după ce vezi codul actual din `expirari.tsx`. Această schiță e structura; numele exacte se ajustează la implementare cu primul test în iOS Simulator.

- [ ] **Step 3: Type-check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 4: Commit**

```bash
git add components/reminders/ReminderCard.tsx
git commit -m "components: add ReminderCard for unified rendering"
```

---

## Task 15: Refactor `app/(tabs)/expirari.tsx` să folosească `useReminders`

**Files:**
- Modify: `app/(tabs)/expirari.tsx`

- [ ] **Step 1: Citește fișierul actual și identifică secțiunile**

Notează:
- Cum se face fetch (`useDocuments()` + filtrare)
- Cum se calculează secțiunile EXPIRATE / VIITOARE / EXPIRATE DE MULT
- Cum funcționează collapsible-ul pentru expirate de mult
- Componentul Card actual

- [ ] **Step 2: Modifică sursa de date**

Înlocuiește:
```typescript
const { documents, loading, error } = useDocuments();
```

Cu:
```typescript
import { useReminders } from '@/hooks/useReminders';
import { ReminderCard } from '@/components/reminders/ReminderCard';
import { useRouter } from 'expo-router';

// ...
const { reminders, loading, error, refresh } = useReminders();
const router = useRouter();
```

Înlocuiește filtrarea pe documents cu filtrare pe reminders:
```typescript
const today = new Date(); today.setHours(0, 0, 0, 0);
const todayIso = today.toISOString().split('T')[0];
const thirtyDaysAgoIso = new Date(today.getTime() - 30 * 86400000).toISOString().split('T')[0];

const expirate = reminders.filter(r => r.reminder_date < todayIso && r.reminder_date >= thirtyDaysAgoIso);
const viitoare = reminders.filter(r => r.reminder_date >= todayIso);
const expirateDeMult = reminders.filter(r => r.reminder_date < thirtyDaysAgoIso);
```

Înlocuiește renderCard-ul intern cu:
```typescript
const handlePress = (r: Reminder) => {
  if (r.document_id) {
    router.push(`/documente/${r.document_id}`);
  }
};

// În JSX, pentru fiecare item:
<ReminderCard reminder={item} onPress={handlePress} />
```

- [ ] **Step 3: Actualizează mesajul empty-state**

Dacă era „Nu există documente care expiră în curând", schimbă în:
```typescript
"Nimic nu urmează"
```

- [ ] **Step 4: Type-check + lint**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori.

- [ ] **Step 5: Pornește simulatorul și verifică vizual**

```bash
cd app && npm run ios
```

În iOS Simulator:
- [ ] Deschide tab Expirări — listă afișată (cu toate documentele expirate ca azi).
- [ ] Verifică light + dark mode (Setări → Aspect).
- [ ] Tap pe un item → navighează la documentul sursă.
- [ ] Verifică empty-state (creează app curat sau șterge toate documentele) → afișează „Nimic nu urmează".

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/expirari.tsx
git commit -m "expirari: switch data source to useReminders + ReminderCard"
```

---

## Task 16: Modifică `components/medical/MedicalRemindersModal.tsx`

**Files:**
- Modify: `components/medical/MedicalRemindersModal.tsx`

- [ ] **Step 1: Localizează handler-ul de aprobare**

Citește componentul. Identifică handler-ul care apelează `addMedicalRecommendationCalendarEvent(...)`. De obicei o funcție `handleConfirm` sau `handleSave` care iterează reminderele bifate.

- [ ] **Step 2: Adaugă apel `createMedicalReminder`**

Adaugă import:
```typescript
import { createMedicalReminder } from '@/services/reminders';
```

În handler-ul după calendar event creation, pentru fiecare reminder bifat:
```typescript
const calendarEventId = await addMedicalRecommendationCalendarEvent({ /* ... existing ... */ });

await createMedicalReminder({
  documentId,        // disponibil din props
  personId,          // din document.person_id sau prop
  label: reminder.label,
  reminderDate: reminder.suggested_date_iso,
  calendarEventId: calendarEventId ?? undefined,
});
```

Notă: dacă `addMedicalRecommendationCalendarEvent` returnează `null` (calendar inaccessible), `createMedicalReminder` se apelează tot — reminderul există în app chiar dacă nu s-a creat event-ul. Userul îl vede în Expirări.

- [ ] **Step 3: Type-check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 4: Verifică în iOS Simulator**

- [ ] Deschide un document medical analizat de AI.
- [ ] Bifează un reminder, confirmă în modal.
- [ ] Mergi în Expirări → reminderul nou apare (cu icon medical + subtitlu „Dosar medical — {nume}").
- [ ] Verifică în iOS Calendar app că event-ul s-a creat (ca azi).

- [ ] **Step 5: Commit**

```bash
git add components/medical/MedicalRemindersModal.tsx
git commit -m "medical: persist approved reminders in reminders table"
```

---

## Task 17: Adaugă secțiune „Remindere active" în `app/(tabs)/documente/[id].tsx`

**Files:**
- Modify: `app/(tabs)/documente/[id].tsx`

- [ ] **Step 1: Citește fișierul, identifică unde se afișează secțiunea pentru documente medicale**

Localizează zona unde se randează detaliile medical (probabil un block condițional pe `isMedicalDocType(document.type)` sau similar).

- [ ] **Step 2: Adaugă state + fetch reminders**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { getRemindersForDocument, dismissReminder } from '@/services/reminders';
import { Alert, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Reminder } from '@/types';

// În component, după hooks existente:
const [docReminders, setDocReminders] = useState<Reminder[]>([]);

const refreshReminders = useCallback(async () => {
  if (!id) return;
  const list = await getRemindersForDocument(id as string);
  setDocReminders(list.filter(r => r.source_type === 'medical_ai' && !r.dismissed_at));
}, [id]);

useEffect(() => { refreshReminders(); }, [refreshReminders]);
```

- [ ] **Step 3: Adaugă render secțiunea**

În JSX, în zona detalii medical, după lista de observații (sau echivalent):

```typescript
{docReminders.length > 0 && (
  <View style={styles.section}>
    <Text style={[styles.sectionTitle, { color: palette.text }]}>Remindere active</Text>
    {docReminders.map(r => (
      <View key={r.id} style={[styles.reminderRow, { backgroundColor: palette.card }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: palette.text, fontWeight: '600' }}>{r.label}</Text>
          <Text style={{ color: palette.textSecondary, fontSize: 13, marginTop: 2 }}>
            {new Date(r.reminder_date).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Alert.alert(
              'Șterge reminder',
              'Sigur ștergi reminderul? Se va anula și evenimentul din calendar.',
              [
                { text: 'Anulează', style: 'cancel' },
                {
                  text: 'Șterge',
                  style: 'destructive',
                  onPress: async () => {
                    await dismissReminder(r.id);
                    await refreshReminders();
                  },
                },
              ]
            );
          }}
          hitSlop={10}
        >
          <Ionicons name="trash-outline" size={22} color={statusColors.critical} />
        </Pressable>
      </View>
    ))}
  </View>
)}
```

Adaugă stiluri:
```typescript
section: { marginTop: 16, marginHorizontal: 16 },
sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
reminderRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 6 },
```

- [ ] **Step 4: Type-check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 5: Verifică în iOS Simulator**

- [ ] Deschide un document medical care are remindere aprobate.
- [ ] Vezi secțiunea „Remindere active".
- [ ] Tap pe trash → confirm dialog → confirmă → reminderul dispare imediat din listă.
- [ ] Mergi în Expirări → reminderul nu mai apare.
- [ ] Deschide iOS Calendar app → event-ul a fost șters.

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/documente/[id].tsx
git commit -m "documente: add Remindere active section with delete button"
```

---

## Task 18: Actualizează `services/appKnowledge.ts` cu secțiunea „Remindere"

**Files:**
- Modify: `services/appKnowledge.ts`

- [ ] **Step 1: Citește fișierul și identifică unde sunt descrise funcțiile principale**

Caută o secțiune similară („Funcții principale", „Ce poate face aplicația"). Pattern-ul exact e setat în fișier — respectă tonul curent.

- [ ] **Step 2: Adaugă secțiune nouă**

```typescript
// În secțiunea de features sau funcții principale:
{
  title: 'Remindere',
  description: `Tabul Expirări afișează cronologic tot ce urmează: documente care expiră (RCA, ITP, vignete etc.) și remindere medicale aprobate.

Reminderele medicale apar doar dacă ai cel puțin un dosar medical activ. La fiecare document medical analizat de AI, sunt sugerate posibile remindere (ex: control cardiolog peste 6 luni); le aprobi din modalul de confirmare, iar apoi le vezi atât în Expirări cât și în calendarul iPhone-ului.

Tap pe orice reminder din Expirări te duce la documentul sursă. Pentru a anula un reminder medical, deschide documentul respectiv și folosește butonul „Șterge reminder" — se va șterge automat și din calendar.`,
}
```

(Adaptează la formatul exact din fișier — array de obiecte, JSDoc, string template etc.)

- [ ] **Step 3: Rulează knowledge-audit**

```bash
cd app && node scripts/knowledge-audit.js --strict
```

Va avertiza că `services/reminders.ts` nu e înregistrat → asta e rezolvat în Task 19. Dacă alte audituri trec, continuă.

- [ ] **Step 4: Commit**

```bash
git add services/appKnowledge.ts
git commit -m "appKnowledge: describe unified reminders feature for chatbot"
```

---

## Task 19: Înregistrează `services/reminders.ts` în `scripts/knowledge-audit.js`

**Files:**
- Modify: `scripts/knowledge-audit.js`

- [ ] **Step 1: Adaugă entry în `ENTRIES.services`**

Localizează `const ENTRIES = { services: { ... } }` și adaugă:
```javascript
reminders: { required: true, keywords: ['remindere', 'expirări', 'reminder', 'expirari'] },
```

- [ ] **Step 2: Rulează auditul**

```bash
cd app && node scripts/knowledge-audit.js --strict
```

Expected: 0 violations.

- [ ] **Step 3: Commit**

```bash
git add scripts/knowledge-audit.js
git commit -m "audit: register reminders service in knowledge-audit ENTRIES"
```

---

## Task 20: Creează `scripts/reminder-consistency-audit.js` (warning-only)

**Files:**
- Create: `scripts/reminder-consistency-audit.js`

- [ ] **Step 1: Creează scriptul**

```javascript
#!/usr/bin/env node

// reminder-consistency-audit.js
// Verifică că în services/documents.ts orice cale care setează/modifică expiry_date
// apelează și syncDocumentExpiryReminder sau removeDocumentExpiryReminder.
// Previne regresia „am uitat să sincronizez reminderele".

const fs = require('fs');
const path = require('path');

const DOC_FILE = path.join(__dirname, '..', 'services/documents.ts');

function audit() {
  if (!fs.existsSync(DOC_FILE)) return [];
  const source = fs.readFileSync(DOC_FILE, 'utf8');
  const violations = [];

  // Regex naiv: găsește funcții care fac UPDATE/INSERT pe documents și includ "expiry_date"
  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([\s\S]*?\)\s*[\s\S]*?\{([\s\S]*?)(?=\n(?:export\s+)?(?:async\s+)?function|\nexport\s|\Z)/g;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    const body = m[2];
    const touchesExpiry = /expiry_date/.test(body);
    const callsSync = /(syncDocumentExpiryReminder|removeDocumentExpiryReminder|deleteRemindersByDocument)\s*\(/.test(body);
    const isWrite = /(INSERT\s+INTO\s+documents|UPDATE\s+documents|DELETE\s+FROM\s+documents)/i.test(body);

    if (touchesExpiry && isWrite && !callsSync) {
      violations.push({ fn: name });
    }
  }
  return violations;
}

function format(v) {
  if (v.length === 0) return '✓ reminder-consistency: OK';
  let out = `⚠ reminder-consistency: ${v.length} funcții posibil ne-sincronizate:\n`;
  for (const x of v) out += `  - ${x.fn}\n`;
  return out;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit };
```

- [ ] **Step 2: Rulează scriptul**

```bash
cd app && node scripts/reminder-consistency-audit.js
```

Expected: `✓ reminder-consistency: OK` (assuming Task 9 a făcut corect sync-ul).

- [ ] **Step 3: Adaugă în pre-commit hook**

În `scripts/hooks/pre-commit`, adaugă o linie după celelalte audituri:
```bash
node scripts/reminder-consistency-audit.js || true  # warning-only la început
```

- [ ] **Step 4: Adaugă referință în CLAUDE.md (secțiunea „Audit scripts")**

În `.claude/CLAUDE.md`, în lista de audit scripts (sub „Contracte cod"), adaugă:
```markdown
- `node scripts/reminder-consistency-audit.js` — flag funcții din `services/documents.ts` care modifică `expiry_date` fără a apela `syncDocumentExpiryReminder` / `removeDocumentExpiryReminder`. Warning-only. Origine: feature reminders unificate 2026-05-31.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/reminder-consistency-audit.js scripts/hooks/pre-commit .claude/CLAUDE.md
git commit -m "audit: add reminder-consistency-audit (warning-only)"
```

---

## Task 21: Rulează `npm run audit` integral

**Files:** (none — verification step)

- [ ] **Step 1: Rulează audit-ul complet**

```bash
cd app && npm run audit
```

Expected: TOATE verzi (type-check + backup-audit + knowledge-audit + hook-contract + alter-table + db-destructive-init + expo-public-secrets + pin-secure-store + lint:ast + characterization tests).

Dacă vreun audit pică → fix înainte de a continua.

- [ ] **Step 2: Regenerează site-ul de prezentare**

```bash
cd app && node scripts/update-site.js
```

Expected: `docs/index.html` și `docs/support.html` actualizate (markeri rescriși din `types/` și `appKnowledge.ts`).

- [ ] **Step 3: Commit eventualele modificări de docs**

```bash
git add docs/ README.md
git commit -m "docs: regen site after reminders feature"
```

(Dacă nu s-a modificat nimic, skip.)

---

## Task 22: Verificare finală în iOS Simulator (Definition of Done)

**Files:** (none — verification step)

- [ ] **Step 1: Build curat**

```bash
cd app && npm run ios
```

- [ ] **Step 2: Test Expirări — 3 stări vizibile**

- [ ] **Stare 1 — gol:** Nu există documente cu expiry_date, nici remindere medicale. Tab Expirări afișează „Nimic nu urmează".
- [ ] **Stare 2 — doar documente:** Adaugă un document cu expiry_date (ex: RCA viitor). Tab Expirări afișează cardul cu icon document type. Niciun reminder medical.
- [ ] **Stare 3 — mixt:** Aprobi un reminder medical printr-un document. Tab Expirări afișează ambele tipuri, sortate cronologic, cu vizual distinct (medical → icon medkit + subtitlu „Dosar medical — {nume}"; document → icon tipic).

- [ ] **Step 3: Test flux ștergere reminder**

- [ ] Deschide documentul medical care a generat reminderul.
- [ ] Secțiunea „Remindere active" e vizibilă.
- [ ] Tap pe trash → confirm dialog cu textul exact din spec.
- [ ] Confirmă → reminderul dispare din listă.
- [ ] Mergi în Expirări → reminderul nu mai e acolo.
- [ ] Deschide iOS Calendar app → event-ul s-a șters.

- [ ] **Step 4: Test ștergere dosar medical (vizibilitate condiționată)**

- [ ] Cu cel puțin un reminder medical activ, mergi în Setări → șterge dosarul medical al persoanei respective.
- [ ] Tab Expirări → reminderul medical NU mai apare. Documentele cu expiry_date sunt încă acolo.
- [ ] Recreează dosarul medical → reminderul reapare în Expirări.

- [ ] **Step 5: Test backup roundtrip**

- [ ] Setări → Backup → exportă (iCloud sau local).
- [ ] Notează ce reminders sunt acum în app.
- [ ] Wipe app data (sau testează pe alt simulator).
- [ ] Restore din backup.
- [ ] Tab Expirări → toate reminderele sunt prezente.

- [ ] **Step 6: Test theme switch**

- [ ] Setări → Aspect → comută între Auto / Deschis / Întunecat.
- [ ] Tab Expirări — culorile cardurilor, icoanele și badge-urile se adaptează corect. Niciun hex hardcodat vizibil greșit pe dark.

- [ ] **Step 7: Mesaj de încheiere obligatoriu (în PR description)**

```
**Verificat colateral:**
- expirari.tsx gol / doar documente / mixt: click în iOS Simulator
- documente/[id].tsx ștergere reminder + verificare în iOS Calendar
- documente create/edit/delete cu expiry_date: SQLite inspect + Expirări refresh
- ștergere dosar medical → vizibilitate condiționată corectă
- backup export → restore roundtrip
- theme switch light/dark
- npm run audit: verde
- characterization tests: 100% pass
```

- [ ] **Step 8: Commit final + PR**

```bash
# Dacă există modificări tweak-uri minore (culori, label-uri) făcute în Simulator:
git add -p
git commit -m "ui: visual polish after Simulator testing"
```
