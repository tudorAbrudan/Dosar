# Medical Backup Fără Cheie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elimină criptarea AES per-câmp a datelor medicale (observații + chat), ca să se stocheze ca TEXT plain — astfel backup-ul/restore-ul cross-device merge fără cheie și fără parolă de criptare cloud.

**Architecture:** Observații (`name/value/ref_min/ref_max`) și mesaje chat (`content`) trec din coloane BLOB criptate în coloane TEXT plain. Instalări noi primesc schema nouă direct; instalări existente sunt migrate la pornire de un modul self-contained care decriptează blob-urile vechi cu cheia master (din Keychain) și apoi șterge cheia. Tot codul de transfer al cheii (cloud `_security.medical_key` + bifa UI + setting) dispare.

**Tech Stack:** React Native + Expo, `expo-sqlite` (SQLite), `expo-secure-store`, `@noble/ciphers` (doar pentru decriptarea de migrare), Jest + better-sqlite3 (characterization tests).

**Spec:** `docs/superpowers/specs/2026-06-05-medical-backup-fara-cheie-design.md`

---

## Context critic (citește înainte de Task 1)

- **db.ts nu are runner de migrare async.** Tot schema + ALTER-urile rulează top-level sincron la `import { db } from '@/services/db'` (`app/_layout.tsx:24`). Singura piesă async e un IIFE la final (db.ts ~868) care face lazy `require('./reminders')` + backfill. Migrarea noastră (decriptare = async) se agață ca un al doilea IIFE de același tip.
- **`name_enc BLOB NOT NULL` și `content_enc BLOB NOT NULL`** au constrângere NOT NULL → nu putem doar adăuga coloane TEXT și opri scrierea în `_enc` (INSERT-urile noi ar pica). De aceea migrarea face **rebuild de tabel** (CREATE nou → copy decriptat → DROP vechi → RENAME), nu ALTER.
- **`medical_record.encryption_key_ref TEXT NOT NULL`** rămâne în schemă (nu-l ștergem — SQLite n-are DROP COLUMN ușor). Îi dăm o valoare literală constantă după refactor.
- **`db-destructive-init-audit.js` scanează doar `services/db.ts`.** Rebuild-ul (DROP+RENAME) stă în `services/medicalKeyMigration.ts` → nu declanșează auditul. `db.ts` nu primește niciun DROP.
- **Restore medical (ZIP + cloud) e o singură funcție:** `applyManifest()` în `backup.ts` (loop-urile medical de la ~836). O editezi o dată.
- **Ordinea contează:** migrarea (Task 2) folosește `decryptFieldOrNull` din `medicalCrypto`; Task 3 reduce `medicalCrypto` dar **păstrează** decriptarea. Nu inversa.

---

## File Structure

| Fișier | Responsabilitate după plan |
|---|---|
| `services/db.ts` | Schema nouă plaintext pentru cele 2 tabele (instalări noi) + IIFE care apelează migrarea |
| `services/medicalKeyMigration.ts` (**nou**) | Rebuild one-time: decriptează `_enc` → TEXT, șterge cheia. Self-contained, testabil cu `db` injectabil |
| `services/medicalCrypto.ts` | Redus la decriptare + management cheie (folosit doar de migrare) |
| `services/medicalObservations.ts` | CRUD pe coloane TEXT plain (fără cripto) |
| `services/medicalChat.ts` | CRUD mesaje pe `content` TEXT (fără cripto) |
| `services/medicalRecord.ts` | Fără `ensureMedicalMasterKey`; `encryption_key_ref` = constantă locală |
| `components/medical/CreateMedicalRecordModal.tsx` | Fără `ensureMedicalMasterKey` |
| `services/backup.ts` | Export + `applyManifest` cu coloane TEXT plain; bump versiune ZIP |
| `services/cloudSync.ts` | Fără `_security.medical_key`; payload plaintext; bump `MANIFEST_VERSION` |
| `services/settings.ts` | Fără `getCloudBackupIncludesMedicalKey`/`set...` |
| `app/cloud-backup.tsx` | Fără rândul-bifă „Include cheia medicală" |
| `__tests__/characterization/db.test.ts` | Aserții TEXT în loc de BLOB |
| `__tests__/medicalKeyMigration.test.ts` (**nou**) | Testează rebuild-ul (path fără cheie → placeholder) |

---

## Task 1: Schema nouă plaintext (instalări noi) + hook migrare

**Files:**
- Modify: `services/db.ts:203-219` (medical_observations), `services/db.ts:232-239` (medical_chat_messages), `services/db.ts:~868` (adaugă IIFE migrare)

- [ ] **Step 1: Înlocuiește schema `medical_observations`**

În `services/db.ts`, înlocuiește blocul `CREATE TABLE IF NOT EXISTS medical_observations (...)` (liniile ~203-219) cu:

```sql
    CREATE TABLE IF NOT EXISTS medical_observations (
      id TEXT PRIMARY KEY,
      medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
      source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      value TEXT,
      unit TEXT,
      ref_min TEXT,
      ref_max TEXT,
      observed_at TEXT,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      user_corrected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
```

