# Spec — Rezumat AI pe document + Timeline doar pentru analize

**Data:** 2026-05-24
**Status:** brainstormed
**Owner:** Tudor
**Estimat:** 13-14h (~3-4 zile part-time)
**Predecesor:** `2026-05-19-dosar-medical-merge-design.md` (F1 medical merge)

---

## 1. Context

Faza 1 (medical merge) extrage din documente medicale narrative — scrisori, bilete de externare, fișe de consultație, bilete de trimitere — și pune fiecare „Recomandare", „Diagnostic", „Plan tratament" ca observații separate cu `category = 'altele'`. Acestea apar amestecate în tab-ul Timeline ca grupuri cu sparkline, alături de analizele de sânge.

Probleme constatate de user (24 mai 2026):

1. **Cognitive overload.** 4 documente medicale → 4-8 carduri „Recomandare / Diagnostic / ..." în Timeline. User non-medic nu știe ce e important, ce nu, ce a fost deja făcut.
2. **Mismatch UI ↔ semantică.** Sparkline (gândit pentru analize cu evoluție numerică) nu are sens pentru un text gen „Diagnostic principal: HTA esențială".
3. **Lipsă context simplu pe document individual.** Userul deschide un document și vede OCR brut + analize structurate, dar nu o explicație accesibilă a ce e out-of-range și ce a recomandat medicul.

