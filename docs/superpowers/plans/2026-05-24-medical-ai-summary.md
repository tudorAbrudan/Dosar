# Medical AI Summary + Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curăță Timeline-ul medical (doar analize), generează `ai_summary` AI per document medical, întreabă userul prin modal dacă vrea calendar reminders pentru recomandările cu termen.

**Architecture:** 3 coloane noi pe `documents`, JSON structured output din `medicalExtractor`, modal trigger pe useEffect la prima vizitare detaliu doc/dosar (D13), `services/calendar.ts` reutilizat cu wrapper nou.

**Tech Stack:** React Native + Expo, expo-sqlite, expo-calendar (deja instalat), expo-notifications nefolosit aici, AI provider existent (`sendAiRequest` din `services/aiProvider.ts`).

**Spec sursă:** `docs/superpowers/specs/2026-05-24-medical-ai-summary-design.md`

---

## File Structure

**Files to create:**
- `components/medical/MedicalRemindersModal.tsx` — UI modal cu listă bifabilă.
- `scripts/medical-ai-summary-isolation-audit.js` — verifică izolarea de FTS/chat.

**Files to modify:**
- `services/db.ts` — 3× ALTER TABLE.
- `types/index.ts` — 3 câmpuri noi pe `Document`.
- `services/documents.ts` — 4 helpers noi.
- `services/medicalRecord.ts` — `getDocumentsWithPendingReminders`.
- `services/medicalExtractor.ts` — pas nou generare summary + actionable_items.
- `services/medicalObservations.ts` — filtru `altele` în `groupByName`, `source_document_id` în `ObservationGroup`.
- `services/calendar.ts` — wrapper `addMedicalRecommendationCalendarEvent`.
- `services/backup.ts` — export + applyManifest cu 3 coloane noi.
- `services/cloudSync.ts` — `buildManifestPayload` cu 3 coloane noi.
- `app/(tabs)/entitati/medical/[id]/index.tsx` — useEffect detectare pending reminders.
- `app/(tabs)/documente/[id].tsx` — useEffect echivalent + secțiune Rezumat AI.
- `app/(tabs)/entitati/medical/_tabs/TimelineTab.tsx` — Pressable tap → sursă.
- `__tests__/characterization/db.test.ts` — coloane noi prezente.
- `__tests__/characterization/backup.test.ts` — roundtrip cele 3 coloane.
- `package.json` — `npm run audit` include scriptul nou.
- `scripts/hooks/pre-commit` — adaugă scriptul nou.

---

## Task 1: Schema — 3 coloane noi pe `documents`

**Files:**
- Modify: `services/db.ts` (după secțiunea existentă de ALTER TABLE pe `documents`, în jurul liniei 790)
- Modify: `types/index.ts` (interface `Document`)
- Test: `__tests__/characterization/db.test.ts`

- [ ] **Step 1: Adaugă cele 3 ALTER TABLE în `services/db.ts`**

Locație: după ultimul `ALTER TABLE documents ADD COLUMN ...` existent (caută `calendar_event_id` cu Grep).

```typescript
// Migrare: ai_summary (rezumat AI per document medical — spec 2026-05-24)
try {
  db.execSync('ALTER TABLE documents ADD COLUMN ai_summary TEXT');
} catch {
  // coloana există deja
}

// Migrare: medical_reminders_prompted_at (timestamp prima decizie reminder — spec 2026-05-24, D10)
try {
  db.execSync('ALTER TABLE documents ADD COLUMN medical_reminders_prompted_at TEXT');
} catch {
  // coloana există deja
}

// Migrare: pending_reminders_json (JSON actionable_items între extracție și prima vizitare — D13)
try {
  db.execSync('ALTER TABLE documents ADD COLUMN pending_reminders_json TEXT');
} catch {
  // coloana există deja
}
```

- [ ] **Step 2: Extinde `Document` interface în `types/index.ts`**

Locație: la finalul declarării `Document` (după `ocr_text?: string` și înainte de închiderea `}`).

```typescript
  /** Rezumat AI generat la extracția medicală. Markdown ușor. NU intră în FTS / chat (spec 2026-05-24 §8). */
  ai_summary?: string;
  /** Timestamp ISO la prima decizie a userului pe modalul de calendar reminders. Blochează re-prompt (D10). */
  medical_reminders_prompted_at?: string;
  /** JSON `[{label, suggested_date_iso}]` persistat tranzitoriu între extracție și prima vizitare a doc/dosar (D13). */
  pending_reminders_json?: string;
```

- [ ] **Step 3: Adaugă test characterization pentru cele 3 coloane**

În `__tests__/characterization/db.test.ts`, în describe-ul pentru `documents`:

```typescript
it('has ai_summary, medical_reminders_prompted_at, pending_reminders_json columns', () => {
  const cols = testDb
    .prepare("PRAGMA table_info('documents')")
    .all() as { name: string }[];
  const names = cols.map(c => c.name);
  expect(names).toContain('ai_summary');
  expect(names).toContain('medical_reminders_prompted_at');
  expect(names).toContain('pending_reminders_json');
});
```

- [ ] **Step 4: Rulează testul, confirmă PASS**

```bash
cd /Users/ax/work/documents/app
npm run test:characterization -- --testNamePattern "ai_summary, medical_reminders"
```

Expected: PASS (`applySchemaToTestDb` extrage schema din db.ts, deci ALTER-urile noi apar automat).

- [ ] **Step 5: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 6: Commit**

```bash
git add services/db.ts types/index.ts __tests__/characterization/db.test.ts
git commit -m "feat(medical): add ai_summary, medical_reminders_prompted_at, pending_reminders_json columns

Per spec 2026-05-24-medical-ai-summary-design.md §4."
```

---

## Task 2: Backup + cloudSync propagation

**Files:**
- Modify: `services/backup.ts`
- Modify: `services/cloudSync.ts`
- Test: `__tests__/characterization/backup.test.ts`

- [ ] **Step 1: Identifică zonele exacte de modificat**

Run:
```bash
cd /Users/ax/work/documents/app
grep -n "ocr_text" services/backup.ts | head -20
grep -n "ocr_text" services/cloudSync.ts | head -20
```

