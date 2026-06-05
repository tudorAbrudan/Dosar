# Structură foldere pe entități în backup-ul cloud (paritate cu ZIP)

**Data:** 2026-06-05
**Status:** Aprobat (brainstorm), pending plan
**Autor:** brainstorm cu userul

## Problema

Backup-ul ZIP organizează fișierele uman-citibil: `files/<NumeEntitate>/<TipDoc>/<fisier>`
(`backup.ts` → `buildFileMap`). Backup-ul **cloud** folosește structură **plată cu UUID**:
`files/<uuid>.ext`. Userul vrea ca folderul iCloud să fie răsfoibil pe entități, ca ZIP-ul.

## De ce cloud-ul e plat acum (și ce pierdem)

Path-ul remote se derivă din `file_path`-ul de pe disk via `fileNameFromPath` (în 7 locuri:
`cloudSync.ts:371, 411, 606, 814, 926, 965`). `file_path = documents/<uuid>.ext` și **nu se
schimbă niciodată** → invarianți:

| Proprietate | Mecanism actual |
|---|---|
| Upload idempotent | același fișier → același nume remote |
| Rename entitate / schimbare tip doc | `file_path` neschimbat → remote neschimbat → **zero re-upload** |
| Restore | calculează remote direct din `file_path` din manifest (`collectFileNamesFromPayload`) |
| Delete cu grace | `cloud_pending_deletes` keyed pe `file_path` |

Trecerea la `files/<Entitate>/<TipDoc>/<uuid>.ext` face path-ul remote dependent de **nume
entitate** + **tip doc** — ambele **mutabile**. Aceasta e schimbarea de fond: din „store
imutabil plat" în „store structurat cu move-on-rename".

## Decizia: Opțiunea 1 — foldere pe entități, cu move-on-rename

Filename-ul rămâne `<uuid>.ext` (fără coliziuni în folder). Doar **folderele** devin
`<NumeEntitate>/<TipDoc>`. Userul acceptă explicit costul (re-upload la redenumiri + mai
multe edge-case-uri de sync + bump versiune manifest).

## Schimbări tehnice

### 1. `fileMap` în manifestul cloud

- `buildManifestPayload` adaugă `fileMap: Record<diskRelPath, cloudRelPath>` (ca ZIP).
- Cloud relative path: `<sanitizeFolderName(entityName)>/<sanitizeFolderName(docTypeLabel)>/<uuid>.ext`.
- Refolosește logica din `backup.ts buildFileMap` (entityFolder + docTypeFolder +
  sanitizeFolderName) — extrasă într-un helper partajat ca să nu dublăm regulile de naming
  între ZIP și cloud.

### 2. Calculul path-ului remote

- Înlocuiește `FILES_PREFIX + fileNameFromPath(file_path)` cu lookup în `fileMap`:
  `FILES_PREFIX + fileMap[toRelativePath(file_path)]`.
- Toate cele 7 callsite-uri (`enqueueFileUpload`, delete, upload din queue, restore download,
  reconcile) trec prin același helper `remotePathFor(file_path, fileMap)`.
- `pending_uploads` rămâne keyed pe `file_path` (stabil); doar **maparea către remote** se
  schimbă.

### 3. Move-on-rename (reconcile)

- La fiecare ciclu de sync, pentru fiecare fișier: calculează cloud path-ul curent din
  numele/tipul actual. Dacă diferă de cel uploadat ultima dată (păstrat în
  `pending_uploads.uploaded_remote_path` — coloană nouă):
  1. Upload pe path-ul nou.
  2. Enqueue delete pe path-ul vechi (prin `cloud_pending_deletes`, cu grace existent).
- Adaugă coloană `uploaded_remote_path TEXT` în `pending_uploads` (ALTER în try-catch).

### 4. Restore

- `collectFileNamesFromPayload` → folosește `fileMap` din manifest pentru a localiza fiecare
  remote, și mapează înapoi pe disk la `file_path` original (reverse `fileMap`, ca ZIP-ul la
  import).
- Compatibilitate: manifest vechi fără `fileMap` → fallback la `fileNameFromPath` (path plat).
  (NB: nu e „backwards-compat shim" interzis — e citirea unui manifest cloud mai vechi
  existent în iCloud-ul userului; fără el, restore-ul unui backup deja făcut se rupe.)

### 5. Versiune manifest cloud

- Bump versiune cloud manifest (separat de versiunea ZIP). Migrarea efectivă a fișierelor
  deja în cloud (de pe path plat pe path structurat) se face natural la următorul sync prin
  reconcile/move (path nou ≠ path vechi → move).

## Verificare (Definition of Done)

### Blast radius
- `cloudSync.ts` — toate cele 7 callsite-uri de path remote + reconcile + restore.
- `backup.ts` — extragerea helper-ului de naming partajat (nu schimbă comportamentul ZIP).
- `pending_uploads` schema → `db.ts` + `backup.ts` + `cloudSync.ts` (regula celor 3 locuri).
- Audit: `backup-audit.js`.

### Teste
- `__tests__/characterization/cloudSync.test.ts` — `fileMap` prezent în payload, remote path
  structurat, restore mapează corect, fallback pe manifest vechi.
- Test reconcile: rename entitate → fișier mutat (upload nou + delete vechi în coadă).
- `npm run audit` verde.

### Manual (necesită device fizic + iCloud, conform `rules/backup.md`)
- Backup → inspectează iCloud → Dosar → `files/<Entitate>/<TipDoc>/` populat corect.
- Rename entitate → următor sync → fișiere mutate, fără orfani la path-ul vechi după grace.
- Restore pe alt device → toate fișierele revin la `file_path`-ul corect pe disk.
- Restore dintr-un backup cloud **vechi** (path plat) → fallback funcționează.

## Dependență de ordine
- Recomandat **după** spec-ul medical (`2026-06-05-medical-backup-fara-cheie-design.md`),
  fiindcă ambele ating `cloudSync.ts` / `backup.ts` / `pending_uploads`; medicalul întâi
  reduce conflictele.

## Out of scope
- Feature cross-check RCA/vignetă/ITP la mașină → spec separat ulterior.
