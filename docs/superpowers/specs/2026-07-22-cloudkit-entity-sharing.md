# Spec — Partajare entități între conturi (household) prin CloudKit

**Data:** 2026-07-22
**Status:** brainstormed
**Owner:** Tudor
**Estimat:** 3-5 săptămâni part-time (spike inclus)
**Context memorie:** `memory/project_apple_only_cloudkit_sharing.md`, `memory/dosar_schema_propagation.md`, `memory/dosar_medical_chatbot_leak.md`

---

## 1. Context

Userul vrea să partajeze o **entitate** (ex. o mașină) cu soția, ambii având **acces live bidirecțional**: ultima versiune a documentelor + fișierelor se sincronizează la amândoi, cu posibilitate de **revocare**. NU snapshot — acces live.

Aplicația e **Apple-only** (deși `CLAUDE.md` mai menționează Android, în practică nu se livrează — vezi memoria). Asta permite mizarea pe stack Apple-native.

### Ce există deja (și de ce NU acoperă cazul)

- `services/cloudStorage.ts` + `cloudSync.ts` + `cloudCrypto.ts` = backup **criptat, single-account, cross-device** în containerul iCloud propriu (`iCloud.com.ax.documente`, via `react-native-cloud-storage`, scope Documents). Manifest + snapshots + LWW + queue `pending_uploads`.
- **De ce nu se refolosește ca transport:** containerul iCloud Documents e per-Apple-ID. Soția are alt container; nu se văd reciproc. Sharing-ul între conturi e un mecanism **nou, lângă** cel existent — nu o extensie a lui. Backup-ul actual rămâne neatins.

### Ce de-riscă implementarea

- **Precedent modul nativ Swift:** `modules/expo-perspective-crop/` și `modules/pdf-renderer/` (cu `expo-module.config.json` + `.podspec` + Swift). Tooling-ul pentru un modul CloudKit nativ există deja.
- **Entitlements iCloud parțial configurate** în `app.json`: `usesIcloudStorage: true`, container `iCloud.com.ax.documente`. **Lipsă:** `"CloudKit"` în `com.apple.developer.icloud-services` (acum doar `"CloudDocuments"`) + `aps-environment` (push pentru sync live).
- **Model de date simplu:** o entitate = 1 rând într-una din 7 tabele (persons/properties/vehicles/cards/animals/companies/service_providers). Documente legate prin junction `document_entities`. Fișiere = `documents.file_path` + `document_pages.file_path` (relativ în DocumentsDirectory).

---

## 2. Decizii (luate la brainstorming, 2026-07-22)

| # | Decizie | Motiv |
|---|---|---|
| D1 | **Transport = CloudKit** (CKShare pe zonă dedicată), NU folder iCloud Drive partajat | Folderul partajat e lent, fără push, risc corupție la scriere concurentă. CloudKit = sync live + push + sharing nativ. |
| D2 | **Payload per-record + `CKSyncEngine`** (nu bundle criptat pe entitate) | Conflict per-record LWW: soția editează talonul, tu RCA-ul → ambele supraviețuiesc. Fișierele oricum devin CKAsset. CKSyncEngine duce bookkeeping-ul. |
| D3 | **Bump `deploymentTarget` 16.0 → 17.0** | `CKSyncEngine` cere iOS 17. Renunțăm la iOS 16 (feature nou oricum). Evită hand-roll pe change tokens + subscriptions. |
| D4 | **Zero backend, zero conturi proprii** | Identitate = contul iCloud. Criptare + key recovery = Apple + Advanced Data Protection. Sustenabilitate: ~0 cost, ~0 ops. |
| D5 | **O `CKRecordZone` per entitate partajată** | Sharing curat pe iOS = la nivel de zonă. `CKShare` pe zonă partajează entitatea + documentele + fișierele ei. Un record trăiește într-o singură zonă. |
| D6 | **SQLite rămâne sursa locală de adevăr** | Entitățile nepartajate nu pleacă niciodată de pe device. Doar cele marcate „shared" se oglindesc în CloudKit. Offline-first păstrat. |
| D7 | **Privacy: `private_notes` + `MEDICAL_DOC_TYPES` NICIODATĂ în zona partajată** | Consecvent cu `ai-privacy.md` + leak-ul medical rezolvat. Default-exclude, opt-in explicit per share. |
| D8 | **Audit script ÎNAINTE de feature** (`share-privacy-audit.js`) | Regula „regresie → audit întâi": plasa de siguranță se scrie înaintea codului care ar putea scurge, nu după. |
| D9 | **UI de invitație + revocare = `UICloudSharingController` nativ** | Sheet-ul standard Apple: invite link, listă participanți, revoke. Gratis, familiar userului. Revocare forward-only. |
| D10 | **Feature flag „Beta partajare"** la launch | Testare pe 2 device-uri fizice + 2 Apple ID-uri înainte de enable global. |

