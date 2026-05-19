# Spec — Reintegrare „dosar medical" ca entitate în Dosar + share criptat la medic

**Data:** 2026-05-19
**Status:** brainstormed, awaiting user review
**Owner:** Tudor
**Estimat:** 6-10 săptămâni part-time

---

## 1. Context și problemă

Aplicația **DosarMedical** (`/Users/ax/work/dosarMedical`, bundle `com.ax.dosarmedical`) a fost derivată din **Dosar** (`/Users/ax/work/documents`, bundle `com.ax.documents`) la începutul lui mai 2026 prin extragerea funcționalității medicale într-un binar separat (commit-uri `dbb5a41`, `2f975f9`, `56e2428`). Motivul de atunci: GDPR Art. 9 părea să justifice un produs separat cu UX dedicat consimțământului și criptării.

**Ce s-a întâmplat între timp:**
- Codul medical a maturat în DosarMedical: criptare AES-256-GCM, Timeline cu sparkline-uri, Chat AI cu retrieval hibrid, FTS5 plaintext pe OCR, extracție observații cu confidence.
- DosarMedical-ul nu a fost lansat în App Store (URL App Store încă conține `idTBD`).
- Userul nu are timp să mențină 2 aplicații paralel.
- Apare cerința nouă: **share dosar medical la medic** — pentru consultații punctuale, pacientul vrea să trimită un snapshot la un doctor specific.

**Soluția propusă:** reintegrăm medicalul în Dosar ca `EntityType` nou (`medical_record`), readucând cele 6 tipuri de documente medicale. Adăugăm un singur feature nou major: **doctor share** (link 1h criptat E2E, blob opac pe Cloudflare R2, viewer static pe GitHub Pages — vezi §6.6). DosarMedical actual intră în maintenance mode.

Predecesori utili (a se citi pentru context):
- `/Users/ax/work/documents/docs/superpowers/specs/2026-05-03-medical-entity-rag-design.md` — spec-ul original „medical_record în Dosar" (înainte de split). Arhitectura propusă atunci este în mare parte recuperabilă, însă a fost implementată concret în DosarMedical.
- `/Users/ax/work/dosarMedical/PLAN.md` — implementarea matură de criptare, Timeline, Chat AI.

---

## 2. Decizii (luate la brainstorming, 2026-05-19)

| # | Decizie | Motiv |
|---|---|---|
| D1 | **Reintegrare în Dosar** ca `EntityType = 'medical_record'`, NU app separat | Mentenanță realistă pentru solo dev. 60-70% reciclabil din DosarMedical. |
| D2 | **DosarMedical (acest repo) intră în maintenance mode.** Nu se publică în App Store. | Evităm 2 binare în paralel. La 6 luni decidem retragere completă (nu există useri publici acum). |
| D3 | **Persoană fizică, fără SRL** — același risk profile ca Dosar curent | Datele Art. 9 nu trec prin servere proprii. Backup rămâne local + iCloud user. Doctor share = blob criptat E2E pe Cloudflare R2 (processor declarat, vede doar opac), șters automat după 1h. |
| D4 | **Cloud sync multi-device (cross-platform) — out of scope** | Dosar are deja iCloud backup. Cross-platform sync nu e cerut acum. |
| D5 | **Apple Health / HealthKit — out of scope pentru MVP** | Adaugă 1-2 săpt fără valoare imediată (cere wearable). Adăugat în faza 2 dacă apare cerere. |
| D6 | **Huawei AppGallery — out of scope** | Userii Huawei în RO sunt foarte puțini. YAGNI. |
| D7 | **Doctor share = link criptat E2E pe Cloudflare Worker + R2, viewer pe GitHub Pages, TTL 1h** | Un dosar real are 20+ documente (~40-60MB). PDF unic embedded depășește limitele Gmail (25MB) și e greoi pe WhatsApp. Soluția cu link funcționează la orice volum, e zero-admin (Cloudflare e sandbox-uri serverless), e gratis sub 500 useri activi (free tier R2 + Workers). Cheia AES sta în URL fragment — nu pleacă la server, app-ul rămâne zero-knowledge față de Cloudflare. |
| D8 | **Monetizare amânată** | MVP-ul iese gratis. Plată one-time €12-15 sau abonament se decid la 6 luni post-launch, pe baza tracțiunii. |
| D9 | **Reciclăm cod direct, nu cherry-pick** | Copiem fișierele relevante din DosarMedical în Dosar și le adaptăm. Nu încercăm git cherry-pick (split-ul a curățat fișierele non-medicale). |

---

## 3. Scope

### În scope (MVP)

1. `EntityType = 'medical_record'` adăugat în Dosar (1:1 cu o persoană din familie).
2. 6 tipuri de documente medicale readăugate: `reteta_medicala`, `analize_medicale`, `scrisoare_medicala`, `bilet_externare`, `imagistica`, `vaccin_persoana`. (Tipul `altul` deja există; `custom` deja există.)
3. Ecran detaliu `medical_record` cu 3 tab-uri: **Timeline · Documente · Chat AI**.
4. Pipeline extracție observații medicale (LLM cu confidence threshold) — recuperat din DosarMedical.
5. Chat AI scoped la dosar cu retrieval hibrid (FTS5 + observații + summaries) + citații obligatorii.
6. Criptare AES-256-GCM pentru observații + mesaje chat (cheie 256-bit în Keychain/Keystore).
7. App Lock dedicat pentru ecranul dosar medical (timeout 5 min, independent de App Lock global).
8. GDPR consent: toggle global „Date medicale" + acceptare per dosar la activare AI.
9. Câmpul `private_notes` pe `Document` nu pleacă la AI (deja respectat în Dosar — confirmat).
10. **Doctor share:** buton „Partajează cu medicul" pe ecran detaliu dosar → generează snapshot ZIP (observații + documente originale) → criptează AES-256-GCM cu cheie efemeră → upload blob opac la Cloudflare R2 cu TTL 1h → app construiește link `https://<viewer>/#k=<key>&b=<blob-id>` → user copiază/trimite linkul prin orice canal (SMS, email, WhatsApp). Cheia stă în URL fragment, nu pleacă la server. Doctorul deschide linkul în browser → viewer static decriptează în memorie → randează Timeline + Documente. După 1h blob-ul e șters, linkul devine inaccesibil.
11. Backup local + cloud existent extins să includă tabelele medicale + opțional cheia AES (criptată cu parola cloud).
12. `appKnowledge.ts` extins cu descrierea funcției medicale + lista tipurilor medicale (auto-generată).

