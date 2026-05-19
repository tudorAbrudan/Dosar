# Dosar Medical Merge — Implementation Plan (Faza 1: F1–F7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reintegrează `medical_record` ca `EntityType` în Dosar prin copierea servicii/hooks/componente din `/Users/ax/work/dosarMedical`, adăugarea schemei SQLite + tipurilor + ecranului detaliu cu 3 tab-uri (Timeline · Documente · Chat AI). Doctor share (F8) și polish App Store (F9) sunt într-un plan separat care va fi scris după ce acest plan e ~80% gata.

**Architecture:** Reutilizare maximă. 7 servicii medicale + 4 hooks + 4 componente + 5 ecrane se copiază bit-by-bit din `dosarMedical/app/` în `documents/app/` cu adaptări de imports (path-uri identice, deci minimale). Schema SQLite primește 7 tabele noi prin `CREATE IF NOT EXISTS` în blocul inițial `db.execSync` din `services/db.ts`. Tipurile (`EntityType`, `DocumentType`) cresc incremental.

**Tech Stack:** TypeScript strict, React Native + Expo 55, expo-sqlite cu FTS5, `@noble/ciphers` (AES-256-GCM), `expo-secure-store` (Keychain), Jest (jest-expo preset), Expo Router file-based routing.

**Spec:** `docs/superpowers/specs/2026-05-19-dosar-medical-merge-design.md`

**Plan separat (viitor):** Faza 2 = F8 (doctor share: Cloudflare Worker + R2 + viewer static) + F9 (polish App Store + privacy policy). Acel plan se va scrie după ce F4 e funcțional.

---

## File Map (overview)

### Fișiere noi (`app/services/`)
- `medicalCrypto.ts` — copy din DosarMedical
- `medicalRecord.ts` — copy + adaptare la multi-entity context
- `medicalObservations.ts` — copy
- `medicalFts.ts` — copy
- `medicalExtractor.ts` — copy + verificare aiProvider import
- `medicalChat.ts` — copy
- `medicalQueryAnalysis.ts` — copy
- `medicalChatThreads.ts` — copy din DosarMedical (`chatThreads.ts`), redenumit ca să nu intre în coliziune cu `chatThreads.ts` general din Dosar

### Fișiere noi (`app/hooks/`)
- `useMedicalRecord.ts` — copy
- `useMedicalObservations.ts` — copy
- `useMedicalChat.ts` — copy
- `useMedicalLock.ts` — copy

### Fișiere noi (`app/components/medical/`)
- `CreateMedicalRecordModal.tsx` — copy
- `MedicalChatBubble.tsx` — copy
- `MedicalConsentModal.tsx` — copy
- `ObservationSparkline.tsx` — copy

### Ecrane noi (`app/app/(tabs)/entitati/medical/`)
- `[id]/index.tsx` — detaliu dosar (3 tab-uri)
- `[id]/review.tsx` — review observații needs_review
- `_tabs/DocumenteTab.tsx` — copy
- `_tabs/TimelineTab.tsx` — copy
- `_tabs/ChatTab.tsx` — copy

### Fișiere modificate
- `app/types/index.ts` — `EntityType` += `medical_record`; 6 tipuri medicale; interfețe TS
- `app/services/db.ts` — 7 CREATE TABLE blocks + FTS5 + triggers
- `app/services/documents.ts` — trigger `medicalExtractor.extractAsync()` la addDocument cu tip medical
- `app/services/backup.ts` — `exportBackup` + `applyManifest` includ medical_*
- `app/services/cloudSync.ts` — `buildManifestPayload` include medical_*
- `app/services/appKnowledge.ts` — DOC_CATEGORIES + secțiune medical
- `app/hooks/useEntities.ts` — `medicalRecords` state + load + resolveEntityName
- `app/app/(tabs)/setari.tsx` — toggle „Date medicale", backup cheie, App Lock medical
- `app/app/(tabs)/entitati/_layout.tsx` — register medical sub-route
- `app/app/(tabs)/documente/add.tsx` — picker entități include medical_records
- `app/components/OnboardingWizard.tsx` — pas opțional medical
- `app/scripts/backup-audit.js` — `TABLE_TO_MANIFEST_FIELD` medical_*
- `app/scripts/update-site.js` — `EMOJI_MAP` cele 6 tipuri medicale

### Teste noi (`app/__tests__/services/`)
- `medicalCrypto.test.ts` — encrypt/decrypt roundtrip
- `medicalRecord.test.ts` — CRUD smoke
- `medicalObservations.test.ts` — insert + query timeline
- `db.medical.test.ts` — migrare creează toate tabelele

---

## Faza F1: Types + Schema SQLite

### Task 1: Adaugă `medical_record` ca EntityType

**Files:**
- Modify: `app/types/index.ts`

- [ ] **Step 1: Adaugă `'medical_record'` în uniunea `EntityType`**

În `app/types/index.ts`, găsește definiția `EntityType` (în jur de linia 216) și adaugă `'medical_record'`:

```ts
export type EntityType =
  | 'person'
  | 'property'
  | 'vehicle'
  | 'card'
  | 'animal'
  | 'company'
  | 'medical_record';
```

- [ ] **Step 2: Adaugă în `ALL_ENTITY_TYPES` la finalul listei**

```ts
export const ALL_ENTITY_TYPES: EntityType[] = [
  'person',
  'vehicle',
  'property',
  'card',
  'animal',
  'company',
  'medical_record',
];
```

- [ ] **Step 3: Adaugă în `ENTITY_TYPE_LABELS`**

```ts
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  property: 'Proprietate',
  vehicle: 'Vehicul',
  card: 'Card',
  animal: 'Animal',
  company: 'Firmă',
  medical_record: 'Dosar medical',
};
```

- [ ] **Step 4: Adaugă în `ENTITY_TYPE_EMOJI`**

```ts
export const ENTITY_TYPE_EMOJI: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
  company: '🏢',
  medical_record: '🏥',
};
```

- [ ] **Step 5: Type-check**

Din folderul `app/`: `npm run type-check`
Expected: 0 erori. **Atenție:** vor apărea erori în alte fișiere (`hooks/useEntities.ts`, `app/(tabs)/entitati/*`) pentru că nu mai sunt exhaustive pe `Record<EntityType, ...>`. Asta e OK pentru acest task — le rezolvăm în Task 2.

Dacă apar erori care NU sunt legate de exhaustive Record, oprește-te și raportează.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add medical_record as EntityType"
```

---

### Task 2: Adaugă cele 6 tipuri medicale în `DocumentType`

**Files:**
- Modify: `app/types/index.ts`

- [ ] **Step 1: Extinde uniunea `DocumentType`**

În `app/types/index.ts` (linia 1), adaugă cele 6 tipuri înainte de `'altul'`:

```ts
export type DocumentType =
  // ... existente
  | 'asigurare_personala'
  // ↓ NOU
  | 'reteta_medicala'
  | 'analize_medicale'
  | 'scrisoare_medicala'
  | 'bilet_externare'
  | 'imagistica'
  | 'vaccin_persoana'
  // ↑ NOU
  | 'diploma'
  // ... continuă
  | 'altul'
  | 'custom';
```

- [ ] **Step 2: Adaugă în `STANDARD_DOC_TYPES`**

Plasează cele 6 tipuri grupat (după blocul „Identitate / Acte civile", înainte de „Vehicule"):

```ts
export const STANDARD_DOC_TYPES: DocumentType[] = [
  // ... existente
  'card_sanatate',
  // Medical (NOU)
  'reteta_medicala',
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'vaccin_persoana',
  // Vehicule
  'talon',
  // ... continuă
];
```

- [ ] **Step 3: Adaugă în `DOCUMENT_TYPE_LABELS`**

```ts
reteta_medicala: 'Rețetă medicală',
analize_medicale: 'Analize medicale',
scrisoare_medicala: 'Scrisoare medicală',
bilet_externare: 'Bilet de externare',
imagistica: 'Imagistică',
vaccin_persoana: 'Vaccin',
```

- [ ] **Step 4: Adaugă `MEDICAL_DOC_TYPES` set**

După `REPEATABLE_DOC_TYPES`, adaugă:

```ts
/**
 * Tipuri de documente medicale (categoria specială Art. 9 GDPR).
 * Folosit pentru: filtrarea picker-ului în detaliu medical_record,
 * triggering medicalExtractor.extractAsync, sanitizare AI privacy.
 */
export const MEDICAL_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  'reteta_medicala',
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'vaccin_persoana',
]);
```

- [ ] **Step 5: Adaugă `REPEATABLE_DOC_TYPES` pentru medical**

În setul existent `REPEATABLE_DOC_TYPES`, adaugă (analize, vaccinuri se repetă):

```ts
  // Medical — analize lunare, vaccin reînnoit
  'analize_medicale',
  'vaccin_persoana',
  'imagistica',
  'reteta_medicala',