---

## 3. Arhitectură

```
Device A (owner)                    CloudKit                     Device B (soția)
─────────────────                ─────────────                   ─────────────────
SQLite (sursă)                                                   SQLite (sursă)
  entitate ── shared? ──►  CKRecordZone "entity_<id>"  ──CKShare──►  Shared DB
    ├─ entity record          ├─ CKRecord (persons/vehicle/…)
    ├─ N documente            ├─ CKRecord/doc (parent → entity)
    └─ fișiere                └─ CKAsset/fișier (lazy)

Sync: CKSyncEngine delegate  ⇄  push/pull deltas  ⇄  CKSyncEngine delegate
      mapează CKRecord ↔ rând SQLite; LWW pe recordChangeTag
Push: CKDatabaseSubscription → notificare silențioasă → sync
```

**Ce NU construim (Apple duce):** conturi, criptare, key recovery, sync fișiere, UI invitație/revocare, hosting.

---

## 4. Model de date & maparea CKRecord

### Schemă (Faza 1 — IMPLEMENTAT 2026-07-23)

**Decizie rafinată vs schița inițială:** în loc de coloane `ck_*` pe fiecare tabel
de entitate (ar polua backup-ul userului cu ID-uri CloudKit device-specific), am
adăugat **două tabele LOCAL-ONLY** care izolează complet starea CloudKit:

- `shared_entities` — registru: `id, entity_type, entity_id, zone_name, role
  (owner|participant), share_url, owner_name, created_at, revoked_at`.
- `cloud_records` — mapare rând↔CKRecord: `id, zone_name, record_name,
  record_type, local_table, local_id, change_tag, synced_at` (UNIQUE
  zone_name+record_name; index pe local_table+local_id).

Ambele **excluse din backup** (`scripts/backup-audit.js` → `EXCLUDED_TABLES`),
ca `cloud_state`/`pending_uploads`. Restore pe device nou reconstruiește starea
din CloudKit, nu din backup. **Zero coloane** adăugate pe tabelele de entitate/
documente → zero risc pe lanțul de propagare backup.

Store CRUD în `services/sharing.ts`: `recordShare`, `getSharedEntities`,
`getShareForEntity`, `revokeShare`, `upsertCloudRecord`, `getCloudRecord`,
`getCloudRecordForLocal`, `zoneNameFor`. Testat: `__tests__/characterization/sharing.test.ts`.

### Maparea rând → CKRecord

| SQLite | CKRecord | Note |
|---|---|---|
| rând entitate (ex. `vehicles`) | `CKRecord` type = tabelul, în zona entității | recordul-rădăcină al zonei |
| rând `documents` | `CKRecord` type `document`, `parent` → entity record | fără `private_notes` |
| `document_entities` (junction) | referință pe recordul document | many-to-many colapsează în refs |
| `documents.file_path` + `document_pages` | `CKAsset[]` pe recordul document | lazy download la deschidere |

**Excluse din serializare (D7):** `private_notes`; orice document cu `type ∈ MEDICAL_DOC_TYPES`; store-ul medical criptat (`medical_record` etc.) nu intră niciodată.

### `SHAREABLE_TABLES`

Sursă unică pentru ce e partajabil. Entitățile de bază da; medical/carduri-cu-note-sensibile tratate cu opt-in sau excluse. De definit exact în Faza 1.

---

## 5. Plan pe faze