### Out of scope (faza 2 sau mai târziu)

- Apple Health / HealthKit import.
- Cloud sync cross-platform multi-device pentru sesiuni complete (nu e același lucru cu share doctor — sync = aceleași date pe toate device-urile userului, dincolo de iCloud Apple-only).
- Domain propriu pentru viewer (`dosar.app`) — MVP folosește `<account>.workers.dev` + GitHub Pages.
- Specialități medicale ca taxonomie (cardiologie, ATI, neurologie). Vezi §11.2 — categoriile de observații sunt taxonomia reală.
- Configurare TTL share (1h fix în MVP).
- Watermark dinamic pe documente la share (cu numele doctorului, timestamp) — anti-leak. Tehnic posibil în viewer dar adaugă complexitate.
- Huawei AppGallery / HMS.
- Monetizare (paywall, abonament).
- Doctor app dedicată (B2B). Viewer-ul web acoperă MVP-ul.
- Cont online / sharing între device-urile aceluiași user.
- AI local (`llama.rn`) pentru observații medicale — rămâne BYOK la cloud provider (Mistral / OpenAI). Modelele locale există deja în Dosar dar nu se folosesc pentru extracție medicală în MVP (calitate insuficientă pentru observații structurate).

---

## 4. Arhitectură generală

### 4.1 Strategie

**Reutilizare maximă.** Stack-ul Dosar (SQLite, OCR, AI provider, backup, cloud sync, design system) rămâne neschimbat. Adăugăm o „felie verticală" pentru medical, copiată și adaptată din DosarMedical.

### 4.2 Module noi în Dosar (`/Users/ax/work/documents/app/services/`)

| Fișier | Rol | Sursă |
|---|---|---|
| `medicalRecord.ts` | CRUD `medical_record` (1:1 cu Person) | adaptat din DosarMedical (acum e singleton entity acolo) |
| `medicalObservations.ts` | CRUD `medical_observations` (criptate), queries timeline | copiat din DosarMedical |
| `medicalCrypto.ts` | Wrapper AES-256-GCM + management cheie Keychain | copiat din DosarMedical |
| `medicalFts.ts` | Index FTS5 plaintext pe OCR + chunks AI | copiat din DosarMedical |
| `medicalExtractor.ts` | Pipeline extracție observații (LLM, confidence-based) | copiat din DosarMedical |
| `medicalChat.ts` | RAG hibrid + sendMessage per dosar | copiat din DosarMedical |
| `medicalQueryAnalysis.ts` | Parsare query pentru retrieval | copiat din DosarMedical |
| `medicalShare.ts` | **NOU** — bundle ZIP (manifest + originale + thumbnails) + criptare AES-256-GCM + upload la Worker + construire link viewer | scris from scratch |
| `medicalShareHistory.ts` | **NOU** — istoric share-uri active (DB tabel `medical_shares` cu id, expires_at, revoked_at) + revoke API | scris from scratch |

### 4.2b Componente noi în repo (fără Expo) — `/Users/ax/work/documents/cloud/`

| Folder | Rol | Deploy |
|---|---|---|
| `cloud/share-relay/` | Cloudflare Worker TypeScript: POST /upload, GET /download/:id, DELETE /share/:id, GET /health. Storage R2 + KV pentru rate-limiting. | Wrangler CLI → `<name>.<acct>.workers.dev` |
| `cloud/share-viewer/` | Static viewer page (Vite + vanilla TS + JSZip + PDF.js). Parse URL fragment, fetch blob, decrypt cu Web Crypto, render Timeline + Documente. | Build → GitHub Pages branch sau Cloudflare Pages |

Ambele folder-e au propriile `package.json`, `tsconfig.json`, teste și `README.md` cu pași de deploy. NU sunt parte din app-ul Expo — au lifecycle separat.

### 4.3 Module modificate (extensii)

| Fișier | Modificare |
|---|---|
| `services/db.ts` | Migrare nouă: 5 tabele (`medical_record`, `medical_observations`, `medical_chat_threads`, `medical_chat_messages`, `medical_document_summaries`) + 1 virtual FTS5 (`medical_fts`) + 3 trigger-i FTS |
| `services/backup.ts` | `exportBackup()` + `applyManifest()` includ tabelele `medical_*` (FTS reconstruită la restore). Wipe șterge la fel. |
| `services/cloudSync.ts` | `buildManifestPayload()` include `medical_*`. Opțional `_security.medical_key` dacă userul are toggle „include cheie medicală în backup cloud". |
| `services/appKnowledge.ts` | Adaugă în `DOC_CATEGORIES` cele 6 tipuri medicale. Adaugă secțiune „Dosar medical" în `buildAppKnowledge()`. |
| `services/documents.ts` | În `addDocument`: trigger `medicalExtractor.extractAsync(docId)` dacă tip medical + dosar activ + consent AI dat. |
| `types/index.ts` | `EntityType` += `'medical_record'`. `DocumentType` += 6 tipuri medicale. `ENTITY_DOCUMENT_TYPES['medical_record']` listă. `MEDICAL_DOC_TYPES` set. `OBSERVATION_CATEGORIES` enum. Interfețe TS pentru `MedicalRecord`, `MedicalObservation`, etc. |
| `hooks/useEntities.ts` | Adaugă `medicalRecords` state + load + `resolveEntityName` case |
| `app/(tabs)/entitati/medical/[id].tsx` | Ecran nou detaliu dosar (3 tab-uri) — copiat din DosarMedical |
| `app/(tabs)/setari.tsx` | Toggle „Date medicale" (consent global Art. 9). Management cheie criptare (regenerare, include în backup). App Lock medical separat. |
| `components/OnboardingWizard.tsx` | Pas opțional „Dosar medical" — explică feature-ul, cere consent, oferă „skip" |
| `scripts/backup-audit.js` | Adaugă `medical_*` în `TABLE_TO_MANIFEST_FIELD` |
| `scripts/check-hardcoded-entities.js` | Verifică că `medical_record` apare în sursele canonice |
| `scripts/update-site.js` | Adaugă tipurile medicale în `EMOJI_MAP` și pe site |

