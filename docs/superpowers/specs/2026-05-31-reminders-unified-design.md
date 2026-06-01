# Remindere unificate în tab-ul Expirări — design

**Data:** 2026-05-31
**Status:** Aprobat în brainstorming, pregătit pentru implementation plan
**Autor:** Tudor (product) + Claude (design)

## Context și motivație

Azi AI-ul medical analizează documente medicale și propune remindere prin `MedicalRemindersModal`. Userul aprobă selectiv, iar reminderele aprobate ajung doar în calendarul iOS (`expo-calendar`) — nu sunt vizibile centralizat în aplicație. Userul a cerut o vizualizare consolidată „ce urmează" în tab-ul Expirări existent, care azi listează doar documente cu `expiry_date`.

Mai mult: reminderele medicale și expirările de documente trebuie să folosească aceleași clase, tabele și abordări — fără ramuri paralele de cod. Un model unic, extensibil pentru tipuri viitoare (remindere manuale, recurente, alte categorii).

**Obiectiv:** un singur tabel SQLite + un singur component de UI care reprezintă tot „ce urmează", cu sursa de adevăr hibridă pentru a evita disrupția codului existent.

## Decizii produs (din brainstorming)

1. **Vizibilitate condiționată:** reminderele medicale apar în Expirări doar dacă există cel puțin un rând în `medical_record` (orice persoană). Dacă userul șterge ultimul dosar, dispar din vizualizare (date rămân în SQLite, reapar la recreare).
2. **Interacțiune tap:** tap pe orice item din Expirări (medical sau document) → navighează la ecranul documentului sursă (`documente/[id]`).
3. **Ciclul de viață:** reminderele după data lor rămân vizibile, ca documentele expirate (secțiuni EXPIRATE / VIITOARE / EXPIRATE DE MULT >30zile).
4. **Sincronizare calendar iOS:** „fire and forget" — aplicația e source-of-truth pentru Expirări. Dacă userul șterge eventul direct din aplicația Calendar a iOS, reminderul rămâne în Expirări cu data originală. Anularea curată se face din ecranul documentului medical.
5. **Diferențiere vizuală:** reminderele medicale au icon medical distinct + culoare accent + subtitlu „Dosar medical — {personName}". Expirările documentelor păstrează aspectul curent.
6. **Buton „Șterge reminder"** în ecranul documentului medical: șterge atât rândul din SQLite (soft-delete) cât și eventul din calendarul iOS.

## Arhitectură date