```

- [ ] **Step 6: Adaugă în `ENTITY_DOCUMENT_TYPES` pentru `medical_record`**

```ts
export const ENTITY_DOCUMENT_TYPES: Record<EntityType, DocumentType[]> = {
  // ... existente
  medical_record: [
    'reteta_medicala',
    'analize_medicale',
    'scrisoare_medicala',
    'bilet_externare',
    'imagistica',
    'vaccin_persoana',
    'card_sanatate',  // util și aici
    'altul',
    'custom',
  ],
};
```

- [ ] **Step 7: Adaugă în `DOC_PRIMARY_ENTITY` pentru cele 6 tipuri**

```ts
export const DOC_PRIMARY_ENTITY: Partial<Record<DocumentType, EntityType>> = {
  // ... existente
  reteta_medicala: 'medical_record',
  analize_medicale: 'medical_record',
  scrisoare_medicala: 'medical_record',
  bilet_externare: 'medical_record',
  imagistica: 'medical_record',
  vaccin_persoana: 'medical_record',
};
```

- [ ] **Step 8: Type-check**

`npm run type-check` din `app/`
Expected: erori exhaustive pe Record<DocumentType, ...> rezolvate prin step 3 + 7. Rămân erori de exhaustive doar pentru `Record<EntityType, ...>` în alte fișiere — OK.

- [ ] **Step 9: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add 6 medical DocumentTypes + MEDICAL_DOC_TYPES set"
```

---

### Task 3: Adaugă interfețele TS medicale

**Files:**
- Modify: `app/types/index.ts`

- [ ] **Step 1: Adaugă interfețele după `Company`**

Plasează blocul după `export interface Company { ... }`:

```ts
// ─── Medical (Art. 9 GDPR) ────────────────────────────────────────────────────

export interface MedicalRecord {
  id: string;
  person_id: string;          // FK la persons; 1:1 strict
  name: string;
  ai_consent_at: string | null;
  ai_consent_version: number;
  encryption_key_ref: string; // ex: 'v1'
  created_at: string;
  updated_at: string;
}

export type ObservationCategory =
  | 'lipide'
  | 'hematologie'
  | 'tiroidiene'
  | 'hormonal'
  | 'hepatice'
  | 'renale'
  | 'urinare'
  | 'microbiologie'
  | 'imunologie'
  | 'biochimie';

export const OBSERVATION_CATEGORIES: ObservationCategory[] = [
  'lipide',
  'hematologie',
  'tiroidiene',
  'hormonal',
  'hepatice',
  'renale',
  'urinare',
  'microbiologie',
  'imunologie',
  'biochimie',
];

export const OBSERVATION_CATEGORY_LABELS: Record<ObservationCategory, string> = {
  lipide: 'Lipide',
  hematologie: 'Hematologie',
  tiroidiene: 'Tiroidiene',
  hormonal: 'Hormonal',
  hepatice: 'Hepatice',
  renale: 'Renale',
  urinare: 'Urinare',
  microbiologie: 'Microbiologie',
  imunologie: 'Imunologie',
  biochimie: 'Biochimie',
};

export interface MedicalObservation {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  name: string;              // decriptat
  value: string | null;      // decriptat; string ca să accepte "pozitiv"/"negativ" + numeric
  unit: string | null;       // plaintext
  ref_min: string | null;    // decriptat
  ref_max: string | null;    // decriptat
  observed_at: string | null; // plaintext (sortare)
  category: ObservationCategory;
  confidence: number;
  needs_review: boolean;
  created_at: string;
}

export interface MedicalChatThread {
  id: string;
  medical_record_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  type: 'OBS' | 'DOC';
  id: string;
  doc_type?: DocumentType;
}

export interface MedicalChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;          // decriptat
  citations: Citation[];
  created_at: string;
}

export interface MedicalDocumentSummary {
  document_id: string;
  summary: string;
  generated_at: string;
  model_used: string | null;
}

export interface MedicalShare {
  id: string;
  medical_record_id: string;
  created_at: string;
  expires_at: string;
  size_bytes: number;
  doc_count: number;
  obs_count: number;
  revoked_at: string | null;
}
```

- [ ] **Step 2: Type-check**

`npm run type-check`
Expected: 0 erori legate de tipurile noi. Persistă erorile exhaustive pe alte locuri (rezolvate de F3-F6).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add medical TS interfaces (MedicalRecord, Observation, ChatThread, Message, Share)"
```

---

### Task 4: Migrare DB — 7 tabele medicale + FTS5

**Files:**
- Modify: `app/services/db.ts`
- Create: `app/__tests__/services/db.medical.test.ts`

Strategie: medical tables sunt **noi pentru toate device-urile** (n-au existat în Dosar dinainte de split). Adăugăm `CREATE TABLE IF NOT EXISTS` în blocul principal `db.execSync()` (după `cloud_pending_deletes`). FTS5 și trigger-ii rămân acolo.

- [ ] **Step 1: Scrie testul de migrare**

Crează `app/__tests__/services/db.medical.test.ts`:

```ts
import { db } from '@/services/db';