Notează numerele de linie unde apare `ocr_text` în `exportBackup`, `applyManifest`, și `buildManifestPayload`. Cele 3 coloane noi se adaugă în aceleași locuri (pattern identic).

- [ ] **Step 2: În `services/backup.ts` — `exportBackup()`**

În funcția `exportBackup`, la maparea documentului în obiect serializat, lângă `ocr_text: doc.ocr_text ?? null`, adaugă:

```typescript
  ai_summary: doc.ai_summary ?? null,
  medical_reminders_prompted_at: doc.medical_reminders_prompted_at ?? null,
  pending_reminders_json: doc.pending_reminders_json ?? null,
```

- [ ] **Step 3: În `services/backup.ts` — `applyManifest()`**

În funcția `applyManifest`, când se face INSERT/UPSERT pe `documents`, adaugă cele 3 coloane în lista SQL și în array-ul de parametri.

Exemplu (adaptează la pattern-ul exact din fișier):

```typescript
await db.runAsync(
  `INSERT OR REPLACE INTO documents (
    id, type, ..., ocr_text,
    ai_summary, medical_reminders_prompted_at, pending_reminders_json
  ) VALUES (?, ?, ..., ?, ?, ?, ?)`,
  [
    d.id, d.type, ..., d.ocr_text ?? null,
    d.ai_summary ?? null,
    d.medical_reminders_prompted_at ?? null,
    d.pending_reminders_json ?? null,
  ]
);
```

- [ ] **Step 4: În `services/cloudSync.ts` — `buildManifestPayload()`**

Similar Step 2: lângă `ocr_text`, adaugă cele 3 câmpuri în obiectul construit pentru cloud manifest.

- [ ] **Step 5: Rulează backup-audit script**

```bash
node scripts/backup-audit.js --strict
```

Expected: Zero discrepanțe. Dacă raportează `ai_summary` / `medical_reminders_prompted_at` / `pending_reminders_json` ca missing → mai e un loc neactualizat.

- [ ] **Step 6: Test characterization roundtrip**

În `__tests__/characterization/backup.test.ts`:

```typescript
it('exports and imports ai_summary, medical_reminders_prompted_at, pending_reminders_json', async () => {
  // Setup: insert document cu cele 3 câmpuri populate
  testDb.prepare(`
    INSERT INTO documents (id, type, created_at, ai_summary, medical_reminders_prompted_at, pending_reminders_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'doc-1', 'analize_medicale', '2026-05-24T00:00:00Z',
    '**Rezumat:** test', '2026-05-24T10:00:00Z',
    JSON.stringify([{ label: 'control', suggested_date_iso: '2026-08-24' }])
  );

  // Export → JSON
  const exported = await exportToObjectFromTestDb(testDb);
  expect(exported.documents[0].ai_summary).toBe('**Rezumat:** test');
  expect(exported.documents[0].medical_reminders_prompted_at).toBe('2026-05-24T10:00:00Z');
  expect(exported.documents[0].pending_reminders_json).toBeTruthy();

  // Import într-un DB nou
  const freshDb = new Database(':memory:');
  applySchemaToTestDb(freshDb);
  await applyManifestToTestDb(freshDb, exported);

  const row = freshDb.prepare('SELECT ai_summary, medical_reminders_prompted_at, pending_reminders_json FROM documents WHERE id = ?').get('doc-1') as Record<string, string | null>;
  expect(row.ai_summary).toBe('**Rezumat:** test');
  expect(row.medical_reminders_prompted_at).toBe('2026-05-24T10:00:00Z');
  expect(JSON.parse(row.pending_reminders_json as string)).toEqual([{ label: 'control', suggested_date_iso: '2026-08-24' }]);
});
```

- [ ] **Step 7: Run test**

```bash
npm run test:characterization -- --testNamePattern "exports and imports ai_summary"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/backup.ts services/cloudSync.ts __tests__/characterization/backup.test.ts
git commit -m "feat(medical): propagate 3 new columns through backup + cloudSync

backup-audit.js --strict passes."
```

---

## Task 3: Document service helpers

**Files:**
- Modify: `services/documents.ts`

- [ ] **Step 1: Adaugă cele 4 helpers la finalul `services/documents.ts`**

```typescript
/**
 * Setează `ai_summary` pe document. NU intră în FTS / chat (spec 2026-05-24 §8).
 * Apelat de `medicalExtractor` după generare AI; suprascris la re-extracție.
 */
export async function setDocumentAiSummary(
  documentId: string,
  summary: string | null
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET ai_summary = ? WHERE id = ?',
    [summary, documentId]
  );
  emit('entities:changed');
}

/**
 * Marchează că userul a primit modalul de calendar reminders pentru acest document
 * (indiferent dacă a adăugat sau a sărit). Blochează re-prompt (spec D10).
 */
export async function setMedicalRemindersPromptedAt(
  documentId: string,
  iso: string
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET medical_reminders_prompted_at = ? WHERE id = ?',
    [iso, documentId]
  );
  emit('entities:changed');
}

/**
 * Setează JSON-ul tranzitoriu cu `actionable_items` pentru modal (D13).
 * `null` la închiderea modalului.
 */
export async function setPendingReminders(
  documentId: string,
  json: string | null
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET pending_reminders_json = ? WHERE id = ?',
    [json, documentId]
  );
  emit('entities:changed');
}

export interface ActionableItem {
  label: string;
  suggested_date_iso: string | null;
}

/**
 * Citește și parsează `pending_reminders_json`. Returnează [] la null sau JSON invalid.
 */