### Tabel nou `reminders` (single source pentru tab-ul Expirări)

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- 'document_expiry' | 'medical_ai'
  document_id TEXT,                  -- FK către documents (azi ambele tipuri sunt legate de un document)
  person_id TEXT,                    -- FK către persons (medical_ai → required; document_expiry → opțional)
  vehicle_id TEXT,
  property_id TEXT,
  animal_id TEXT,
  card_id TEXT,
  label TEXT NOT NULL,
  reminder_date TEXT NOT NULL,       -- YYYY-MM-DD
  calendar_event_id TEXT,            -- nullable; setat doar dacă user a aprobat sync calendar
  origin TEXT NOT NULL,              -- 'ai' | 'derived' | 'manual' (viitor)
  created_at TEXT NOT NULL,
  dismissed_at TEXT                  -- soft-delete; NULL = activ
);
CREATE INDEX IF NOT EXISTS idx_reminders_date ON reminders(reminder_date);
CREATE INDEX IF NOT EXISTS idx_reminders_source ON reminders(source_type);
CREATE INDEX IF NOT EXISTS idx_reminders_document ON reminders(document_id);
```

### Strategie source-of-truth (hibridă)

- **`source_type='medical_ai'`:** rândul din `reminders` ESTE sursa de adevăr. Scris direct la aprobare în `MedicalRemindersModal`. `documents.pending_reminders_json` rămâne ca tracking al ce a propus AI-ul (nu echivalent cu ce a aprobat userul). `calendar_event_id` se populează cu ID-ul eventului iOS Calendar creat.
- **`source_type='document_expiry'`:** `documents.expiry_date` rămâne sursa de adevăr (folosit în UI-uri existente: chip-uri pe carduri, ecran detalii). Rândul din `reminders` e **derivat** (`origin='derived'`) și sincronizat tranzacțional din `services/documents.ts`. `calendar_event_id` rămâne NULL — comportament neschimbat: documentele expirante azi nu creează automat event-uri în calendar, doar sunt listate în Expirări.

### Sincronizare `documents.ts` ↔ `reminders`

În fiecare cale de write a documentelor:
- `createDocument()`: după INSERT, dacă `expiry_date != null` → `syncDocumentExpiryReminder(doc)` (UPSERT cu `INSERT OR REPLACE` sau echivalent).
- `updateDocument()`:
  - Dacă `expiry_date` non-null după update → `syncDocumentExpiryReminder(doc)`.
  - Dacă `expiry_date` era setat și acum e null → `removeDocumentExpiryReminder(documentId)`.
- `deleteDocument()`: înainte de DELETE document → `deleteRemindersByDocument(documentId)` (CASCADE manual, șterge atât `derived` cât și `medical_ai`).

Toate operațiile în aceeași tranzacție SQLite cu modificarea documentului — risk de divergență minimal.

### Migrare/backfill la prima rulare

`initDb()` apelează `backfillDocumentExpiryReminders()`:
- Idempotent: `INSERT OR IGNORE` pentru fiecare document cu `expiry_date` care nu are deja un rând `reminders` cu `source_type='document_expiry'` și `document_id=…`.
- Gardat de o coloană `app_meta.reminders_backfilled_at` ca să nu ruleze inutil la fiecare init.

### Modul nou `services/reminders.ts` — API

```typescript
export interface Reminder {
  id: string;
  source_type: 'document_expiry' | 'medical_ai';
  document_id: string | null;
  person_id: string | null;
  vehicle_id: string | null;
  property_id: string | null;
  animal_id: string | null;
  card_id: string | null;
  label: string;
  reminder_date: string;          // YYYY-MM-DD
  calendar_event_id: string | null;
  origin: 'ai' | 'derived' | 'manual';
  created_at: string;
  dismissed_at: string | null;
}

export type ReminderSourceType = Reminder['source_type'];
export type ReminderOrigin = Reminder['origin'];

export function listActiveReminders(opts?: {
  fromDate?: string;
  sourceType?: ReminderSourceType;
}): Reminder[];

export function getRemindersForDocument(documentId: string): Reminder[];

export function createMedicalReminder(input: {
  documentId: string;
  personId: string;
  label: string;
  reminderDate: string;
  calendarEventId?: string;
}): Reminder;

export function dismissReminder(id: string): Promise<void>;
// SOFT-DELETE: user explicit anulează un reminder pe care îl menținem în istoric.
// 1. citește rândul; 2. dacă calendar_event_id != null → Calendar.deleteEventAsync (ignoră NotFound);
// 3. UPDATE dismissed_at = now()

export function deleteRemindersByDocument(documentId: string): Promise<void>;
// HARD-DELETE: documentul părinte e șters, n-are sens să rămână rânduri orfane.
// 1. listează remindere active cu calendar_event_id; 2. șterge events din calendar (best-effort);
// 3. DELETE FROM reminders WHERE document_id = ?

export function syncDocumentExpiryReminder(doc: Document): void;
// UPSERT: insert nou sau update label/data dacă deja există

export function removeDocumentExpiryReminder(documentId: string): void;
// DELETE FROM reminders WHERE document_id = ? AND source_type = 'document_expiry'

export function backfillDocumentExpiryReminders(): Promise<number>;
// returnează nr. rânduri create
```

### Query unificat pentru Expirări

```sql
SELECT * FROM reminders
WHERE dismissed_at IS NULL
  AND (
    source_type != 'medical_ai'
    OR EXISTS (SELECT 1 FROM medical_record LIMIT 1)
  )