### 4.4 Module NEschimbate

- `services/chatbot.ts` — chatbot global rămâne ca este; chat medical e separat.
- `services/aiProvider.ts` — același provider (Mistral built-in / BYOK / local).
- `services/ocrLlmExtractor.ts`, `services/pdfOcr.ts`, `services/ocr.ts` — folosite ca primă etapă în pipeline-ul extractor medical.
- `services/chatThreads.ts` — NU reused. `medical_chat_*` are propria infra criptată.
- `services/cloudCrypto.ts` — wrappat de `medicalCrypto.ts`.
- Stack auth/login — nu există în Dosar și nu adăugăm.

### 4.5 Feature flags

Activarea dosarului medical e gated în 3 niveluri:

1. **Setări → Vizibilitate → „Dosar medical"** (entity type) — fără asta, entitatea nu apare nicăieri în UI.
2. **Setări → Asistent AI → „Date medicale (consimțământ Art. 9)"** — fără asta, tab-ul Chat e dezactivat cu mesaj explicativ. Extracția observații nu rulează.
3. **Per-dosar `medical_record.ai_consent_at`** — primul tap pe „Activează AI" în detaliul dosarului. Default OFF la creare.

---

## 5. Model de date

### 5.1 Tipuri TypeScript noi în `types/index.ts`

```ts
// EntityType extins
export type EntityType =
  | 'person'
  | 'property'
  | 'vehicle'
  | 'card'
  | 'animal'
  | 'company'
  | 'medical_record';  // NOU

// DocumentType extins
export type DocumentType =
  // ... existente
  | 'reteta_medicala'       // NOU
  | 'analize_medicale'      // NOU
  | 'scrisoare_medicala'    // NOU
  | 'bilet_externare'       // NOU
  | 'imagistica'            // NOU
  | 'vaccin_persoana'       // NOU
  | 'altul'
  | 'custom';

export const MEDICAL_DOC_TYPES: ReadonlySet<DocumentType> = new Set([
  'reteta_medicala',
  'analize_medicale',
  'scrisoare_medicala',
  'bilet_externare',
  'imagistica',
  'vaccin_persoana',
]);

export interface MedicalRecord {
  id: string;
  person_id: string;          // FK la persons; 1:1 strict
  name: string;
  ai_consent_at: string | null;
  ai_consent_version: number;
  encryption_key_ref: string; // referință la cheia din Keychain
  created_at: string;
  updated_at: string;
}

export interface MedicalObservation {
  id: string;
  medical_record_id: string;
  source_document_id: string | null;
  // Câmpurile criptate sunt BLOB la SQLite, dar la nivel TS lucrăm cu decriptat
  name: string;             // ex: "HDL", "TSH"
  value: string | null;     // string ca să accepte "negativ"/"pozitiv" + numeric
  unit: string | null;
  ref_min: string | null;
  ref_max: string | null;
  observed_at: string | null;
  category: ObservationCategory;
  confidence: number;       // 0-1
  needs_review: boolean;    // true dacă 0.5 ≤ confidence < 0.7
  created_at: string;
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

export interface MedicalChatThread {
  id: string;
  medical_record_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MedicalChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;           // decriptat la citire
  citations: Citation[];     // OBS:id / DOC:tip|id
  created_at: string;
}

export interface Citation {
  type: 'OBS' | 'DOC';
  id: string;
  doc_type?: DocumentType;  // doar pentru DOC
}
```

### 5.2 Schema SQLite (migrare nouă în `services/db.ts`)

```sql
-- 1) Entitate dosar medical
CREATE TABLE medical_record (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL UNIQUE REFERENCES persons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ai_consent_at TEXT,
  ai_consent_version INTEGER DEFAULT 1,
  encryption_key_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_medrec_person ON medical_record(person_id);

-- 2) Observații extrase (CÂMPURI SENSIBILE = BLOB criptat AES-256-GCM)
CREATE TABLE medical_observations (
  id TEXT PRIMARY KEY,
  medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  name_enc BLOB NOT NULL,
  value_enc BLOB,
  unit TEXT,                  -- unitatea (mg/dL) nu e PII per se → plaintext pentru indexare
  ref_min_enc BLOB,
  ref_max_enc BLOB,
  observed_at TEXT,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_medobs_record ON medical_observations(medical_record_id);
CREATE INDEX idx_medobs_observed_at ON medical_observations(observed_at);
CREATE INDEX idx_medobs_category ON medical_observations(category);

-- 3) Fire de discuție chat medical
CREATE TABLE medical_chat_threads (
  id TEXT PRIMARY KEY,
  medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 4) Mesaje chat (conținut criptat)
CREATE TABLE medical_chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES medical_chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content_enc BLOB NOT NULL,
  citations_json TEXT,        -- JSON array de Citation, plaintext (ID-uri locale, nu PII)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_medmsg_thread ON medical_chat_messages(thread_id);

-- 5) Rezumat AI per document medical (chunks indexat în FTS)
CREATE TABLE medical_document_summaries (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,      -- plaintext; vezi §6 (acceptat în AI privacy)
  generated_at TEXT NOT NULL,
  model_used TEXT
);

-- 6) FTS5 virtual table — plaintext pe OCR + summaries (vezi §6)
CREATE VIRTUAL TABLE medical_fts USING fts5(
  document_id UNINDEXED,
  medical_record_id UNINDEXED,
  chunk_type,                 -- 'ocr' | 'summary'
  chunk_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- 7) Triggeri pentru FTS auto-sync
-- (insert/update/delete pe medical_document_summaries și pe documents.ocr_text)
-- detaliile în implementation plan

-- 8) Istoric share-uri active (pentru UI revoke + audit)
CREATE TABLE medical_shares (
  id TEXT PRIMARY KEY,            -- ID-ul blob-ului din R2
  medical_record_id TEXT NOT NULL REFERENCES medical_record(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_count INTEGER NOT NULL,
  obs_count INTEGER NOT NULL,
  revoked_at TEXT                 -- NULL = activ; populat la revoke manual
);
CREATE INDEX idx_medshares_record ON medical_shares(medical_record_id);
CREATE INDEX idx_medshares_expires ON medical_shares(expires_at);
```