- [ ] **Step 2: Înlocuiește schema `medical_chat_messages`**

Înlocuiește blocul `CREATE TABLE IF NOT EXISTS medical_chat_messages (...)` (liniile ~232-239) cu:

```sql
    CREATE TABLE IF NOT EXISTS medical_chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES medical_chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      created_at TEXT NOT NULL
    );
```

Actualizează și comentariul de la liniile ~181-182 (scoate „Câmpurile *_enc sunt BLOB criptat") → `// Datele medicale se stochează plaintext (vezi spec 2026-06-05); protejate de App Lock + sandbox iOS.`

- [ ] **Step 3: Adaugă IIFE-ul de migrare la finalul db.ts**

Imediat DUPĂ IIFE-ul existent `backfillDocumentExpiryReminders` (db.ts ~868-875), adaugă:

```ts
// Migrare one-time: decriptează datele medicale _enc → coloane TEXT plain și
// șterge cheia master (spec 2026-06-05). Idempotent: skip dacă tabelele sunt deja
// în schema nouă. Lazy require pentru a evita import circular.
(async () => {
  try {
    const { migrateMedicalEncToPlaintext } = require('./medicalKeyMigration');
    await migrateMedicalEncToPlaintext();
  } catch (e) {
    console.warn(
      '[initDb] migrateMedicalEncToPlaintext failed:',
      e instanceof Error ? e.message : e
    );
  }
})();
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS (modulul `medicalKeyMigration` e creat în Task 2; `require` e runtime, nu type-checked — dacă tsc se plânge de `require`, e ok, e deja pattern în db.ts cu `require('./reminders')`).

- [ ] **Step 5: Commit**

```bash
git add services/db.ts
git commit -m "feat(medical): plaintext schema for medical observations + chat (fresh installs)"
```

---

## Task 2: Modulul de migrare one-time

**Files:**
- Create: `services/medicalKeyMigration.ts`
- Test: `__tests__/medicalKeyMigration.test.ts`

- [ ] **Step 1: Scrie testul (path fără cheie → placeholder + schemă nouă)**

Creează `__tests__/medicalKeyMigration.test.ts`. Folosește better-sqlite3 in-memory cu wrapper async (același pattern ca `__tests__/characterization/`). Testul creează manual schema VECHE (`_enc`), inserează un rând, rulează migrarea fără cheie în SecureStore, și verifică că tabelul a devenit schema nouă cu placeholder:

```ts
import Database from 'better-sqlite3';
import { migrateMedicalEncToPlaintext } from '@/services/medicalKeyMigration';

// Wrapper async minimal peste better-sqlite3 (oglindă a API-ului expo-sqlite folosit de migrare)
function makeAsyncDb(raw: Database.Database) {
  return {
    getAllAsync: async <T>(sql: string, params: unknown[] = []) =>
      raw.prepare(sql).all(...(params as never[])) as T[],
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) =>
      (raw.prepare(sql).get(...(params as never[])) as T) ?? null,
    runAsync: async (sql: string, params: unknown[] = []) => {
      raw.prepare(sql).run(...(params as never[]));
    },
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
  };
}

jest.mock('@/services/medicalCrypto', () => ({
  hasMedicalMasterKey: jest.fn(async () => false),
  ensureMedicalMasterKey: jest.fn(async () => {}),
  deleteMedicalMasterKey: jest.fn(async () => {}),
  decryptFieldOrNull: jest.fn(async () => null), // fără cheie → null → fallback
}));

