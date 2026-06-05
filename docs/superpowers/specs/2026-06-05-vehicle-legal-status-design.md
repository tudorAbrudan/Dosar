# Status legal mașină — cross-check RCA/ITP/Rovinietă + dublură

**Data:** 2026-06-05
**Status:** Aprobat (brainstorm), pending plan
**Origine:** scenariul real al userului — RCA dublat + rovinietă lipsă → amenzi de vignetă.

## Problema

Dosar nu avertizează când acoperirea legală a unei mașini e incompletă sau dublată:
- `vehicleStatus.ts` (cărămizi RCA/CASCO/ITP/consum) **nu include rovinieta** și arată doar
  documentele existente, nu și obligațiile lipsă.
- `homeAlerts.ts` verifică doar *existența* talon/RCA/ITP (nu valabilitatea), **fără vignetă**.
- Nu există detecție de **suprapunere** (ai deja un RCA valid → mai cumperi unul).

## Decizii (din brainstorm)

- **Surface:** ambele — pop-up la adăugare + secțiune permanentă pe mașină + alertă Home.
- **Obligații în „status legal":** RCA + ITP + Rovinietă (`vigneta`). CASCO **doar** în detecția
  de suprapunere (e repetabil), nu în trio-ul legal.
- **Dublură:** suprapunere de valabilitate pe tipuri repetabile (RCA, rovinietă, CASCO).

## Arhitectură — zero schemă nouă

RCA/ITP/`vigneta` sunt deja `DocumentType`-uri pe vehicul cu `expiry_date`. Feature = computație
(read-only) + UI + cross-check. **Fără migrare SQLite, fără atingeri pe `backup.ts`/`cloudSync.ts`.**

### 1. `services/vehicleStatus.ts` (extindere)
- Extinde union-ul `StatusItemRaw['key']` cu `'vigneta'`.
- Adaugă cărămida vigneta în `buildVehicleStatusItems` (pick latest `vigneta` cu expiry).
- Tip nou `LegalObligation = { key: 'rca'|'itp'|'vigneta'; label; status: 'ok'|'expiring'|'expired'|'missing'; expiryIso?; daysRemaining?; docId? }`.
- `buildVehicleLegalStatus(documents, today, notificationDays): LegalObligation[]` — întoarce
  **toate cele 3** obligații, inclusiv cele **lipsă** (fără document). ITP refolosește logica
  talon/ITP existentă.

### 2. `services/vehicleDocChecks.ts` (nou)
- `findOverlappingDoc(documents, candidate): Document | null` — pentru tipuri repetabile
  (rca/vigneta/casco), documentul existent de același tip pe aceeași mașină cu valabilitate
  suprapusă (`existing.expiry_date >= candidate.issue_date ?? today`, exclus id-ul propriu la edit).
- `findMissingObligations(documents, justAddedType, today, notificationDays): LegalObligation[]` —
  obligațiile (din trio) care sunt `missing` sau `expired`, excluzând tipul tocmai adăugat.

### 3. Surface permanent — `entitati/[id].tsx` + componentă nouă
- `components/VehicleLegalStatus.tsx` — panou „Status legal" sub `EntityStatusBar` (doar pe
  vehicul). Randează `buildVehicleLegalStatus`: rândurile `missing`/`expired`/`expiring` sunt
  evidențiate (semafor) și **tappable** → navighează la `documente/add` cu tipul precompletat;
  dacă toate `ok` → linie compactă „În regulă ✓". Culori din `statusColors`.
- `EntityStatusBar.tsx`: adaugă `'vigneta'` în `iconForKey` (switch exhaustiv — TS forțează).

### 4. Cross-check la adăugare — `documente/add.tsx` (`handleSubmit`)
- **Înainte de `createDocument` (dublură):** dacă `type ∈ {rca, vigneta, casco}` + vehicul legat
  → `findOverlappingDoc` pe documentele vehiculului → `Alert` „Ai deja [label] valid până la X.
  Adaugi oricum?" [Anulează / Adaugă]. Anulează → return.
- **După `createDocument` (lipsă acoperire):** dacă `type ∈ {rca, itp, vigneta}` + vehicul legat
  → `findMissingObligations` → dacă există → `Alert` „[label] salvat. ⚠️ [altul] lipsește/expirat.
  Adaugi acum?" [Mai târziu / Adaugă] → navigație cu `InteractionManager` (regula
  `alert-modal-race-audit`). Secvențiat cu `promptAddExpiryReminder` prin `onDone` (fără alerte
  stivuite pe iOS).

### 5. `services/homeAlerts.ts` + `types/documentFields.ts`
- Adaugă `vigneta` în `VEHICLE_CHECKS` (alertă „[mașină] nu are rovinietă").
- `EXPIRY_FIELD_LABEL.vigneta = 'Valabilă până la'` (nicety).

## Verificare (Definition of Done)
- Blast radius: `StatusItemRaw['key']` union (consumat în `EntityStatusBar.iconForKey` —
  singurul switch exhaustiv); `useVehicleStatus` (consumat doar în `entitati/[id].tsx`);
  `homeAlerts` (consumat pe Home `index.tsx`).
- Teste: `vehicleStatus` (vigneta brick + legal status incl. missing/expired), `vehicleDocChecks`
  (overlap + missing), `homeAlerts` (vigneta).
- `npm run audit` verde (`check-hardcoded-entities` — folosește tipurile din `types/`, nu hardcode).
- **iOS Simulator** (light + dark): panoul Status legal pe o mașină cu/ fără rovinietă; pop-up
  dublură la adăugare RCA suprapus; pop-up lipsă acoperire după salvare RCA fără rovinietă.

## Out of scope (YAGNI)
- Nu dublez Expirări/remindere (notificările de expirare există în `reminders.ts`).
- Nu persist niciun câmp nou (read-only) → fără propagare schemă.