### Faza 0 — Spike de validare (1-3 zile) ⚠️ înainte de orice cod de produs
Dovedești `CKShare` round-trip între **2 conturi iCloud pe 2 device-uri fizice**.
- Patch entitlements: `"CloudKit"` în icloud-services + `aps-environment` (Expo config plugin).
- Provisioning Apple Developer: CloudKit container + push cert (**pas manual în portal, owner**).
- Modul nativ minimal `expo-cloudkit-share` (pattern `expo-perspective-crop`): create zone → create `CKShare` → prezintă `UICloudSharingController` → accept → write/read 1 record.
- **Test = 2 iPhone fizice + 2 Apple ID.** Simulatorul NU acoperă CloudKit sharing (cf. `backup.md`).
- **Gate:** dacă pică (provisioning/accept share), oprim aici, cost minim.

### Faza 1 — Model de date + privacy
- **PRIMUL:** `scripts/share-privacy-audit.js` — fail dacă un path de share serializează `private_notes` sau `MEDICAL_DOC_TYPES`. Leagă de `npm run audit` + pre-commit.
- Coloane de sync + tabel `shared_entities` (§4) → propagare 3 locuri + `backup-audit.js`.
- `SHAREABLE_TABLES` + maparea rând → CKRecord.
- Bump `deploymentTarget` la 17 (`app.json` + prebuild).

### Faza 2 — Sync engine (nativ)
- Delegate `CKSyncEngine`: push local→cloud, pull cloud→local, LWW pe `recordChangeTag`.
- Fișiere ca `CKAsset` lazy (metadata mereu, blob la deschidere, cache local).
- Reconciliere cu SQLite; entități nepartajate nu pleacă.
- **Coexistență cu `cloudSync.ts`:** izolare clară, cele două sisteme iCloud nu se calcă. Entitatea partajată rămâne și în backup-ul local propriu (fiecare are copie locală — OK).

### Faza 3 — UI (RO, design system EVPoint + #9EB567)
- Buton „Partajează" pe ecranul entității → `UICloudSharingController`.
- Opt-in explicit categorii sensibile (default excluse). „Toată entitatea" = tot minus medical/`private_notes`, cu bifă vizibilă.
- La soție: „Partajat cu mine" (inbox), badge pe entități partajate, „Cine are acces" + revocare, banner „forward-only".
- Formulare noi → `FormPageScreen`/`FormSheetModal`.

### Faza 4 — Hardening + teste
- Edge cases: un-share, ștergere entitate → cleanup orphan pe celălalt device; quota; offline queue; conflict.
- Characterization tests pe maparea CKRecord↔SQLite (partea testabilă fără device).
- Documentat explicit ce **cere 2 device-uri fizice** (nu intră în CI).
- Interacțiune backup/restore cu entități partajate.

---

## 6. Privacy & audit (non-negociabil)

- `private_notes` + `MEDICAL_DOC_TYPES` excluse din orice serializare CloudKit (D7).
- `share-privacy-audit.js` scris **înaintea** feature-ului (D8), în `npm run audit` + pre-commit.
- Testare manuală înainte de release: pune „CVV_TEST_9876" în `private_notes`, partajează entitatea, verifică pe device-ul soției că NU apare (analog testului din `ai-privacy.md`).

---

## 7. Riscuri

1. **iOS 17 vs 16** — rezolvat prin D3 (bump).
2. **Testare cere 2 device-uri fizice + 2 Apple ID** — friction permanent, neacoperit de simulator/CI. Cel mai subestimat cost.
3. **Provisioning Apple Developer** (CloudKit container, push cert) — pas manual portal, owner.
4. **Două sisteme iCloud coexistă** — izolare necesară (Faza 2).
5. **Modul nativ = întreținere la upgrade Expo/iOS** — mică, dar reală.
6. **Un record trăiește într-o zonă** — mutarea unei entități existente în zonă partajată = creare records în zona nouă + marcare locală.

---

## 8. Open questions

- Cardurile (fără CVV, dar cu note sensibile) — shareable cu opt-in sau excluse complet?
- Entitate partajată ștearsă de owner → se șterge și la participant, sau devine copie locală „orfană"?
- Câți participanți max per entitate (household = 2, dar API permite mai mulți)?
- Interacțiune cu `entity_order` / vizibilitate — entitățile „partajate cu mine" apar în aceleași tab-uri?
