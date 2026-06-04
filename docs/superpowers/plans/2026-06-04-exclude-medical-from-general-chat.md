# Exclude medical docs from general chatbot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chatbot-ul general nu mai primește niciun document medical (conținut sau existență); când utilizatorul întreabă despre subiecte medicale, e redirecționat către chat-ul medical.

**Architecture:** Filtrare list-level a tipurilor medicale în `getDocumentsForAI()` (sursa AI-safe, consumator unic = chatbot-ul general), plus o regulă statică de redirect în system prompt-ul chatbot-ului. Chat-ul medical (`medicalChat.ts`, `getDocumentById` + RAG propriu) e neatins.

**Tech Stack:** TypeScript, Expo/React Native, Jest (`__tests__/characterization/` cu better-sqlite3 in-memory + `__tests__/unit/`).

**Spec:** `docs/superpowers/specs/2026-06-04-exclude-medical-from-general-chat-design.md`

---

## File Structure

- **Modify:** `services/documents.ts` — `getDocumentsForAI()` filtrează `MEDICAL_DOC_TYPES`; adaugă `MEDICAL_DOC_TYPES` la importul din `@/types`; actualizează JSDoc.
- **Modify:** `services/chatbot.ts` — exportă `MEDICAL_REDIRECT_RULE`; îl interpolează în `systemPrompt` (~linia 671).
- **Modify:** `.claude/rules/ai-privacy.md` — documentează noua garanție.
- **Create:** `__tests__/characterization/getDocumentsForAI.test.ts` — DB in-memory: docul medical e exclus, cel non-medical rămâne.
- **Create:** `__tests__/unit/chatbotMedicalRedirect.test.ts` — `MEDICAL_REDIRECT_RULE` conține redirectul, fără date per-document.

---

### Task 1: Exclude medical docs from `getDocumentsForAI()`

**Files:**
- Modify: `services/documents.ts:234-237` (+ importul din `@/types`)
- Modify: `.claude/rules/ai-privacy.md`
- Test: `__tests__/characterization/getDocumentsForAI.test.ts`

- [ ] **Step 1: Write the failing test**

Creează `__tests__/characterization/getDocumentsForAI.test.ts` (oglindește setup-ul din `__tests__/characterization/backup.test.ts`):

```typescript
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Characterization test — getDocumentsForAI() exclude documentele medicale.
 *
 * Garanție GDPR: chatbot-ul general (singurul consumator al getDocumentsForAI)
 * nu primește niciun document medical. Vezi
 * docs/superpowers/specs/2026-06-04-exclude-medical-from-general-chat-design.md
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('../helpers/testDb');
    return createTestDbInstance();
  },
}));

import { applySchemaToTestDb } from '../helpers/testDbSetup';
import type { TestDb } from '../helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let getDocumentsForAI: typeof import('@/services/documents').getDocumentsForAI;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    getDocumentsForAI = require('@/services/documents').getDocumentsForAI;
  });
});

function resetSchema(): void {
  const tables = testDb._raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  testDb._raw.pragma('foreign_keys = OFF');
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    if (t.name === 'medical_fts') continue;
    try {
      testDb._raw.exec(`DELETE FROM ${t.name}`);
    } catch {
      /* virtual/shadow tables */
    }
  }
  testDb._raw.pragma('foreign_keys = ON');
}

beforeEach(resetSchema);

function insertDoc(id: string, type: string, note: string): void {
  testDb._raw
    .prepare(
      `INSERT INTO documents (id, type, issue_date, expiry_date, created_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, type, '2026-05-24', null, '2026-05-24T00:00:00Z', note);
}