**Note de schemă:**
- `medical_observations.unit` rămâne **plaintext** (nu e PII; permite agregare/grupare).
- `medical_observations.category` rămâne plaintext (face filtering pe categorie posibil fără decriptare).
- `medical_observations.observed_at` rămâne plaintext (sortare cronologică).
- `medical_chat_messages.citations_json` rămâne plaintext (doar ID-uri locale).
- `medical_fts.chunk_text` plaintext — decizie din ai-privacy.md §FTS5: FTS nu poate căuta în date criptate, iar conținutul e doar OCR-ul deja existent (sanitizat pe `private_notes`) + summaries (generate dintr-un input sanitizat).

### 5.3 Cheia AES medicală

- Generată o singură dată la primul `medical_record` creat.
- Stocată în `expo-secure-store` cu key `medical_aes_key_v1`.
- Format: 256-bit random, base64.
- `encryption_key_ref` din `medical_record` = string `'v1'` (versiune cheie, pentru rotație viitoare).
- AAD pentru fiecare câmp criptat = `medical_record.id`.
- **Pierderea cheii (Keychain wipe) = pierderea datelor decriptate.** Userul are opțiunea „include cheie în backup cloud" (criptată cu parola cloud, default OFF).

---

## 6. Fluxuri user

### 6.1 Onboarding (user nou)

1. Wizard standard Dosar (familiar).
2. **Pas opțional** „Folosești și pentru dosare medicale?" — Yes / No / Mai târziu.
3. Dacă Yes: explicație 2 paragrafe despre Art. 9 + criptare + AI consent. Cere consent global „Date medicale".
4. Crează automat primul `medical_record` legat de userul-self (sau lasă pe ecranul Entități).

### 6.2 Adăugare dosar medical existent