export async function getPendingReminders(documentId: string): Promise<ActionableItem[]> {
  const row = await db.getFirstAsync<{ pending_reminders_json: string | null }>(
    'SELECT pending_reminders_json FROM documents WHERE id = ?',
    [documentId]
  );
  if (!row?.pending_reminders_json) return [];
  try {
    const parsed = JSON.parse(row.pending_reminders_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is ActionableItem =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as ActionableItem).label === 'string'
    );
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verifică că `emit` și `db` sunt deja importate**

Run:
```bash
grep -E "^import.*from.*['\"]\./(db|events)" services/documents.ts | head -5
```

Dacă lipsesc → adaugă import-urile la începutul fișierului.

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 4: Commit**

```bash
git add services/documents.ts
git commit -m "feat(medical): add document helpers for ai_summary + pending reminders

setDocumentAiSummary, setMedicalRemindersPromptedAt, setPendingReminders, getPendingReminders."
```

---

## Task 4: `getDocumentsWithPendingReminders` în `services/medicalRecord.ts`

**Files:**
- Modify: `services/medicalRecord.ts`

- [ ] **Step 1: Adaugă funcția**

La finalul `services/medicalRecord.ts`:

```typescript
import { getPendingReminders, type ActionableItem } from './documents';

export interface PendingReminderDoc {
  documentId: string;
  items: ActionableItem[];
}

/**
 * Returnează documentele legate de un dosar medical care au `pending_reminders_json`
 * populat ȘI `medical_reminders_prompted_at IS NULL` ȘI cel puțin un item cu
 * `suggested_date_iso >= today` (D14 — past dates filtrate complet).
 *
 * Folosit de UI-ul de dosar medical (`entitati/medical/[id]`) la mount pentru a
 * decide dacă deschide `MedicalRemindersModal`.
 */
export async function getDocumentsWithPendingReminders(
  recordId: string
): Promise<PendingReminderDoc[]> {
  const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const rows = await db.getAllAsync<{
    document_id: string;
    pending_reminders_json: string | null;
    medical_reminders_prompted_at: string | null;
  }>(
    `SELECT d.id AS document_id, d.pending_reminders_json, d.medical_reminders_prompted_at
     FROM documents d
     JOIN document_entities de ON de.document_id = d.id
     WHERE de.entity_type = 'medical_record'
       AND de.entity_id = ?
       AND d.pending_reminders_json IS NOT NULL
       AND d.medical_reminders_prompted_at IS NULL`,
    [recordId]
  );

  const result: PendingReminderDoc[] = [];
  for (const r of rows) {
    const items = await getPendingReminders(r.document_id);
    const future = items.filter(
      i => i.suggested_date_iso !== null && i.suggested_date_iso >= todayIso
    );
    if (future.length > 0) {
      result.push({ documentId: r.document_id, items: future });
    }
  }
  return result;
}
```

- [ ] **Step 2: Verifică că `db` și `getPendingReminders` sunt importate**

`db` ar trebui să fie deja importat. `getPendingReminders` se adaugă în import-ul din `./documents`.

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 4: Commit**

```bash
git add services/medicalRecord.ts
git commit -m "feat(medical): add getDocumentsWithPendingReminders

Filters by record + non-null pending_reminders_json + not-yet-prompted + future dates (D14)."
```

---

## Task 5: `medicalObservations` — filter `altele` + source_document_id

**Files:**
- Modify: `services/medicalObservations.ts`

- [ ] **Step 1: Extinde `ObservationGroup.values` cu `source_document_id`**

Locație: declarația interface `ObservationGroup` (în jurul liniei 252 din spec):

```typescript
export interface ObservationGroup {
  name: string;
  category: ObservationCategory;
  unit: string | null;
  values: {
    id: string;
    value: string | null;
    observed_at: string | null;
    needs_review: boolean;
    source_document_id: string | null;  // NOU
  }[];
  ref_min: string | null;
  ref_max: string | null;
  last_observed_at: string | null;
}
```

- [ ] **Step 2: Populează `source_document_id` în `groupByName`**

Locație: în loop-ul `for (const o of all)` din `groupByName`, schimbă push-ul în `g.values`:

```typescript
g.values.push({
  id: o.id,
  value: o.value,
  observed_at: o.observed_at,
  needs_review: o.needs_review,
  source_document_id: o.source_document_id,  // NOU
});
```

- [ ] **Step 3: Adaugă filter `category != 'altele'` cu opt-in**

Schimbă signature-ul:

```typescript
export async function groupByName(
  recordId: string,
  options?: { includeNarrative?: boolean }
): Promise<ObservationGroup[]> {
  const all = await listObservationsByRecord(recordId);
  const filtered = options?.includeNarrative
    ? all
    : all.filter(o => o.category !== 'altele');
  const map = new Map<string, ObservationGroup>();
  for (const o of filtered) {
    // ... restul logicii existente (unchanged)
  }
  // ...
}
```

- [ ] **Step 4: Verifică `useMedicalObservations` hook**

Run:
```bash
grep -n "groupByName" hooks/useMedicalObservations.ts
```

Dacă apelează `groupByName(recordId)` fără options → OK (narrative excluse default). Dacă apelează `groupByName(recordId, ...)` → lasă cum e, nu modifica.

- [ ] **Step 5: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 6: Commit**

```bash
git add services/medicalObservations.ts
git commit -m "feat(medical): filter narrative observations from Timeline + add source_document_id to groups

D1 (Timeline = doar analize) + D6 (tap → sursă needs source_document_id)."
```

---

## Task 6: Calendar event wrapper

**Files:**
- Modify: `services/calendar.ts`

- [ ] **Step 1: Adaugă wrapper-ul la finalul `services/calendar.ts`**

```typescript
export interface MedicalRecommendationEventOptions {
  /** Text complet recomandare. */
  label: string;
  /** Data la care se programează evenimentul (YYYY-MM-DD). */
  scheduledDate: string;
  /** Tip document (label uman, ex „Scrisoare medicală"). */
  sourceDocumentType: string;
  /** Data documentului sursă (YYYY-MM-DD). */
  sourceDocumentDate: string | null;
  /** Numele dosarului medical (ex „Dosar Tudor"). */
  recordName: string;
  /** ID document pentru referință în calendar (deep-linking fază 2). */
  documentId: string;
}

/**
 * Adaugă în calendar un eveniment pentru o recomandare medicală cu termen.
 * Format body conform spec 2026-05-24 §8.6 / D15.
 * Returnează ID-ul evenimentului sau null dacă calendar nu e disponibil
 * (permisiune refuzată / modul nelinkat).
 */
export async function addMedicalRecommendationCalendarEvent(
  opts: MedicalRecommendationEventOptions
): Promise<string | null> {
  if (!CalendarModule) return null;

  try {
    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    const labelTrunc = opts.label.length > 40 ? `${opts.label.slice(0, 40)}…` : opts.label;
    const title = `Recomandare medicală — ${labelTrunc}`;

    const sourceLine = opts.sourceDocumentDate
      ? `Sursă: ${opts.sourceDocumentType} din ${opts.sourceDocumentDate}`
      : `Sursă: ${opts.sourceDocumentType}`;

    const notes = [
      opts.label,
      '',
      sourceLine,
      `Dosar: ${opts.recordName}`,
      '',
      `Document ID: ${opts.documentId}`,
    ].join('\n');

    // Eveniment all-day la data scheduledDate.
    const eventDate = new Date(`${opts.scheduledDate}T09:00:00`);
    const eventEnd = new Date(eventDate);
    eventEnd.setHours(10, 0, 0, 0);

    const eventId = await CalendarModule.createEventAsync(calendarId, {
      title,
      startDate: eventDate,
      endDate: eventEnd,
      notes,
      alarms: [{ relativeOffset: -60 * 24 }], // notificare cu 1 zi înainte
    });

    return eventId ?? null;
  } catch (e) {
    console.warn('[calendar] addMedicalRecommendationCalendarEvent failed:', e);
    return null;
  }
}
```

- [ ] **Step 2: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 3: Commit**

```bash
git add services/calendar.ts
git commit -m "feat(medical): add addMedicalRecommendationCalendarEvent wrapper

Body format per spec D15."
```

---

## Task 7: `MedicalRemindersModal` component nou

**Files:**
- Create: `components/medical/MedicalRemindersModal.tsx`

- [ ] **Step 1: Verifică component-urile existente reutilizate**

Run:
```bash
ls components/ui/
```

Confirmă că există: `FormSheetModal.tsx`, `DatePickerField.tsx`.

- [ ] **Step 2: Creează fișierul**

```typescript
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { DatePickerField } from '@/components/ui/DatePickerField';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';
import { addMedicalRecommendationCalendarEvent } from '@/services/calendar';
import { getDocumentById } from '@/services/documents';
import { getMedicalRecord } from '@/services/medicalRecord';
import { getDocumentLabel } from '@/types';
import type { ActionableItem } from '@/services/documents';

interface Props {
  visible: boolean;
  items: ActionableItem[];
  documentId: string;
  recordId: string;
  onClose: (decision: 'added' | 'skipped') => void;
}

interface ItemState {
  label: string;
  date: string | null;
  selected: boolean;
}

export function MedicalRemindersModal({ visible, items, documentId, recordId, onClose }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [states, setStates] = useState<ItemState[]>(() =>
    items.map(i => ({
      label: i.label,
      date: i.suggested_date_iso,
      selected: true, // toate sunt future (filtrate înainte de a ajunge aici, D14)
    }))
  );
  const [saving, setSaving] = useState(false);

  const toggle = useCallback((idx: number) => {
    setStates(prev => prev.map((s, i) => (i === idx ? { ...s, selected: !s.selected } : s)));
  }, []);

  const setDate = useCallback((idx: number, date: string | null) => {
    setStates(prev => prev.map((s, i) => (i === idx ? { ...s, date } : s)));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const toAdd = states.filter(s => s.selected && s.date);
      if (toAdd.length === 0) {
        onClose('skipped');
        return;
      }

      const doc = await getDocumentById(documentId);
      const record = await getMedicalRecord(recordId);
      if (!doc || !record) {
        onClose('skipped');
        return;
      }

      let permissionDenied = false;
      for (const item of toAdd) {
        const eventId = await addMedicalRecommendationCalendarEvent({
          label: item.label,
          scheduledDate: item.date!,
          sourceDocumentType: getDocumentLabel(doc),
          sourceDocumentDate: doc.issue_date ?? null,
          recordName: record.name,
          documentId,
        });
        if (!eventId) {
          permissionDenied = true;
          break;
        }
      }

      if (permissionDenied) {
        Alert.alert(
          'Calendar indisponibil',
          'Activează permisiunile pentru Calendar în Setări iOS ca să adăugăm reminders.',
          [
            { text: 'Anulează', style: 'cancel', onPress: () => onClose('skipped') },
            { text: 'Deschide Setări', onPress: () => { Linking.openSettings(); onClose('skipped'); } },
          ]
        );
        return;
      }

      onClose('added');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-au putut adăuga reminders.');
      onClose('skipped');
    } finally {
      setSaving(false);
    }
  }, [states, documentId, recordId, onClose]);

  return (
    <FormSheetModal
      visible={visible}
      title="Reminders din document medical"
      onClose={() => onClose('skipped')}
      onSave={handleSave}
      saving={saving}
      saveLabel="Adaugă selectate"
      cancelLabel="Sari"
    >
      <Text style={[styles.intro, { color: palette.textSecondary }]}>
        AI a detectat {items.length} {items.length === 1 ? 'recomandare cu termen' : 'recomandări cu termen'}.
        Bifează ce vrei să apară în calendar.
      </Text>

      <ScrollView style={styles.list}>
        {states.map((s, idx) => (
          <View key={idx} style={[styles.row, { borderColor: palette.border }]}>
            <Pressable onPress={() => toggle(idx)} style={styles.checkbox} accessibilityRole="checkbox" accessibilityState={{ checked: s.selected }}>
              <Ionicons
                name={s.selected ? 'checkbox' : 'square-outline'}
                size={24}
                color={s.selected ? primary : palette.textSecondary}
              />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: palette.text }]} numberOfLines={3}>
                {s.label}
              </Text>
              <View style={{ marginTop: 8 }}>
                <DatePickerField
                  label="Data reminder"
                  value={s.date}
                  onChange={d => setDate(idx, d)}
                />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </FormSheetModal>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, marginBottom: 16, lineHeight: 18 },
  list: { maxHeight: 400 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  checkbox: { paddingTop: 2 },
  label: { fontSize: 14, lineHeight: 20 },
});
```

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: Zero erori. Posibile probleme:
- `FormSheetModal` props pentru `saveLabel` / `cancelLabel` — verifică interfața. Dacă nu acceptă override, adaugă props sau folosește default-urile.
- `getDocumentLabel(doc)` — verifică signature exact (poate cere și `customTypes`).

Dacă apar erori, ajustează apelurile la signature-urile reale (fără să schimbi semantica).

- [ ] **Step 4: Commit**

```bash
git add components/medical/MedicalRemindersModal.tsx
git commit -m "feat(medical): MedicalRemindersModal component

FormSheetModal + checkbox list + DatePickerField per item.
Handle calendar permission denied with Linking.openSettings deep-link (D12)."
```

---

## Task 8: AI prompt + extractor integration

**Files:**
- Modify: `services/medicalExtractor.ts`

- [ ] **Step 1: Adaugă constanta cu prompt-ul AI summary la începutul fișierului**

După SYSTEM_* existente (caută `SYSTEM_SCRISOARE` etc.):

```typescript
const SYSTEM_AI_SUMMARY = `Generator rezumat document medical pentru cititor non-medic +
extractor recomandări cu termen.

REGULI STRICTE:
- NU interpretezi clinic. NU spui „risc crescut", „grav", „atenție",
  „periculos", „normal e OK", etc.
- Folosește DOAR informație EXPLICITĂ din document.
- Pentru valori out-of-range: formulare neutră „peste limita superioară X"
  sau „sub limita inferioară X". NU explica de ce e relevant.
- Pentru recomandări: copiezi sau aproape-copiezi textul medicului.
  NU rezumi, NU prioritizezi.

Format OUTPUT — JSON strict, fără markdown wrapping, fără text înainte/după:

{
  "summary_md": "<markdown text, vezi formatul de mai jos>",
  "actionable_items": [
    { "label": "<text recomandare>", "suggested_date_iso": "YYYY-MM-DD" | null }
  ]
}

Format summary_md (markdown ușor, max 200 cuvinte):

**Rezumat:** 1-2 fraze descriere obiectivă a tipului documentului.

**Recomandări:** (doar dacă există în document)
- bullet 1 (text aproape verbatim)
- bullet 2

**Valori în afara intervalului:** (doar dacă există)
- LDL: 145 mg/dL — peste limita superioară 130
- TSH: 0.3 mU/L — sub limita inferioară 0.4

Dacă nu sunt recomandări sau valori out-of-range → omiți secțiunile.
Dacă documentul nu are niciun conținut relevant → "summary_md": "".

Reguli actionable_items:
- Include un item DOAR dacă recomandarea are termen explicit ÎN TEXT.
- suggested_date_iso = calculat relativ la observed_at al documentului.
- Fără termen → NU include (rămâne doar în summary_md).
- label = text aproape verbatim, max 80 caractere.
- actionable_items poate fi [].`;

const FORBIDDEN_WORDS = [
  'grav', 'urgent', 'periculos', 'risc', 'risc crescut',
  'normal e', 'e bun', 'e rău', 'recomandăm să', 'ar trebui',
];

function containsForbiddenWords(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.some(w => lower.includes(w));
}

function isValidIsoDate(s: string | null | undefined): boolean {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !isNaN(d.getTime());
}

interface AiSummaryResult {
  summary_md: string;
  actionable_items: { label: string; suggested_date_iso: string | null }[];
}

async function generateAiSummary(
  ocrText: string,
  documentDate: string | null
): Promise<AiSummaryResult> {
  try {
    const userMsg = [
      documentDate ? `Data documentului (observed_at): ${documentDate}` : '',
      '',
      'Conținut document (OCR):',
      ocrText.slice(0, 8000), // hard cap ca să evităm depășirea context-ului
    ].filter(Boolean).join('\n');

    const response = await sendAiRequest({
      system: SYSTEM_AI_SUMMARY,
      user: userMsg,
      jsonMode: true, // dacă providerul suportă; altfel parse manual
    });

    let parsed: AiSummaryResult;
    try {
      parsed = JSON.parse(response) as AiSummaryResult;
    } catch {
      return { summary_md: '', actionable_items: [] };
    }

    // Word guard pe summary_md.
    if (parsed.summary_md && containsForbiddenWords(parsed.summary_md)) {
      console.warn('[medicalExtractor] ai_summary contains forbidden clinical words, dropping');
      parsed.summary_md = '';
    }

    // Validare actionable_items.
    const items = Array.isArray(parsed.actionable_items) ? parsed.actionable_items : [];
    const cleanedItems = items
      .filter(i => typeof i?.label === 'string' && i.label.trim().length > 0)
      .map(i => ({
        label: i.label.trim().slice(0, 80),
        suggested_date_iso: isValidIsoDate(i.suggested_date_iso) ? i.suggested_date_iso : null,
      }));

    return {
      summary_md: typeof parsed.summary_md === 'string' ? parsed.summary_md : '',
      actionable_items: cleanedItems,
    };
  } catch (e) {
    console.warn('[medicalExtractor] generateAiSummary failed:', e);
    return { summary_md: '', actionable_items: [] };
  }
}
```

Verifică signature-ul `sendAiRequest` — dacă nu acceptă `jsonMode`, adaptează pentru parsare cu regex pe primul `{...}` din răspuns.

- [ ] **Step 2: Integrează în `extractFromDocument`**

Caută în `services/medicalExtractor.ts` finalul funcției `extractFromDocument` (sau echivalentul care face `deleteObservationsBySourceDocument` + insert). După loop-ul de inserare observații:

```typescript
// Generare AI summary + actionable_items (spec 2026-05-24).
// Eșecul NU blochează — log + continue.
try {
  const doc = await getDocumentById(documentId);
  if (doc) {
    const aiResult = await generateAiSummary(ocrTextUsed, doc.issue_date ?? null);
    await setDocumentAiSummary(documentId, aiResult.summary_md || null);

    // Pending reminders: doar dacă există items ȘI documentul nu a primit prompt-ul încă.
    if (aiResult.actionable_items.length > 0 && !doc.medical_reminders_prompted_at) {
      await setPendingReminders(documentId, JSON.stringify(aiResult.actionable_items));
    }
  }
} catch (e) {
  console.warn('[medicalExtractor] AI summary step failed (non-blocking):', e);
}
```

Notează variabila exactă pentru OCR text folosit în extracție (caută unde apare `ocrFromDocument` sau echivalent).

- [ ] **Step 3: Import-uri noi**

La începutul `services/medicalExtractor.ts`:

```typescript
import { getDocumentById, setDocumentAiSummary, setPendingReminders } from './documents';
```

Verifică să nu existe deja un import partial.

- [ ] **Step 4: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 5: Test manual rapid pe Simulator**

```bash
npm run ios
```

Pe Simulator, upload un document medical real (poză cu o scrisoare medicală). Așteaptă extracția (15-30s). Verifică în SQLite (sau în UI după Task 9) că `ai_summary` și `pending_reminders_json` sunt populate.

Dacă providerul AI nu returnează JSON valid (text înainte/după sau markdown wrapper), ajustează parsing-ul în Step 1.

- [ ] **Step 6: Commit**

```bash
git add services/medicalExtractor.ts
git commit -m "feat(medical): generate ai_summary + actionable_items at extraction time

JSON structured output from AI. Word guard rejects clinical interpretation.
Failure non-blocking — observations still inserted."
```

---

## Task 9: UI document detail — Rezumat AI + modal trigger

**Files:**
- Modify: `app/(tabs)/documente/[id].tsx`

- [ ] **Step 1: Identifică unde se randează `doc.note`**

Run:
```bash
grep -n "note\|ocr_text\|Notă\|Note" "app/(tabs)/documente/[id].tsx" | head -20
```

Notează linia unde se afișează nota/OCR ca să adaugi secțiunea „Rezumat AI" sub.

- [ ] **Step 2: Adaugă secțiunea „Rezumat AI" în JSX**

Sub blocul existent de Note/OCR:

```tsx
{doc.ai_summary ? (
  <View style={[styles.section, { borderColor: palette.border, backgroundColor: palette.card }]}>
    <View style={styles.sectionHeader}>
      <Ionicons name="sparkles-outline" size={16} color={primary} />
      <Text style={[styles.sectionTitle, { color: palette.text }]}>Rezumat AI</Text>
    </View>
    <Text style={[styles.summaryBody, { color: palette.text }]}>{doc.ai_summary}</Text>
    <Text style={[styles.summaryDisclaimer, { color: palette.textSecondary }]}>
      Generat automat, nu înlocuiește consultul medical.
    </Text>
  </View>
) : null}
```

Adaugă în `styles`:
```typescript
section: { marginVertical: 12, padding: 14, borderRadius: 10, borderWidth: 1 },
sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
sectionTitle: { fontSize: 14, fontWeight: '700' },
summaryBody: { fontSize: 14, lineHeight: 20 },
summaryDisclaimer: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
```

Rendering-ul e plain text (markdown se citește OK ca text). Pentru render markdown propriu-zis ar fi nevoie de o librărie suplimentară — out of scope MVP.

- [ ] **Step 3: Adaugă useEffect pentru pending reminders + modal**

La nivelul componentei (lângă alte hooks):

```typescript
import { MedicalRemindersModal } from '@/components/medical/MedicalRemindersModal';
import { setMedicalRemindersPromptedAt, setPendingReminders, getPendingReminders } from '@/services/documents';
import type { ActionableItem } from '@/services/documents';

// ... în componentă:

const [reminderModalProps, setReminderModalProps] = useState<{
  items: ActionableItem[];
  recordId: string;
} | null>(null);

useEffect(() => {
  if (!doc) return;
  if (doc.medical_reminders_prompted_at) return;

  (async () => {
    const items = await getPendingReminders(doc.id);
    const todayIso = new Date().toISOString().slice(0, 10);
    const future = items.filter(
      i => i.suggested_date_iso !== null && i.suggested_date_iso >= todayIso
    );
    if (future.length === 0) return;

    const medicalLink = doc.entity_links?.find(l => l.entity_type === 'medical_record');
    if (!medicalLink) return;

    setReminderModalProps({ items: future, recordId: medicalLink.entity_id });
  })();
}, [doc?.id, doc?.medical_reminders_prompted_at]);

const handleReminderClose = useCallback(
  async (decision: 'added' | 'skipped') => {
    if (!doc) return;
    await setMedicalRemindersPromptedAt(doc.id, new Date().toISOString());
    await setPendingReminders(doc.id, null);
    setReminderModalProps(null);
    // refresh document state ca să nu re-declanșeze useEffect
    await refresh(); // sau echivalentul existent
  },
  [doc]
);
```

În return-ul componentei, după restul UI:

```tsx
{reminderModalProps && doc ? (
  <MedicalRemindersModal
    visible={true}
    items={reminderModalProps.items}
    documentId={doc.id}
    recordId={reminderModalProps.recordId}
    onClose={handleReminderClose}
  />
) : null}
```

- [ ] **Step 4: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 5: Manual verify pe Simulator**

```bash
npm run ios
```

Deschide un document medical care a fost extras (ar trebui să aibă `ai_summary`). Verifică:
- Secțiunea „Rezumat AI" apare cu textul corect.
- Disclaimer-ul vizibil.
- Dacă `pending_reminders_json` are items future → modalul apare.

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/documente/[id].tsx"
git commit -m "feat(medical): document detail — Rezumat AI section + modal trigger

Display ai_summary with disclaimer. Detect pending reminders on mount and open modal."
```

---

## Task 10: UI medical record detail — modal trigger

**Files:**
- Modify: `app/(tabs)/entitati/medical/[id]/index.tsx`

- [ ] **Step 1: Adaugă useEffect pentru pending reminders**

În componentă, lângă alte hooks:

```typescript
import { MedicalRemindersModal } from '@/components/medical/MedicalRemindersModal';
import { setMedicalRemindersPromptedAt, setPendingReminders } from '@/services/documents';
import { getDocumentsWithPendingReminders, type PendingReminderDoc } from '@/services/medicalRecord';

// ... în componentă:

const [reminderModal, setReminderModal] = useState<PendingReminderDoc | null>(null);

useEffect(() => {
  if (!record) return;
  (async () => {
    const pending = await getDocumentsWithPendingReminders(record.id);
    if (pending.length === 0) return;
    setReminderModal(pending[0]);
  })();
}, [record?.id]);

const handleReminderClose = useCallback(
  async (_decision: 'added' | 'skipped') => {
    if (!reminderModal) return;
    await setMedicalRemindersPromptedAt(reminderModal.documentId, new Date().toISOString());
    await setPendingReminders(reminderModal.documentId, null);
    setReminderModal(null);
    await refresh();
  },
  [reminderModal, refresh]
);
```

În return-ul componentei, după restul UI:

```tsx
{reminderModal && record ? (
  <MedicalRemindersModal
    visible={true}
    items={reminderModal.items}
    documentId={reminderModal.documentId}
    recordId={record.id}
    onClose={handleReminderClose}
  />
) : null}
```

- [ ] **Step 2: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 3: Manual verify pe Simulator**

```bash
npm run ios
```

Test scenario:
1. Document medical recent upload-uit cu recomandare cu termen.
2. Deschide dosarul medical → modal apare.
3. Bifează + confirmă → verifică în iOS Calendar app că eventul apare cu format corect.
4. Re-deschide dosarul → modal NU mai apare.
5. Deschide documentul individual → modal NU mai apare (`prompted_at` deja setat).

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/entitati/medical/[id]/index.tsx"
git commit -m "feat(medical): medical record detail — pending reminders modal trigger

Open MedicalRemindersModal on mount if any linked document has future pending items."
```

---

## Task 11: TimelineTab — tap pe valoare → sursă

**Files:**
- Modify: `app/(tabs)/entitati/medical/_tabs/TimelineTab.tsx`

- [ ] **Step 1: Wrap cardul în Pressable**

În `renderItem`, în jurul `<View style={[styles.card, ...]}>` adaugă Pressable cu logica de navigare:

```tsx
const uniqueDocIds = useMemo(
  () => [...new Set(item.values.map(v => v.source_document_id).filter(Boolean))] as string[],
  [item.values]
);

const handleTap = useCallback(() => {
  if (uniqueDocIds.length === 0) return;
  if (uniqueDocIds.length === 1) {
    router.push(`/(tabs)/documente/${uniqueDocIds[0]}`);
    return;
  }
  // Multiple surse → Alert cu butoane (MVP).
  Alert.alert(
    'Surse multiple',
    'Această valoare apare în mai multe documente. Alege unul:',
    [
      ...uniqueDocIds.slice(0, 5).map((id, idx) => ({
        text: `Document ${idx + 1}`,
        onPress: () => router.push(`/(tabs)/documente/${id}`),
      })),
      { text: 'Anulează', style: 'cancel' as const },
    ]
  );
}, [uniqueDocIds, router]);

return (
  <Pressable onPress={handleTap} style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
    {/* ... conținut existent ... */}
  </Pressable>
);
```

Notă: `renderItem` în RN nu poate folosi hooks. Mută `useMemo`/`useCallback` într-un sub-component `<TimelineCard />` extras din `renderItem`, sau calculează inline (mai puțin performant dar mai simplu).

Variantă inline (fără sub-component):

```tsx
renderItem={({ item }) => {
  const uniqueDocIds = [...new Set(item.values.map(v => v.source_document_id).filter(Boolean))] as string[];
  const onTap = () => {
    if (uniqueDocIds.length === 0) return;
    if (uniqueDocIds.length === 1) {
      router.push(`/(tabs)/documente/${uniqueDocIds[0]}`);
      return;
    }
    Alert.alert(
      'Surse multiple',
      'Această valoare apare în mai multe documente.',
      [
        ...uniqueDocIds.slice(0, 5).map((id, idx) => ({
          text: `Document ${idx + 1}`,
          onPress: () => router.push(`/(tabs)/documente/${id}`),
        })),
        { text: 'Anulează', style: 'cancel' as const },
      ]
    );
  };

  return (
    <Pressable onPress={onTap} style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {/* ... conținut existent ... */}
    </Pressable>
  );
}}
```

- [ ] **Step 2: Import-uri necesare**

```typescript
import { Alert } from 'react-native';
// router e deja din useRouter()
```

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: Zero erori.

- [ ] **Step 4: Manual verify pe Simulator**

```bash
npm run ios
```

În Timeline, tap pe un card de analiză cu o singură sursă → navighează la document. Tap pe un card cu multiple surse → Alert cu lista.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/entitati/medical/_tabs/TimelineTab.tsx"
git commit -m "feat(medical): Timeline cards tap → source document

D6. Single source navigates directly; multiple sources show picker Alert."
```

---

## Task 12: Audit script izolare `ai_summary`

**Files:**
- Create: `scripts/medical-ai-summary-isolation-audit.js`
- Modify: `package.json` (script `audit`)
- Modify: `scripts/hooks/pre-commit`

- [ ] **Step 1: Creează scriptul**

```javascript
#!/usr/bin/env node
/**
 * Audit script — verifică că `ai_summary` și `pending_reminders_json` NU apar
 * în fișierele care construiesc context pentru chat-ul medical sau FTS.
 *
 * Spec 2026-05-24-medical-ai-summary-design.md §8.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const FORBIDDEN_IN = [
  'services/medicalFts.ts',
  'services/medicalChat.ts',
  'services/medicalQueryAnalysis.ts',
];

const FORBIDDEN_FIELDS = ['ai_summary', 'pending_reminders_json'];

let violations = 0;

for (const rel of FORBIDDEN_IN) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`[isolation-audit] skip missing file: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(abs, 'utf8');
  for (const field of FORBIDDEN_FIELDS) {
    const regex = new RegExp(`\\b${field}\\b`);
    if (regex.test(content)) {
      console.error(`❌ ${rel} contains '${field}' — must NOT leak into chat/FTS (spec §8)`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} violations found.`);
  process.exit(STRICT ? 1 : 0);
}

console.log('✓ medical-ai-summary isolation audit clean.');
process.exit(0);
```

- [ ] **Step 2: Fă scriptul executabil**

```bash
chmod +x scripts/medical-ai-summary-isolation-audit.js
```

- [ ] **Step 3: Rulează scriptul (după ce Task 1-11 sunt commited)**

```bash
node scripts/medical-ai-summary-isolation-audit.js --strict
```

Expected: Exit 0, mesaj „clean".

- [ ] **Step 4: Adaugă la `package.json` în `npm run audit`**

Caută în `package.json` script-ul `"audit"` și adaugă invocarea (fă-l ultimul pas):

```json
"audit": "npm run type-check && node scripts/backup-audit.js --strict && ... && node scripts/medical-ai-summary-isolation-audit.js --strict"
```

- [ ] **Step 5: Adaugă la pre-commit hook**

În `scripts/hooks/pre-commit`, după `pin-secure-store-audit.js`, înainte de `lint:ast`:

```bash
echo "Checking medical AI summary isolation..."
node scripts/medical-ai-summary-isolation-audit.js --strict || exit 1
```

- [ ] **Step 6: Test rulare bundle audit**

```bash
npm run audit
```

Expected: Toate auditele verzi.

- [ ] **Step 7: Commit**

```bash
git add scripts/medical-ai-summary-isolation-audit.js package.json scripts/hooks/pre-commit
git commit -m "chore(medical): add isolation audit for ai_summary + pending_reminders_json

Blocks accidental leak into FTS / chat context. Strict in npm run audit + pre-commit."
```

---

## Task 13: End-to-end Simulator test

**Files:** none (manual)

- [ ] **Step 1: Build pe device fizic sau Simulator iOS**

```bash
npm run ios
```

(Build nativ necesar — expo-calendar nu funcționează prin Expo Go.)

- [ ] **Step 2: Scenario de test**

1. **Upload document medical:** Acte → Adaugă → tip „Scrisoare medicală" → atașează poză cu text gen „Recomandare: control cardiologic peste 3 luni." → salvează. Așteaptă 15-30s pentru extracția AI.

2. **Verifică Timeline:** deschide dosarul medical (sau creează unul + asociază documentul). Tab Timeline → ar trebui să arate DOAR analize, NU recomandarea.

3. **Verifică modal:** la prima deschidere a dosarului SAU a documentului, modalul „Reminders din document medical" ar trebui să apară cu un item bifat și data sugerată (~ astăzi + 3 luni).

4. **Confirmă:** apasă „Adaugă selectate" → modalul dispare → în iOS Calendar app verifică:
   - Eveniment cu titlu „Recomandare medicală — Recomandare: control cardiologic…"
   - Body conține text complet, sursă, nume dosar, Document ID.
   - Alarmă cu 1 zi înainte.

5. **Verifică non-re-prompt:** re-deschide dosarul → modal NU mai apare. Re-deschide documentul → modal NU mai apare.

6. **Verifică Rezumat AI:** detaliu document → secțiunea „Rezumat AI" cu textul markdown vizibil + disclaimer „Generat automat...".

7. **Verifică tap → sursă:** Timeline → tap pe un card de analiză → navighează la documentul corespunzător.

8. **Permisiune calendar refuzată:** dezactivează permisiunea Calendar pentru app din Setări iOS. Upload alt document. Deschide modal → bifează → confirmă → Alert „Calendar indisponibil" cu buton „Deschide Setări".

- [ ] **Step 3: Raport rezultate**

Bifează în spec §10 fiecare item testat. Dacă găsești bug-uri, creează commit-uri de fix separate.

- [ ] **Step 4: Final commit (dacă au fost fix-uri)**

```bash
git add -A
git commit -m "fix(medical): post-E2E adjustments"
```

---

## Final verification

- [ ] **Run full audit bundle:**

```bash
npm run audit
```

Expected: type-check ✓ + toate audit-urile verzi + testele characterization PASS.

- [ ] **Verifică sincronizare cunoștințe:** actualizează `services/appKnowledge.ts` dacă feature-ul merită menționat la „Funcții principale" (rezumat AI per document medical + reminders în calendar).

- [ ] **Verifică `CHANGELOG.md`:** adaugă entry pentru release-ul curent.

- [ ] **Final commit dacă au fost actualizări cosmetice:**

```bash
git add services/appKnowledge.ts CHANGELOG.md
git commit -m "docs(medical): update appKnowledge + changelog for AI summary feature"
```

---

## Spec coverage check (self-review)

| Spec section | Task |
|---|---|
| D1 Timeline filter | Task 5 |
| D2 câmp nou ai_summary | Task 1 |
| D3 nu intră FTS | Task 12 (audit enforce) |
| D4 plaintext | Task 1 (TEXT column) |
| D5 conținut 3 secțiuni | Task 8 (prompt) |
| D6 tap → sursă | Task 11 |
| D7 NU-uri | (none — exclus prin omisiune) |
| D8 re-extracție suprascrie | Task 8 (setDocumentAiSummary apel) |
| D9 modal pop-up | Task 7 + Task 9 + Task 10 |
| D10 re-prompt blocked | Task 9 + Task 10 (set medical_reminders_prompted_at) |
| D11 no event ID tracking | (none — exclus prin omisiune) |
| D12 calendar denied | Task 7 (Alert + Linking.openSettings) |
| D13 modal nu pop-up imediat | Task 8 (set pending_reminders_json) + Task 9/10 trigger |
| D14 past dates filtered | Task 4 (getDocumentsWithPendingReminders) + Task 9 |
| D15 event body format | Task 6 (addMedicalRecommendationCalendarEvent) |
| Schema în 3 locuri | Task 1 + Task 2 |
| Audit izolare | Task 12 |
| Characterization tests | Task 1 + Task 2 |
| E2E Simulator | Task 13 |

Toate 15 decizii din spec sunt acoperite de task-uri concrete. ✓

---

## Note de execuție

1. Sub-task-urile cu „verify on Simulator" cer build nativ (`npm run ios` cu prebuild dacă e necesar). Asigură-te că Simulator e pornit înainte.
2. Dacă tipuri TS lipsesc la apelarea `FormSheetModal` cu props necunoscute → consultă fișierul `components/ui/FormSheetModal.tsx` și ajustează API-ul (poate fi nevoie să adaugi `saveLabel?` și `cancelLabel?` la interfața component-ului existent — Task 7 Step 3).
3. `getDocumentLabel(doc)` — verifică signature reală în `types/index.ts`. Dacă cere și `customTypes`, încarcă cu `useCustomTypes()` în component.
4. La rulare `npm run audit`, dacă `lint:ast` raportează probleme pe codul nou, fix-uiește înainte de commit final.