describe('medical schema migration', () => {
  it('creates all medical tables', () => {
    const tables = db
      .getAllSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name LIKE 'medical_%'`
      )
      .map(r => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'medical_record',
        'medical_observations',
        'medical_chat_threads',
        'medical_chat_messages',
        'medical_document_summaries',
        'medical_fts',
        'medical_shares',
      ])
    );
  });

  it('creates FTS5 triggers', () => {
    const triggers = db
      .getAllSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'medical_fts_%'`
      )
      .map(r => r.name);
    expect(triggers.length).toBeGreaterThanOrEqual(3);
  });

  it('has correct indexes', () => {
    const indexes = db
      .getAllSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_med%'`
      )
      .map(r => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_medrec_person',
        'idx_medobs_record',
        'idx_medobs_observed_at',
        'idx_medobs_category',
        'idx_medmsg_thread',
        'idx_medshares_record',
        'idx_medshares_expires',
      ])
    );
  });
});
```

- [ ] **Step 2: Rulează testul — confirmă că eșuează**

`npx jest __tests__/services/db.medical.test.ts`
Expected: FAIL — tabelele nu există.

- [ ] **Step 3: Adaugă blocurile CREATE în `db.ts`**

În `app/services/db.ts`, în interiorul `db.execSync(\`...\`)` inițial, după blocul `cloud_pending_deletes`, înainte de `;` final, adaugă:

```sql
  CREATE TABLE IF NOT EXISTS medical_record (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL UNIQUE REFERENCES persons(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ai_consent_at TEXT,
    ai_consent_version INTEGER DEFAULT 1,
    encryption_key_ref TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_medrec_person ON medical_record(person_id);

  CREATE TABLE IF NOT EXISTS medical_observations (
    id TEXT PRIMARY KEY,
    medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
    source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    name_enc BLOB NOT NULL,
    value_enc BLOB,
    unit TEXT,
    ref_min_enc BLOB,
    ref_max_enc BLOB,
    observed_at TEXT,
    category TEXT NOT NULL,
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_medobs_record ON medical_observations(medical_record_id);
  CREATE INDEX IF NOT EXISTS idx_medobs_observed_at ON medical_observations(observed_at);
  CREATE INDEX IF NOT EXISTS idx_medobs_category ON medical_observations(category);

  CREATE TABLE IF NOT EXISTS medical_chat_threads (
    id TEXT PRIMARY KEY,
    medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medical_chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES medical_chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content_enc BLOB NOT NULL,
    citations_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_medmsg_thread ON medical_chat_messages(thread_id);

  CREATE TABLE IF NOT EXISTS medical_document_summaries (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    model_used TEXT
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS medical_fts USING fts5(
    document_id UNINDEXED,
    medical_record_id UNINDEXED,
    chunk_type,
    chunk_text,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS medical_fts_summary_ai
  AFTER INSERT ON medical_document_summaries BEGIN
    INSERT INTO medical_fts(document_id, medical_record_id, chunk_type, chunk_text)
    VALUES (new.document_id, '', 'summary', new.summary);
  END;

  CREATE TRIGGER IF NOT EXISTS medical_fts_summary_au
  AFTER UPDATE ON medical_document_summaries BEGIN
    DELETE FROM medical_fts WHERE document_id = old.document_id AND chunk_type = 'summary';
    INSERT INTO medical_fts(document_id, medical_record_id, chunk_type, chunk_text)
    VALUES (new.document_id, '', 'summary', new.summary);
  END;

  CREATE TRIGGER IF NOT EXISTS medical_fts_summary_ad
  AFTER DELETE ON medical_document_summaries BEGIN
    DELETE FROM medical_fts WHERE document_id = old.document_id AND chunk_type = 'summary';
  END;

  CREATE TABLE IF NOT EXISTS medical_shares (
    id TEXT PRIMARY KEY,
    medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    doc_count INTEGER NOT NULL,
    obs_count INTEGER NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_medshares_record ON medical_shares(medical_record_id);
  CREATE INDEX IF NOT EXISTS idx_medshares_expires ON medical_shares(expires_at);
```

- [ ] **Step 4: Rulează testul — confirmă PASS**

`npx jest __tests__/services/db.medical.test.ts`
Expected: PASS (3 teste verzi).

- [ ] **Step 5: Verifică pe device fizic / simulator**

Dacă ai simulator iOS pornit: `npm run ios`. Așteaptă app să pornească. Deschide log-urile (`npm start` într-un alt terminal) — caută erori SQLite. Niciuna nu trebuie să apară pentru migrare.

Dacă apare eroare „table medical_record already exists" pe un device cu DB vechi → asta NU se întâmplă (IF NOT EXISTS). Dacă apare altă eroare SQL — oprește-te și raportează.

- [ ] **Step 6: Commit**

```bash
git add services/db.ts __tests__/services/db.medical.test.ts
git commit -m "feat(db): add medical schema (7 tables + FTS5 + triggers)"
```

---

### Task 5: Update scripturi audit + site

**Files:**
- Modify: `app/scripts/backup-audit.js`
- Modify: `app/scripts/update-site.js`

- [ ] **Step 1: Adaugă medical tables în backup-audit `TABLE_TO_MANIFEST_FIELD`**

În `app/scripts/backup-audit.js`, caută `const TABLE_TO_MANIFEST_FIELD = {`. Adaugă la final:

```js
const TABLE_TO_MANIFEST_FIELD = {
  // ... existente
  medical_record: 'medicalRecords',
  medical_observations: 'medicalObservations',
  medical_chat_threads: 'medicalChatThreads',
  medical_chat_messages: 'medicalChatMessages',
  medical_document_summaries: 'medicalDocumentSummaries',
  medical_shares: 'medicalShares',
  // medical_fts NU se backup-ează (reconstruită la restore)
};
```

- [ ] **Step 2: Adaugă cele 6 tipuri în `update-site.js` `EMOJI_MAP`**

În `app/scripts/update-site.js`, caută `const EMOJI_MAP = {`. Adaugă:

```js
const EMOJI_MAP = {
  // ... existente
  reteta_medicala: '💊',
  analize_medicale: '🔬',
  scrisoare_medicala: '📋',
  bilet_externare: '🏥',
  imagistica: '🩻',
  vaccin_persoana: '💉',
};
```

- [ ] **Step 3: Rulează audit-urile**

```bash
npm run type-check
node scripts/backup-audit.js
node scripts/check-hardcoded-entities.js
node scripts/update-site.js
```

Expected: backup-audit raportează tabele medical lipsă din `backup.ts` și `cloudSync.ts` — **asta e normal pentru moment**, le rezolvăm în F7 (Task 30-31). Toate celelalte verzi.

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-audit.js scripts/update-site.js docs/ README.md
git commit -m "chore(scripts): register medical tables in audit + site EMOJI_MAP"
```

---

## Faza F2: Copy servicii medicale din DosarMedical

### Task 6: Copy `medicalCrypto.ts` + test

**Files:**
- Create: `app/services/medicalCrypto.ts` (sursa: `/Users/ax/work/dosarMedical/app/services/medicalCrypto.ts`)
- Create: `app/__tests__/services/medicalCrypto.test.ts`

- [ ] **Step 1: Copiază fișierul**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalCrypto.ts \
   /Users/ax/work/documents/app/services/medicalCrypto.ts
```

- [ ] **Step 2: Verifică importurile**

Deschide noul fișier. Confirmă că folosește doar:
- `@noble/ciphers/aes` (există în package.json Dosar)
- `@noble/hashes/pbkdf2` (există)
- `@noble/hashes/sha2` (există)
- `expo-secure-store` (există)

Dacă vreun import e altfel, ajustează la path-urile Dosar (în acest caz nu ar trebui — sunt identice).

- [ ] **Step 3: Scrie testul de roundtrip**

Crează `app/__tests__/services/medicalCrypto.test.ts`:

```ts
import { encryptField, decryptField, getOrCreateMedicalKey } from '@/services/medicalCrypto';

describe('medicalCrypto', () => {
  it('encrypts and decrypts roundtrip', async () => {
    const aad = 'test-record-id-123';
    const plaintext = 'HDL: 62 mg/dL';
    const encrypted = await encryptField(plaintext, aad);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);

    const decrypted = await decryptField(encrypted, aad);
    expect(decrypted).toBe(plaintext);
  });

  it('decryption fails with wrong AAD', async () => {
    const encrypted = await encryptField('secret', 'aad-1');
    await expect(decryptField(encrypted, 'aad-2')).rejects.toThrow();
  });

  it('getOrCreateMedicalKey returns stable key on repeated calls', async () => {
    const key1 = await getOrCreateMedicalKey();
    const key2 = await getOrCreateMedicalKey();
    expect(key1).toEqual(key2);
  });
});
```

- [ ] **Step 4: Rulează testul**

`npx jest __tests__/services/medicalCrypto.test.ts`
Expected: PASS (3 teste). Dacă pică `getOrCreateMedicalKey` din cauza mock-ului `expo-secure-store`, verifică `__mocks__/expo-secure-store.ts` — există deja în Dosar.

- [ ] **Step 5: Commit**

```bash
git add services/medicalCrypto.ts __tests__/services/medicalCrypto.test.ts
git commit -m "feat(medical): copy medicalCrypto.ts (AES-256-GCM + Keychain)"
```

---

### Task 7: Copy `medicalRecord.ts` + test smoke

**Files:**
- Create: `app/services/medicalRecord.ts` (sursa: `dosarMedical/app/services/medicalRecord.ts`)
- Create: `app/__tests__/services/medicalRecord.test.ts`

- [ ] **Step 1: Copiază fișierul**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalRecord.ts \
   /Users/ax/work/documents/app/services/medicalRecord.ts
```

- [ ] **Step 2: Verifică adaptările necesare**

Deschide noul fișier. În DosarMedical, `medicalRecord` era singletonul app-ului. În Dosar, e o entitate printre altele. Caută orice referință la „singleton" sau asumpții că există un singur dosar — dacă există, ajustează:

- Funcția `getMedicalRecordByPersonId(personId: string)` — trebuie să rămână (1:1 cu persoană).
- Funcția `listMedicalRecords()` — trebuie să existe (pentru tab listă entități).
- `getDefaultMedicalRecord()` — dacă există, scoate-o; nu mai are sens.

Așteptarea minimă: API public include `createMedicalRecord`, `getMedicalRecord`, `listMedicalRecords`, `updateMedicalRecord`, `deleteMedicalRecord`, `setAiConsent`.

- [ ] **Step 3: Type-check**

`npm run type-check`
Expected: 0 erori în `medicalRecord.ts`.

- [ ] **Step 4: Scrie testul smoke**

Crează `app/__tests__/services/medicalRecord.test.ts`:

```ts
import { db } from '@/services/db';
import { createMedicalRecord, getMedicalRecord, listMedicalRecords, setAiConsent } from '@/services/medicalRecord';

describe('medicalRecord CRUD', () => {
  const testPersonId = 'test-person-' + Date.now();

  beforeAll(() => {
    db.runSync(
      `INSERT INTO persons (id, name, created_at) VALUES (?, 'Test Person', ?)`,
      [testPersonId, new Date().toISOString()]
    );
  });

  afterAll(() => {
    db.runSync(`DELETE FROM medical_record WHERE person_id = ?`, [testPersonId]);
    db.runSync(`DELETE FROM persons WHERE id = ?`, [testPersonId]);
  });

  it('creates and retrieves a medical record', async () => {
    const id = await createMedicalRecord({ person_id: testPersonId, name: 'Dosar test' });
    const record = await getMedicalRecord(id);
    expect(record).toBeTruthy();
    expect(record!.name).toBe('Dosar test');
    expect(record!.ai_consent_at).toBeNull();
  });

  it('lists records', async () => {
    const all = await listMedicalRecords();
    expect(all.some(r => r.person_id === testPersonId)).toBe(true);
  });

  it('setAiConsent records timestamp', async () => {
    const records = await listMedicalRecords();
    const r = records.find(r => r.person_id === testPersonId)!;
    await setAiConsent(r.id);
    const updated = await getMedicalRecord(r.id);
    expect(updated!.ai_consent_at).toBeTruthy();
  });
});
```

- [ ] **Step 5: Rulează testul**

`npx jest __tests__/services/medicalRecord.test.ts`
Expected: PASS (3 teste).

- [ ] **Step 6: Commit**

```bash
git add services/medicalRecord.ts __tests__/services/medicalRecord.test.ts
git commit -m "feat(medical): copy medicalRecord.ts + smoke tests"
```

---

### Task 8: Copy `medicalObservations.ts` + test

**Files:**
- Create: `app/services/medicalObservations.ts` (sursa: `dosarMedical/app/services/medicalObservations.ts`)
- Create: `app/__tests__/services/medicalObservations.test.ts`

- [ ] **Step 1: Copiază**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalObservations.ts \
   /Users/ax/work/documents/app/services/medicalObservations.ts
```

- [ ] **Step 2: Verifică importurile** — toate din `@/services/db`, `@/services/medicalCrypto`, `@/types`. Niciunul nu trebuie ajustat.

- [ ] **Step 3: Type-check**

`npm run type-check`
Expected: 0 erori.

- [ ] **Step 4: Scrie testul**

Crează `app/__tests__/services/medicalObservations.test.ts`:

```ts
import { db } from '@/services/db';
import { createMedicalRecord } from '@/services/medicalRecord';
import { insertObservation, listObservationsByRecord, listObservationsByName } from '@/services/medicalObservations';

describe('medicalObservations', () => {
  let recordId: string;
  const personId = 'test-person-obs-' + Date.now();

  beforeAll(async () => {
    db.runSync(
      `INSERT INTO persons (id, name, created_at) VALUES (?, 'Test', ?)`,
      [personId, new Date().toISOString()]
    );
    recordId = await createMedicalRecord({ person_id: personId, name: 'Test record' });
  });

  afterAll(() => {
    db.runSync(`DELETE FROM medical_observations WHERE medical_record_id = ?`, [recordId]);
    db.runSync(`DELETE FROM medical_record WHERE id = ?`, [recordId]);
    db.runSync(`DELETE FROM persons WHERE id = ?`, [personId]);
  });

  it('inserts and retrieves a decrypted observation', async () => {
    await insertObservation({
      medical_record_id: recordId,
      source_document_id: null,
      name: 'HDL',
      value: '62',
      unit: 'mg/dL',
      ref_min: '40',
      ref_max: '80',
      observed_at: '2026-04-15',
      category: 'lipide',
      confidence: 0.92,
      needs_review: false,
    });
    const list = await listObservationsByRecord(recordId);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('HDL');
    expect(list[0].value).toBe('62');
    expect(list[0].unit).toBe('mg/dL');
  });

  it('groups observations by name (Timeline use-case)', async () => {
    await insertObservation({
      medical_record_id: recordId,
      source_document_id: null,
      name: 'HDL',
      value: '68',
      unit: 'mg/dL',
      ref_min: '40',
      ref_max: '80',
      observed_at: '2026-05-10',
      category: 'lipide',
      confidence: 0.88,
      needs_review: false,
    });
    const series = await listObservationsByName(recordId, 'HDL');
    expect(series.length).toBe(2);
    expect(series.map(o => o.value)).toEqual(expect.arrayContaining(['62', '68']));
  });
});
```

- [ ] **Step 5: Rulează testul**

`npx jest __tests__/services/medicalObservations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/medicalObservations.ts __tests__/services/medicalObservations.test.ts
git commit -m "feat(medical): copy medicalObservations.ts + smoke tests"
```

---

### Task 9: Copy `medicalFts.ts`

**Files:**
- Create: `app/services/medicalFts.ts` (sursa: `dosarMedical/app/services/medicalFts.ts`)

- [ ] **Step 1: Copiază**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalFts.ts \
   /Users/ax/work/documents/app/services/medicalFts.ts
```

- [ ] **Step 2: Type-check**

`npm run type-check`
Expected: 0 erori.

- [ ] **Step 3: Commit**

```bash
git add services/medicalFts.ts
git commit -m "feat(medical): copy medicalFts.ts (FTS5 indexer for OCR + summaries)"
```

---

### Task 10: Copy `medicalQueryAnalysis.ts`

**Files:**
- Create: `app/services/medicalQueryAnalysis.ts`

- [ ] **Step 1: Copiază**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalQueryAnalysis.ts \
   /Users/ax/work/documents/app/services/medicalQueryAnalysis.ts
```

- [ ] **Step 2: Type-check**

`npm run type-check`
Expected: 0 erori.

- [ ] **Step 3: Commit**

```bash
git add services/medicalQueryAnalysis.ts
git commit -m "feat(medical): copy medicalQueryAnalysis.ts (NL → retrieval hints)"
```

---

### Task 11: Copy `medicalExtractor.ts` + verifică aiProvider

**Files:**
- Create: `app/services/medicalExtractor.ts`

- [ ] **Step 1: Copiază**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalExtractor.ts \
   /Users/ax/work/documents/app/services/medicalExtractor.ts
```

- [ ] **Step 2: Compară `aiProvider.ts` între cele două repos**

```bash
diff /Users/ax/work/dosarMedical/app/services/aiProvider.ts \
     /Users/ax/work/documents/app/services/aiProvider.ts | head -40
```

Verifică că semnătura `sendAiRequest` / `sendAiRequestStructured` e identică. Dacă diferă (Dosar are funcții noi sau parametri diferiți), ajustează `medicalExtractor.ts` să folosească API-ul din Dosar.

- [ ] **Step 3: Verifică că `getDocumentsForAI` / `sanitizeDocumentForAI` din `services/documents.ts` Dosar au aceeași semnătură ca în DosarMedical**

```bash
grep -A 5 "sanitizeDocumentForAI\|getDocumentsForAI" \
  /Users/ax/work/documents/app/services/documents.ts | head -30
```

`medicalExtractor.ts` trebuie să folosească exclusiv `sanitizeDocumentForAI` din services Dosar. Confirmă că importul `from '@/services/documents'` rezolvă corect.

- [ ] **Step 4: Type-check**

`npm run type-check`
Expected: 0 erori. Dacă apar erori legate de aiProvider — ajustează apelurile la API-ul Dosar.

- [ ] **Step 5: Commit**

```bash
git add services/medicalExtractor.ts
git commit -m "feat(medical): copy medicalExtractor.ts (LLM pipeline cu confidence threshold)"
```

---

### Task 12: Copy `medicalChat.ts` + redenumire `chatThreads.ts` → `medicalChatThreads.ts`

**Files:**
- Create: `app/services/medicalChat.ts`
- Create: `app/services/medicalChatThreads.ts` (sursa: `dosarMedical/app/services/chatThreads.ts`)

- [ ] **Step 1: Copiază `medicalChat.ts`**

```bash
cp /Users/ax/work/dosarMedical/app/services/medicalChat.ts \
   /Users/ax/work/documents/app/services/medicalChat.ts
```

- [ ] **Step 2: Copiază `chatThreads.ts` (din DosarMedical, care e specific medical) ca `medicalChatThreads.ts`**

```bash
cp /Users/ax/work/dosarMedical/app/services/chatThreads.ts \
   /Users/ax/work/documents/app/services/medicalChatThreads.ts
```

Așa eviți coliziunea cu `chatThreads.ts` general din Dosar (chatbot global).

- [ ] **Step 3: Update imports în `medicalChat.ts`**

În `app/services/medicalChat.ts`, înlocuiește orice import:
```ts
from '@/services/chatThreads'
```
cu:
```ts
from '@/services/medicalChatThreads'
```

(Verifică cu `grep "chatThreads" app/services/medicalChat.ts`.)

- [ ] **Step 4: Type-check**

`npm run type-check`
Expected: 0 erori.

- [ ] **Step 5: Commit**

```bash
git add services/medicalChat.ts services/medicalChatThreads.ts
git commit -m "feat(medical): copy medicalChat.ts + rename chatThreads → medicalChatThreads"
```

---

## Faza F3: Hooks + Components

### Task 13: Copy cele 4 hooks medicale

**Files:**
- Create: `app/hooks/useMedicalRecord.ts`
- Create: `app/hooks/useMedicalObservations.ts`
- Create: `app/hooks/useMedicalChat.ts`
- Create: `app/hooks/useMedicalLock.ts`

- [ ] **Step 1: Copiază în batch**

```bash
for f in useMedicalRecord useMedicalObservations useMedicalChat useMedicalLock; do
  cp /Users/ax/work/dosarMedical/app/hooks/${f}.ts \
     /Users/ax/work/documents/app/hooks/${f}.ts
done
```

- [ ] **Step 2: Verifică imports**

```bash
grep -E "from '@/services|from '@/types|from '@/hooks" \
  /Users/ax/work/documents/app/hooks/useMedical*.ts | head -30
```

Confirmă că toate path-urile rezolvă. Dacă `useMedicalChat` importă `chatThreads`, ajustează la `medicalChatThreads`.

- [ ] **Step 3: Type-check**

`npm run type-check`
Expected: 0 erori.

- [ ] **Step 4: Verifică hook pattern Dosar** (loading/error/refresh)

Fiecare hook trebuie să expună `{ loading, error, refresh }`. Verifică manual; dacă lipsește în vreunul, adaugă (de obicei e deja prezent).

- [ ] **Step 5: Commit**

```bash
git add hooks/useMedicalRecord.ts hooks/useMedicalObservations.ts hooks/useMedicalChat.ts hooks/useMedicalLock.ts
git commit -m "feat(medical): copy 4 medical hooks (record, observations, chat, lock)"
```

---

### Task 14: Copy componente medical/

**Files:**
- Create: `app/components/medical/CreateMedicalRecordModal.tsx`
- Create: `app/components/medical/MedicalChatBubble.tsx`
- Create: `app/components/medical/MedicalConsentModal.tsx`
- Create: `app/components/medical/ObservationSparkline.tsx`

- [ ] **Step 1: Crează folderul + copiază**

```bash
mkdir -p /Users/ax/work/documents/app/components/medical
cp /Users/ax/work/dosarMedical/app/components/medical/*.tsx \
   /Users/ax/work/documents/app/components/medical/
```

- [ ] **Step 2: Verifică `useColorScheme` din import corect**

```bash
grep "useColorScheme" /Users/ax/work/documents/app/components/medical/*.tsx
```

Toate trebuie să folosească `from '@/components/useColorScheme'`, NU `from 'react-native'`. Dacă vreuna folosește varianta greșită — fix-ăm.

- [ ] **Step 3: Type-check**

`npm run type-check`
Expected: 0 erori. Dacă pică pe `FormSheetModal` etc — verifică că Dosar are componenta în `components/ui/` (există: vezi `npm ls`).

- [ ] **Step 4: Commit**

```bash
git add components/medical/
git commit -m "feat(medical): copy 4 medical components (modal-uri, bubble, sparkline)"
```

---

### Task 15: Update `useEntities` să încarce `medical_record`

**Files:**
- Modify: `app/hooks/useEntities.ts`

- [ ] **Step 1: Citește implementarea curentă**

Deschide `app/hooks/useEntities.ts`. Identifică:
- State pentru fiecare EntityType (`persons`, `properties`, `vehicles`, `cards`, `animals`, `companies`)
- `Promise.all` în `refresh()` care le încarcă pe toate
- `resolveEntityName(link: DocumentEntityLink): string`
- Object-ul de return

- [ ] **Step 2: Adaugă state pentru `medicalRecords`**

```ts
const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([]);
```

(Importă `MedicalRecord` din `@/types` și `listMedicalRecords` din `@/services/medicalRecord` cu un alias adecvat dacă există ambiguitate.)

- [ ] **Step 3: Adaugă în `Promise.all`-ul din `refresh`**

```ts
const [/* ... existente */, mr] = await Promise.all([
  /* ... existente */,
  listMedicalRecords(),
]);
setMedicalRecords(mr);
```

- [ ] **Step 4: Update `resolveEntityName`**

Adaugă case pentru `medical_record`:

```ts
case 'medical_record': {
  const r = medicalRecords.find(x => x.id === link.entityId);
  if (!r) return link.entityId;
  // Compus: numele dosarului + numele persoanei (pentru contextul vizual)
  const p = persons.find(x => x.id === r.person_id);
  return p ? `${r.name} (${p.name})` : r.name;
}
```

- [ ] **Step 5: Adaugă în return**

```ts
return {
  // ... existente
  medicalRecords,
  refresh,
  resolveEntityName,
  // ...
};
```

- [ ] **Step 6: Type-check**

`npm run type-check`
Expected: 0 erori pe useEntities. Toate consumatorii rămân backward-compat (medicalRecords e opțional pentru cei care nu îl citesc).

- [ ] **Step 7: Commit**

```bash
git add hooks/useEntities.ts
git commit -m "feat(useEntities): load medical_records + resolveEntityName case"
```

---

### Task 16: Run audit scripts — verifică curățenie

**Files:** niciun fișier modificat — doar validare.

- [ ] **Step 1: Rulează toate audit-urile**

```bash
npm run audit
```

Așteptat: TOT verde (type-check + backup-audit + hardcoded entities + knowledge + update-site).
**Excepție acceptată:** backup-audit raportează tabele medical lipsă din `backup.ts` / `cloudSync.ts` — îl rezolvăm în Task 30-31.

- [ ] **Step 2: Dacă apar erori de hardcoded entities**

Cel mai probabil în:
- `app/(tabs)/entitati/index.tsx` — `ALL_TABS`, `TYPE_RANK`
- `app/(tabs)/entitati/add.tsx` — `MANUAL_ENTITY_TYPES`
- `app/(tabs)/documente/add.tsx` — `pickerEntities`

Pentru fiecare: înlocuiește lista hardcodată cu `ALL_ENTITY_TYPES` din `@/types` (sau hook-ul corespunzător). Ghid concret: `app/.claude/rules/dynamic-types.md`.

- [ ] **Step 3: Commit fix-urile**

```bash
git add app/
git commit -m "fix(entities): use ALL_ENTITY_TYPES instead of hardcoded lists"
```

---

## Faza F4: Ecran detaliu dosar medical (3 tab-uri)

### Task 17: Copy ecrane medical din DosarMedical

**Files:**
- Create: `app/app/(tabs)/entitati/medical/[id]/index.tsx`
- Create: `app/app/(tabs)/entitati/medical/[id]/review.tsx`
- Create: `app/app/(tabs)/entitati/medical/_tabs/DocumenteTab.tsx`
- Create: `app/app/(tabs)/entitati/medical/_tabs/TimelineTab.tsx`
- Create: `app/app/(tabs)/entitati/medical/_tabs/ChatTab.tsx`

- [ ] **Step 1: Crează folderele**

```bash
mkdir -p /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/\[id\]
mkdir -p /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/_tabs
```

- [ ] **Step 2: Copy ecranele**

```bash
cp /Users/ax/work/dosarMedical/app/app/\(tabs\)/entitati/medical/\[id\]/index.tsx \
   /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/\[id\]/index.tsx