1. Tab Entități → tab „Dosar medical" → buton „+".
2. Picker persoană existentă (sau „creează persoană nouă").
3. La salvare: crează `medical_record`, nu activează AI by default.
4. User aterizează în ecran detaliu cu Timeline gol + CTA „Adaugă primul document medical".

### 6.3 Adăugare document medical

1. Din detaliu dosar: tap „+ Document medical" → picker tipuri restrâns la `MEDICAL_DOC_TYPES`.
2. Scanare (existent în Dosar) sau import PDF/imagine.
3. La salvare: `documents.addDocument` invocă `medicalExtractor.extractAsync(docId)` dacă:
   - Tipul ∈ `MEDICAL_DOC_TYPES`,
   - Documentul e legat de o entitate `medical_record`,
   - Consent AI medical e dat (global + per dosar).
4. Extracția rulează în background; UI arată badge „extractie în curs" pe document.
5. Observațiile extrase apar în Timeline după ce extracția se termină.

### 6.4 Timeline (tab principal dosar)

- Group-by `observation.name` (HDL, TSH, glicemie, etc.).
- Per grup: sparkline al ultimelor N valori, ultima valoare, intervalul referință (decriptate la render).
- Filtre pe `category` (lipide, hematologie, etc.).
- Buton „Re-extrage din toate documentele" (batch, progress bar, estimate cost AI, anulabil).
- Tap pe valoare → drill-down la documentul sursă.

### 6.5 Chat AI (tab dosar)

- Dacă consent AI global + per-dosar absent: ecran „Activează AI pentru acest dosar" cu acceptare.
- Dacă activ: lista fire de discuție + buton „Fir nou".
- Retrieval hibrid:
  1. Parsare query (`medicalQueryAnalysis.ts`) → extrage entități medicale, intervale temporale, tipuri document relevante.
  2. Caută în `medical_observations` (decriptat în memorie, filtrat per query) + `medical_fts` (FTS5 pe OCR + summaries).
  3. Construiește prompt cu context structurat + citații obligatorii.
- Răspuns conține citații `OBS:id` / `DOC:tip|id` — UI le transformă în chip-uri tapabile.
- **Niciodată diagnostic.** Prompt-ul system include „Nu dai diagnostic clinic. Redirecționează spre medic specialist pentru întrebări de interpretare."
- Mesajele se criptează la scriere, se decriptează la citire.

### 6.6 Doctor share (NOU) — link 1h criptat E2E

**De ce nu PDF embedded:** un dosar real are 15-30 documente medicale. La 2-3MB/document (analize PDF + poze imagistică), un PDF unic ajunge la 40-80MB. Depășește limita Gmail (25MB) și e greoi pe WhatsApp. Soluția cu link funcționează la orice volum.

#### Arhitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│  APP (Dosar) — telefon pacient                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
       1. User tap „Partajează cu medicul"
       2. Sheet config (interval, ce include)
       3. App construiește bundle.zip:
            - manifest.json (pacient + observații recente + index docs)
            - documents/<id>.pdf|jpg (originale)
            - thumbnails/<id>.jpg (preview-uri 200x200)
       4. Cheie AES-256 random generată în memorie
       5. ZIP criptat AES-256-GCM (cheie + nonce)
       6. POST blob criptat la Worker
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKER (dosar-share-relay.<acct>.workers.dev)               │
│  • POST /upload                                                          │
│    - Acceptă blob ≤ 100MB                                                │
│    - Generează UUID                                                      │
│    - PUT în R2 cu metadata { expiresAt: now + 1h, sizeBytes }           │
│    - Returnează { id, expiresAt }                                        │
│  • GET /download/:id                                                     │
│    - Verifică expiresAt                                                  │
│    - Dacă expirat: DELETE din R2 + return 404                            │
│    - Dacă valid: stream blob                                             │
│  • R2 lifecycle rule: auto-delete obiecte > 24h (catch-all safeguard)   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
       7. App primește { id }
       8. Construiește URL:
            https://<viewer-domain>/#k=<base64-key>&n=<base64-nonce>&b=<id>
       9. Copy în clipboard + share sheet nativ
                                  │
                                  ▼
            User trimite link la doctor (SMS, WhatsApp, email)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DOCTOR — orice browser modern                                           │
└─────────────────────────────────────────────────────────────────────────┘
       10. Tap link → deschide pagină statică (GitHub Pages)
       11. JS citește #fragment (k, n, b) — NU pleacă la server
       12. Fetch GET /download/:b — primește blob criptat
       13. Web Crypto API decriptează în memorie cu k+n
       14. JSZip extrage bundle
       15. Render UI:
            - Header pacient + dată snapshot + countdown „expiră în 47 min"
            - Tab Timeline: observații cu sparkline (SVG)
            - Tab Documente: listă cu thumbnail tap → modal PDF/imagine
            - Footer: avertisment GDPR + buton „Cere date noi"
                                  │
       16. După 1h: blob șters, link → 404, viewer afișează „Link expirat"
```

#### Flow user pas cu pas (în app)

1. Din ecran detaliu dosar: tap buton „🔗 Partajează cu medicul".
2. Sheet de configurare:
   - **Ce includ:** toggle pe „Observații recente" (default ON), „Documente originale" (default ON), „Rezumate AI" (default ON dacă există).
   - **Interval:** select „Ultimele 3 luni / 6 luni / 12 luni / Toate" (default 6 luni).
   - **Filtru tipuri:** checkbox per `MEDICAL_DOC_TYPES` (default toate ON).
   - **Estimare dimensiune:** „~24 MB · 12 documente · 47 observații" (calculat live când user modifică toggle-uri).
   - Buton „Generează link".
3. **Progress modal:**
   - „Pregătesc bundle... 1/4"
   - „Comprim documente... 2/4"
   - „Criptez... 3/4"
   - „Trimit... 4/4 (în siguranță, criptat)"
4. **Modal succes:**
   - Link afișat cu copy button: `https://dosar.app/v/AbCdEf...`
   - Mesaj: „Linkul e valabil 1 oră. După expirare, datele dispar automat. Doctorul nu are nevoie de cont sau aplicație."
   - Buton „Copiază link" + buton „Trimite..." (deschide share sheet nativ cu textul linkului).
   - Buton „Revoke acum" — apel `DELETE /share/:id` care șterge blob-ul imediat (panică, accident).
5. **Istoric share-uri** (în ecran detaliu dosar, secțiune nouă): listă cu ID, dată, status (`activ` / `expirat` / `revoke`), buton revoke pe cele active.

#### Bundle ZIP — structură

```
bundle.zip
├── manifest.json          # JSON cu metadata (vezi mai jos)
├── documents/
│   ├── <doc-id-1>.pdf
│   ├── <doc-id-2>.jpg
│   └── ...
└── thumbnails/
    ├── <doc-id-1>.jpg     # 200x200 webp/jpg, calitate 70
    └── ...
```

`manifest.json`:
```json
{
  "version": 1,
  "generatedAt": "2026-05-19T14:32:00Z",
  "expiresAt": "2026-05-19T15:32:00Z",
  "patient": {
    "name": "Maria Pop",
    "phone": "+40 ...",
    "email": "maria@..."
  },
  "observations": [
    {
      "name": "HDL", "value": "62", "unit": "mg/dL",
      "ref_min": "40", "ref_max": "80",
      "observed_at": "2026-04-15", "category": "lipide",
      "source_document_id": "<id>"
    }
  ],
  "documents": [
    {
      "id": "<doc-id-1>",
      "type": "analize_medicale",
      "type_label": "Analize medicale",
      "title": "Analize Synevo - profilul lipidic",
      "issue_date": "2026-04-15",
      "filename": "documents/<doc-id-1>.pdf",
      "thumbnail": "thumbnails/<doc-id-1>.jpg",
      "size_bytes": 1842340,
      "summary": "Profil lipidic în limite normale. HDL ușor crescut..."
    }
  ]
}
```

#### Criptare client-side

- **Algoritm:** AES-256-GCM (același ca observations).
- **Cheie:** 256-bit aleatoare per share, generată cu `crypto.getRandomValues`.
- **Nonce:** 96-bit aleator per share.
- **AAD:** `share-v1:<blob-id>` — împiedică reaplicarea blob-ului la alt ID.
- **Encode în URL:** base64url (fără padding, URL-safe). Lungime tipică: cheie 43 chars, nonce 16 chars, blob-id ~22 chars. URL total ~120 chars — copy-paste-able.

#### Cloudflare Worker — design minimal

Repo layout nou: `/Users/ax/work/documents/cloud/share-relay/`

```
cloud/share-relay/
├── package.json
├── wrangler.toml          # config Cloudflare (account, R2 bucket binding)
├── src/
│   ├── index.ts           # router cu 3 endpoints
│   └── r2.ts              # helper PUT/GET/DELETE cu metadata
├── tests/
│   └── index.test.ts
└── README.md              # deploy guide pentru noi instalări
```

API:
- `POST /upload` — body: encrypted blob (raw bytes). Returnează `{ id, expiresAt }`. Limita 100MB.
- `GET /download/:id` — returnează blob criptat sau 404 dacă expirat.
- `DELETE /share/:id` — șterge imediat (revoke).
- `GET /health` — uptime check.

Rate limit: max 10 upload-uri/IP/zi (anti-abuz). Stocat în Cloudflare KV (free tier suficient).

#### Viewer static — design minimal

Repo layout nou: `/Users/ax/work/documents/cloud/share-viewer/`

```
cloud/share-viewer/
├── package.json
├── vite.config.ts         # build static
├── index.html
├── src/
│   ├── main.ts            # fragment parse + fetch + decrypt + render
│   ├── ui/
│   │   ├── header.ts
│   │   ├── timeline.ts
│   │   ├── sparkline.ts   # SVG inline (zero deps)
│   │   ├── docs-list.ts
│   │   └── doc-viewer.ts  # modal PDF/imagine
│   ├── crypto.ts          # Web Crypto API wrapper
│   └── styles.css
└── README.md              # deploy guide pentru GitHub Pages
```

Dependențe minimale: `jszip` (decompresie ZIP), `pdf.js` (PDF viewer inline). Zero framework — vanilla TS. Bundle final ~150KB gzipped.

Deploy: build → `dist/` → push la branch `gh-pages` în repo dedicat (sau folosește repo-ul existent `tudorabrudan.github.io` cu sub-path `/dosar-share/`).

#### Domain (decizie deschisă)

| Opțiune | URL viewer | URL relay | Cost | Verdict |
|---|---|---|---|---|
| **Default Cloudflare + GitHub** | `tudorabrudan.github.io/dosar-share/` | `dosar-share-relay.<account>.workers.dev` | $0 | ✅ MVP. workers.dev poate fi flagged de filtre email enterprise — risc mediu. |
| **Domain propriu** | `dosar.app/v` | `dosar.app/api` | ~$10/an | ⚠️ Profesional dar opțional. Decizie la 6 luni post-launch. |

**Pentru MVP: opțiunea 1.** Mutare pe domain propriu = ~1h muncă când decizi.

#### Privacy & GDPR

- Cloudflare R2 este **processor declarat** pentru blob-uri opace criptate E2E. Adăugăm în privacy policy: „Funcția «Partajează cu medicul» folosește Cloudflare R2 ca relay temporar (max 1 oră) pentru blob-uri criptate end-to-end. Cheia de decriptare nu părăsește dispozitivele tale — e încorporată în linkul pe care îl trimiți doctorului. Cloudflare nu poate accesa conținutul."
- DPA Cloudflare: standard, pre-semnat la deploy (auto-acceptat la signup).
- Tu (developer, persoană fizică) ești **controller** pentru: ID-uri blob + timestamps. NU controller pentru date medicale (criptate E2E, nu ai cheia).
- Documentat în privacy policy: care date pleacă unde, ce reține Cloudflare, cât (max 1h + max 24h fallback).

### 6.7 App Lock medical

- La intrarea în ecranul detaliu `medical_record`: prompt biometric/PIN dacă au trecut >5 min de la ultima autentificare medicală.
- Independent de App Lock global. User cu App Lock OFF în Setări poate totuși să aibă lock pe medical.
- Setting în Setări → „App Lock pentru dosare medicale" (default ON).
- Hook `useMedicalLock` — recuperat din DosarMedical.

---

## 7. Securitate și privacy

### 7.1 Criptare la rest

- **AES-256-GCM** prin `@noble/ciphers` (deja în Dosar via `cloudCrypto.ts`).
- Cheia 256-bit aleatoare în `expo-secure-store`.
- AAD = `medical_record.id` per câmp criptat → empêche reaplicarea unui blob criptat la alt dosar.
- Versiunea cheii în `encryption_key_ref` (`'v1'` inițial; permite rotație în viitor fără migrare distructivă).

### 7.2 `private_notes` nu pleacă la AI

Regula globală din `app/.claude/rules/ai-privacy.md` continuă să se aplice:
- `getDocumentsForAI()` / `sanitizeDocumentForAI()` obligatorii înainte de orice apel AI.
- `medicalExtractor.ts` și `medicalChat.ts` consumă DOAR documente sanitizate.
- `medical_fts` chunks generate din `documents.ocr_text` (deja sanitizat) și `medical_document_summaries.summary` (generat dintr-un input sanitizat).

### 7.3 GDPR

| Aspect | Implementare |
|---|---|
| Consent Art. 9 | Toggle global + per-dosar. Documentat în privacy policy. Înregistrat în `ai_consent_at`. |
| Drept la ștergere | Existent — wipe dosar șterge cascade (tabele + fișiere + observații + chat + share-uri active revocate). |
| Drept la export | Backup ZIP local + cloud export (decriptat dacă userul are cheia). |
| Minimizare | Numai categoriile de observații definite. Nu colectăm telemetrie. |
| Data residency | Datele medicale rămân pe device + în iCloud-ul userului. Blob-urile share criptate E2E stau temporar (max 1h) în Cloudflare R2 — opace pentru Cloudflare. |
| Processor declarat | **Cloudflare** pentru relay temporar de blob-uri criptate E2E (share doctor). DPA Cloudflare e standard, pre-semnat la signup. AI provider BYOK (OpenAI/Mistral/Anthropic) e processor pentru utilizatorii care optează — declarat în privacy policy. |
| Zero-knowledge față de processor | Cheia AES pentru share nu părăsește dispozitivul pacientului decât prin URL fragment trimis direct la doctor. Cloudflare nu poate decripta. |

### 7.4 Backup cloud — cheia AES medicală

- Default OFF: cheia nu pleacă în backup-ul cloud. Restore pe device nou = observații rămân criptate, neaccesibile.
- Toggle ON: cheia se include în `_security.medical_key`, criptată cu parola cloud (PBKDF2 + AES-GCM). Pierderea parolei cloud = pierderea cheii.
- UX clar: warning explicit în Setări la activare („Dacă activezi, pierderea parolei cloud înseamnă pierderea accesului la date medicale pe device nou.").

---

## 8. Reutilizare din DosarMedical (matrix concretă)

| Sursă (DosarMedical) | Destinație (Dosar) | Acțiune |
|---|---|---|
| `services/medicalRecord.ts` | `services/medicalRecord.ts` | Copy + adaptare: în Dosar, `medical_record` e un `EntityType` printre altele, nu singletonul app-ului. Eliminăm orice asumpție „one app = one entity type". |
| `services/medicalObservations.ts` | `services/medicalObservations.ts` | Copy direct. |
| `services/medicalCrypto.ts` | `services/medicalCrypto.ts` | Copy direct. Folosește `cloudCrypto.ts` din Dosar. |
| `services/medicalFts.ts` | `services/medicalFts.ts` | Copy direct. |
| `services/medicalExtractor.ts` | `services/medicalExtractor.ts` | Copy + adaptare: în Dosar `aiProvider.ts` are aceeași semnătură (verificat). |
| `services/medicalChat.ts` | `services/medicalChat.ts` | Copy direct. |
| `services/medicalQueryAnalysis.ts` | `services/medicalQueryAnalysis.ts` | Copy direct. |
| `services/chatThreads.ts` (medical-specific din DosarMedical) | `services/medicalChatThreads.ts` (RENAMED) | Copy + redenumire ca să nu intre în coliziune cu `chatThreads.ts` general din Dosar. |
| `hooks/useMedicalRecord.ts` | `hooks/useMedicalRecord.ts` | Copy + adaptare să respecte hook pattern Dosar (loading/error/refresh). |
| `hooks/useMedicalChat.ts` | `hooks/useMedicalChat.ts` | Copy. |
| `hooks/useMedicalObservations.ts` | `hooks/useMedicalObservations.ts` | Copy. |
| `hooks/useMedicalLock.ts` | `hooks/useMedicalLock.ts` | Copy. |
| `components/medical/*` | `components/medical/*` | Copy folder întreg (timeline, sparkline, chat bubble). Verifică că folosesc `useColorScheme` din `@/components/useColorScheme`. |
| `app/(tabs)/entitati/medical/[id].tsx` | `app/(tabs)/entitati/medical/[id].tsx` | Copy + adaptare la routing-ul Dosar. |
| `types/index.ts` (porțiunea medicală) | merge în Dosar `types/index.ts` | Adăugare incrementală, nu replace. |
| Doctor share (bundle ZIP + criptare E2E + upload R2) | `services/medicalShare.ts` + `services/medicalShareHistory.ts` | **NOU, nu există în DosarMedical.** Scris from scratch cu `jszip` (RN), `@noble/ciphers` (criptare). |
| Cloudflare Worker relay | `cloud/share-relay/` | **NOU.** Wrangler + TypeScript, R2 + KV. Vezi §4.2b. |
| Viewer static | `cloud/share-viewer/` | **NOU.** Vite + vanilla TS + JSZip + PDF.js. Vezi §4.2b. |

**Verificare critică:** după copiere, rulează:
- `npm run type-check`
- `npm run audit`
- `node scripts/check-hardcoded-entities.js`

---

## 9. Faze și ordine de implementare

| Faza | Conținut | Durată | Output |
|---|---|---|---|
| **F1: Tipuri + schemă** | Adaugă `medical_record` în `EntityType`, cele 6 tipuri în `DocumentType`, migrare SQLite cu 6 tabele (incl. `medical_shares`) + FTS5. Audit scripts updatate. | 3-4 zile | `npm run audit` verde. App pornește, nimic vizibil nou. |
| **F2: Servicii medicale copiate** | Copy servicii din DosarMedical în Dosar, ajustare imports, type-check verde. | 3-4 zile | Servicii există dar neapelate din UI. |
| **F3: Hook-uri + componente** | Hooks + components/medical copiate și ajustate. | 2-3 zile | Pieces disponibile dar nu wired. |
| **F4: Ecran detaliu dosar** | `entitati/medical/[id].tsx` cu 3 tab-uri. Tab Timeline + Documente funcționale. Tab Chat schele. | 5-7 zile | User poate crea dosar, adăuga document, vedea observații extrase. |
| **F5: Chat AI** | Wire `medicalChat.ts` + UI complet în tab Chat. Citații, threads. | 4-5 zile | Chat funcțional cu retrieval hibrid. |
| **F6: Onboarding + Setări** | Pas onboarding opțional. Toggle consent global. Toggle backup cheie. App Lock medical. | 2-3 zile | Userul nou poate face flow complet. |
| **F7: Backup + cloud sync extins** | `backup.ts` și `cloudSync.ts` includ tabelele medicale. Audit scripts. | 2-3 zile | Backup local + iCloud funcționează cross-device (same user, Apple-only). |
| **F8a: Cloudflare Worker relay** | Crează `cloud/share-relay/` cu wrangler, R2 bucket, KV namespace pentru rate-limit. Worker cu 4 endpoints. Teste unit. Deploy pe `<name>.workers.dev`. | 2-3 zile | Endpoint live, accept upload/download de blob criptat. |
| **F8b: Viewer static** | Crează `cloud/share-viewer/` cu Vite + vanilla TS. Render Timeline + Documente + countdown TTL. Deploy pe GitHub Pages sub-path. | 4-5 zile | Pagină live; manual test cu blob de test funcționează în Safari + Chrome + browser mobil. |
| **F8c: App integration share** | `services/medicalShare.ts` (bundle ZIP + criptare + upload). `services/medicalShareHistory.ts` (DB tabel + revoke). UI: buton + sheet config + progress + modal succes + ecran istoric share-uri. | 3-4 zile | User poate genera link funcțional, copiază, trimite la doctor; doctor deschide în browser, vede tot. Revoke + expiry funcționează. |
| **F9: Polish + testare** | App Store screenshots, App Privacy labels, privacy policy update (incl. Cloudflare processor), smoke test end-to-end pe device fizic. | 5-7 zile | Build ready pentru TestFlight. |

**Total estimat:** 35-48 zile lucrătoare ≈ **7-12 săptămâni part-time** (10-15h/săptămână).

**Dependențe critice:**
- F2 depinde de F1 (DB trebuie să existe).
- F4 depinde de F2 + F3.
- F8a / F8b se pot paraleliza (Worker independent de viewer).
- F8c depinde de F8a + F8b (app trebuie să știe URL-uri reale).
- F8 (cluster) e independent de F5 — poate rula în paralel cu F5/F6/F7.
- F9 e ultimul, depinde de tot.

---

## 10. Criterii „done" pentru MVP

Un task e considerat done când:

- [ ] `npm run audit` verde (type-check + backup-audit + check-hardcoded-entities + knowledge-audit + update-site).
- [ ] Pe device fizic iOS: user creează dosar medical, scanează 3 analize, vede observații extrase în Timeline cu sparkline.
- [ ] Chat AI răspunde la întrebare „Cum a evoluat HDL-ul meu?" cu citații `OBS:...`.
- [ ] Restore dintr-un backup pe device nou: dacă userul are cheia inclusă în backup + parola cloud, vede observațiile decriptate. Dacă nu, vede badge „date criptate, cheia lipsește".
- [ ] Buton „Partajează cu medicul": user generează un link, îl trimite prin WhatsApp către alt device (simulator de doctor), doctor-ul deschide în browser și vede Timeline + documente decriptate. Revoke manual din app → linkul devine 404 imediat. După 1h fără revoke → expiră natural.
- [ ] App Lock medical declanșează la intrare după 5 min inactivitate.
- [ ] Privacy policy în Setări → Despre actualizată cu mențiuni Art. 9 + doctor share.
- [ ] App Privacy labels în App Store Connect actualizate (Health Data → Yes, Used for app functionality, Not linked to user, Not used for tracking).
- [ ] Test pe device fără AI provider configurat: app funcționează, tab Chat dezactivat cu mesaj clar, observații nu se extrag automat.

---

## 11. Riscuri și non-decizii rămase

### 11.1 Riscuri

| Risc | Mitigare |
|---|---|
| Conflict între `chatThreads.ts` (Dosar general) și threads medicale | Redenumire la copiere: `medicalChatThreads.ts`. Verificat în F2. |
| Migrare SQLite eșuează pe device-uri existente Dosar | Migrarea e ALTER + CREATE doar (nu rename / drop). În try-catch per statement. Versionare standard. |
| Calitate extracție LLM scade după update model | Confidence threshold (0.5/0.7) plus banner „revizuiește" pentru observații suspecte. Test corpus în `__tests__/medical/`. |
| User pierde Keychain → date pierdute | Toggle „include cheie în backup cloud" explicat clar. Default OFF. Userul informat explicit la creare primul dosar. |
| Bundle share prea mare pentru free tier R2 | Limită hard 100MB per share (validată în Worker). Comprimare imagini la 1600px max + JPEG q70 pentru thumbnails. Cap 50 documente per share. La depășire: error clar „Prea multe documente, restrânge intervalul". |
| Confuzia entitate: o persoană are deja documente medicale legate direct la `person` (din versiuni anterioare Dosar dinaintea split-ului) | Migrare 1: găsește persoanele cu documente medicale orfane (tip medical, fără `medical_record` asociat), oferă wizard „Crează dosar medical pentru X persoane". |
| **Cloudflare free tier depășit la creștere user base** | Free tier permite ~500 useri activi/lună (calculat: 5 share-uri × 500 useri × 30MB blob = 75GB R2 lunar peak, dar cu TTL 1h storage instantaneu rămâne sub 10GB). Trigger upgrade la primul depășit: Workers Paid ($5/lună fix) + R2 standard ($0.015/GB după 10GB). La 5000 useri activi estimăm $10-15/lună. Monitoring lunar din dashboard Cloudflare. |
| **`workers.dev` URL flagged ca suspect** de filtre email enterprise (Outlook, Gmail Workspace) | Pentru MVP acceptabil (target = utilizatori personali). Plan B: domain propriu `dosar.app` (~$10/an) cu CNAME la Worker — 1h muncă, opțional. |
| **Doctor cu browser foarte vechi nu poate decripta** (Web Crypto API necesar) | Web Crypto e suportat în orice browser ≥ 2017 (Safari 11+, Chrome 37+, Firefox 34+, Edge 12+). Pentru cazuri marginale: viewer afișează mesaj clar „Browser-ul tău nu suportă criptarea modernă. Folosește Chrome/Safari/Firefox recent." |
| **Pierderea cheii Cloudflare R2** | Cheia stă doar local pe dispozitivul pacientului per share (random per share). Nu există „cheia ta principală pe Cloudflare" — nu există ce să pierzi. Worker-ul foloseste credentials Cloudflare automat; dacă userul (developer) pierde contul, toate share-urile active se sting (max 1h impact). |
| **Worker downtime** (Cloudflare incident) | App detectează POST eșuat → afișează „Serviciul de share temporar indisponibil. Încearcă din nou peste câteva minute." Bundle local nu e șters până la confirmare upload. Cloudflare uptime istoric > 99.99% — risc nesemnificativ. |

### 11.2 Non-decizii (de discutat la review)

- **Locație ecran detaliu dosar:** `entitati/medical/[id].tsx` vs `entitati/[entityType]/[id].tsx` generic. Recomandare: dedicat (`medical/[id].tsx`) — Timeline + Chat sunt prea specifice pentru un detaliu generic.
- **Pas onboarding default ON sau OFF:** dacă pas e default ON, userii non-medical vor da skip. Dacă e OFF (link discreet), unii nu vor descoperi. Recomandare: ON, dar cu opțiune „skip" foarte vizibilă.
- **Limit observații per dosar:** rezonabil la 10.000? Sau infinit cu paginare? Recomandare: infinit, cu FTS5 ca să nu degradeze. Sparkline limitat la ultimele 20 valori per grup.
- **Specialități medicale (cardiologie, ATI, neurologie, etc.) ca taxonomie:** NU pentru MVP. Cele 10 `OBSERVATION_CATEGORIES` (lipide, hepatice, tiroidiene, etc.) acoperă filtrarea reală pe valori medicale. Specialitățile se suprapun și ar forța userul să taggheze fiecare document — adoption rate prevăzut < 20%. Dacă în faza 2 apare cerere clară: tag-uri free-form (`tags?: string[]` pe `Document`), nu enum rigid.
- **TTL share — fix 1h sau configurabil?** Recomandare: fix 1h pentru MVP. Configurabil (1h / 6h / 24h) în faza 2 dacă apare cerere. Auto-revoke după prima vizualizare = neimplementat (browserul poate refresh; nu detectăm „prima" vizualizare clean).

---

## 12. Documente conexe

- **Spec original Dosar medical (înainte de split):** `/Users/ax/work/documents/docs/superpowers/specs/2026-05-03-medical-entity-rag-design.md`
- **PLAN.md DosarMedical (implementarea matură):** `/Users/ax/work/dosarMedical/PLAN.md`
- **Reguli AI privacy:** `/Users/ax/work/documents/app/.claude/rules/ai-privacy.md`
- **Reguli backup (3-locuri):** `/Users/ax/work/documents/.claude/rules/backup.md`
- **Reguli formulare canonice:** `/Users/ax/work/documents/app/.claude/rules/dynamic-types.md` + `/Users/ax/work/dosarMedical/.claude/CLAUDE.md` §5
- **Design system:** `/Users/ax/work/documents/docs/DESIGN_SYSTEM.md`

---

## 13. Pași imediat după aprobarea spec-ului

1. Invocare skill `superpowers:writing-plans` pentru generare implementation plan detaliat (task-uri F1-F9 spart pe sub-task-uri cu fișiere concrete + checklist).
2. Plan-ul se salvează la `/Users/ax/work/documents/app/docs/superpowers/plans/2026-05-19-dosar-medical-merge.md`.
3. Implementarea începe în F1 (tipuri + schemă) — minim invaziv, audit-uri verzi imediat.
4. La final F9: decizia pe DosarMedical curent (retragere completă, archive repo, sau lăsat ca-i).
