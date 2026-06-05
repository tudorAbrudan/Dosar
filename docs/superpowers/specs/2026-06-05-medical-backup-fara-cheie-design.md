# Backup medical fără cheie de criptare — simplificare

**Data:** 2026-06-05
**Status:** Aprobat (brainstorm), pending plan
**Autor:** brainstorm cu userul

## Problema

Userul a activat „Include cheia medicală în backup cloud", a făcut backup pe telefon,
a dat restore pe alt device — și conținutul medical nu apare. Investigația a arătat:

- **Datele medicale se urcă deja** în cloud (`cloudSync.ts:119-171`) și în ZIP
  (`backup.ts:146-159`). Nu lipsesc.
- **Fișierele scanate** ale actelor medicale se urcă și ele (fără excludere medicală
  în `buildFileMap` / `enqueueFileUpload`).
- Singurul lucru care nu ajunge pe device 2 e **cheia AES** care decriptează
  observațiile + chat-ul medical.

### Root cause

`cloudSync.ts:179` urcă cheia medicală (`_security.medical_key`) **doar dacă există o
session-key** (`getSessionKey()` non-null), iar session-key apare **doar dacă userul are
parolă de criptare cloud activată**. Userul **nu are parolă de criptare cloud** → bifa
„include cheia medicală" e un **no-op silențios**: backup-ul raportează „finalizat", dar
cheia nu se scrie niciodată în manifest. Pe restore (`cloudSync.ts:1009`) nu există cheie
→ observațiile/chat-ul rămân ciphertext ilizibil.

ZIP-ul nici nu are mecanismul `_security.medical_key` → aceeași problemă, fără soluție.

## Decizia: eliminăm criptarea separată a datelor medicale

### Justificare — modelul actual e deja inconsistent

| Date medicale | Stare actuală |
|---|---|
| Fișiere scanate (PDF/poze) | **plaintext** pe disk + backup |
| Text OCR + rezumate AI (`medical_fts.chunk_text`) | **plaintext** în SQLite (decizie conștientă, `medicalFts.ts:4`, spec §7.2) |
| Observații (4 coloane) + chat (1 coloană) | criptat cu master key |

Criptarea protejează un subset minuscul, în timp ce sursa brută (fișiere + OCR + rezumate)
e deja în clar, apărată de **App Lock medical + sandbox iOS**. Eliminarea cheii
**uniformizează** la modelul deja real pentru 90% din date; nu expune nimic ce nu era deja
expus.

### Postura de securitate după schimbare

Datele medicale rămân protejate de:
1. Criptarea nativă iOS (data protection, cât device-ul e blocat).
2. **App Lock medical** (PIN/biometric pentru a deschide secțiunea) — rămâne.
3. Opțional: **parola de criptare cloud** — care criptează *tot* manifestul (medical inclus),
   nu doar medicalul.

Decizie de produs asumată de owner (trade-off GDPR Art. 9 prezentat explicit).

## Schimbări tehnice

### 1. Model de date (`services/db.ts`)

- `medical_observations`: `name_enc / value_enc / ref_min_enc / ref_max_enc` (BLOB) →
  `name / value / ref_min / ref_max` (TEXT).
- `medical_chat_messages`: `content_enc` (BLOB) → `content` (TEXT).
- Restul tabelelor medicale (`medical_record`, `medical_document_summaries`,
  `medical_shares`, `medical_chat_threads`) erau deja plaintext — neatins.
- ALTER TABLE în try-catch (pattern existent); coloane noi nullable/DEFAULT.

### 2. Migrare one-time (critic — datele existente ale userului)

La pornirea app-ului, dacă există cheia `medical_master_key_v1` în SecureStore **și**
coloanele vechi `_enc` mai au date:

1. Decriptează `_enc` cu master key → scrie în coloanele TEXT noi.
2. Șterge master key din SecureStore (`deleteMedicalMasterKey`).
3. (Opțional) marchează migrarea făcută ca să nu re-ruleze.