cp /Users/ax/work/dosarMedical/app/app/\(tabs\)/entitati/medical/\[id\]/review.tsx \
   /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/\[id\]/review.tsx

cp /Users/ax/work/dosarMedical/app/app/\(tabs\)/entitati/medical/_tabs/*.tsx \
   /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/_tabs/
```

- [ ] **Step 3: Verifică imports `useColorScheme`**

```bash
grep "useColorScheme" /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/**/*.tsx
```

Toate `from '@/components/useColorScheme'`. Fix orice excepție.

- [ ] **Step 4: Verifică imports `chatThreads` → `medicalChatThreads`**

```bash
grep -r "chatThreads" /Users/ax/work/documents/app/app/\(tabs\)/entitati/medical/
```

Înlocuiește orice `from '@/services/chatThreads'` cu `from '@/services/medicalChatThreads'`.

- [ ] **Step 5: Type-check**

`npm run type-check`
Expected: 0 erori în medical/. Pot apărea erori în alte fișiere care nu cunosc EntityType medical_record (vor fi rezolvate ulterior).

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/entitati/medical/
git commit -m "feat(medical): copy detail screen + 3 tabs + review screen"
```

---

### Task 18: Înregistrează ruta medical în `(tabs)/entitati/_layout.tsx`

**Files:**
- Modify: `app/app/(tabs)/entitati/_layout.tsx`

