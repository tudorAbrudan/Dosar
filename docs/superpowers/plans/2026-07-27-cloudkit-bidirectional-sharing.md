---
date: 2026-07-27
updated: 2026-07-28 (Increment 3 landat — Faza 2 read-write + Faza 3 parțial, implementate din decizie explicită a userului, fără să aștepte checklist-ul 2-device)
tags: [cloudkit, sharing, sync, ckshare, native-module]
status: in-progress
supersedes-parts-of: docs/superpowers/specs/2026-07-22-cloudkit-entity-sharing.md
---

# CloudKit sharing bidirecțional (read-write + alegere per share)

## STATUS — RESUME HERE (2026-07-28)

**⚠️ Faza 1 + Faza 2 landate în cod, dar UNVERIFIED on-device pe CloudKit real.**
Increment 1 + 2 + 3 sunt complete — motorul live (nativ + orchestrare + hooks +
diagnostics), permisiunea read/readwrite la share, push-back-ul participantului,
pull-ul propriu al owner-ului și supresia de ecou sunt implementate și verificate
local (type-check, audituri inclusiv `share-scope-audit.js` nou, 161 teste
characterization, build Xcode complet `npx expo run:ios` reușit pe simulator,
app pornește și randează). **Increment 3 a fost implementat înainte de checklist-ul
2-device** — userul a ales explicit „Implementează Faza 2 acum, oricum",
asumându-și riscul. **Rămâne de făcut: checklist-ul manual 2-device de mai jos**
(necesită 2 telefoane + 2 Apple ID) — până atunci fluxul CloudKit real (push/pull
între conturi, silent push, push-back readwrite, echo suppression pe hardware real)
e neverificat.

### Increment 1 — LANDAT + verificat ✅
type-check verde · 125 teste characterization verzi · backup/privacy/alter-table audits verzi.
- `services/db.ts`: coloane `change_token` + `permission` pe `shared_entities`; tabel `pending_share_pushes`.
- `services/sharing.ts`: `SharePermission`, `recordShare` upsert (preservă token la re-înregistrare),
  `get/setZoneChangeToken`, `setSharePermission`, `getZonesForDocument`, coadă `enqueue/get/delete/bumpSharePush`.
- `services/cloudShareMapping.ts`: `entityToPushRecord` + `shareableDocToPushRecord` (pure, refolosite de push granular).
- `scripts/backup-audit.js`: `pending_share_pushes` în `EXCLUDED_TABLES`.

### Increment 2 — LANDAT + verificat local ✅ (2026-07-28)
type-check verde · 148 teste characterization verzi (7 noi în `cloudShare.test.ts` +
11 noi în `sharing.test.ts`/`cloudShareMapping.test.ts`) · `npm run audit` complet
verde · build Xcode al scheme-ului `ExpoCloudKitShare` (arm64+x86_64 simulator)
**BUILD SUCCEEDED**. Semnăturile Swift verificate direct în SDK-ul instalat
(`CloudKit.swiftinterface` + headere ObjC), nu ghicite.

- **Native** (`ExpoCloudKitShareModule.swift`): `fetchZoneChanges` cu `sinceToken`/
  `newToken` (loop `moreComing`, reset pe `.changeTokenExpired`); `fetchDatabaseChanges`
  (token DB-level, aceeași paginare); `pushRecords` (LWW pe `.serverRecordChanged` cu
  merge + max 3 încercări, retry separat pe `.zoneBusy`/`.requestRateLimited` via
  `retryAfterSeconds`, chunk ≤400, curăță chei `file_*` orfane); `subscribeDatabase`
  (`CKDatabaseSubscription`); `shareZone` reprezintă share-ul existent în loc să creeze
  unul nou; `Events("onRemoteChange")` + observeri `NotificationCenter` (silent push +
  `.CKAccountChanged`). `pushBundle` și semnătura veche `fetchZoneChanges` ELIMINATE
  (fără shim — singurul consumator, `cloudShare.ts`, actualizat în lockstep).
- **AppDelegate**: `didFinishLaunchingWithOptions` (`registerForRemoteNotifications`) +
  `didReceiveRemoteNotification` → postează `ExpoCloudKitShareRemoteChange`; accept
  handler unificat pe același notification name.