- Pe **telefonul userului** (are cheia): conversie curată, zero pierdere.
- Pe **device 2** (n-are cheia, are ciphertext): rândurile vechi rămân ilizibile, dar după
  ce telefonul migrează + re-face backup, restore-ul aduce datele în clar. Acesta e calea
  de recovery pentru device 2.

Migrarea e singurul loc care mai folosește funcțiile de decriptare; după ce rulează, codul
crypto poate fi șters. Implementare: modul de migrare self-contained care își ține propriul
helper de decriptare (sau rulează înainte de ștergerea `medicalCrypto.ts`).

### 3. Cod de șters (regula „fără cod mort")

- `services/medicalCrypto.ts` — eliminat complet (master key, `encryptField`,
  `decryptField`, `exportMasterKeyBase64`, `importMasterKeyBase64`). Excepție: helper-ul
  de decriptare folosit de migrare, până când migrarea e garantat rulată pe toate device-urile;
  apoi eliminat.
- `services/cloudSync.ts` — scoate blocul `_security.medical_key` la upload (175-186) și la
  restore (1008-1019); scoate importurile `medicalCrypto` + `getCloudBackupIncludesMedicalKey`.
- `services/settings.ts` — scoate `getCloudBackupIncludesMedicalKey` /
  `setCloudBackupIncludesMedicalKey` + constanta `KEY_CLOUD_BACKUP_INCLUDES_MEDICAL_KEY`.
- `app/cloud-backup.tsx` — scoate rândul-bifă „Include cheia medicală în backup cloud"
  (382-400) + handler.
- `services/medicalObservations.ts` — scrie/citește `name/value/ref_min/ref_max` TEXT direct
  (scoate `encryptField/decryptFieldOpt/decryptFieldOrNull`).
- `services/medicalChat.ts` — scrie/citește `content` TEXT direct.
- `services/medicalRecord.ts:73` + `components/medical/CreateMedicalRecordModal.tsx:73` —
  scoate `ensureMedicalMasterKey()`.

### 4. Backup / restore (`backup.ts` + `cloudSync.ts`)

- `exportBackup` + `buildManifestPayload`: observații/chat acum TEXT → JSON plain string,
  fără encoding base64 BLOB (`blobToB64` / `b64ToBlob` eliminat pentru aceste coloane).
- `applyManifest`: importă TEXT direct.
- Bump versiune manifest (ZIP + cloud) — schema coloanelor medicale s-a schimbat.

## Verificare (Definition of Done)

### Blast radius
- Schemă SQLite (`medical_observations`, `medical_chat_messages`) → `db.ts` + `backup.ts`
  + `cloudSync.ts` (regula celor 3 locuri).
- Consumatori observații/chat: `useMedicalObservations`, `useMedicalChat`, TimelineTab,
  ChatTab, `medicalExtractor.ts` (scrie observații).
- Audit: `backup-audit.js` (tabelele medicale rămân în export/import/wipe + cloudSync),
  `db-destructive-init-audit.js` (recreate pattern dacă recreăm tabela).

### Teste
- `__tests__/characterization/db.test.ts:175-188` — schimbă aserțiile BLOB → TEXT pentru
  `medical_observations` + `medical_chat_messages`.
- `__tests__/characterization/cloudSync.test.ts` — observații/chat plain în manifest.
- `npm run audit` verde.

### Manual
- Telefon cu date medicale criptate existente → pornire app → migrare rulează → timeline +
  chat încă afișează corect.
- Telefon → backup → restore pe alt device → medicalul apare complet, fără cheie/parolă.
- `legalTexts.ts` — verifică dacă politica GDPR promite „criptare date medicale"; dacă da,
  actualizează formularea.

## Out of scope
- Structura folderelor cloud pe entități → spec separat
  (`2026-06-05-cloud-files-foldere-entitati-design.md`).
- Feature cross-check RCA/vignetă/ITP la mașină → spec separat ulterior.