describe('migrateMedicalEncToPlaintext', () => {
  it('rebuilds old _enc observations table to plaintext TEXT schema', async () => {
    const raw = new Database(':memory:');
    raw.exec(`
      CREATE TABLE medical_observations (
        id TEXT PRIMARY KEY, medical_record_id TEXT NOT NULL, source_document_id TEXT,
        name_enc BLOB NOT NULL, value_enc BLOB, unit TEXT, ref_min_enc BLOB, ref_max_enc BLOB,
        observed_at TEXT, category TEXT NOT NULL, confidence REAL NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0, user_corrected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE medical_chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
        content_enc BLOB NOT NULL, citations_json TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO medical_observations
        (id, medical_record_id, source_document_id, name_enc, value_enc, unit, ref_min_enc,
         ref_max_enc, observed_at, category, confidence, needs_review, user_corrected, created_at, updated_at)
        VALUES ('o1','r1',NULL, X'00', X'00', 'mg', NULL, NULL, '2026-01-01', 'altele', 0.9, 0, 0, 't','t');
      INSERT INTO medical_chat_messages (id, thread_id, role, content_enc, citations_json, created_at)
        VALUES ('m1','t1','user', X'00', NULL, 't');
    `);
    const adb = makeAsyncDb(raw);

    await migrateMedicalEncToPlaintext(adb as never);

    const obsCols = raw.prepare("PRAGMA table_info(medical_observations)").all() as { name: string }[];
    const names = obsCols.map(c => c.name);
    expect(names).toContain('name');
    expect(names).not.toContain('name_enc');
    const obs = raw.prepare('SELECT name, value FROM medical_observations WHERE id = ?').get('o1') as {
      name: string; value: string | null;
    };
    expect(obs.name).toBe('[indisponibil]');

    const msgCols = raw.prepare("PRAGMA table_info(medical_chat_messages)").all() as { name: string }[];
    expect(msgCols.map(c => c.name)).toContain('content');
    const msg = raw.prepare('SELECT content FROM medical_chat_messages WHERE id = ?').get('m1') as {
      content: string;
    };
    expect(msg.content).toBe('[mesaj indisponibil]');
  });

  it('is a no-op when tables are already plaintext (no name_enc column)', async () => {
    const raw = new Database(':memory:');
    raw.exec(`
      CREATE TABLE medical_observations (
        id TEXT PRIMARY KEY, medical_record_id TEXT NOT NULL, source_document_id TEXT,
        name TEXT NOT NULL, value TEXT, unit TEXT, ref_min TEXT, ref_max TEXT,
        observed_at TEXT, category TEXT NOT NULL, confidence REAL NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0, user_corrected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE medical_chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, citations_json TEXT, created_at TEXT NOT NULL
      );
    `);
    const adb = makeAsyncDb(raw);
    await expect(migrateMedicalEncToPlaintext(adb as never)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să PICE**

Run: `npx jest medicalKeyMigration --no-coverage`
Expected: FAIL cu „Cannot find module '@/services/medicalKeyMigration'".

- [ ] **Step 3: Scrie modulul de migrare**

Creează `services/medicalKeyMigration.ts`:

```ts
/**
 * Migrare one-time (spec 2026-06-05): datele medicale criptate AES (coloanele
 * `_enc` BLOB) sunt convertite în coloane TEXT plaintext. După conversie, cheia
 * master e ștearsă din Keychain — nu mai e nevoie de ea.
 *
 * Idempotent: dacă tabelele sunt deja în schema nouă (fără `name_enc`), skip.
 * Rândurile care nu se pot decripta (cheie lipsă pe device-ul ăsta) primesc
 * placeholder — datele reale revin la următorul restore din backup plaintext.
 *
 * `database` e injectabil pentru testare; default = singleton-ul `db`.
 */
import { db as defaultDb, generateId } from './db';
import {
  hasMedicalMasterKey,
  ensureMedicalMasterKey,
  deleteMedicalMasterKey,
  decryptFieldOrNull,
} from './medicalCrypto';

interface MinimalDb {
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  execAsync(sql: string): Promise<unknown>;
}

function toBytes(blob: unknown): Uint8Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  if (Array.isArray(blob)) return new Uint8Array(blob as number[]);
  // better-sqlite3 returnează Buffer (subclasă de Uint8Array) — acoperit mai sus
  return null;
}

async function hasColumn(database: MinimalDb, table: string, column: string): Promise<boolean> {
  const cols = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

interface OldObsRow {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  name_enc: unknown;
  value_enc: unknown;
  unit: string | null;
  ref_min_enc: unknown;
  ref_max_enc: unknown;
  observed_at: string | null;
  category: string;
  confidence: number;
  needs_review: number;
  user_corrected: number;
  created_at: string;
  updated_at: string;
}

interface OldMsgRow {
  id: string;
  thread_id: string;
  role: string;
  content_enc: unknown;
  citations_json: string | null;
  created_at: string;
}

async function migrateObservations(database: MinimalDb): Promise<void> {
  if (!(await hasColumn(database, 'medical_observations', 'name_enc'))) return;

  await database.execAsync(`
    CREATE TABLE medical_observations_plain (
      id TEXT PRIMARY KEY,
      medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
      source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      value TEXT,
      unit TEXT,
      ref_min TEXT,
      ref_max TEXT,
      observed_at TEXT,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      user_corrected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const rows = await database.getAllAsync<OldObsRow>('SELECT * FROM medical_observations');
  for (const r of rows) {
    const aad = r.medical_record_id;
    const name = (await decryptFieldOrNull(toBytes(r.name_enc), aad)) ?? '[indisponibil]';
    const value = await decryptFieldOrNull(toBytes(r.value_enc), aad);
    const refMin = await decryptFieldOrNull(toBytes(r.ref_min_enc), aad);
    const refMax = await decryptFieldOrNull(toBytes(r.ref_max_enc), aad);
    await database.runAsync(
      `INSERT INTO medical_observations_plain
         (id, medical_record_id, source_document_id, name, value, unit, ref_min, ref_max,
          observed_at, category, confidence, needs_review, user_corrected, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id, r.medical_record_id, r.source_document_id, name, value, r.unit, refMin, refMax,
        r.observed_at, r.category, r.confidence, r.needs_review, r.user_corrected,
        r.created_at, r.updated_at,
      ]
    );
  }

  await database.execAsync('DROP TABLE medical_observations');
  await database.execAsync('ALTER TABLE medical_observations_plain RENAME TO medical_observations');
  await database.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_medobs_record ON medical_observations(medical_record_id);
     CREATE INDEX IF NOT EXISTS idx_medobs_observed_at ON medical_observations(observed_at);
     CREATE INDEX IF NOT EXISTS idx_medobs_category ON medical_observations(category);`
  );
}

async function migrateChatMessages(database: MinimalDb): Promise<void> {
  if (!(await hasColumn(database, 'medical_chat_messages', 'content_enc'))) return;

  await database.execAsync(`
    CREATE TABLE medical_chat_messages_plain (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES medical_chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // thread_id → medical_record_id pentru AAD
  const threadMap = new Map<string, string>();
  const threads = await database.getAllAsync<{ id: string; medical_record_id: string }>(
    'SELECT id, medical_record_id FROM medical_chat_threads'
  );
  for (const t of threads) threadMap.set(t.id, t.medical_record_id);

  const rows = await database.getAllAsync<OldMsgRow>('SELECT * FROM medical_chat_messages');
  for (const r of rows) {
    const aad = threadMap.get(r.thread_id) ?? '';
    const content =
      (await decryptFieldOrNull(toBytes(r.content_enc), aad)) ?? '[mesaj indisponibil]';
    await database.runAsync(
      `INSERT INTO medical_chat_messages_plain (id, thread_id, role, content, citations_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.id, r.thread_id, r.role, content, r.citations_json, r.created_at]
    );
  }

  await database.execAsync('DROP TABLE medical_chat_messages');
  await database.execAsync(
    'ALTER TABLE medical_chat_messages_plain RENAME TO medical_chat_messages'
  );
  await database.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_medmsg_thread ON medical_chat_messages(thread_id);'
  );
}

export async function migrateMedicalEncToPlaintext(database: MinimalDb = defaultDb): Promise<void> {
  const needsObs = await hasColumn(database, 'medical_observations', 'name_enc');
  const needsMsg = await hasColumn(database, 'medical_chat_messages', 'content_enc');
  if (!needsObs && !needsMsg) return;

  // Încarcă cheia dacă există (pentru decriptare); dacă lipsește, rândurile primesc placeholder.
  if (await hasMedicalMasterKey()) {
    await ensureMedicalMasterKey();
  }

  if (needsObs) await migrateObservations(database);
  if (needsMsg) await migrateChatMessages(database);

  // Cheia nu mai e necesară — datele sunt plaintext acum.
  await deleteMedicalMasterKey();
}
```

> `generateId` e importat pentru paritate cu pattern-ul db.ts; dacă tsc semnalează unused, scoate-l din import.

- [ ] **Step 4: Rulează testul — trebuie să TREACĂ**

Run: `npx jest medicalKeyMigration --no-coverage`
Expected: PASS (ambele teste).

- [ ] **Step 5: Type-check + commit**

Run: `npm run type-check`
Expected: PASS

```bash
git add services/medicalKeyMigration.ts __tests__/medicalKeyMigration.test.ts
git commit -m "feat(medical): one-time migration decrypting _enc columns to plaintext"
```

---

## Task 3: Reduce medicalCrypto.ts la decriptare + management cheie

**Files:**
- Modify: `services/medicalCrypto.ts`

- [ ] **Step 1: Șterge funcțiile de criptare + export/import cheie**

În `services/medicalCrypto.ts`, șterge complet:
- `encryptField` (liniile ~197-210)
- `encryptFieldOpt` (liniile ~251-257)
- `exportMasterKeyBase64` (liniile ~276-280)
- `importMasterKeyBase64` (liniile ~286-295)

Păstrează: `MEDICAL_MASTER_KEY_REF`, helperii base64/utf8, `loadKeyFromStore`, `saveKeyToStore`, `ensureMedicalMasterKey`, `hasMedicalMasterKey`, `deleteMedicalMasterKey`, `resetMedicalMasterKeyForTests`, `getKeyOrThrow`, `decryptField`, `decryptFieldOrNull`, `decryptFieldOpt`.

Actualizează JSDoc-ul de header (liniile 1-12): scoate referințele la „Backup-ul include opțional cheia" → înlocuiește cu:
```ts
/**
 * Decriptare AES-256-GCM per câmp pentru dosarul medical — păstrat DOAR pentru
 * migrarea one-time (spec 2026-06-05) care convertește datele vechi `_enc` în
 * plaintext. Codul nou NU mai criptează. După ce toate device-urile migrează,
 * acest fișier devine eliminabil.
 */
```

- [ ] **Step 2: Type-check — așteaptă erori în consumatori**

Run: `npm run type-check`
Expected: FAIL — `encryptField`/`decryptFieldOpt`/etc. importate în `medicalObservations.ts`, `medicalChat.ts`, `cloudSync.ts`. Acestea se rezolvă în Task 4-8. Notează erorile, continuă.

- [ ] **Step 3: Commit (parțial — type-check se reface în Task 8)**

```bash
git add services/medicalCrypto.ts
git commit -m "refactor(medical): strip encrypt + master-key transfer from medicalCrypto"
```

---

## Task 4: medicalObservations.ts → plaintext

**Files:**
- Modify: `services/medicalObservations.ts`
- Test: `__tests__/medicalObservations.test.ts` (nou)

- [ ] **Step 1: Scrie testul de round-trip plaintext**

Creează `__tests__/medicalObservations.test.ts` — folosește harness-ul de DB async din characterization (better-sqlite3 + schema nouă). Verifică insert→get fără criptare:

```ts
// NOTĂ implementator: refolosește helper-ul existent din
// __tests__/characterization/ pentru a obține un `db` async cu schema din db.ts.
// Dacă acel helper nu e exportat, creează un better-sqlite3 in-memory cu schema
// nouă (vezi medicalKeyMigration.test.ts) și mock-uiește '@/services/db' să
// întoarcă wrapper-ul. Testul minimal:
import { insertObservation, getObservation } from '@/services/medicalObservations';

it('stores and reads observation name/value as plaintext', async () => {
  // pre-cond: medical_record 'r1' există în db-ul de test
  const obs = await insertObservation({
    medical_record_id: 'r1',
    source_document_id: null,
    name: 'Hemoglobina',
    value: '14.2',
    unit: 'g/dL',
    ref_min: '13',
    ref_max: '17',
    observed_at: '2026-01-01',
    category: 'sange',
    confidence: 0.95,
  });
  const reload = await getObservation(obs.id);
  expect(reload?.name).toBe('Hemoglobina');
  expect(reload?.value).toBe('14.2');
});
```

- [ ] **Step 2: Rulează testul — trebuie să PICE**

Run: `npx jest medicalObservations --no-coverage`
Expected: FAIL (codul încă cripteaza / importă `encryptField` șters → eroare runtime sau de import).

- [ ] **Step 3: Rescrie medicalObservations.ts fără cripto**

- Șterge importul `medicalCrypto` (liniile 13-19).
- Șterge helperul `toBytes` (56-60).
- Schimbă `ObservationRow` (38-54): `name_enc/value_enc/ref_min_enc/ref_max_enc: Uint8Array...` → `name: string; value: string | null; ref_min: string | null; ref_max: string | null;`.
- Fă `rowToObs` sincron (scoate `async`/`await`):

```ts
function rowToObs(r: ObservationRow): MedicalObservation {
  return {
    id: r.id,
    medical_record_id: r.medical_record_id,
    source_document_id: r.source_document_id,
    name: r.name,
    value: r.value,
    unit: r.unit,
    ref_min: r.ref_min,
    ref_max: r.ref_max,
    observed_at: r.observed_at,
    category: (r.category ?? 'altele') as ObservationCategory,
    confidence: r.confidence,
    needs_review: r.needs_review === 1,
    user_corrected: r.user_corrected === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
```

- `insertObservation`: scoate `aad`/`encryptField*`; INSERT cu coloane TEXT:

```ts
  const needsReview = input.confidence < REVIEW_THRESHOLD ? 1 : 0;
  await db.runAsync(
    `INSERT INTO medical_observations
       (id, medical_record_id, source_document_id, name, value, unit,
        ref_min, ref_max, observed_at, category, confidence,
        needs_review, user_corrected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id, input.medical_record_id, input.source_document_id, input.name, input.value,
      input.unit, input.ref_min, input.ref_max, input.observed_at, input.category,
      input.confidence, needsReview, now, now,
    ]
  );
```

- `getObservation`: `return rowToObs(row);` (fără await).
- `listObservationsByRecord` / `listObservationsBySourceDocument`: `return rows.map(rowToObs);` (scoate `Promise.all`).
- `updateObservation`: înlocuiește perechile `_enc`:
```ts
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
  if (patch.value !== undefined) { sets.push('value = ?'); params.push(patch.value); }
  if (patch.ref_min !== undefined) { sets.push('ref_min = ?'); params.push(patch.ref_min); }
  if (patch.ref_max !== undefined) { sets.push('ref_max = ?'); params.push(patch.ref_max); }
```
  (tipul `params` devine `(string | number | null)[]`). Scoate linia `const aad = ...`.

- [ ] **Step 4: Rulează testul + type-check**

Run: `npx jest medicalObservations --no-coverage && npm run type-check`
Expected: testul PASS; type-check încă poate avea erori în `medicalChat`/`cloudSync` (rezolvate următor) — `medicalObservations.ts` fără erori.

- [ ] **Step 5: Commit**

```bash
git add services/medicalObservations.ts __tests__/medicalObservations.test.ts
git commit -m "refactor(medical): observations stored as plaintext TEXT"
```

---

## Task 5: medicalChat.ts → plaintext

**Files:**
- Modify: `services/medicalChat.ts`

- [ ] **Step 1: Scoate criptarea din mesaje**

- Șterge importul (linia 18): `import { encryptField, decryptFieldOrNull } from './medicalCrypto';`.
- Șterge helperul `toBytes` (liniile ~117-121).
- `MessageRow.content_enc: Uint8Array` → `content: string`.
- În `listMessages`, înlocuiește blocul de decriptare:

```ts
  const out: MedicalChatMessage[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      thread_id: r.thread_id,
      role: r.role as MedicalChatRole,
      content: r.content,
      citations: parseCitations(r.citations_json),
      created_at: r.created_at,
    });
  }
  return out;
```
  (Poți păstra fetch-ul `medical_record_id` din thread doar dacă mai e folosit altundeva; dacă rămâne nefolosit, scoate-l ca să nu pice lint-ul.)

- În `insertMessage`, scoate `const enc = await encryptField(...)` și scrie `content`:

```ts
  await db.runAsync(
    `INSERT INTO medical_chat_messages(id, thread_id, role, content, citations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, args.thread_id, args.role, args.content, JSON.stringify(args.citations), now]
  );
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: `medicalChat.ts` fără erori (rămân doar cele din `cloudSync.ts`).

- [ ] **Step 3: Commit**

```bash
git add services/medicalChat.ts
git commit -m "refactor(medical): chat messages stored as plaintext TEXT"
```

---

## Task 6: medicalRecord.ts + CreateMedicalRecordModal.tsx

**Files:**
- Modify: `services/medicalRecord.ts`, `components/medical/CreateMedicalRecordModal.tsx`

- [ ] **Step 1: medicalRecord.ts — scoate cheia, constantă locală pentru `encryption_key_ref`**

- Înlocuiește importul (linia 16):
```ts
import { db, generateId } from './db';
```
  (scoate `import { ensureMedicalMasterKey, MEDICAL_MASTER_KEY_REF } from './medicalCrypto';`)
- Adaugă sub importuri o constantă locală:
```ts
// Coloana `encryption_key_ref` rămâne în schemă (NOT NULL) dar nu mai referă o cheie reală.
const MEDICAL_ENCRYPTION_REF = 'plaintext-v2';
```
- În `createMedicalRecord`: șterge linia `await ensureMedicalMasterKey();`.
- În INSERT (linia ~83), înlocuiește `MEDICAL_MASTER_KEY_REF` cu `MEDICAL_ENCRYPTION_REF`.

- [ ] **Step 2: CreateMedicalRecordModal.tsx — scoate cheia**

- Șterge importul (linia 13): `import { ensureMedicalMasterKey } from '@/services/medicalCrypto';`.
- Șterge linia `await ensureMedicalMasterKey();` (~linia 72).

- [ ] **Step 3: Type-check + commit**

Run: `npm run type-check`
Expected: aceleași erori reziduale doar în `cloudSync.ts`.

```bash
git add services/medicalRecord.ts components/medical/CreateMedicalRecordModal.tsx
git commit -m "refactor(medical): drop master-key bootstrap from record creation"
```

---

## Task 7: backup.ts — export + restore plaintext

**Files:**
- Modify: `services/backup.ts`

- [ ] **Step 1: Export — scoate base64 BLOB encoding**

În `exportBackup` (în jurul liniilor 163-186):
- Șterge `obsForExport` și `msgsForExport`.
- Șterge helperii `toBytes` + `blobToB64` (liniile ~164-172) **dacă nu mai sunt referiți** după edit (type-check confirmă).
- În obiectul `manifest`, schimbă:
```ts
    medicalObservations,
    medicalChatThreads,
    medicalChatMessages,
```
  (folosește direct array-urile brute `medicalObservations` / `medicalChatMessages`, acum plaintext).
- Bump versiune: `version: 15, // v15: medical observations/chat plaintext (spec 2026-06-05)`.

- [ ] **Step 2: Restore (`applyManifest`) — coloane plaintext, citire tolerantă**

În loop-ul `medicalObservations` (liniile ~862-886), înlocuiește INSERT-ul:
```ts
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_observations
          (id, medical_record_id, source_document_id, name, value, unit,
           ref_min, ref_max, observed_at, category, confidence, needs_review,
           user_corrected, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          o.id as string, o.medical_record_id as string,
          (o.source_document_id as string | null) ?? null,
          (o.name as string | null) ?? '[indisponibil]',
          (o.value as string | null) ?? null,
          (o.unit as string | null) ?? null,
          (o.ref_min as string | null) ?? null,
          (o.ref_max as string | null) ?? null,
          (o.observed_at as string | null) ?? null,
          o.category as string,
          o.confidence as number,
          o.needs_review ? 1 : 0,
          o.user_corrected ? 1 : 0,
          o.created_at as string, o.updated_at as string,
        ]
      );
```

În loop-ul `medicalChatMessages` (liniile ~906-921), înlocuiește INSERT-ul:
```ts
      await db.runAsync(
        `INSERT OR REPLACE INTO medical_chat_messages
          (id, thread_id, role, content, citations_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          m.id as string, m.thread_id as string, m.role as string,
          (m.content as string | null) ?? '[mesaj indisponibil]',
          (m.citations_json as string | null) ?? null,
          m.created_at as string,
        ]
      );
```

- Șterge helperul `b64ToBlob` (liniile ~837-838) **dacă nu mai e referit** (type-check confirmă).

> Citirea tolerantă (`?? '[indisponibil]'`) acoperă și backup-uri vechi v14 (care au `name_enc` base64, fără `name`) — fără branch de versiune și fără a pretinde decriptare.

- [ ] **Step 3: Verifică gate-ul de versiune la import**

Run: `grep -n "version" services/backup.ts | grep -iE "version >|version <|version ===|unsupported|14|15"`
Citește `importBackup` — confirmă că nu respinge `version: 15`. Dacă există un check `version > N`, ridică N la 15. (Restul formatelor rămân acceptate; nu adăuga branch nou.)

- [ ] **Step 4: Type-check + commit**

Run: `npm run type-check`
Expected: `backup.ts` fără erori.

```bash
git add services/backup.ts
git commit -m "refactor(backup): medical observations/chat exported/restored as plaintext (v15)"
```

---

## Task 8: cloudSync.ts — scoate transferul cheii, payload plaintext

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Scoate `_security` din tip + payload**

- În `ManifestPayload`, șterge câmpul `_security?: { medical_key?: string };` (linia ~80).
- În `buildManifestPayload`:
  - Șterge helperii `toBytes` + `blobToB64` (dacă definiți local pentru obs/msgs).
  - Șterge `obsForPayload` + `msgsForPayload`.
  - În obiectul `payload`, folosește direct `medicalObservations` și `medicalChatMessages` (brute, plaintext).
  - Șterge tot blocul `// 28c — optionally include encrypted medical master key` (liniile ~175-186).
- Bump `MANIFEST_VERSION` (constanta din cloudSync.ts) la următoarea valoare + comentariu `// vN: medical plaintext`.

- [ ] **Step 2: Scoate blocul de restore al cheii**

Șterge complet blocul `// 28d — restore medical master key if present in _security` (liniile ~1006-1019).

- [ ] **Step 3: Curăță importurile**

Scoate din importuri (verifică fiecare să nu mai fie folosit):
- `getCloudBackupIncludesMedicalKey` (din `./settings`)
- `hasMedicalMasterKey`, `exportMasterKeyBase64`, `importMasterKeyBase64` (din `./medicalCrypto`) — linia ~45.
- Păstrează `encryptString` / `decryptString` (folosite la criptarea manifestului).

- [ ] **Step 4: Type-check — acum TOT verde**

Run: `npm run type-check`
Expected: PASS complet (toate erorile reziduale din medicalCrypto rezolvate).

- [ ] **Step 5: Commit**

```bash
git add services/cloudSync.ts
git commit -m "refactor(cloud): remove medical key transfer; medical payload plaintext"
```

---

## Task 9: settings.ts — scoate getter/setter cheie

**Files:**
- Modify: `services/settings.ts`

- [ ] **Step 1: Șterge constanta + funcțiile**

Șterge (liniile ~244, ~257-264):
```ts
const KEY_CLOUD_BACKUP_INCLUDES_MEDICAL_KEY = 'cloud_backup_includes_medical_key';
```
```ts
export async function getCloudBackupIncludesMedicalKey(): Promise<boolean> { ... }
export async function setCloudBackupIncludesMedicalKey(enabled: boolean): Promise<void> { ... }
```

- [ ] **Step 2: Type-check + commit**

Run: `npm run type-check`
Expected: FAIL doar în `app/cloud-backup.tsx` (rezolvat în Task 10).

```bash
git add services/settings.ts
git commit -m "refactor(settings): remove cloud-backup-includes-medical-key flag"
```

---

## Task 10: cloud-backup.tsx — scoate rândul-bifă

**Files:**
- Modify: `app/cloud-backup.tsx`

- [ ] **Step 1: Scoate import, state, load, JSX, stiluri**

- Importuri (liniile ~30-31): scoate `getCloudBackupIncludesMedicalKey,` și `setCloudBackupIncludesMedicalKey,`.
- State (linia ~67): șterge `const [includeMedKey, setIncludeMedKey] = useState(false);`.
- Load effect (liniile ~91-107): scoate `getCloudBackupIncludesMedicalKey()` din `Promise.all`, scoate `medKey` din destructurare și `setIncludeMedKey(medKey);`. Rezultat:
```ts
      const [f, r, enc] = await Promise.all([
        getCloudSnapshotFrequency(),
        getCloudSnapshotRetention(),
        getCloudEncryptionEnabled(),
      ]);
      if (mountedRef.current) {
        setFreq(f);
        setRetention(r);
        setEncryptionEnabledState(enc);
        setLoaded(true);
      }
```
- JSX (liniile ~377-418): șterge tot blocul `{/* ── Cheie medicală în backup ── */}` (View + Switch + handler).
- Stiluri: șterge din `StyleSheet.create` cheile nefolosite acum: `medKeyCard`, `medKeyRow`, `medKeyTextWrap`, `medKeyLabel`, `medKeySub`.
- Dacă `Alert` / `Switch` / `primary` / `onPrimary` rămân nefolosite, scoate-le din importuri (type-check + lint confirmă).

- [ ] **Step 2: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 3: Verificare vizuală (iOS Simulator)**

Deschide ecranul Cloud Backup în simulator → confirmă că rândul „Include cheia medicală" a dispărut, restul (frecvență, retenție, criptare) intact, în light + dark.

- [ ] **Step 4: Commit**

```bash
git add app/cloud-backup.tsx
git commit -m "feat(cloud-backup): remove obsolete medical-key toggle from UI"
```

---

## Task 11: Characterization tests — BLOB → TEXT

**Files:**
- Modify: `__tests__/characterization/db.test.ts:175-189`

- [ ] **Step 1: Rescrie cele două teste**

Înlocuiește (liniile 175-189):
```ts
  it('medical_observations stores name and value as plaintext TEXT', async () => {
    const cols = await db.getAllAsync<{ name: string; type: string }>(
      'PRAGMA table_info(medical_observations)'
    );
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['name', 'value', 'ref_min', 'ref_max']));
    expect(names).not.toContain('name_enc');
  });

  it('medical_chat_messages stores content as plaintext TEXT', async () => {
    const cols = await db.getAllAsync<{ name: string; type: string }>(
      'PRAGMA table_info(medical_chat_messages)'
    );
    const names = cols.map(c => c.name);
    expect(names).toContain('content');
    expect(names).not.toContain('content_enc');
  });
```

- [ ] **Step 2: Rulează characterization**

Run: `npm run test:characterization`
Expected: PASS (45+ teste). Dacă vreun test din `db.test.ts:92-97` enumeră tabelele medical, rămâne valid (numele tabelelor nu se schimbă).

- [ ] **Step 3: Commit**

```bash
git add __tests__/characterization/db.test.ts
git commit -m "test(characterization): assert medical columns are plaintext TEXT"
```

---

## Task 12: Docs / legal / knowledge + audit final

**Files:**
- Verify/Modify: `components/settings/legalTexts.ts`, `services/appKnowledge.ts`

- [ ] **Step 1: Verifică claimuri de „criptare date medicale"**

Run: `grep -niE "cript|encrypt|cheie medical|AES" components/settings/legalTexts.ts services/appKnowledge.ts`
Pentru fiecare rezultat care promite criptarea datelor medicale la nivel de app: actualizează formularea la realitatea nouă (date medicale protejate prin App Lock + criptarea device-ului + backup criptat opțional), păstrând tonul GDPR. Nu inventa — doar aliniază la spec.

- [ ] **Step 2: Caută referințe rămase la simbolurile șterse**

Run: `grep -rniE "encryptField|exportMasterKeyBase64|importMasterKeyBase64|IncludesMedicalKey|_security|medical_key|content_enc|name_enc" services/ app/ components/ hooks/ __tests__/ | grep -v medicalKeyMigration.ts | grep -v "node_modules"`
Expected: doar `medicalCrypto.ts` (decryptField intern) și eventual comentarii. Zero importuri/uzaje active în alt cod. Rezolvă orice rămășiță.

- [ ] **Step 3: Audit complet**

Run: `npm run audit`
Expected: type-check + toate audit-urile + characterization + lint:ast verzi. În special:
- `backup-audit.js --strict` → tabelele medicale încă în export/import/wipe + cloudSync (numele neschimbate) → OK.
- `db-destructive-init-audit.js --strict` → `db.ts` nu are DROP (rebuild-ul e în `medicalKeyMigration.ts`) → OK.
- `knowledge-audit.js --strict` → OK.

- [ ] **Step 4: Test manual end-to-end (device fizic, conform rules/backup.md)**

1. Pe un device cu date medicale criptate existente (sau seed vechi): pornește app → migrarea rulează → deschide dosarul medical → Timeline + Chat afișează datele reale (decriptate), nu placeholder.
2. Backup cloud (fără parolă de criptare) → restore pe alt device → dosarul medical apare complet (observații + chat), fără cheie, fără parolă.
3. Export ZIP → reinstalare → import ZIP → date medicale prezente.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "docs(medical): align legal/knowledge wording with plaintext medical storage"
```

---

## Self-Review (rulat la scriere)

**Spec coverage:** schema (T1) ✓ · migrare one-time (T2) ✓ · cod șters medicalCrypto/cloudSync/settings/UI (T3,T8,T9,T10) ✓ · observații/chat plaintext (T4,T5) ✓ · record fără cheie (T6) ✓ · backup ZIP+cloud plaintext + version bump (T7,T8) ✓ · teste characterization (T11) ✓ · legal/knowledge wording (T12) ✓ · postură securitate (App Lock + iOS) — păstrată, nimic de implementat.

**Placeholder scan:** fără TBD/„handle edge cases" — fiecare pas are cod sau comandă concretă. Excepție conștientă: T4 Step 1 lasă implementatorului alegerea harness-ului de DB pentru un test minimal (cu instrucțiune explicită cum), pentru că forma exactă a helper-ului de test din `__tests__/characterization/` nu e fixată în acest plan.

**Type consistency:** `migrateMedicalEncToPlaintext(database?)` — semnătură unică, folosită identic în db.ts IIFE (fără arg) și test (cu arg). `MEDICAL_ENCRYPTION_REF` definit și folosit doar în medicalRecord.ts. Coloane noi `name/value/ref_min/ref_max/content` — identice în schema (T1), migrare (T2), CRUD (T4,T5), restore (T7), teste (T11).

**Ordine dependențe:** T1 (schema) → T2 (migrare, folosește decrypt) → T3 (reduce crypto, păstrează decrypt) → T4-T6 (consumatori) → T7-T8 (backup/cloud, închid type-check) → T9-T10 (settings/UI) → T11-T12 (teste/docs). Type-check redevine integral verde abia la T8 Step 4 — semnalat explicit.