- **`app.json` + `ios/Dosar/Info.plist`**: `UIBackgroundModes: [remote-notification]`
  (ambele — Xcode arhivează din Info.plist direct, nu din app.json).
- **`services/settings.ts`**: `get/setCloudKitDbChangeToken` + `get/setCloudKitDbSubscribed`
  (scope 'private'/'shared'; Increment 2 folosește doar 'shared').
- **`services/sharing.ts`**: `ENTITY_SYNC_FIELDS` (whitelist per tip entitate — decizia 7),
  `rowToShareFields` (numeric → `String(v)` — decizia 6), `getEntityShareFields`,
  `getCloudRecordsForLocal`, `deleteCloudRecord`, `setCloudRecordFileHash`,
  `markZoneSyncSuccess`/`markZoneSyncError` (diagnostics), `pending_share_pushes.kind`.
- **`services/cloudShare.ts`** (rescriere): `pushLocalChange`/`afterEntityMutation`/
  `afterDocumentMutation`/`afterDocumentUnlinked`/`flushSharePushes` (owner push, gated
  pe `role==='owner'` — inclusiv pentru documente pull-uite ca participant, fix dincolo
  de plan); `syncSharedEntities`/`pullSharedChanges`/`syncOneZone` (apply+token în
  aceeași tranzacție SQLite, token DB-level avansează doar dacă nicio zonă n-a eșuat);
  `applyEntityRow`/`applyDocumentRow` non-destructive (`ON CONFLICT DO UPDATE`, NU
  `INSERT OR REPLACE`); `applyDeletions` multi-zonă; `getShareDiagnostics`.
- **Hook-uri mutații**: `services/entities.ts` (15× create/update/delete, card exclus),
  `services/documents.ts` (7 funcții) — dynamic import (`import('./cloudShare')`) ca să
  evite ciclul static documents.ts↔sharing.ts↔cloudShare.ts.
- **`hooks/useSharingSync.ts`** (nou, mount în `_layout.tsx`): `AppState→active` +
  `onRemoteChange`. `hooks/useSharing.ts`: `diagnostics` adăugat, contract
  `{loading,error,refresh}` neschimbat.
- **UI** (`app/partajare.tsx`): `lastSyncedAt`/`lastSyncError` per rând + banner
  `pendingPushCount`. `SharingBetaSection.tsx` neschimbat (decizie de scop).
- **`scripts/share-privacy-audit.js`** extins: whitelist `ENTITY_SYNC_FIELDS`, regulă B
  lărgită, regulă E nouă (provenance `pushRecords`).

**Nu s-a atins (decizie de scop explicită, confirmată în plan):** Faza 2
(permission UI/gating, push-back participant, supresie ecou), `share-scope-audit.js`,
prag dead-letter pe coadă — toate rămân gated pe checklist-ul 2-device de mai jos.