- [ ] **Step 1: Citește `_layout.tsx` curent**

Identifică Stack.Screen-urile existente pentru rute (probabil `index`, `add`, `[id]`, etc.).

- [ ] **Step 2: Adaugă rutele medical**

În blocul `<Stack>`, adaugă:

```tsx
<Stack.Screen name="medical/[id]/index" options={{ headerShown: false }} />
<Stack.Screen name="medical/[id]/review" options={{ title: 'Revizuiește observații' }} />
```

(Expo Router file-based — rutele se înregistrează automat dacă file-ul există, dar Stack.Screen explicit dă control pe header/titlu.)

- [ ] **Step 3: Pornește app în simulator**

`npm run ios`

În UI: tap Entități → swipe la tab „Dosar medical" (apare automat din `ALL_ENTITY_TYPES`). Dacă lista e goală, e OK — nu există dosare. Tap butonul „+" și verifică că `CreateMedicalRecordModal` se deschide.

- [ ] **Step 4: Test manual: crează un dosar**

În modal, selectează o persoană existentă, dă-i un nume („Dosar Maria"), salvează. Navighează în lista de dosare și tap pe el — trebuie să se deschidă ecranul detaliu cu cele 3 tab-uri (Timeline gol, Documente gol, Chat dezactivat).

Dacă picătura UI nu funcționează — investighează ce import sau prop e diferit.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/entitati/_layout.tsx
git commit -m "feat(routes): register medical/[id] routes in entitati Stack"
```

---

### Task 19: Picker entități în documente/add include medical_record

**Files:**
- Modify: `app/app/(tabs)/documente/add.tsx`

- [ ] **Step 1: Identifică `pickerEntities` curent**

Deschide `add.tsx`. Caută cum se construiește lista de entități pentru picker („Legat de").

- [ ] **Step 2: Include medical_records în picker**

Adaugă-le în lista construită, folosind `useEntities().medicalRecords`. Folosește `resolveEntityName` pentru afișare.

- [ ] **Step 3: Filtrare tipuri document când entitatea aleasă e medical_record**

Asigură-te că `useFilteredDocTypes({ entityTypes: ['medical_record'] })` returnează doar `MEDICAL_DOC_TYPES` + `altul` + `custom`.

- [ ] **Step 4: Test manual: adaugă document medical**

În simulator: tab Documente → „+" → alege entitate „Dosar Maria" (medical_record) → picker tipuri afișează doar cele 6 + altul/custom → alege „Analize medicale" → continuă fluxul scanare → salvează.

Document salvat ar trebui să apară în tab-ul Documente din ecranul detaliu dosar medical.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/documente/add.tsx
git commit -m "feat(documente): support medical_record entity in picker"
```

---

### Task 20: Trigger `medicalExtractor.extractAsync` din `documents.ts`

**Files:**
- Modify: `app/services/documents.ts`

- [ ] **Step 1: Identifică `addDocument` în `documents.ts`**

`grep -n "export.*addDocument\|export async function addDocument" services/documents.ts`

- [ ] **Step 2: Adaugă trigger la final**

După insert-ul în DB și înainte de return, adaugă:

```ts
import { MEDICAL_DOC_TYPES } from '@/types';
import { extractAsync as extractMedicalAsync } from '@/services/medicalExtractor';
import { getMedicalRecordByPersonId } from '@/services/medicalRecord';

// ... în addDocument, după insert:

// Trigger extracție medical dacă tip ∈ MEDICAL_DOC_TYPES + dosar activ + consent AI
if (MEDICAL_DOC_TYPES.has(doc.type)) {
  // Caută medical_record-ul asociat (prin entity_links sau person_id)
  const medicalRecordId = await findMedicalRecordIdFromDoc(doc);
  if (medicalRecordId) {
    extractMedicalAsync(doc.id, medicalRecordId).catch(err => {
      console.warn('[documents] medicalExtractor failed:', err);
    });
  }
}
```

Helper `findMedicalRecordIdFromDoc` (în `documents.ts`):

```ts
async function findMedicalRecordIdFromDoc(doc: Document): Promise<string | null> {
  // Caută prin entity_links direct
  const directLink = doc.entity_links?.find(l => l.entityType === 'medical_record');
  if (directLink) return directLink.entityId;
  // Fallback: prin person_id (legacy) → caută medical_record asociat
  if (doc.person_id) {
    const rec = await getMedicalRecordByPersonId(doc.person_id);
    return rec?.id ?? null;
  }
  return null;
}
```

- [ ] **Step 3: Type-check**

`npm run type-check`
Expected: 0 erori. Dacă `extractAsync` are altă semnătură decât `(docId, medicalRecordId)`, ajustează apelul.

- [ ] **Step 4: Test manual end-to-end**

În simulator: crează dosar medical → activează AI consent (în detail screen) → adaugă analize cu o poză test conținând valori clare (HDL: 62 mg/dL etc.) → așteaptă ~30 sec → verifică în tab Timeline că apar observații.

Dacă extracția nu se declanșează: verifică log-uri (`console.log`-uri din `medicalExtractor`). Cauze comune: consent global lipsă, AI provider neconfigurat.

- [ ] **Step 5: Commit**

```bash
git add services/documents.ts
git commit -m "feat(documents): trigger medicalExtractor on medical doc add"
```

---

## Faza F5: Chat AI (wire up Tab Chat)

### Task 21: Activează Chat tab + consent flow

**Files:**
- Modify: `app/app/(tabs)/entitati/medical/_tabs/ChatTab.tsx` (deja copiat în Task 17 — aici verifici flow)
- Reference: `useMedicalChat`, `MedicalConsentModal`

- [ ] **Step 1: Test flow consent manual**

În simulator: deschide un dosar fără AI activat. Tab Chat afișează:
- Mesaj „Activează AI pentru acest dosar..."
- Buton „Activează AI" → deschide `MedicalConsentModal`
- După Accept → tab Chat re-render cu UI normal (lista threads + buton „Fir nou")

Confirmă că flow-ul merge end-to-end. Dacă nu, debug — probabil `setAiConsent` din `services/medicalRecord` nu se apelează corect.

- [ ] **Step 2: Test send message**

Dă click „Fir nou" → tastează „Cum a evoluat HDL-ul?" → trimite. Așteaptă răspuns (depinde de provider). Verifică:
- Mesajul tău apare în chat
- Răspuns AI apare cu citații `OBS:...`
- Citațiile sunt chip-uri tapabile

Dacă AI provider nu e configurat, va apărea eroare. Configurează provider în Setări → Asistent AI.

- [ ] **Step 3: Verifică criptare mesaje**

În SQLite browser sau via cod:
```ts
const rows = db.getAllSync(`SELECT * FROM medical_chat_messages LIMIT 3`);
console.log(rows);
```
Coloana `content_enc` trebuie să fie BLOB (binar), nu plaintext.

- [ ] **Step 4: Commit (dacă au fost ajustări)**

```bash
git status
# dacă există modificări:
git add app/\(tabs\)/entitati/medical/_tabs/ChatTab.tsx
git commit -m "fix(medical): chat tab consent flow + citation rendering"
```

---

### Task 22: Adăugare rezumat AI per document medical (medical_document_summaries)

**Files:**
- Modify: `app/services/medicalExtractor.ts` (sau adăugare hook nou — verifică logica copiată)

- [ ] **Step 1: Verifică dacă logica există deja în `medicalExtractor.ts` copiat**

```bash
grep -n "medical_document_summaries\|insertSummary\|generateSummary" services/medicalExtractor.ts
```

Dacă există: trecem la Step 3 (verificare runtime).
Dacă nu există: trecem la Step 2 (adăugare).

- [ ] **Step 2: Adaugă generare summary după extracție** (doar dacă lipsește)

În `medicalExtractor.extractAsync`, după ce observațiile sunt inserate, adaugă un al doilea apel AI care generează un summary 2-3 propoziții pentru document:

```ts
const summaryPrompt = `Rezumă în 2-3 propoziții documentul medical de mai jos pentru a fi referat ulterior. NU dai diagnostic.\n\n${ocrText.slice(0, 3000)}`;
const summary = await sendAiRequest(summaryPrompt);

db.runSync(
  `INSERT OR REPLACE INTO medical_document_summaries (document_id, summary, generated_at, model_used) VALUES (?, ?, ?, ?)`,
  [docId, summary, new Date().toISOString(), aiProviderId]
);
```

- [ ] **Step 3: Test manual: verifică FTS5 includes summary**

```ts
const r = db.getAllSync(`SELECT * FROM medical_fts WHERE chunk_type='summary' LIMIT 3`);
console.log(r);
```

Trebuie să apară rânduri cu `chunk_text` plaintext.

- [ ] **Step 4: Test retrieval în chat**

Trimite în chat: „Ce mi-a recomandat doctorul la analize în ultima vizită?". Răspunsul ar trebui să citeze documente (`DOC:scrisoare_medicala|...`). Dacă nu, retrieval-ul nu folosește FTS pe summaries — debug `medicalChat.ts`.

- [ ] **Step 5: Commit (dacă au fost modificări)**

```bash
git add services/medicalExtractor.ts
git commit -m "feat(medical): generate per-document summary into FTS5"
```

---

## Faza F6: Setări + Onboarding

### Task 23: Toggle „Date medicale (Art. 9)" global în Setări

**Files:**
- Modify: `app/app/(tabs)/setari.tsx`

- [ ] **Step 1: Identifică secțiunea „Asistent AI" din Setări**

Deschide `setari.tsx`. Caută secțiunea „Asistent AI" (sau „AI provider").

- [ ] **Step 2: Adaugă sub-secțiune „Date medicale (Art. 9 GDPR)"**

Cu un `Switch` legat de o setare nouă în `services/settings.ts`:
- Key: `medical_ai_consent_global`
- Default: `false`

UI: titlu + descriere clară („Permite asistentului AI să acceseze observațiile și documentele medicale. Datele se criptează local cu AES-256-GCM. Poți dezactiva oricând.").

- [ ] **Step 3: Adaugă lectura setării în `medicalChat.ts` / `medicalExtractor.ts`**

Verifică în fișierele medical că la início de funcție se citește setarea și se aruncă eroare clară dacă e OFF. Probabil deja există în versiunea copiată — confirmă cu `grep`.

- [ ] **Step 4: Test manual: dezactivează → re-activează**

În simulator: Setări → Asistent AI → Date medicale OFF. Înapoi în dosar → tab Chat afișează „Date medicale dezactivate global din Setări". Reactivează → chat funcționează din nou.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/setari.tsx services/settings.ts
git commit -m "feat(setari): global toggle for Art. 9 medical data consent"
```

---

### Task 24: Setări → Include cheie medicală în backup cloud

**Files:**
- Modify: `app/app/(tabs)/setari.tsx`
- Modify: `app/services/cloudSync.ts` (sau wherever `_security.medical_key` se setează)

- [ ] **Step 1: Adaugă Switch în Setări → Backup cloud**

Sub secțiunea „Backup cloud":

```tsx
<Switch
  value={settings.medicalKeyInCloudBackup}
  onValueChange={async v => {
    if (v) {
      Alert.alert(
        'Include cheie medicală în backup?',
        'Cheia AES pentru observațiile medicale criptate va fi inclusă în backup-ul iCloud, criptată cu parola cloud. Pierderea parolei = pierderea accesului la date medicale pe device nou.',
        [
          { text: 'Anulează', style: 'cancel' },
          { text: 'Activează', onPress: () => updateSetting('medicalKeyInCloudBackup', true) },
        ]
      );
    } else {
      updateSetting('medicalKeyInCloudBackup', false);
    }
  }}
/>
```

- [ ] **Step 2: În `cloudSync.ts` `buildManifestPayload`**

Dacă setarea e ON, include cheia criptată în `_security`:

```ts
if (settings.medicalKeyInCloudBackup) {
  const key = await getOrCreateMedicalKey();
  const encrypted = await encryptWithCloudPassword(key, cloudPassword);
  payload._security = { ...payload._security, medical_key: base64(encrypted) };
}
```

- [ ] **Step 3: Restore — în `applyManifest` în `backup.ts` / `cloudSync.ts`**

La restore, dacă `_security.medical_key` există, decriptează cu parola cloud și salvează în Keychain:

```ts
if (manifest._security?.medical_key && cloudPassword) {
  const decrypted = await decryptWithCloudPassword(manifest._security.medical_key, cloudPassword);
  await SecureStore.setItemAsync('medical_aes_key_v1', decrypted);
}
```

- [ ] **Step 4: Test manual**

Cu un dosar plin de observații pe device A → backup cloud cu setting ON → instalează app pe device B (sau wipe + restore) → verifică că observațiile se decriptează corect.

- [ ] **Step 5: Commit**

```bash
git add app/\(tabs\)/setari.tsx services/cloudSync.ts services/backup.ts services/settings.ts
git commit -m "feat(backup): optional include of medical AES key in cloud backup"
```

---

### Task 25: App Lock medical separat (timeout 5 min)

**Files:**
- Modify: `app/app/(tabs)/entitati/medical/[id]/index.tsx`
- Reference: `hooks/useMedicalLock.ts` (deja copiat)

- [ ] **Step 1: Verifică integrare `useMedicalLock` în detail screen**

Deschide `index.tsx`. Verifică dacă există ceva similar cu:

```tsx
const { locked, unlock } = useMedicalLock();
if (locked) return <AppLockScreen onUnlock={unlock} />;
```

Dacă nu — adaugă-l la începutul componentei.

- [ ] **Step 2: Adaugă toggle în Setări → Securitate**

În `setari.tsx`, sub App Lock global, adaugă:

```tsx
<Switch
  value={settings.medicalAppLockEnabled}
  onValueChange={v => updateSetting('medicalAppLockEnabled', v)}
/>
```
Label: „App Lock pentru dosare medicale".
Descriere: „Cere autentificare la deschiderea unui dosar medical, independent de App Lock-ul global. Timeout 5 minute."

Default: `true`.

- [ ] **Step 3: Test manual**

În simulator: deschide un dosar medical → cerută autentificare biometric/PIN → succes → reintră în dosar imediat (<5 min) — nu mai cere. Iesi → așteaptă 6 min → reintră → cere din nou.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/entitati/medical/\[id\]/index.tsx app/\(tabs\)/setari.tsx services/settings.ts
git commit -m "feat(medical): dedicated App Lock with 5min timeout"
```

---

### Task 26: OnboardingWizard — pas „Dosar medical" opțional

**Files:**
- Modify: `app/components/OnboardingWizard.tsx`

- [ ] **Step 1: Identifică pașii curenți**

Deschide `OnboardingWizard.tsx`. Caută structura pașilor (probabil array de `{ title, description, render }`).

- [ ] **Step 2: Adaugă pas nou înainte de pasul final**

Conținut:
- Titlu: „Dosar medical (opțional)"
- Descriere: „Vrei să folosești Dosar și pentru documente medicale (analize, rețete, scrisori)? Datele se criptează local conform Art. 9 GDPR. Poți activa oricând din Setări."
- Două butoane: „Activează" (trimite la Setări → toggle global + redirecționează înapoi în wizard) și „Mai târziu" (skip).

- [ ] **Step 3: Test manual**

Wipe app data → reinstalează → onboarding apare → ajunge la pasul medical → ambele opțiuni funcționează.

- [ ] **Step 4: Commit**

```bash
git add components/OnboardingWizard.tsx
git commit -m "feat(onboarding): optional medical step (consent + skip)"
```

---

## Faza F7: Backup + cloud sync extins

### Task 27: Extinde `backup.ts` cu tabelele medical_*

**Files:**
- Modify: `app/services/backup.ts`

- [ ] **Step 1: Citește implementarea curentă `exportBackup`**

Identifică pattern-ul (per tabel: `db.getAllSync(SELECT * FROM <table>)` → adăugat în payload).

- [ ] **Step 2: Adaugă cele 6 tabele medical**

```ts
const medicalRecords = db.getAllSync(`SELECT * FROM medical_record`);
const medicalObservations = db.getAllSync(`SELECT * FROM medical_observations`);
const medicalChatThreads = db.getAllSync(`SELECT * FROM medical_chat_threads`);
const medicalChatMessages = db.getAllSync(`SELECT * FROM medical_chat_messages`);
const medicalDocumentSummaries = db.getAllSync(`SELECT * FROM medical_document_summaries`);
const medicalShares = db.getAllSync(`SELECT * FROM medical_shares`);
// medical_fts NU se exportă — se reconstruiește la restore din summaries + documents.ocr_text

return {
  // ... existente
  medicalRecords,
  medicalObservations,
  medicalChatThreads,
  medicalChatMessages,
  medicalDocumentSummaries,
  medicalShares,
};
```

**Atenție:** câmpurile BLOB (`name_enc`, `value_enc`, etc.) trebuie convertite la base64 înainte de export (JSON nu suportă BLOB direct). Verifică pattern-ul Dosar existent — există probabil un helper `encodeBlob` / `decodeBlob`.

- [ ] **Step 3: Extinde `applyManifest` / `importBackup`**

Pentru restore: parse-ează payload-ul, decode base64 înapoi în BLOB, insert în tabele. La final, rebuild FTS5:

```ts
db.execSync(`DELETE FROM medical_fts`);
// Re-populate din medical_document_summaries
const summaries = db.getAllSync(`SELECT document_id, summary FROM medical_document_summaries`);
for (const s of summaries) {
  db.runSync(
    `INSERT INTO medical_fts(document_id, medical_record_id, chunk_type, chunk_text) VALUES (?, '', 'summary', ?)`,
    [s.document_id, s.summary]
  );
}
// Re-populate din documents.ocr_text pentru documente medicale
const medDocs = db.getAllSync(`SELECT id, ocr_text FROM documents WHERE type IN (?, ?, ?, ?, ?, ?) AND ocr_text IS NOT NULL`,
  ['reteta_medicala', 'analize_medicale', 'scrisoare_medicala', 'bilet_externare', 'imagistica', 'vaccin_persoana']);
for (const d of medDocs) {
  db.runSync(
    `INSERT INTO medical_fts(document_id, medical_record_id, chunk_type, chunk_text) VALUES (?, '', 'ocr', ?)`,
    [d.id, d.ocr_text]
  );
}
```

- [ ] **Step 4: Wipe trebuie să șteargă și medical**

În funcția `wipeAllData()` (sau echivalent), adaugă:

```ts
db.execSync(`
  DELETE FROM medical_fts;
  DELETE FROM medical_shares;
  DELETE FROM medical_document_summaries;
  DELETE FROM medical_chat_messages;
  DELETE FROM medical_chat_threads;
  DELETE FROM medical_observations;
  DELETE FROM medical_record;
`);
```

(Ordinea respectă FK-urile.)

- [ ] **Step 5: Test manual: export + reset + import**

În Setări → Backup → Export ZIP. Apoi Setări → Wipe data. Re-importă din ZIP-ul exportat. Verifică că dosarele medicale + observațiile + chat-urile sunt restaurate, criptate corespunzător (cheia rămâne în Keychain — wipe NU șterge Keychain).

- [ ] **Step 6: Commit**

```bash
git add services/backup.ts
git commit -m "feat(backup): include medical tables in export/import + wipe"
```

---

### Task 28: Extinde `cloudSync.ts` `buildManifestPayload`

**Files:**
- Modify: `app/services/cloudSync.ts`

- [ ] **Step 1: Identifică `buildManifestPayload` și pattern-ul de encode BLOB**

```bash
grep -n "buildManifestPayload\|encodeBlob\|toBase64" services/cloudSync.ts | head -20
```

Notează helper-ul de encode BLOB folosit (probabil `bytesToBase64` din `@/services/cloudCrypto` sau helper local).

- [ ] **Step 2: Adaugă colectarea tabelelor medical în payload**

În interiorul `buildManifestPayload`, după ce colectează tabelele non-medical, adaugă (ajustează numele helper-ului encode dacă diferă):

```ts
const medicalRecords = db.getAllSync(`SELECT * FROM medical_record`);
const medicalObservations = db.getAllSync<any>(`SELECT * FROM medical_observations`).map(r => ({
  ...r,
  name_enc: r.name_enc ? bytesToBase64(r.name_enc) : null,
  value_enc: r.value_enc ? bytesToBase64(r.value_enc) : null,
  ref_min_enc: r.ref_min_enc ? bytesToBase64(r.ref_min_enc) : null,
  ref_max_enc: r.ref_max_enc ? bytesToBase64(r.ref_max_enc) : null,
}));
const medicalChatThreads = db.getAllSync(`SELECT * FROM medical_chat_threads`);
const medicalChatMessages = db.getAllSync<any>(`SELECT * FROM medical_chat_messages`).map(r => ({
  ...r,
  content_enc: r.content_enc ? bytesToBase64(r.content_enc) : null,
}));
const medicalDocumentSummaries = db.getAllSync(`SELECT * FROM medical_document_summaries`);
const medicalShares = db.getAllSync(`SELECT * FROM medical_shares`);
// medical_fts NU se include în payload — reconstruită la restore.

return {
  // ... existente
  medicalRecords,
  medicalObservations,
  medicalChatThreads,
  medicalChatMessages,
  medicalDocumentSummaries,
  medicalShares,
};
```

- [ ] **Step 3: Actualizează `applyManifest` în restore** (dacă e wrappat aici, altfel deja făcut în Task 27)

Dacă `cloudSync.restore()` folosește o copie locală a `applyManifest`, replică logica de Task 27 (decode base64 → BLOB, insert, rebuild FTS). Dacă reutilizează `applyManifest` din `backup.ts`, e suficient pas-ul de Task 27.

- [ ] **Step 4: Verifică audit**

```bash
node scripts/backup-audit.js --strict
```

Expected: TOT verde. Toate cele 6 tabele medical apar la „în toate locațiile".

- [ ] **Step 5: Test manual**

Cu cloud activat: trigger un backup automat (sau manual via Setări → Backup acum). Verifică în iCloud Drive că manifest.json conține câmpurile `medicalRecords` etc.

- [ ] **Step 6: Commit**

```bash
git add services/cloudSync.ts
git commit -m "feat(cloudSync): include medical tables in manifest payload"
```

---

### Task 29: Extinde `appKnowledge.ts` cu descriere medical

**Files:**
- Modify: `app/services/appKnowledge.ts`

- [ ] **Step 1: Citește structura `buildAppKnowledge`**

Identifică secțiunile (Funcții principale, DOC_CATEGORIES, navigare, etc.).

- [ ] **Step 2: Adaugă entry pentru entitate medical_record**

În `DOC_CATEGORIES` (sau echivalentul listei de tipuri), adaugă o secțiune nouă:

```ts
{
  category: 'Medical',
  types: [
    'reteta_medicala',
    'analize_medicale',
    'scrisoare_medicala',
    'bilet_externare',
    'imagistica',
    'vaccin_persoana',
  ],
  description: 'Documente medicale legate de dosarul medical al unei persoane. Conțin date Art. 9 GDPR — criptate AES-256-GCM.',
}
```

- [ ] **Step 3: Adaugă feature description**

În lista „Funcții principale":

```ts
{
  name: 'Dosar medical',
  description: 'Gestionare documente medicale + Timeline cu evoluția valorilor + Chat AI pe dosar.',
  activation: 'Setări → Asistent AI → Date medicale (Art. 9). Plus consent per dosar la activarea AI.',
}
```

- [ ] **Step 4: Verifică audit knowledge**

```bash
node scripts/knowledge-audit.js --strict
```

Expected: TOT verde.

- [ ] **Step 5: Commit**

```bash
git add services/appKnowledge.ts
git commit -m "feat(knowledge): document medical record feature for chatbot"
```

---

### Task 30: Migrare orfani — wizard „Crează dosar medical pentru..."

**Files:**
- Create: `app/components/medical/MigrateOrphansWizard.tsx`
- Modify: `app/app/(tabs)/index.tsx` (sau loc unde trigger-uim banner-ul)

- [ ] **Step 1: Detectare orfani**

În `services/medicalRecord.ts`, adaugă:

```ts
export async function findPersonsWithOrphanMedicalDocs(): Promise<Person[]> {
  // Persoane care au documente cu tip ∈ MEDICAL_DOC_TYPES dar NU au medical_record
  return db.getAllSync<Person>(`
    SELECT DISTINCT p.* FROM persons p
    JOIN documents d ON d.person_id = p.id
    WHERE d.type IN (?, ?, ?, ?, ?, ?)
      AND NOT EXISTS (
        SELECT 1 FROM medical_record m WHERE m.person_id = p.id
      )
  `, ['reteta_medicala', 'analize_medicale', 'scrisoare_medicala', 'bilet_externare', 'imagistica', 'vaccin_persoana']);
}
```

- [ ] **Step 2: Banner pe Home**

În `app/(tabs)/index.tsx`, la mount, apel `findPersonsWithOrphanMedicalDocs()`. Dacă rezultatul > 0:

```tsx
<Banner>
  <Text>Ai {orphans.length} persoane cu documente medicale fără dosar dedicat.</Text>
  <Button onPress={() => setShowWizard(true)}>Creează dosare</Button>
</Banner>
```

- [ ] **Step 3: `MigrateOrphansWizard.tsx`**

Modal pageSheet cu lista persoane + checkbox per persoană (default toate ON). Buton „Creează" iterează și apelează `createMedicalRecord({ person_id, name: \`Dosar ${person.name}\` })` pentru fiecare.

- [ ] **Step 4: Test manual**

Crează manual un document medical legat doar de `person_id` (legacy). Restart app. Banner-ul apare. Tap → wizard → confirmă → dosarele se creează → banner dispare.

- [ ] **Step 5: Commit**

```bash
git add components/medical/MigrateOrphansWizard.tsx app/\(tabs\)/index.tsx services/medicalRecord.ts
git commit -m "feat(medical): migrate orphan medical docs to dedicated dosars"
```

---

### Task 31: Smoke test final + audit complet

**Files:** niciun fișier modificat — validare finală.

- [ ] **Step 1: Rulează tot audit-ul**

```bash
npm run audit
```

Expected: TOT verde. Niciun warning.

- [ ] **Step 2: Test end-to-end pe device fizic iOS**

Conectează iPhone fizic + cont iCloud activ. `npm run ios --device`.

Flow complet:
1. Onboarding → activează dosar medical
2. Crează dosar pentru tine
3. Scanează 3 analize (cu poze test sau analize reale)
4. Așteaptă extracția observații
5. Verifică Timeline cu sparkline
6. Trimite o întrebare în chat
7. Verifică citații
8. Backup cloud (Setări → Backup acum)
9. Wipe data
10. Restore din cloud → verifică tot revine

Dacă oricare pas pică — debug + fix înainte de merge.

- [ ] **Step 3: Commit final + tag**

```bash
git log --oneline | head -10
git tag dosar-medical-merge-mvp-ready
git push --tags  # opțional
```

- [ ] **Step 4: Decizii pentru Plan 2**

Înainte de start Plan 2 (doctor share):
- Cumperi domain? (`dosar.app` ~$10/an)
- Cont Cloudflare gata? (`workers.dev` subdomain ales)
- Branch dedicat pentru `cloud/share-relay` și `cloud/share-viewer` în repo Dosar sau repo separat?

Notează deciziile în `IDEAS.md` sau spec-ul de Plan 2.

---

## Note de execuție

### Ordinea de implementare

Strict secvențială pe verticale, dar în interiorul unei verticale poți paraleliza:
- F1: secvențial (Task 1 → 2 → 3 → 4 → 5)
- F2: Tasks 6-12 pot rula în orice ordine după Task 4 (DB există)
- F3: secvențial după F2 (Tasks 13 → 14 → 15 → 16)
- F4: secvențial (17 → 18 → 19 → 20)
- F5: secvențial (21 → 22)
- F6: ordinea 23 → 24 → 25 → 26
- F7: ordinea 27 → 28 → 29 → 30 → 31

### Frequent commits

Fiecare Task se termină cu un commit dedicat. Dacă un Task pică la jumătate (test eșuat, type-check rupt), nu se commit-uiește până nu trece. Hook-ul pre-commit din Dosar (`npm run setup-hooks`) rulează `type-check + backup-audit --strict + check-hardcoded-entities + knowledge-audit --strict + update-site` automat.

### Verificare cu agentul

După F4 e momentul natural pentru un check cu `feature-implementer` agent (sau review manual) — ecranul detaliu e cel mai complex piece. Folosește comanda `/review-staged` sau `superpowers:requesting-code-review` skill.

### Mocks necesare în teste

Dosar are deja `__mocks__/` pentru:
- `expo-sqlite` — implementare in-memory funcțională
- `expo-secure-store` — store în RAM
- `@noble/ciphers` — pass-through (sau real, depinde de versiune)

Dacă apare „cannot find mock" în testele medical, copy mock-urile din `dosarMedical/app/__mocks__/`.

### Dacă apare un blocker

Oprește implementarea, raportează problema, propune 2-3 soluții. NU forța merge cu `--no-verify`. NU comenta tests-uri „temporar".