ORDER BY reminder_date ASC;
```

## Arhitectură UI

### Hook nou `hooks/useReminders.ts`

```typescript
export function useReminders(): {
  reminders: Reminder[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

Re-fetch automat la:
- Mount.
- Focus pe tab-ul Expirări (via `useFocusEffect`).
- App revine din background (via `AppState`).
- Eveniment intern „reminders changed" (event bus / context) emis la `createMedicalReminder`, `dismissReminder`, `syncDocumentExpiryReminder`, `removeDocumentExpiryReminder`, `deleteRemindersByDocument`.

### Refactor `app/(tabs)/expirari.tsx`

- Înlocuiește `useDocuments()` + filtrare `expiry_date` cu `useReminders()`.
- Păstrează exact secțiunile actuale (EXPIRATE / VIITOARE / EXPIRATE DE MULT >30zile + collapsible).
- Sortare prin `reminder.reminder_date` ascendent.
- Render: înlocuiește renderCard intern cu `<ReminderCard reminder={r} />`.
- State gol (zero remindere): mesaj actualizat („Nimic nu urmează") — păstrează pattern-ul empty-state existent.

### Component nou `components/reminders/ReminderCard.tsx`

Props: `{ reminder: Reminder, onPress?: (r: Reminder) => void }`.

Comportament:
- **`source_type='document_expiry'`:** render identic cu cardul actual din `expirari.tsx`:
  - Icon din `DOC_ICON[document.type]`, background `DOC_ICON_BG[…]`, culoare `DOC_ICON_COLOR[…]`.
  - Titlu: `getDocumentLabel(document, customTypes)`.
  - Subtitlu: `resolveDocumentEntityName(document)`.
  - Badge status expirare (Expirat / X zile / lună scadență).
  - Border-left culoare după urgență.
- **`source_type='medical_ai'`:**
  - Icon medical distinct din Ionicons (ex: `medkit` / `heart` / `pulse` — alegere finală în implementare, validată în iOS Simulator).
  - Culoare accent medical din paletă (token existent dacă disponibil în `theme/colors.ts`; altfel adăugat ca extensie a paletei, NU hex hardcodat — vezi regula din `design.md`). Aplicată pe icon background și border-left.
  - Titlu: `reminder.label`.
  - Subtitlu: „Dosar medical — {personName}" (rezolvat din `person_id`).
  - Badge status la fel ca documentele (Expirat / X zile / etc.) — coerent.
  - Border-left coerent cu codul de urgență, dar cu nuanță medical-accent.
- **Tap:** dacă `document_id != null` → navigare la `documente/{document_id}`. Dacă nu (caz rar — manual viitor) → no-op pentru acum.

### Modificare ecran document medical `app/(tabs)/documente/[id].tsx`

Secțiune nouă „Remindere active" (vizibilă doar pentru documente cu `source_type='medical_ai'` legat — adică care au cel puțin un rând în `reminders` cu acel `document_id`):
- Listă din `getRemindersForDocument(id).filter(r => r.source_type === 'medical_ai' && !r.dismissed_at)`.
- Per rând: label, `reminder_date` formatat, buton `IconButton` „🗑 Șterge reminder".
- Tap pe șterge → `Alert.confirm("Sigur ștergi reminderul? Se va anula și evenimentul din calendar.")` → `dismissReminder(id)` → refresh local + emit event pentru `useReminders`.

### Modificare `components/medical/MedicalRemindersModal.tsx`

În handler-ul existent de aprobare:
1. Pentru fiecare reminder bifat: apelează `addMedicalRecommendationCalendarEvent(...)` (cum face azi) → primește `calendar_event_id`.
2. Apelează **în plus** `createMedicalReminder({ documentId, personId, label, reminderDate, calendarEventId })`.
3. Emit event „reminders changed" ca `useReminders` să se refacă la următorul focus.

Reminderele nebifate (respinse): niciun rând în `reminders` — comportament identic cu azi.

## Impact pe codul existent (Blast Radius)

### Fișiere atinse

| Fișier | Tip modificare |
|---|---|
| `services/db.ts` | `CREATE TABLE reminders` + indexuri |
| `services/reminders.ts` | NOU |
| `services/documents.ts` | Hooks în create/update/delete pentru sync expiry → reminder |
| `services/backup.ts` | Export + applyManifest pentru `reminders` |
| `services/cloudSync.ts` | `buildManifestPayload` pentru `reminders` |
| `services/appKnowledge.ts` | Secțiune „Remindere / Expirări" în descrierea chatbot |
| `types/index.ts` | Interface `Reminder` + types `ReminderSourceType`, `ReminderOrigin` |
| `hooks/useReminders.ts` | NOU |
| `app/(tabs)/expirari.tsx` | Refactor sursa de date |
| `components/reminders/ReminderCard.tsx` | NOU |
| `app/(tabs)/documente/[id].tsx` | Secțiune „Remindere active" + buton șterge |
| `components/medical/MedicalRemindersModal.tsx` | Apel suplimentar `createMedicalReminder` |
| `scripts/knowledge-audit.js` | Adaugă `services/reminders.ts` în `ENTRIES` |
| `docs/` (HTML) | Regenerat automat de `scripts/update-site.js` |

### Audit scripts impactate

**Existente — vor verifica automat:**
- `backup-audit.js --strict` — verifică `reminders` prezent în `db.ts` + `backup.ts` + `cloudSync.ts`.
- `knowledge-audit.js --strict` — verifică `services/reminders.ts` în manifest.
- `hook-contract-audit.js` — verifică `useReminders` returnează `{loading, error, refresh}`.
- `alter-table-trycatch-audit.js --strict` — orice `ALTER TABLE reminders` viitor trebuie în try/catch.
- `db-destructive-init-audit.js --strict` — `reminders` nu va fi DROP la init.

**Nou (recomandat, warning-only la început):**
- `scripts/reminder-consistency-audit.js` — verifică în `services/documents.ts` că orice assignment la `expiry_date` într-o funcție care face write SQL este urmat de apel `syncDocumentExpiryReminder` sau `removeDocumentExpiryReminder` în aceeași funcție. Previne regresia „am uitat să sincronizez".

### Characterization tests

Adăugare în `__tests__/characterization/`:
- `reminders.test.ts` — NOU:
  - Schema `reminders` (coloane, NOT NULL, indexuri).
  - `syncDocumentExpiryReminder` idempotent (a doua chemare nu duplică).
  - `dismissReminder` setează `dismissed_at` (nu DELETE).
  - `deleteRemindersByDocument` șterge toate rândurile asociate (atât derived cât și medical_ai).
  - `listActiveReminders` filtrează `dismissed_at IS NOT NULL`.
  - Vizibilitate condiționată: rândurile `medical_ai` nu apar dacă `medical_record` e gol.
  - Backfill idempotent: a doua rulare = 0 inserții noi.
- Extindere `backup.test.ts` — roundtrip export/import include `reminders`.
- Extindere `db.test.ts` — verifică `app_meta.reminders_backfilled_at` se setează după backfill.

## Definition of Done

### Verificare colaterală obligatorie

1. **Expirări tab** afișează atât documente expirante cât și remindere medicale aprobate. Testate cu/fără dosar medical existent.
2. **Document medical** → aprobat reminder via modal → apare în Expirări imediat (refresh la focus tab).
3. **Document medical** → șters reminder din ecranul documentului → dispare din Expirări + dispare din calendarul iOS (verificat în iOS Calendar app).
4. **Document oarecare** → setezi `expiry_date` nou → apare în Expirări fără pași extra (sync automat).
5. **Document oarecare** → editezi document și golești `expiry_date` → dispare din Expirări.
6. **Document oarecare** → ștergi documentul → toate reminderele asociate dispar din Expirări (CASCADE).
7. **Dosar medical** → ștergi dosarul medical → reminderele `medical_ai` dispar din Expirări (verifică în SQLite că rândurile încă există, dar query-ul le filtrează). Recreare dosar → reapar.
8. **Backup** export → import pe alt device → reminderele se păstrează cu același conținut.
9. **`npm run audit` verde** (type-check + toate audit-urile + characterization tests).
10. **iOS Simulator** vizual: Expirări cu trei stări (gol, doar documente, mixt medical + documente), ecran document medical cu listă remindere + flux ștergere.

### Mesaj de încheiere obligatoriu

```
**Verificat colateral:**
- expirari.tsx cu/fără dosar medical: click în iOS Simulator
- documente/[id].tsx ștergere reminder: click + verificare iOS Calendar
- documente create/edit/delete cu expiry_date: SQLite inspect + Expirări refresh
- npm run audit: verde
- characterization tests: 100% pass
```

## Out of scope (Faza 2 sau ulterior)

- Tab dedicat „Remindere" în interiorul ecranului dosarului medical (alături de Timeline / Documente / Chat) — decizia 2026-05-31: începem cu centralizat în Expirări; dacă apare nevoia, se adaugă ulterior reading din același tabel cu filtru pe `person_id`.
- Remindere manuale puse de user (`origin='manual'`) — schema le suportă (`origin` ENUM extensibil), dar UI-ul de creare nu e parte din această fază.
- Remindere recurente (ex: anual control medical) — exclus deocamdată.
- Sincronizare bidirecțională cu calendarul iOS (polling pentru deletes/moves) — confirmat fire-and-forget.
- Notificări push locale via `expo-notifications` — calendarul iOS oferă deja notificare 24h înainte. Dacă vrem alertă în-app independentă, viitor.
- Migrare retroactivă a reminderelor medicale create înainte de acest feature (există ca event-uri orfane în iOS Calendar) — nu populăm `reminders` retroactiv din `documents.pending_reminders_json` (acel câmp tracheză propuneri, nu aprobări).

## Aliniere cu regulile proiectului

- **`design.md`:** `ReminderCard` folosește `useColorScheme` din `@/components/useColorScheme` și citește culorile din paletă (NU hex hardcodat). Theme switch testat în iOS Simulator.
- **`dynamic-types.md`:** label-urile pentru document expiry derivă din `DOCUMENT_TYPE_LABELS` via `getDocumentLabel`; entitățile legate via `resolveEntityName`. Niciun switch hardcodat per tip.
- **`backup.md`:** schema nouă propagată în trei locuri (`db.ts` + `backup.ts` + `cloudSync.ts`); verificare prin `backup-audit.js --strict`.
- **`ai-privacy.md`:** tabelul `reminders` NU conține `private_notes` și nu interacționează cu fluxul AI. Reminderele `medical_ai` au labels generate de AI dar deja sanitizate înainte de a fi propuse userului (flow existent în `medicalExtractor.ts`).
- **`code-conventions.md`:** tipuri publice cu return explicit; tipuri noi în `types/index.ts`; nume fișier `reminders.ts` (camelCase service), `ReminderCard.tsx` (PascalCase component).

## Trade-offs acceptate

- **Duplicare date** pentru `source_type='document_expiry'` (`documents.expiry_date` + `reminders.reminder_date`). Acceptat pentru beneficiul unui singur query/render în Expirări. Sincronizare tranzacțională în `documents.ts` + audit script optional minimizează divergența.
- **Backfill one-time** la prima rulare după update — costă o scanare a `documents`, dar e doar prima dată.
- **Fără sync calendar iOS → app** — userul care șterge event din iOS Calendar va vedea reminderul rămas în Expirări. Edge case rar, anularea curată e prin ecranul documentului.