### Increment 3 — LANDAT + verificat local ✅ (2026-07-28)
Implementat din decizie explicită a userului (`AskUserQuestion` → „Implementează
Faza 2 acum, oricum"), ÎNAINTE ca checklist-ul 2-device Faza 1 să fi trecut.
type-check verde · 161 teste characterization verzi (13 noi: 4 în `sharing.test.ts`
pentru `isEntityReadOnlyForMe`/`isDocumentReadOnlyForMe`, 9 în `cloudShare.test.ts`
pentru push-back readwrite/no-op read/pullOwnedChanges/echo suppression/stuckCount)
· `npm run audit` complet verde (inclusiv `share-scope-audit.js` nou) · build Xcode
complet (`npx expo run:ios`) reușit, app instalat și pornit pe simulator (splash
screen confirmat vizual).

- **Native** (`ExpoCloudKitShareModule.swift` + `src/index.ts`): `shareZone`
  capătă `permission?: 'read'|'readwrite'` — setat pe `CKShare.publicPermission`
  DOAR la crearea unui share nou (re-share pe zonă existentă nu-l schimbă
  retroactiv — nicio UI pentru asta încă).
- **`services/events.ts`**: `AppEvent` +1 (`'sharing:changed'`), emis din
  `recordShare`/`revokeShare`/`setSharePermission`.
- **`services/sharing.ts`**: `isEntityReadOnlyForMe`/`isDocumentReadOnlyForMe`
  (conservativ pe documente — read-only dacă legat de ORICE zonă participant
  non-readwrite, chiar dacă mai e legat și de o zonă readwrite/owned).
- **`services/cloudShare.ts`**: `pushLocalChange` extins — participant+readwrite
  pushuiește (`scope:'shared'`, `ownerName`), participant+read rămâne no-op,
  participant+delete pe entitate rămâne no-op (doar owner poate revoca zona);
  `syncOneZone` scope-agnostic (owner→`'private'`, participant→`'shared'`);
  nou `pullOwnedChanges()` (owner trage din propria zonă, DOAR pe share-uri
  readwrite); `applyFetchedRecords` cu supresie ecou generalizată (compară
  `cloud_records.change_tag` înainte de apply, pe orice cale de pull — nu doar
  owner-pull); `getShareDiagnostics().stuckCount` (prag 5 încercări, Faza 3
  dead-letter vizibil).
- **`hooks/useSharing.ts`**: `share()` capătă param `permission`.
  **`hooks/useShareReadOnly.ts`** (nou): `useEntityReadOnly`/`useDocumentReadOnly`,
  re-verifică live pe `sharing:changed`.
- **`components/ReadOnlyShareBanner.tsx`** (nou).
- **UI**: `app/partajare.tsx` (alegere „Doar citire"/„Poate edita" la share,
  badge permisiune pe rânduri owned + received, banner roșu „modificări blocate"
  pe `diagnostics.stuckCount > 0`); `app/(tabs)/entitati/[id].tsx`
  + `app/(tabs)/documente/[id].tsx` + `app/(tabs)/documente/edit.tsx` — banner
  + gard pe fiecare handler de mutație directă + `disabled`/`saveDisabled` pe
  butoanele de edit/delete/save.
- **`scripts/share-scope-audit.js`** (nou, adăugat în `npm run audit`): flag
  orice `enqueueSharePush` cu `scope:'shared'` NEGARDAT de
  `permission==='readwrite'` în `services/cloudShare.ts`.

**Gap închis (2026-07-28, follow-up imediat):** `components/VehicleMaintenanceSection.tsx`
și `components/PropertyProvidersSection.tsx` au primit prop `readOnly?: boolean`,
trecut din `entitati/[id].tsx` (`readOnly={isReadOnly}`). Pattern: blocare completă
via `Alert` (nu partial-view-with-disabled-save) pe orice handler de mutație —
`openAddModal`, `handleTaskOptions` (mentenanță: marchează efectuat/editează/șterge),
`openEditModal`/`handleLongPress`/`handleSave` (furnizori) — consistent cu
pattern-ul deja stabilit în `entitati/[id].tsx`/`documente/[id].tsx` (block
complet la intrare în modal, nu view-only cu save dezactivat). Butonul „+ Adaugă
furnizor" e vizual dezactivat (opacity 0.4) când `readOnly`; butonul „Mentenanță"
din `BottomActionBar` (`topActions`) la fel, via `disabled: isReadOnly`.
type-check verde, `npm run audit` verde (161 teste neschimbate — aceste două
fișiere sunt componente UI fără characterization tests dedicate, verificate prin
citire de cod + build Xcode + verificare vizuală manuală a fluxului happy-path
neregresat). Fluxul read-only (Alert-ul de blocare) NU a putut fi verificat vizual
— cere un share real primit ca participant, imposibil de simulat fără al doilea
cont iCloud.

**NU verificat (cere CloudKit real sau 2 device-uri fizice):** push-back real
participant→owner, silent push pe baza privată a owner-ului la editare
participant, echo suppression pe hardware real, matricea 2-device completă
(inclusiv Faza 2 din checklist-ul de mai jos, care încă nu există ca items
separate — vezi „Checklist test Faza 1" de mai jos, neschimbat; Faza 2 ar
merita propriile items dar nu au fost adăugate în acest increment).

### Checklist test Faza 1 pe TestFlight (read-only propagation)
1. Owner partajează entitate → participant deschide link → entitatea + docurile apar.
2. Owner **adaugă** un document → apare la participant. Live prin silent push SAU la aducerea
   în foreground / pull-to-refresh — push-ul e best-effort (throttling iOS), fallback-ul e garanția.
3. Owner **editează** o notă/dată → se actualizează la participant.
4. Owner **șterge** un document → dispare la participant.
5. Owner revocă → participant pierde accesul.
6. Editare owner **offline** → se propagă la revenirea online (coada `pending_share_pushes`).
7. **Privacy:** participantul NU vede documente medicale / `private_notes`.
8. Participantul NU poate edita (read-only) — nu există push-back în Faza 1.
9. Participantul setează un **reminder** pe un doc partajat → supraviețuiește următorului sync
   (apply non-destructiv; cu `INSERT OR REPLACE` ar fi CASCADE-șters).
10. Doc legat de **două** entități partajate → revocarea/unlink-ul unei zone NU șterge doc-ul
    la participant cât timp rămâne în cealaltă.
11. Participant cu app **force-quit** → owner editează → participantul redeschide app-ul →
    schimbarea apare (sync pe foreground, fără push).

### Checklist test Faza 2 pe TestFlight (read-write push-back) — de făcut

Notă: itemul #8 din checklist-ul Faza 1 de mai sus presupunea read-only universal
— nu mai e adevărat pentru share-uri readwrite, verifică comportamentul nou aici.

1. Owner partajează cu „Poate edita" → participantul vede badge „Poate edita" în
   „Partajat cu mine"; NU vede `<ReadOnlyShareBanner>` pe ecranele de detaliu.
2. Participant readwrite **editează** o entitate/document → owner primește
   editarea (live prin silent push pe `scope:'private'` SAU la foreground).
3. Owner **își editează propria zonă** DUPĂ ce participantul a pushuit — nu se
   pierde nimic (supresie ecou pe hardware real, nu doar în teste locale).
4. Owner partajează cu „Doar citire" → participantul vede `<ReadOnlyShareBanner>`
   pe ecranele de detaliu, butoanele de edit/delete/save sunt dezactivate, orice
   încercare directă de mutație (dacă e posibilă prin `VehicleMaintenanceSection`/
   `PropertyProvidersSection` — gap cunoscut, vezi Increment 3) e no-op silențios
   la nivel de sync, nu produce eroare vizibilă.
5. Owner revocă un share readwrite CÂT TIMP participantul are o editare
   netrimisă (offline) → la reconectare, push-ul participantului nu mai are
   unde ajunge (zonă revocată) — verifică că nu crapă, doar eșuează silențios.
6. Participant readwrite **șterge local** copia entității-rădăcină → NU
   propagă ștergerea la owner (doar owner poate revoca zona — decizia 2).
7. `getShareDiagnostics().stuckCount` — forțează un push să eșueze repetat
   (ex. offline prelungit) și verifică că banner-ul roșu „modificări blocate"
   din `partajare.tsx` apare după 5 încercări eșuate.

## Context

Sharing-ul curent (`services/cloudShare.ts` + `modules/expo-cloudkit-share`) e un
**snapshot read-only one-directional**: owner-ul urcă bundle-ul o singură dată la
`shareEntity`, participantul doar trage la mount. Editările owner-ului **nu se
propagă**, participantul **nu poate edita**, nu există sync live. Fix-ul recent
(`CKSharingSupported` în Info.plist + app.json) a deblocat *acceptarea* linkului;
Production e deployed și testat pe 2 device-uri.

Userul cere: (1) update-uri live, (2) editare de către participant, (3) sync
bidirecțional, (4) alegere read-only / read-write per share.

## Decizii luate (2026-07-27)

- **Motor sync:** extindem modulul manual `CKDatabase` existent (NU CKSyncEngine).
  Motiv: CKSyncEngine cere iOS 17; deployment target-ul e **iOS 16.0**. Rămânem pe 16.
  (Notă: dacă target-ul urcă vreodată la 17, CKSyncEngine elimină din oficiu punctele
  2-5 din review-ul de robustețe — scheduling, retry, tokens, account changes.)
- **Conflicte:** **record-level last-writer-wins** cu guard `.ifServerRecordUnchanged`.
  Fără merge pe câmpuri, fără UI de conflict.

## Decizii de robustețe (review 2026-07-28)

Adăugate ÎNAINTE de Increment 2 pentru că schimbă forma modulului nativ și a orchestrării.
Primele două ar fi ars iterații de TestFlight.

1. **Subscripții = `CKDatabaseSubscription`, una per DB, NU per zonă.** Confirmat docs Apple
   ([CKRecordZoneSubscription](https://developer.apple.com/documentation/cloudkit/ckrecordzonesubscription)):
   *„Only the private database supports record zone subscriptions. If you attempt to save a
   record zone subscription in a public or shared database, CloudKit returns an error."*
   `subscribeZone` pe participant (shared DB) ar fi eșuat direct. Flux corect: silent push →
   `fetchDatabaseChanges` (token DB) → zonele schimbate → `fetchZoneChanges` (token per zonă).
2. **Silent push = accelerator, nu garanție.** `content-available` e throttluit de iOS (buget,
   Low Power Mode, force-quit). Liveness garantat = sync pe `AppState → active` + după accept +
   pull-to-refresh. Testele „live" se citesc cu fallback-ul ăsta în minte.
3. **Atomicitate token ↔ date:** apply-ul unei zone și salvarea `change_token` în ACEEAȘI
   tranzacție SQLite. Altfel un crash mid-apply pierde definitiv schimbările (tokenul a avansat).
4. **Apply non-destructiv:** `ON CONFLICT(id) DO UPDATE` pe coloanele sincronizate; interzis
   `INSERT OR REPLACE` pe `documents`/entități (null-uie coloanele nesincronizate + FK
   `ON DELETE CASCADE` șterge copiii — ex. reminderele participantului). Candidat de audit
   script nou: `INSERT OR REPLACE` pe tabele cu copii CASCADE.
5. **`pushRecords` cu politică de eșec explicită:** rezultate per-record, LWW re-save max 3,
   `retryAfterSeconds`, chunk ≤400/op, CKAsset doar la hash de fișier schimbat.
6. **Serializare numerică:** coloanele INTEGER/REAL pleacă azi tăcut nicăieri (filtrul
   `typeof v === 'string'`); se includ ca `String(v)`, SQLite affinity convertește la apply.
7. **Whitelist și pe entități:** azi doar documentele sunt whitelisted; `getShareBundle` trimite
   TOATE string-urile din rândul entității → o coloană sensibilă viitoare ar scurge implicit.
   Whitelist per tip de entitate + extinde `share-privacy-audit.js` pe `entityFields`.
8. **`CKAccountChanged`:** schimbare/delogare cont iCloud → pauză sync + re-verificare
   `accountStatus`; starea de share locală aparține contului vechi.
9. **Faza 2 — supresie ecou:** owner-ul care trage propria zonă privată își primește înapoi
   propriile push-uri; un ecou vechi peste o editare locală mai nouă = clobber. Skip pe
   `changeTag` identic cu `cloud_records.change_tag` (sau `lastModifiedUserRecordID` == self).

## Invariante care NU se strică (privacy — testate azi)

- `MEDICAL_DOC_TYPES` și `private_notes` NU pleacă NICIODATĂ (whitelist
  `SHAREABLE_DOC_FIELDS` + `assertNoSensitiveLeak` în `services/sharing.ts`).
- **Orice cale nouă de push** (inclusiv push-back participant) serializează prin
  `toShareableDocument` / `getShareBundle` — niciodată `SELECT *` → push brut.
- Enforcement: `scripts/share-privacy-audit.js` (extins) + `sharing.test.ts`.
- **Gap cunoscut (fix în Increment 2, decizia 7):** whitelist-ul acoperă azi doar documentele;
  `entityFields` din `getShareBundle` e blanket (toate coloanele string ale rândului). Se
  adaugă whitelist per tip de entitate + audit pe `entityFields`, altfel o coloană sensibilă
  viitoare pe `persons`/`vehicles` scurge implicit în share.

---

## Faza 1 — Owner → participant LIVE (rămâne read-only)

Livrează „primesc update-uri". Zero conflicte (doar owner scrie) → risc mic.

### Native (`ExpoCloudKitShareModule.swift` + `src/index.ts`)
- `fetchZoneChanges({..., sinceToken?}) → { records, deletedRecordNames, newToken }`
  — token incremental (`CKServerChangeToken` serializat base64 via `NSKeyedArchiver`).
  Înlocuiește `since: nil` full-fetch.
- `fetchDatabaseChanges({ scope, sinceToken? }) → { changedZones, deletedZones, newToken }`
  — token DB-level, separat de cele per zonă. Participantul află ce zone s-au schimbat /
  au dispărut fără să le viziteze pe toate.
- `pushRecords({ zoneName, scope, ownerName, records[], deletions[] })` — push
  granular per-record (create/update/delete individual), NU tot bundle-ul.
  `savePolicy = .ifServerRecordUnchanged`; pe `serverRecordChanged` → merge câmpurile
  noastre pe server record, re-save (LWW), max 3 încercări. Rezultate per-record,
  `retryAfterSeconds` respectat, chunk ≤400/op, CKAsset doar la hash schimbat.
- `subscribeDatabase({ scope })` — `CKDatabaseSubscription` cu
  `shouldSendContentAvailable = true` (silent push, fără server). NU zone subscription:
  nesuportat în shared DB (vezi „Decizii de robustețe" #1).
- `shareZone` fix: fetch `CKRecordNameZoneWideShare` existent înainte de a crea CKShare
  nou (re-share pe zonă deja partajată altfel eșuează).
- Event emitter: `Events("onRemoteChange")` + `sendEvent`. Wiring:
  - `AppDelegate.didReceiveRemoteNotification` (silent push CloudKit) → `onRemoteChange`.
  - Accept handler (`userDidAcceptCloudKitShareWith`) → `onRemoteChange` (înlocuiește
    `NSNotification` nefolosit) ca participantul să tragă imediat după accept.
- `app.json` + Info.plist: `UIBackgroundModes: [remote-notification]`.

### DB (`services/db.ts`) — ambele tabele sunt LOCAL-ONLY (excluse din backup deja)
- `ALTER TABLE shared_entities ADD COLUMN change_token TEXT` (în try-catch, `safeAlterTable`).
- `CREATE TABLE pending_share_pushes (id, zone_name, record_name, op TEXT, scope TEXT,
  owner_name TEXT, attempt_count INTEGER, created_at)` — coadă offline, model
  `pending_uploads` (db.ts:188).
- **Fără** modificări în `backup.ts` / `cloudSync.ts` (EXCLUDED_TABLES, backup-audit.js:45-46).

### Servicii (`services/cloudShare.ts`, `services/sharing.ts`)
- `pushLocalChange(localTable, localId, op)`: rezolvă zona (owner: prin
  `getCloudRecordForLocal` sau `getZoneForEntity`/`getZonesForDocument` pentru
  recorduri noi), serializează via whitelist, apelează native `pushRecords`.
- `getZoneForEntity(entityType, entityId)` + `getZonesForDocument(docId)` — join
  `document_entities` × `shared_entities` (un doc legat de o entitate partajată → în zonă).
- `enqueueSharePush` / `flushSharePushes` — coada offline (retry la sync + după mutație când online).
- `syncSharedEntities`: `fetchDatabaseChanges` → doar zonele schimbate → pull incremental cu
  `change_token` per zonă; apply + token în aceeași tranzacție SQLite; upsert
  `ON CONFLICT DO UPDATE` (nu `INSERT OR REPLACE`); aplică deletions
  (`applyDeletions`: șterge rânduri + fișiere + `cloud_records`; doc în două zone → șters
  doar la dispariția din ultima).
- Triggere sync: `AppState → active` + după accept + pull-to-refresh (garanția);
  `onRemoteChange` (acceleratorul). `CKAccountChanged` → pauză + re-verificare cont.
- Serializare: coloanele numerice pleacă și ele (ca `String(v)`), nu doar string-urile.

### Hook mutații (`services/entities.ts`, `services/documents.ts`)
- Helper thin la finalul fiecărei mutații: `afterEntityMutation(type,id,op)` în
  create/update/delete{Person,Property,Vehicle,Animal,Company}; `afterDocumentMutation(id,op)`
  în createDocument/updateDocument/deleteDocument/addDocumentPage/removeDocumentPage/
  add|removeEntityLinkToDocument. Helper-ul e no-op dacă recordul nu e într-o zonă partajată.

### Audit + teste
- `sharing.test.ts`: token round-trip, delete apply, zone-resolution doc→zonă.
- Extinde `share-privacy-audit.js`: `pushRecords`/`pushLocalChange` trebuie să
  provină din `toShareableDocument`/`getShareBundle`.

---

## Faza 2 — Read-write + alegere per share

### DB
- `ALTER TABLE shared_entities ADD COLUMN permission TEXT NOT NULL DEFAULT 'read'`
  ('read' | 'readwrite').

### Native
- `shareZone({..., permission})` → `publicPermission = permission == 'readwrite'
  ? .readWrite : .readOnly`.

### Servicii
- `pushLocalChange` pe partea participant: `scope='shared'`, `ownerName` din share,
  **gated pe `permission === 'readwrite'`** (read-only → editările rămân locale,
  nu se urcă).
- `syncSharedEntities`: pentru share-uri readwrite, **owner-ul trage și el**
  (participantul scrie în zona owner-ului din private DB → owner pull scope='private'
  cu token). Azi owner-ul e sărit — schimbă doar pentru readwrite.
- **Supresie ecou (obligatoriu, decizia 9):** owner-ul care își trage propria zonă privată
  primește înapoi și PROPRIILE push-uri; un ecou vechi aplicat peste o editare locală mai
  nouă = clobber. Skip recordurile cu `changeTag` identic cu `cloud_records.change_tag`
  (sau `lastModifiedUserRecordID` == userul curent).
- LWW se aplică simetric (deja în `pushRecords`).

### UI (`app/partajare.tsx`, `components/settings/SharingBetaSection.tsx`)
- La share: selector „Doar citire" / „Poate edita" → `permission`.
- Badge permisiune în lista de share-uri.
- Participant pe share read-only: gate pe afordanțele de edit (buton disabled +
  banner „Doar citire"). Localizează în ecranele de detaliu entitate/document.

### Audit
- `scripts/share-scope-audit.js` (NOU): niciun push pe cale participant fără guard
  `permission === 'readwrite'`. Legat de `npm run audit` + pre-commit.

---

## Faza 3 — Hardening

- Characterization: pending-queue idempotency, LWW resolution (inclusiv cap-ul de 3 re-save),
  privacy pe push-back, permission gating, upsert non-destructiv (coloanele locale supraviețuiesc),
  supresie ecou.
- Edge cases: offline edit → propagare la revenire; revoke în timpul editării;
  conflict pe CKAsset; participant șterge doc pe readwrite; schimbare cont iCloud mid-sync
  (`CKAccountChanged`); doc în două zone partajate — delete dintr-una singură; re-share pe
  zonă deja partajată; force-quit → fără silent push (fallback foreground).
- Coada `pending_share_pushes`: prag de atenționare la `attempt_count` mare (dead-letter
  vizibil în `SharingBetaSection`, nu retry infinit tăcut).
- Matrice completă 2-device (vezi Verificare).

---

## Verificare (Definition of Done)

### Automat (rulez eu)
- `npm run type-check`, `npm run audit` (backup-audit rămâne verde — tabele excluse),
  `npm run test:characterization`.

### Manual 2-device (SINGURA verificare reală — necesită user, 2 telefoane + 2 Apple ID)
1. Owner share **read-write** → participant deschide link.
2. Owner adaugă document → apare la participant (live, silent push).
3. Participant editează notă document → apare la owner.
4. Ambii editează același câmp → ultimul salvat câștigă.
5. Owner șterge document → dispare la participant.
6. Owner revocă → participant pierde accesul.
7. Share **read-only** → participant NU poate edita (UI gated), fără push-back.
8. Editare offline → se propagă la revenirea online.
9. **Privacy:** participantul NU vede documente medicale / `private_notes` (nici pe push-back).

## Blast Radius (consumatori de verificat colateral)
- `app/partajare.tsx`, `components/settings/SharingBetaSection.tsx` — UI sharing (+ starea
  de diagnostics per zonă).
- `app/_layout.tsx` — wiring `AppState → active` sync + observer `CKAccountChanged`/`onRemoteChange`.
- `hooks/useSharing.ts` — contract `{loading,error,refresh}` păstrat.
- `services/entities.ts` (5×create/update/delete), `services/documents.ts` (7 mutații) — hook push.
- `services/settings.ts` (sau kv echivalent) — stocarea token-ului DB-level (`fetchDatabaseChanges`).
- `scripts/backup-audit.js` — trebuie să rămână verde (tabele excluse).
- `scripts/share-privacy-audit.js`, `sharing.test.ts`, `cloudShareMapping.test.ts`.

## Apendice — semnături CloudKit verificate (docs Apple, 2026-07-27)

Verificate ca Increment 2 să compileze din prima (nu ghicite). iOS 16-safe.

```swift
// 1. Fetch incremental — recordZoneChanges(inZoneWith:since:) async
let result = try await db.recordZoneChanges(inZoneWith: zoneID, since: token) // token: CKServerChangeToken?
// membri: result.modificationResultsByID, result.deletions, result.changeToken, result.moreComing
// token serialize: NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true).base64EncodedString()
// deserialize:     NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
// on CKError.changeTokenExpired → reia cu token = nil

// 2. Save cu politică LWW — modifyRecords(saving:deleting:savePolicy:atomically:) async
let (saveResults, _) = try await db.modifyRecords(
  saving: records, deleting: ids, savePolicy: .ifServerRecordUnchanged, atomically: false
) // → (saveResults: [CKRecord.ID: Result<CKRecord, Error>], deleteResults: ...)

// 3. Conflict LWW — pe serverRecordChanged, merge pe SERVER record + re-save
if let ckError = error as? CKError, ckError.code == .serverRecordChanged,
   let serverRecord = ckError.userInfo[CKRecordChangedErrorServerRecordKey] as? CKRecord {
  for key in ours.allKeys() { serverRecord[key] = ours[key] }
  // re-save serverRecord (are change-tag-ul corect; client/ancestor dau iar conflict)
}

// 4. Database changes (ce zone s-au schimbat) — databaseChanges(since:) async (verificat 2026-07-28)
let ch = try await db.databaseChanges(since: dbToken) // dbToken: CKServerChangeToken?
// → (modifications: [CKDatabase.DatabaseChange.Modification],
//    deletions:     [CKDatabase.DatabaseChange.Deletion],
//    changeToken:   CKServerChangeToken, moreComing: Bool)
// Modification/Deletion poartă zoneID → lista zonelor de fetch-uit / de curățat local.

// 5. Subscripție DB — CKDatabaseSubscription, una per DB (verificat 2026-07-28: zone
// subscriptions sunt suportate DOAR în private DB; în shared/public DB salvarea dă eroare)
let sub = CKDatabaseSubscription(subscriptionID: "shared-db-changes")
let info = CKSubscription.NotificationInfo()
info.shouldSendContentAvailable = true
sub.notificationInfo = info
_ = try await db.modifySubscriptions(saving: [sub], deleting: [])
// → (saveResults: [CKSubscription.ID: Result<CKSubscription, Error>], deleteResults: ...)
```

Surse: [recordZoneChanges](https://developer.apple.com/documentation/cloudkit/ckdatabase/3856522-recordzonechanges),
[modifyRecords(savePolicy)](https://developer.apple.com/documentation/cloudkit/ckdatabase/3794323-modifyrecords),
[serverRecordChanged](https://developer.apple.com/documentation/cloudkit/ckerror/code/serverrecordchanged),
[databaseChanges + modifySubscriptions (CKDatabase)](https://developer.apple.com/documentation/cloudkit/ckdatabase),
[CKRecordZoneSubscription — „Only the private database supports record zone subscriptions"](https://developer.apple.com/documentation/cloudkit/ckrecordzonesubscription),
[sample-cloudkit-sync-engine](https://github.com/apple/sample-cloudkit-sync-engine/blob/main/SyncEngine/SyncedDatabase.swift).