describe('getDocumentsForAI — excludere documente medicale', () => {
  it('exclude un document medical și păstrează unul non-medical', async () => {
    insertDoc('doc-medical', 'analize_medicale', 'Glucoză: 95 mg/dL (ref: 70-99)');
    insertDoc('doc-factura', 'factura', 'Furnizor: E.ON, Total: 225 RON');

    const docs = await getDocumentsForAI();
    const ids = docs.map(d => d.id);

    expect(ids).toContain('doc-factura');
    expect(ids).not.toContain('doc-medical');
    // Nicio urmă de conținut medical în rezultat
    expect(JSON.stringify(docs)).not.toContain('Glucoză');
  });

  it('exclude TOATE tipurile din MEDICAL_DOC_TYPES', async () => {
    const { MEDICAL_DOC_TYPES } = require('@/types');
    let i = 0;
    for (const t of MEDICAL_DOC_TYPES) insertDoc(`med-${i++}`, t, 'date clinice');
    insertDoc('non-med', 'buletin', 'CI');

    const docs = await getDocumentsForAI();
    const types = new Set(docs.map(d => d.type));
    for (const t of MEDICAL_DOC_TYPES) expect(types.has(t)).toBe(false);
    expect(docs.map(d => d.id)).toContain('non-med');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/characterization/getDocumentsForAI.test.ts`
Expected: FAIL — `doc-medical` IS returned (filtrarea nu există încă), deci `expect(ids).not.toContain('doc-medical')` pică.

- [ ] **Step 3: Add MEDICAL_DOC_TYPES to the @/types import**

În `services/documents.ts`, găsește importul existent din `@/types` (sus în fișier, ex. `import { Document, DocumentType, ... } from '@/types';`) și adaugă `MEDICAL_DOC_TYPES` la lista de simboluri importate. Dacă nu există import din `@/types`, adaugă-l:

```typescript
import { MEDICAL_DOC_TYPES } from '@/types';
```

(Preferă să-l adaugi la importul existent din `@/types` dacă acesta există, ca să nu dublezi linia de import.)

- [ ] **Step 4: Filter medical docs in getDocumentsForAI**

În `services/documents.ts`, înlocuiește funcția de la liniile 229-237:

```typescript
/**
 * Variantă de `getDocuments()` garantată fără date private.
 * Folosește-o în locul `getDocuments()` pentru orice pipeline care trimite
 * date la un model extern.
 */
export async function getDocumentsForAI(): Promise<Document[]> {
  const all = await getDocuments();
  return all.map(sanitizeDocumentForAI);
}
```

cu:

```typescript
/**
 * Variantă de `getDocuments()` sigură pentru AI-ul GENERAL (chatbot-ul aplicației):
 * - scoate `private_notes` (vezi sanitizeDocumentForAI);
 * - EXCLUDE complet documentele medicale (MEDICAL_DOC_TYPES) — din motive de
 *   confidențialitate/GDPR, datele clinice nu pleacă la modelul general. Doar
 *   chat-ul medical (medicalChat.ts, scoped + medical lock) are acces la ele.
 * Folosește-o în locul `getDocuments()` pentru orice pipeline care trimite date
 * la modelul AI general.
 */
export async function getDocumentsForAI(): Promise<Document[]> {
  const all = await getDocuments();
  return all
    .filter(d => !MEDICAL_DOC_TYPES.has(d.type))
    .map(sanitizeDocumentForAI);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/characterization/getDocumentsForAI.test.ts`
Expected: PASS (ambele teste verzi).

- [ ] **Step 6: Update the ai-privacy.md rule**

În `.claude/rules/ai-privacy.md`, la secțiunea „### 3. Unde NU pleacă la AI" (sau imediat după descrierea `getDocumentsForAI`), adaugă:

```markdown
### Documente medicale — excluse din AI-ul general

`getDocumentsForAI()` exclude complet documentele cu tip în `MEDICAL_DOC_TYPES`
(analize, rețete, diagnostice, scrisori, bilete, imagistică, vaccinuri). Chatbot-ul
general (singurul consumator) nu le vede — nici conținut, nici existență. Doar
chat-ul medical (`medicalChat.ts`, scoped pe dosar + medical lock) are acces, prin
ruta lui proprie (`getDocumentById` + `medical_fts`/`medical_observations`), care
NU trece prin `getDocumentsForAI`.

Garanție verificată de `__tests__/characterization/getDocumentsForAI.test.ts`.
```

- [ ] **Step 7: Type-check + suite**

Run: `npm run type-check` → zero erori.
Run: `npm run test:characterization` → PASS (inclusiv noul fișier; cele 45 existente neafectate).

- [ ] **Step 8: Commit**

```bash
git add services/documents.ts __tests__/characterization/getDocumentsForAI.test.ts .claude/rules/ai-privacy.md
git commit -m "feat: exclude medical docs from general chatbot context (GDPR)"
```

Notă: pre-commit-ul rulează (type-check + audit-uri + characterization + site regen). Lasă-l să ruleze; nu folosi `--no-verify`. Dacă pică un audit strict NOU din cauza schimbării, raportează DONE_WITH_CONCERNS cu output-ul.

---

### Task 2: Redirect static în system prompt-ul chatbot-ului

**Files:**
- Modify: `services/chatbot.ts` (const nou + `systemPrompt` ~linia 671)
- Test: `__tests__/unit/chatbotMedicalRedirect.test.ts`

- [ ] **Step 1: Write the failing test**

Creează `__tests__/unit/chatbotMedicalRedirect.test.ts`:

```typescript
import { MEDICAL_REDIRECT_RULE } from '@/services/chatbot';

describe('MEDICAL_REDIRECT_RULE — redirect static, fără scurgere', () => {
  it('îndrumă către Dosarul medical', () => {
    expect(MEDICAL_REDIRECT_RULE).toContain('Dosarul medical');
  });

  it('invocă motivul de confidențialitate/GDPR', () => {
    expect(MEDICAL_REDIRECT_RULE).toMatch(/confiden|GDPR/i);
  });

  it('instruiește explicit fără acces la documentele medicale', () => {
    expect(MEDICAL_REDIRECT_RULE).toMatch(/nu ai acces|fără acces/i);
  });

  it('e text static — fără interpolare rămasă (nicio scurgere per-document)', () => {
    expect(MEDICAL_REDIRECT_RULE).not.toContain('${');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/chatbotMedicalRedirect.test.ts`
Expected: FAIL la compilare — `MEDICAL_REDIRECT_RULE` nu e exportat din `chatbot.ts`.

- [ ] **Step 3: Add the exported constant**

În `services/chatbot.ts`, lângă celelalte constante de la nivel de modul (sus, după importuri), adaugă:

```typescript
/**
 * Regulă statică injectată în system prompt-ul chatbot-ului GENERAL. Datele
 * medicale sunt deja excluse din context (getDocumentsForAI). Aici instruim
 * modelul să redirecționeze întrebările medicale către chat-ul medical, fără
 * să inventeze și fără să nege existența documentelor. Text FIX — zero date
 * per-document, deci nicio scurgere.
 */
export const MEDICAL_REDIRECT_RULE = `## Documente medicale — fără acces

Nu ai acces la documentele medicale ale utilizatorului (analize, rețete, diagnostice, scrisori medicale, bilete de externare/trimitere, imagistică, vaccinuri) — din motive de confidențialitate/GDPR, ele NU apar în „Datele utilizatorului" de mai sus.

Dacă utilizatorul întreabă despre analize, rezultate, medicamente, diagnostice sau orice subiect medical: NU inventa date și NU spune că documentele nu există. Răspunde îndrumându-l: „Pentru analizele și documentele tale medicale, deschide Dosarul medical — chat-ul de acolo are acces la ele."`;
```

- [ ] **Step 4: Wire the rule into systemPrompt**

În `services/chatbot.ts`, găsește construcția `systemPrompt` (~linia 671):

```typescript
  const systemPrompt = `${buildAppKnowledge()}

## Datele utilizatorului

${contextText}

Când menționezi un document specific, folosește ÎNTOTDEAUNA tag-ul [DOC:...|...] din context.
Când menționezi o entitate, folosește ÎNTOTDEAUNA tag-ul [ENT:...|...|...] din context.${taskRule}`;
```

și adaugă `MEDICAL_REDIRECT_RULE` după blocul de date:

```typescript
  const systemPrompt = `${buildAppKnowledge()}

## Datele utilizatorului

${contextText}

${MEDICAL_REDIRECT_RULE}

Când menționezi un document specific, folosește ÎNTOTDEAUNA tag-ul [DOC:...|...] din context.
Când menționezi o entitate, folosește ÎNTOTDEAUNA tag-ul [ENT:...|...|...] din context.${taskRule}`;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/unit/chatbotMedicalRedirect.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Type-check + suite**

Run: `npm run type-check` → zero erori.
Run: `npx jest __tests__/unit/ __tests__/smoke/` → fără regresii.

- [ ] **Step 7: Commit**

```bash
git add services/chatbot.ts __tests__/unit/chatbotMedicalRedirect.test.ts
git commit -m "feat: redirect medical questions to medical chat in general chatbot"
```

---

### Task 3: Verificare colaterală + raport (Definition of Done)

**Files:** niciunul (verificare).

- [ ] **Step 1: Confirmă consumatorul unic + ruta medicală neatinsă**

Run: `grep -rn "getDocumentsForAI" services/ app/ hooks/ components/ | grep -v "function getDocumentsForAI"`
Expected: o singură referință de consum — `services/chatbot.ts`. (Plus linia de comentariu/import.)

Run: `grep -nE "getDocumentsForAI|getDocumentById" services/medicalChat.ts`
Expected: `medicalChat.ts` folosește `getDocumentById`, NU `getDocumentsForAI` → acces medical neafectat.

- [ ] **Step 2: Confirmă filtrarea acoperă și findDocsByOcrSearch**

Run: `grep -nE "findDocsByOcrSearch|getDocumentsForAI" services/chatbot.ts`
Expected: `findDocsByOcrSearch` operează pe lista `documents` venită din `getDocumentsForAI` (deja filtrată) — deci căutarea OCR nu poate readuce documente medicale. Citește `buildContext` (~linia 410-451) ca să confirmi că nu există altă sursă de documente.

- [ ] **Step 3: Manual — chatbot general (ai-privacy.md)**

Pe Simulator/device: pune o întrebare medicală în chatbot-ul general (ex. „ce analize am?" / „care era glicemia mea?").
Expected: răspuns de redirect către Dosarul medical, FĂRĂ date clinice. Dacă poți inspecta payload-ul HTTP, confirmă că niciun `note`/`ocr_text` de document medical nu apare în `messages[].content`.

- [ ] **Step 4: Raport final „Verificat colateral"**

Scrie secțiunea obligatorie:

```
**Verificat colateral:**
- getDocumentsForAI consumator unic = chatbot.ts (grep) — medical exclus la sursă
- medicalChat.ts folosește getDocumentById, nu getDocumentsForAI — acces medical neatins (grep)
- findDocsByOcrSearch operează pe lista deja filtrată — fără re-leak via căutare OCR
- npm run type-check + test:characterization + unit/smoke: verde
- Manual: întrebare medicală în chatbot general → redirect, fără date clinice (sau „NU am verificat manual pentru că Y")
```

---

## Self-Review

**1. Spec coverage:**
- Spec §Soluție 1 „excludere date în getDocumentsForAI" → Task 1 Step 3-4 + test Step 1. ✓
- Spec §Soluție 2 „redirect static în system prompt" → Task 2 Step 3-4 + test. ✓
- Spec §Soluție 3 „plasă anti-regresie (test automat)" → Task 1 Step 1 (characterization test). ✓
- Spec „actualizează ai-privacy.md" → Task 1 Step 6. ✓
- Spec „ce NU se schimbă (medical chat, sanitizeDocumentForAI, schema)" → neatinse; Task 3 Step 1 confirmă. ✓
- Spec §Verificare (consumator unic, medicalChat, findDocsByOcrSearch, manual) → Task 3. ✓

**2. Placeholder scan:** Fără TBD/TODO. Toate step-urile de cod conțin codul efectiv (old + new). ✓

**3. Type consistency:** `MEDICAL_DOC_TYPES` (`ReadonlySet<DocumentType>`, `.has()`), `MEDICAL_REDIRECT_RULE` (string exportat) — aceleași nume în implementare și teste. `getDocumentsForAI` semnătură neschimbată. ✓