**Decizie de produs:** Aplicația **NU interpretează clinic** (nu prioritizează, nu filtrează gravitatea — vezi `medicalExtractor.ts` care are explicit „Nu interpretezi clinic" în toate prompt-urile). Soluția nu poate fi „AI-ul decide ce e important", ci „AI-ul prezintă mai bine ce e scris în document, pe document".

---

## 2. Decizii (luate la brainstorming, 2026-05-24)

| # | Decizie | Motiv |
|---|---|---|
| D1 | **Timeline = doar analize (categorii lab).** Filtru `category != 'altele'` în UI. | Sparkline are sens doar pe valori numerice cu evoluție. Recomandările/diagnosticele nu „evoluează" — sunt snapshots. |
| D2 | **Câmp nou `documents.ai_summary TEXT NULL`** populat la extracție medicală. NU se atinge `doc.note` (rămâne user-controlled). | Separare clară: `note` = ce scrie userul; `ai_summary` = ce extrage AI-ul. Niciun risc de suprascriere. |
| D3 | **`ai_summary` NU intră în FTS** și nu influențează chat-ul. | User-ul vrea explicit izolare. Chat-ul răspunde mai departe pe OCR + observații extrase, fără cache AI suplimentar. |
| D4 | **`ai_summary` plaintext în DB** (același pattern ca `ocr_text` din spec §7.2 medical-merge). | Consistență cu OCR. Defense-in-depth prin `app_lock` + sandbox iOS, nu prin encryption per-field. |
| D5 | **Conținutul `ai_summary` are 3 secțiuni stricte:** rezumat 1-2 fraze + bullets recomandări extrase verbatim + bullets valori out-of-range cu „peste/sub limita X" (fără interpretare clinică). | Limbaj neutru, copie sau aproape-copie din document, fără inferență. „Peste limită" e fapt din document, „risc crescut" ar fi judecată clinică. |
| D6 | **Tap pe valoare în Timeline deschide documentul sursă.** | Singura îmbunătățire UX păstrată din designul anterior. Cost: 30 minute. |
| D7 | **NU implementăm** soft-delete observații, banner disclaimer, action sheet, restructurare Timeline pe secțiuni. | Complexitate fără câștig măsurabil. |
| D8 | **Re-extracția unui document re-generează `ai_summary`.** Suprascriere directă, fără confirmare. | Deja `deleteObservationsBySourceDocument` curăță observațiile la re-extracție — același pattern. |
| D9 | **La prima extracție medicală AI întreabă userul dacă vrea calendar reminders** pentru recomandările cu termen explicit din document. Modal cu listă bifabilă, salvare în iOS Calendar / Google Calendar via `services/calendar.ts` existent. | Momentul cognitiv corect = imediat după upload, cu contextul proaspăt. Un chip discret într-un tab nu e descoperit. |
| D10 | **Re-prompt blocat după prima decizie.** Coloană `documents.medical_reminders_prompted_at` setată la `now` indiferent dacă userul a adăugat sau a sărit. Re-extracția aceluiași document NU re-întreabă. | Zgomot zero pentru re-upload (re-scan poză = aceeași recomandare). User-ul face decizia o dată per document. |
| D11 | **NU trackuim individual calendar event IDs** pentru recomandări medicale. Eventele trăiesc în iOS Calendar / Google Calendar; userul le gestionează acolo. | Tradeoff acceptat: la ștergerea documentului, eventele rămân în calendar (rar + non-surprinzător). Alternativa = JSON column sau tabel nou doar pentru ID tracking = complexitate disproporționată. |
| D12 | **Calendar permisiune refuzată → Alert cu deep-link la Setări iOS.** NU fallback la `expo-notifications`. | Calendar e sursa unică pentru reminders în app (consistent cu expirări/evenimente via `services/calendar.ts`). Două căi paralele de reminders dublu codul. |
| D13 | **Modal NU pop-up imediat după save.** `extractAsync` rămâne fire-and-forget. La finalizare extracție, items se persistă în `documents.pending_reminders_json TEXT NULL`. Modalul apare la prima deschidere a documentului SAU a dosarului medical de care e legat. La închidere modal: șterge `pending_reminders_json` + setează `medical_reminders_prompted_at`. | Save-ul rămâne instant (UX nu se degradează). Items nu se pierd dacă userul navighează. Modalul apare în context relevant (Timeline / detaliu doc) unde userul s-a întors deliberat. |
| D14 | **Past dates filtrate complet din modal.** Items cu `suggested_date_iso < today` la momentul deschiderii modalului sunt eliminate din listă, NU afișate cu chip. | Reduce zgomot. Past dates apar uneori pentru documente vechi re-extrase și nu au valoare ca reminders. Dacă apare doar past dates → modal NU se deschide deloc. |
| D15 | **Calendar event body conține: text complet recomandare + sursă (tip document + dată) + nume dosar.** Plus `Document ID: {uuid}` la final pentru referință (deep-linking în fază 2). | Userul găsește în Calendar evenimentul, apasă, vede de unde vine (medic, când). Fără asta, reminder-ul în Calendar e orphaned text. |

---

## 3. Scope

### În scope

1. **Schema:** 3 coloane noi pe `documents` (`ai_summary TEXT NULL`, `medical_reminders_prompted_at TEXT NULL`, `pending_reminders_json TEXT NULL`) propagate în 3 locuri (db.ts + backup.ts + cloudSync.ts).
2. **`services/medicalExtractor.ts`:** nou step după inserarea observațiilor — generare `ai_summary` + `actionable_items` (JSON structured output) via AI provider existent, populare `pending_reminders_json` pentru consum ulterior (D13).
3. **AI prompt JSON output** (§6): `{ summary_md, actionable_items: [{label, suggested_date_iso}] }`. Un singur call, fără cost suplimentar față de plain text.
4. **UI document detail:** secțiune nouă „Rezumat AI" sub OCR, vizibilă doar dacă `ai_summary` populat.
5. **`services/medicalObservations.ts`:** `groupByName` filtrează `category != 'altele'` (sau opțional `includeNarrative: boolean` în signature).
6. **`TimelineTab.tsx`:** card devine tap-abil; tap pe valoare deschide documentul sursă; tap pe sparkline întreg deschide sheet cu lista documentelor (când sunt >1 surse).
7. **Componenta nouă `MedicalRemindersModal`** (FormSheetModal pattern): listă cu checkbox + label + DatePickerField per item, butoane „Adaugă selectate" / „Sari".
8. **Trigger flow (D13):** useEffect pe ecranele `entitati/medical/[id]` și `documente/[id]` care detectează `pending_reminders_json != null` + items future (D14) → deschid modalul. La închidere: setează `medical_reminders_prompted_at` + șterge `pending_reminders_json`.
9. **Integrare calendar:** la confirmare modal → loop prin items bifate → `addMedicalRecommendationCalendarEvent()` per item (wrapper nou în `services/calendar.ts` cu format body D15). La permisiune refuzată → Alert cu deep-link la Setări iOS.
10. **Audit:** `scripts/backup-audit.js` verde pe cele 3 coloane noi + audit nou `scripts/medical-ai-summary-isolation-audit.js` + test characterization pentru toate 3 coloanele în export/import.

### Out of scope

- Soft-delete persistent al observațiilor.
- Banner disclaimer „nu interpretăm clinic".
- Restructurare Timeline pe 2 secțiuni.
- Action sheet pe carduri (long-press).
- Suggestion-uri noi în ChatTab.
- Editare manuală `ai_summary` (read-only; regenerare doar prin re-extracție).
- Encryption per-field pentru `ai_summary`.
- Tracking individual al calendar event IDs (D11).
- Fallback la local notifications dacă calendar refuzat (D12).
- Re-prompt manual din UI după ce userul a decis o dată (D10).

---

## 4. Schema changes

### `services/db.ts`

```sql
-- În migrarea curentă pentru documents (try-catch, idempotent):
ALTER TABLE documents ADD COLUMN ai_summary TEXT;
ALTER TABLE documents ADD COLUMN medical_reminders_prompted_at TEXT;
ALTER TABLE documents ADD COLUMN pending_reminders_json TEXT;
```

Toate 3 coloanele nullable, fără default. Semantică:
- `ai_summary`: text markdown generat la extracția medicală. Populat o dată; suprascris la re-extracție.
- `medical_reminders_prompted_at`: ISO timestamp la prima decizie a userului (D10).
- `pending_reminders_json`: JSON `[{label, suggested_date_iso}, ...]` populat la finalizare extracție, șters la închiderea modalului (D13). Coloana e tranzitorie — ar trebui să fie `NULL` pe documente unde userul a decis deja.

### `services/backup.ts`

- `exportBackup()`: include toate 3 coloanele în obiectul serializat per document. `pending_reminders_json` exportat ca string raw (nu re-parsat).
- `applyManifest()`: scrie toate 3 coloanele la insert/upsert document, mapping direct din JSON.

### `services/cloudSync.ts`

- `buildManifestPayload()`: include toate 3 câmpurile în payload-ul pentru fiecare document.

### Audit verificare

```bash
node scripts/backup-audit.js --strict
```

Trebuie să nu raporteze niciuna dintre noile coloane ca missing din vreuna dintre cele 3 locații.

---

## 5. Service changes

### `services/medicalExtractor.ts`

După `insertObservation` finalizat pe toate observațiile validate, **înainte** de finalizarea funcției:

```typescript
// 1. Construiește input: OCR text + observații proaspăt inserate (cu valori + ref-uri).
// 2. Apel AI cu prompt SYSTEM_AI_SUMMARY (nou — vezi §6). Cere JSON output strict:
//    { summary_md: string, actionable_items: [{ label, suggested_date_iso }] }
// 3. Parsează JSON. La eșec parsare → log + setează ai_summary=null și actionable_items=[].
// 4. Aplică word-guard pe summary_md (vezi §6) → dacă conține cuvinte interzise, salvează null.
// 5. Salvează rezultatul prin nou helper `setDocumentAiSummary(docId, summary_md)`.
// 6. Returnează `actionable_items` în signature-ul funcției ca să poată fi consumate de UI.
// 7. Eșecul generării rezumatului NU blochează extracția observațiilor — log + continuă.
```

`extractFromDocument` (signature actuală neschimbată — `Promise<ExtractionResult>`). În interiorul ei, după ce summary se salvează:

```typescript
// Dacă actionable_items.length > 0 ȘI documentul are doc.medical_reminders_prompted_at == null:
//   await setPendingReminders(docId, JSON.stringify(actionable_items));
// Altfel: nu modifica pending_reminders_json (rămâne null sau valoarea anterioară).
```

Funcții noi în `services/documents.ts`:

```typescript
export async function setDocumentAiSummary(
  documentId: string,
  summary: string | null
): Promise<void>

export async function setMedicalRemindersPromptedAt(
  documentId: string,
  iso: string
): Promise<void>

export async function setPendingReminders(
  documentId: string,
  json: string | null
): Promise<void>

export async function getPendingReminders(
  documentId: string
): Promise<{ label: string; suggested_date_iso: string | null }[]>
// Helper care parsează `documents.pending_reminders_json`, returnează [] dacă null/invalid.
```

Funcție nouă în `services/medicalRecord.ts` (sau acolo unde e logic):

```typescript
export async function getDocumentsWithPendingReminders(
  recordId: string
): Promise<{ documentId: string; items: ActionableItem[] }[]>
// Returnează documentele legate de dosar care au pending_reminders_json != null
// ȘI items filtrate cu suggested_date_iso >= today (D14).
// Folosit de UI-ul de dosar medical la deschidere pentru a decide
// dacă afișează modalul.
```

### `services/medicalObservations.ts`

`groupByName` schimbat să excludă `category = 'altele'` implicit:

```typescript
export async function groupByName(
  recordId: string,
  options?: { includeNarrative?: boolean }
): Promise<ObservationGroup[]> {
  const all = await listObservationsByRecord(recordId);
  const filtered = options?.includeNarrative
    ? all
    : all.filter(o => o.category !== 'altele');
  // ... restul logicii neschimbat
}
```

`useMedicalObservations` hook apelează `groupByName(recordId)` (fără flag → narrative excluse din Timeline).

### `ObservationGroup` extins

Adăugare în interface ca tap-ul în Timeline să poată naviga la sursă:

```typescript
interface ObservationGroup {
  // ... câmpurile existente
  values: {
    id: string;
    value: string | null;
    observed_at: string | null;
    needs_review: boolean;
    source_document_id: string | null;  // NOU
  }[];
}
```

---

## 6. AI prompt pentru `ai_summary` + `actionable_items`

```
Sistem: Generator rezumat document medical pentru cititor non-medic +
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

**Rezumat:** 1-2 fraze descriere obiectivă a tipului documentului
(„Analize sânge din 12 mai 2026" / „Scrisoare medicală cardiologie").

**Recomandări:** (doar dacă există în document)
- bullet 1 (text aproape verbatim)
- bullet 2

**Valori în afara intervalului:** (doar dacă există)
- LDL: 145 mg/dL — peste limita superioară 130
- TSH: 0.3 mU/L — sub limita inferioară 0.4

Dacă nu sunt recomandări sau valori out-of-range → omiți secțiunile.
Dacă documentul nu are niciun conținut relevant → "summary_md": "".

Reguli actionable_items:
- Include un item DOAR dacă recomandarea are termen explicit ÎN TEXT
  („la 3 luni", „peste 6 luni", „pe 24 august", „într-o lună").
- suggested_date_iso = calculat relativ la observed_at al documentului.
  Exemplu: observed_at = "2026-05-24", text „control 3 luni" → "2026-08-24".
- Dacă recomandarea NU are termen explicit, NU o include în actionable_items
  (rămâne doar în summary_md ca bullet).
- label = text aproape verbatim, max 80 caractere.
- actionable_items poate fi [].
```

Confidence guard pe `summary_md`: dacă conține cuvinte interzise (lista: `grav`, `urgent`, `periculos`, `risc`, `risc crescut`, `normal e`, `e bun`, `e rău`, `recomandăm să`, `ar trebui`), rejectează și salvează `ai_summary = NULL`. `actionable_items` păstrate (vin verbatim din text doctor, sunt safe).

Validare suggested_date_iso: trebuie să fie ISO `YYYY-MM-DD`, parsabil ca Date validă. La eșec → forțat `null` (modal va avea date câmp gol pentru editare).

---

## 7. UI changes

### `app/(tabs)/documente/[id].tsx` (sau detaliul medical document)

Nouă secțiune sub OCR/Notă:

```
┌─ Rezumat AI ───────────────────────┐
│ (markdown render minimal — bold +  │
│ bullets — fără links/imagini)      │
│                                    │
│ **Rezumat:** ...                   │
│ **Recomandări:**                   │
│ • ...                              │
└────────────────────────────────────┘
```

- Vizibilă doar dacă `doc.ai_summary` truthy.
- Sub label-ul secțiunii: text mic 11pt „Generat automat, nu înlocuiește consultul medical."
- Nu e editabilă.

### `TimelineTab.tsx`

Modificări minime:

```typescript
// Per card (grupul observațional):
// Wrap în Pressable.
// onPress:
//   - extrage `unique_doc_ids = [...new Set(values.map(v => v.source_document_id).filter(Boolean))]`
//   - if 1 → router.push(`/(tabs)/documente/${unique_doc_ids[0]}`)
//   - if >1 → deschide ActionSheet cu opțiunile (label = data + tip doc).
```

ActionSheet folosește `Alert.alert` cu butoane (pattern simplu, deja folosit în app) — sau component nou `DocumentSourceSheet` dacă vrem fancy. **MVP:** Alert.alert.

### `MedicalRemindersModal` (nou)

Locație: `components/medical/MedicalRemindersModal.tsx`.

Wrapper peste `FormSheetModal` (`components/ui/FormSheetModal`).

Props:

```typescript
interface Props {
  visible: boolean;
  items: { label: string; suggested_date_iso: string | null }[];
  documentId: string;
  recordId: string;
  onClose: (decision: 'added' | 'skipped') => void;
}
```

Structură UI:
- Header: „Reminders din document medical"
- Subtitlu sub header: „AI a detectat {N} recomandări cu termen. Bifează ce vrei să apară în calendarul tău."
- Listă verticală, un rând per item:
  - Checkbox stânga (default ON pentru items cu date ≥ azi, OFF pentru date trecute)
  - Label (text recomandare) — max 2 linii, truncate cu ellipsis
  - `DatePickerField` (component existent din `components/ui/`) editabil — pre-populat cu `suggested_date_iso` sau gol
  - Dacă suggested_date_iso e trecut: chip mic „data e în trecut" sub picker
- Două butoane jos:
  - „Sari" (secondary, dreapta) → `onClose('skipped')`
  - „Adaugă selectate" (primary, dreapta) → loop prin items bifate cu date validă, apel `addEventToCalendar()` per item, apoi `onClose('added')`. La eroare permisiune calendar (returnează null) → Alert „Activează calendarul" cu deep-link `Linking.openSettings()`.

### Trigger flow pentru modal (D13)

**NU** declanșăm modalul direct la save. `extractAsync` rămâne fire-and-forget. Items se persistă în `pending_reminders_json` și modalul apare la **prima vizitare a documentului SAU a dosarului medical**.

#### Punctele de verificare (cele 2 ecrane care declanșează modalul):

**1. `app/(tabs)/entitati/medical/[id]/index.tsx`** — la mount + după fiecare refresh:

```typescript
useEffect(() => {
  if (!record) return;
  (async () => {
    const pending = await getDocumentsWithPendingReminders(record.id);
    // pending = lista documentelor legate de acest dosar cu items >= today (D14)
    if (pending.length === 0) return;
    // Strategie: batch toate items dintr-un singur modal, grupate vizual per document.
    // Simplificare MVP: deschidem modalul pentru PRIMUL document din listă;
    // dacă userul mai are altele, la următoarea deschidere a dosarului apare iar.
    const first = pending[0];
    setRemindersModalProps({
      visible: true,
      items: first.items,
      documentId: first.documentId,
      recordId: record.id,
      onClose: handleReminderDecision,
    });
  })();
}, [record?.id]);

async function handleReminderDecision(decision: 'added' | 'skipped') {
  await setMedicalRemindersPromptedAt(modalProps.documentId, new Date().toISOString());
  await setPendingReminders(modalProps.documentId, null);
  setRemindersModalProps(null);
}
```

**2. `app/(tabs)/documente/[id].tsx`** — la mount, dacă documentul are `pending_reminders_json != null` ȘI `medical_reminders_prompted_at == null` ȘI items au date >= today:

```typescript
useEffect(() => {
  if (!doc) return;
  if (doc.medical_reminders_prompted_at) return;
  const items = parseJSON(doc.pending_reminders_json) ?? [];
  const future = items.filter(i => i.suggested_date_iso && i.suggested_date_iso >= todayIso);
  if (future.length === 0) return;
  setRemindersModalProps({
    visible: true,
    items: future,
    documentId: doc.id,
    recordId: doc.entity_links?.find(l => l.entity_type === 'medical_record')?.entity_id,
    onClose: handleReminderDecision,
  });
}, [doc?.id]);
```

#### Convergența celor 2 trigger-e

Dacă userul deschide întâi dosarul medical, vede modalul acolo. Modalul setează `medical_reminders_prompted_at` și șterge `pending_reminders_json` → la deschiderea documentului în sine, condiția nu mai e satisfăcută → nu apare modalul a 2-a oară. Same în direcția cealaltă.

---

## 8. Privacy enforcement

### Reguli

1. `ai_summary` **NU** apare în niciun chunk FTS (`services/medicalFts.ts`).
2. `ai_summary` **NU** e citit în `services/medicalChat.ts` la construirea contextului.
3. `ai_summary` **DA** e inclus în backup + cloudSync (e datele userului).
4. `ai_summary` **NU** e inclus în share către medic (faza F8) — medicul citește documentele complete cu propriul context, nu rezumat AI.
5. `actionable_items` sunt persistate temporar în `documents.pending_reminders_json` între extracție și prima vizitare. La închiderea modalului, coloana e setată la `NULL` (D13). Calendar events trăiesc apoi doar în iOS/Google Calendar (D11).
6. Calendar event format (D15):
   - **Title:** `Recomandare medicală — {label trunchiat 40 char}`
   - **Body/notes:**
     ```
     {label complet}

     Sursă: {tip_document} din {data_observed_at}
     Dosar: {nume_dosar_medical}

     Document ID: {document_uuid}
     ```
   - NU conține nume pacient, nume medic, valori analize, OCR.
   - „Document ID" e referință pentru deep-linking în fază 2 (`dosar://documents/{id}` scheme dacă/când apare).
7. `pending_reminders_json` e considerat date medicale → inclus în backup + cloudSync ca rest of data (encrypted at-rest dacă userul are PIN/biometric pe backup cloud).

### Audit nou

`scripts/medical-ai-summary-isolation-audit.js`:
- Caută `ai_summary` în `services/medicalFts.ts` → eroare dacă găsește.
- Caută `ai_summary` în `services/medicalChat.ts` → eroare dacă găsește.
- Caută în prompt-urile chat (`medicalChat.ts` context builder) → eroare.
- Adăugat la `npm run audit` și pre-commit (`--strict`).

---

## 9. Migration & rollout

1. Userii existenți cu observații deja extrase: `ai_summary` rămâne `NULL` pe documente vechi.
2. **Backfill opțional:** buton „Regenerează rezumat" în detaliul dosar medical → rulează re-extracția pe toate documentele atașate. NU automat la upgrade (cost AI provider). Out of scope MVP — feature de fază 2 dacă apare cerere.
3. Documente noi adăugate post-upgrade: `ai_summary` populat la prima extracție.
4. Re-extracția unui document existent (re-upload aceeași poză) suprascrie `ai_summary`.

---

## 10. Audit checklist (Blast Radius)

- [ ] `services/db.ts` — 3× ALTER TABLE (`ai_summary`, `medical_reminders_prompted_at`, `pending_reminders_json`) în try-catch, idempotent.
- [ ] `services/backup.ts` — `exportBackup` + `applyManifest` cu toate 3 coloanele.
- [ ] `services/cloudSync.ts` — `buildManifestPayload` cu toate 3 coloanele.
- [ ] `scripts/backup-audit.js --strict` → verde.
- [ ] `scripts/medical-ai-summary-isolation-audit.js --strict` → verde (nou).
- [ ] `__tests__/characterization/backup.test.ts` — test nou pentru cele 3 coloane în export/import.
- [ ] `services/medicalExtractor.ts` — nou step generare summary + actionable_items, populare `pending_reminders_json`, eșecul nu blochează observații.
- [ ] `services/documents.ts` — helpers `setDocumentAiSummary` + `setMedicalRemindersPromptedAt` + `setPendingReminders` + `getPendingReminders`.
- [ ] `services/medicalRecord.ts` (sau echivalent) — `getDocumentsWithPendingReminders(recordId)` cu filtru `>= today` (D14).
- [ ] `services/medicalObservations.ts` — `groupByName` cu filtru implicit, `ObservationGroup.values[].source_document_id` adăugat.
- [ ] `components/medical/MedicalRemindersModal.tsx` (nou) — listă + checkbox + DatePickerField.
- [ ] `app/(tabs)/entitati/medical/[id]/index.tsx` — useEffect pentru detectare pending reminders + deschidere modal.
- [ ] `app/(tabs)/documente/[id].tsx` — useEffect echivalent pentru detalii document.
- [ ] `services/calendar.ts` — nou helper `addMedicalRecommendationCalendarEvent` cu body conform D15.
- [ ] `app/(tabs)/entitati/medical/_tabs/TimelineTab.tsx` — Pressable cu navigation logic.
- [ ] UI document detail — secțiune nouă „Rezumat AI" cu render markdown minimal.
- [ ] `services/medicalFts.ts` — verificare manuală că `ai_summary` și `pending_reminders_json` NU apar.
- [ ] `services/medicalChat.ts` — verificare manuală că `ai_summary` și `pending_reminders_json` NU apar.
- [ ] iOS Simulator — test end-to-end:
  1. Upload document medical cu recomandare cu termen (ex: scrisoare medicală cu „control 3 luni") → așteaptă extracția.
  2. Deschide dosarul medical → modalul apare cu items future.
  3. Bifează → confirmă → verifică eventul în Calendar.app cu body conform D15.
  4. Re-deschide dosarul medical → modal NU mai apare.
  5. Re-deschide documentul individual → modal NU mai apare.
  6. Re-upload același document → extracție rulează → modal NU mai apare (`medical_reminders_prompted_at` persistent).
  7. Timeline arată doar analize → tap valoare deschide documentul.
  8. Document detail arată „Rezumat AI" formatat.

---

## 11. Estimare efort

| Task | Estimat |
|---|---|
| Schema (3 coloane) + propagare (db/backup/cloudSync) | 1h |
| Helpers `setDocumentAiSummary` + `setMedicalRemindersPromptedAt` + `setPendingReminders` + `getPendingReminders` + `getDocumentsWithPendingReminders` | 1h 30 min |
| Integrare în `medicalExtractor` (parsing JSON output + populare pending_reminders_json) | 1h |
| Prompt JSON output + guard cuvinte interzise + validare dates | 1h 30 min |
| UI secțiune Rezumat AI în document detail | 1h |
| `MedicalRemindersModal` component nou (FormSheetModal + checkbox list + DatePickerField) | 2h |
| Trigger flow: useEffect pe medical_record detail + documente/[id] + helper navigation | 1h 30 min |
| Calendar event creation cu body D15 + Alert permisiune | 45 min |
| Timeline filter + tap → sursă (Alert.alert) | 1h |
| Audit script nou + adăugare la pre-commit | 30 min |
| Characterization test (3 coloane) | 45 min |
| Testare manuală end-to-end pe Simulator (build nativ necesar pentru calendar) | 1h 30 min |
| **Total** | **~13-14 ore** |

---

## 12. Open questions (pentru fază 2)

- Buton manual „Regenerează rezumat" în UI?
- Buton manual „Re-întreabă reminders" (resetează `medical_reminders_prompted_at`)?
- Inclus `ai_summary` în export PDF al dosarului?
- Permite user-ul să corecteze `ai_summary` și să-l marcheze ca „revizuit"?
- Tracking individual calendar event IDs per recomandare (pentru cleanup automat la ștergerea documentului)?

Toate amânate până vine cerere user.
