# Cloud Files — Foldere pe Entități Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backup-ul iCloud stochează fișierele în foldere `files/<NumeEntitate>/<TipDoc>/<uuid>.ext` (paritate cu ZIP-ul) în loc de flat `files/<uuid>.ext`, cu move-on-rename, fără să strice restore-ul backup-urilor vechi.

**Architecture:** Sursa de adevăr pentru locația remote a fiecărui fișier devine `pending_uploads.uploaded_remote_path` (calea relativă structurată sub `files/`). Manifestul cloud câștigă un câmp `fileMap` (disk relPath → remote relPath) = exact locațiile reale, deci restore-ul găsește fiecare fișier unde chiar e. La upload, dacă numele entității/tipul s-a schimbat, fișierul se urcă pe calea nouă și cea veche intră în grace-delete. O migrare one-time re-home-uiește fișierele flat existente. Logica de naming (entitate + tip + sanitizare) se extrage din `backup.ts` într-un modul partajat folosit de ZIP și cloud.

**Tech Stack:** React Native + Expo, `expo-sqlite`, `react-native-cloud-storage` (wrapper `cloudStorage.ts`), Jest + better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-06-05-cloud-files-foldere-entitati-design.md`

---

## Context critic (citește înainte de Task 1)

- **Schema remote actuală e flat:** `FILES_PREFIX + fileNameFromPath(file_path)` = `Dosar/files/<uuid>.ext`. Calculată în 6 callsite-uri (cloudSync.ts:330, 370, 565, 773, 885, 924).
- **Restore azi:** `collectFileNamesFromPayload` întoarce `file_path`-uri de pe disk din manifest; remote = `FILES_PREFIX + fileNameFromPath(file_path)`; destinația pe disk = `documentDirectory + file_path`. Deci calea pe disk vine din `file_path`, nu din remote.
- **`buildFileMap` + `sanitizeFolderName` sunt LOCALE în `backup.ts`** (neexportate). Le extragem într-un modul partajat. Depind de `toRelativePath` (din `fileUtils.ts`), `DOCUMENT_TYPE_LABELS`, și hărți de nume per entitate.
- **Nu există fileMap în manifestul cloud.** ZIP-ul are (backup.ts), cloud-ul nu.
- **`MANIFEST_VERSION = 3`** (cloudSync.ts:46). Restore respinge `version > MANIFEST_VERSION` (linia 869). Bump la 4 + fallback flat pentru manifest v3.
- **NU folosi DROP TABLE în `db.ts`** pe `pending_uploads`/`cloud_pending_deletes` — `db-destructive-init-audit` (strict) blochează. Doar `ALTER TABLE ADD COLUMN` în try-catch.
- **Move-on-rename folosește grace-delete-ul existent** (`cloud_pending_deletes`, `DELETE_GRACE_SNAPSHOTS=2`) ca să nu rupă restore-ul din snapshot-uri vechi.
- **Filename rămâne `<uuid>.ext`** → fără coliziuni în folder. Doar folderele devin `<Entitate>/<TipDoc>`.

---

## File Structure

| Fișier | Responsabilitate |
|---|---|
| `services/fileOrganization.ts` (**nou**) | `sanitizeFolderName`, `EntityNameMaps`, `relPathForDoc`, `buildEntityFileMap` — naming partajat ZIP+cloud |
| `services/backup.ts` | Folosește helper-ul partajat (comportament ZIP neschimbat) |
| `services/cloudSync.ts` | `fileMap` în manifest; upload pe cale structurată + move-on-rename; delete pe remote rel; restore via fileMap + fallback flat; migrare re-home |
| `services/db.ts` | `ALTER pending_uploads ADD uploaded_remote_path`; `ALTER cloud_pending_deletes ADD remote_rel` |
| `__tests__/characterization/cloudSync.test.ts` | fileMap în payload; move detection; restore mapping; fallback v3 |

---

## Task 1: Extrage modulul de naming partajat

**Files:**
- Create: `services/fileOrganization.ts`
- Modify: `services/backup.ts`
- Test: `__tests__/fileOrganization.test.ts`

- [ ] **Step 1: Scrie testul**

Creează `__tests__/fileOrganization.test.ts`:

```ts
import { sanitizeFolderName, relPathForDoc, buildEntityFileMap } from '@/services/fileOrganization';

const maps = {
  personNames: new Map([['p1', 'Ion Pop']]),
  vehicleNames: new Map([['v1', 'Dacia Logan']]),
  propertyNames: new Map(),
  cardNames: new Map(),
  animalNames: new Map(),
  companyNames: new Map(),
  customTypeNames: new Map([['c1', 'BCAA Card']]),
};

it('sanitizes folder names', () => {
  expect(sanitizeFolderName('a/b:c')).toBe('a_b_c');
  expect(sanitizeFolderName('   ')).toBe('General');
});

it('builds <Entity>/<DocType>/<filename> for a vehicle RCA', () => {
  const doc = { id: 'd1', type: 'rca', vehicle_id: 'v1', file_path: 'documents/abc.jpg' } as never;
  expect(relPathForDoc(doc, 'documents/abc.jpg', maps)).toBe('Dacia Logan/RCA/abc.jpg');
});

it('uses custom type name for custom docs', () => {
  const doc = { id: 'd2', type: 'custom', custom_type_id: 'c1', person_id: 'p1', file_path: 'documents/x.pdf' } as never;
  expect(relPathForDoc(doc, 'documents/x.pdf', maps)).toBe('Ion Pop/BCAA Card/x.pdf');
});

it('buildEntityFileMap maps disk path → structured path for docs and pages', () => {
  const docs = [{ id: 'd1', type: 'rca', vehicle_id: 'v1', file_path: 'documents/abc.jpg' }] as never[];
  const pages = [{ document_id: 'd1', file_path: 'documents/abc_p2.jpg' }] as never[];
  const map = buildEntityFileMap(docs, pages, maps);
  expect(map['documents/abc.jpg']).toBe('Dacia Logan/RCA/abc.jpg');
  expect(map['documents/abc_p2.jpg']).toBe('Dacia Logan/RCA/abc_p2.jpg');
});
```

- [ ] **Step 2: Rulează — trebuie să PICE**

Run: `npx jest fileOrganization --no-coverage`
Expected: FAIL „Cannot find module '@/services/fileOrganization'".

- [ ] **Step 3: Creează `services/fileOrganization.ts`**

Mută logica din `backup.ts` (sanitizeFolderName + entityFolder + docTypeFolder + zipPath + buildFileMap), parametrizată cu un obiect `EntityNameMaps`:

```ts
/**
 * Naming partajat pentru organizarea fișierelor în backup: foldere
 * `<NumeEntitate>/<TipDoc>/<filename>`. Folosit de ZIP (`backup.ts`) și de
 * backup-ul cloud (`cloudSync.ts`) ca să producă structuri identice.
 */
import { toRelativePath } from './fileUtils';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type * as docs from './documents';

type DocLike = Awaited<ReturnType<typeof docs.getDocuments>>[number];
type PageLike = Awaited<ReturnType<typeof docs.getAllDocumentPages>>[number];

export interface EntityNameMaps {
  personNames: Map<string, string>;
  vehicleNames: Map<string, string>;
  propertyNames: Map<string, string>;
  cardNames: Map<string, string>;
  animalNames: Map<string, string>;
  companyNames: Map<string, string>;
  customTypeNames: Map<string, string>;
}

export function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'General';
}

function entityFolder(doc: DocLike, m: EntityNameMaps): string {
  if (doc.vehicle_id) return m.vehicleNames.get(doc.vehicle_id) ?? 'General';
  if (doc.person_id) return m.personNames.get(doc.person_id) ?? 'General';
  if (doc.property_id) return m.propertyNames.get(doc.property_id) ?? 'General';
  if (doc.animal_id) return m.animalNames.get(doc.animal_id) ?? 'General';
  if (doc.company_id) return m.companyNames.get(doc.company_id) ?? 'General';
  if (doc.card_id) return m.cardNames.get(doc.card_id) ?? 'General';
  return 'General';
}

function docTypeFolder(doc: DocLike, m: EntityNameMaps): string {
  if (doc.type === 'custom' && doc.custom_type_id) {
    const customName = m.customTypeNames.get(doc.custom_type_id);
    if (customName) return customName;
  }
  return DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
}

/** Calea relativă structurată (`<Entity>/<DocType>/<filename>`) pentru un document. */
export function relPathForDoc(doc: DocLike, diskRelPath: string, m: EntityNameMaps): string {
  const filename = diskRelPath.split('/').pop() ?? diskRelPath;
  const ef = sanitizeFolderName(entityFolder(doc, m));
  const tf = sanitizeFolderName(docTypeFolder(doc, m));
  return `${ef}/${tf}/${filename}`;
}

/** Map diskRelativePath → structuredRelativePath pentru documente + pagini. */
export function buildEntityFileMap(
  allDocuments: DocLike[],
  allPages: PageLike[],
  m: EntityNameMaps
): Record<string, string> {
  const fileMap: Record<string, string> = {};
  const docById = new Map(allDocuments.map(d => [d.id, d]));
  for (const doc of allDocuments) {
    if (!doc.file_path) continue;
    const rel = toRelativePath(doc.file_path);
    if (!fileMap[rel]) fileMap[rel] = relPathForDoc(doc, rel, m);
  }
  for (const page of allPages) {
    if (!page.file_path) continue;
    const rel = toRelativePath(page.file_path);
    if (fileMap[rel]) continue;
    const parentDoc = docById.get(page.document_id);
    fileMap[rel] = parentDoc ? relPathForDoc(parentDoc, rel, m) : rel;
  }
  return fileMap;
}
```

- [ ] **Step 4: Refactor `backup.ts` să folosească helper-ul**

În `services/backup.ts`:
- Șterge funcțiile locale `sanitizeFolderName` și `buildFileMap` (liniile ~37-115).
- Adaugă import: `import { sanitizeFolderName, buildEntityFileMap, type EntityNameMaps } from './fileOrganization';`
- Înlocuiește apelul `buildFileMap(documents, allPages, personNames, vehicleNames, ...)` cu construirea unui obiect `EntityNameMaps` și `buildEntityFileMap(documents, allPages, maps)`:

```ts
  const maps: EntityNameMaps = {
    personNames, vehicleNames, propertyNames, cardNames, animalNames, companyNames, customTypeNames,
  };
  const fileMap = buildEntityFileMap(documents, allPages, maps);
```
- Lasă neschimbat blocul vehicle-photo (`fileMap[rel] = 'Vehicule/<folder>/photo.jpg'`) — încă folosește `sanitizeFolderName` (acum din import).

- [ ] **Step 5: Rulează testele + type-check**

Run: `npx jest fileOrganization --no-coverage && npm run type-check && npm run test:characterization`
Expected: fileOrganization PASS; type-check green; characterization green (ZIP behavior neschimbat — backup.test.ts încă verde).

- [ ] **Step 6: Commit**

```bash
git add services/fileOrganization.ts services/backup.ts __tests__/fileOrganization.test.ts
git commit -m "refactor(backup): extract shared file-organization helper (ZIP + cloud)"
```

---

## Task 2: Schema — coloane noi pe pending_uploads + cloud_pending_deletes

**Files:**
- Modify: `services/db.ts`

- [ ] **Step 1: ALTER pending_uploads + cloud_pending_deletes**

În `services/db.ts`, lângă migrările existente `ALTER TABLE pending_uploads` (liniile ~814-834), adaugă (fiecare în try-catch, pattern existent):

```ts
// Migrare: pending_uploads.uploaded_remote_path — calea relativă remote (sub
// files/) unde fișierul e stocat curent în iCloud. NULL = neuploadat încă.
// Sursa de adevăr pentru move-on-rename + pentru fileMap-ul manifestului.
try {
  db.execSync('ALTER TABLE pending_uploads ADD COLUMN uploaded_remote_path TEXT');
} catch {
  // coloana există deja
}

// Migrare: cloud_pending_deletes.remote_rel — calea relativă remote exactă de
// șters (sub files/). Permite ștergerea locației VECHI după un move, nu doar a
// basename-ului din file_path.
try {
  db.execSync('ALTER TABLE cloud_pending_deletes ADD COLUMN remote_rel TEXT');
} catch {
  // coloana există deja
}
```

- [ ] **Step 2: Type-check + audit schema**

Run: `npm run type-check && node scripts/alter-table-trycatch-audit.js --strict && node scripts/db-destructive-init-audit.js --strict`
Expected: toate green (ALTER în try-catch, niciun DROP).

- [ ] **Step 3: Commit**

```bash
git add services/db.ts
git commit -m "feat(cloud): add uploaded_remote_path + remote_rel columns for structured files"
```

---

## Task 3: fileMap în manifestul cloud + bump versiune

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Adaugă `fileMap` în tip + payload, bump versiune**

- `ManifestPayload` (cloudSync.ts:54): adaugă câmp `fileMap: Record<string, string>;`.
- `MANIFEST_VERSION` (linia 46): `const MANIFEST_VERSION = 4; // v4: structured file folders (fileMap)`.
- În `buildManifestPayload`, fileMap-ul trebuie să reflecte **locația REALĂ curentă** a fiecărui fișier (din `pending_uploads.uploaded_remote_path`), cu fallback la calea structurată calculată pentru fișierele încă neuploadate. Construiește hărțile de nume din entitățile deja fetch-uite, plus citește locațiile reale:

```ts
  // fileMap: disk relPath → remote relPath. Sursa primară = locația reală
  // (uploaded_remote_path); fallback = calea structurată calculată (fișiere noi
  // neuploadate încă). Astfel restore-ul găsește fiecare fișier unde chiar e,
  // iar conversia flat→structurat se face progresiv (vezi migrarea re-home).
  const nameMaps: EntityNameMaps = {
    personNames: new Map(persons.map(p => [p.id, p.name])),
    vehicleNames: new Map(vehicles.map(v => [v.id, v.name])),
    propertyNames: new Map(properties.map(p => [p.id, p.name])),
    cardNames: new Map(
      cards.map(c => [c.id, c.nickname ? `${c.nickname} ····${c.last4}` : `Card ····${c.last4}`])
    ),
    animalNames: new Map(animals.map(a => [a.id, a.name])),
    companyNames: new Map(companies.map(c => [c.id, c.name])),
    customTypeNames: new Map(customTypes.map(ct => [ct.id, ct.name])),
  };
  const structuredMap = buildEntityFileMap(documents, allPages, nameMaps);
  // vehicle photos (paritate cu ZIP)
  for (const v of vehicles) {
    if (!v.photo_uri) continue;
    const rel = toRelativePath(v.photo_uri);
    if (!rel || structuredMap[rel]) continue;
    structuredMap[rel] = `Vehicule/${sanitizeFolderName(v.name)}/photo.jpg`;
  }
  // Suprascrie cu locația reală acolo unde diferă (fișier deja urcat la o cale).
  const realLocations = await db.getAllAsync<{ file_path: string; uploaded_remote_path: string | null }>(
    'SELECT file_path, uploaded_remote_path FROM pending_uploads WHERE uploaded_remote_path IS NOT NULL'
  );
  const fileMap: Record<string, string> = { ...structuredMap };
  for (const r of realLocations) {
    fileMap[toRelativePath(r.file_path)] = r.uploaded_remote_path as string;
  }
```

Adaugă `fileMap,` în obiectul `payload`. Adaugă importurile: `import { buildEntityFileMap, sanitizeFolderName, type EntityNameMaps } from './fileOrganization';` și `import { toRelativePath } from './fileUtils';` (verifică dacă `toRelativePath` nu e deja importat).

> Notă: `customTypes` se fetch-uiește deja în `buildManifestPayload` (`getCustomTypes()`); dacă lipsește din destructurare, adaugă-l.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add services/cloudSync.ts
git commit -m "feat(cloud): include real-location fileMap in manifest (v4)"
```

---

## Task 4: Upload pe cale structurată + move-on-rename

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Helper de path remote + selecția cozii**

- Adaugă lângă `fileNameFromPath` un helper:
```ts
/** Calea remote completă pentru o cale relativă structurată (sub files/). */
function remotePathForRel(remoteRel: string): string {
  return `${FILES_PREFIX}${remoteRel}`;
}
```
- În `processQueue`, ÎNAINTE de a procesa coada, construiește fileMap-ul curent o singură dată (reutilizează logica din Task 3 — extrage-o într-un helper privat `buildCurrentFileMap(): Promise<Record<string,string>>` apelat atât de `buildManifestPayload` cât și de `processQueue`, ca să nu dublezi). `buildCurrentFileMap` întoarce `structuredMap` (fără override-ul de locație reală — vrem ținta structurată curentă):

```ts
async function buildStructuredFileMap(): Promise<Record<string, string>> {
  const [persons, vehicles, properties, cards, animals, companies, customTypes, documents, allPages] =
    await Promise.all([
      entities.getPersons(), entities.getVehicles(), entities.getProperties(),
      entities.getCards(), entities.getAnimals(), entities.getCompanies(),
      getCustomTypes(), docs.getDocuments(), docs.getAllDocumentPages(),
    ]);
  const nameMaps: EntityNameMaps = {
    personNames: new Map(persons.map(p => [p.id, p.name])),
    vehicleNames: new Map(vehicles.map(v => [v.id, v.name])),
    propertyNames: new Map(properties.map(p => [p.id, p.name])),
    cardNames: new Map(cards.map(c => [c.id, c.nickname ? `${c.nickname} ····${c.last4}` : `Card ····${c.last4}`])),
    animalNames: new Map(animals.map(a => [a.id, a.name])),
    companyNames: new Map(companies.map(c => [c.id, c.name])),
    customTypeNames: new Map(customTypes.map(ct => [ct.id, ct.name])),
  };
  const map = buildEntityFileMap(documents, allPages, nameMaps);
  for (const v of vehicles) {
    if (!v.photo_uri) continue;
    const rel = toRelativePath(v.photo_uri);
    if (!rel || map[rel]) continue;
    map[rel] = `Vehicule/${sanitizeFolderName(v.name)}/photo.jpg`;
  }
  return map;
}
```
Refactor `buildManifestPayload` (Task 3) să cheme `buildStructuredFileMap()` în loc de codul inline, apoi aplică override-ul de locație reală. (DRY.)

- În `processQueue`: după `reconcilePendingUploads()`, înainte de loop, `const structuredMap = await buildStructuredFileMap();`. Și adaugă `uploaded_remote_path` în SELECT-ul care construiește `pending` (citește SELECT-ul curent ~liniile 500-518 și adaugă coloana + în tipul rândului).

- [ ] **Step 2: Upload pe cale structurată + detecția mutării în `processOne`**

Înlocuiește în `processOne` linia `const remote = \`${FILES_PREFIX}${fileNameFromPath(row.file_path)}\`;` + writeFile + UPDATE cu:

```ts
      const targetRel = structuredMap[toRelativePath(row.file_path)] ?? fileNameFromPath(row.file_path);
      const remote = remotePathForRel(targetRel);
      await cloudStorage.writeFile(remote, base64, 'base64');
      // Move-on-rename: dacă fișierul era la altă cale remote, programează ștergerea celei vechi.
      if (row.uploaded_remote_path && row.uploaded_remote_path !== targetRel) {
        await enqueueRemoteGraceDelete(row.file_path, row.uploaded_remote_path);
      }
      await db.runAsync(
        'UPDATE pending_uploads SET uploaded_at = ?, uploaded_remote_path = ?, last_error = NULL, file_size = ? WHERE id = ?',
        [Date.now(), targetRel, fileSize || null, row.id]
      );
```

`enqueueRemoteGraceDelete` se definește în Task 5.

- [ ] **Step 3: Type-check (enqueueRemoteGraceDelete vine în Task 5)**

Run: `npm run type-check`
Expected: poate fi RED pe `enqueueRemoteGraceDelete` until Task 5. Commit cu `--no-verify` și notează; Task 5 închide type-check-ul.

- [ ] **Step 4: Commit**

```bash
git add services/cloudSync.ts
git commit --no-verify -m "feat(cloud): upload files to structured paths + move-on-rename"
```

---

## Task 5: Delete-queue pe cale remote (grace) + restul callsite-urilor

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Helper grace-delete pe remote rel**

Adaugă:
```ts
/** Programează ștergerea unei căi remote (sub files/) cu grace period. */
async function enqueueRemoteGraceDelete(filePath: string, remoteRel: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO cloud_pending_deletes (file_path, queued_at, snapshots_remaining, remote_rel)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       queued_at = excluded.queued_at,
       snapshots_remaining = excluded.snapshots_remaining,
       remote_rel = excluded.remote_rel`,
    [filePath, Date.now(), DELETE_GRACE_SNAPSHOTS, remoteRel]
  );
}
```

- [ ] **Step 2: `dequeueFileDelete` — șterge locația reală a fișierului**

Rescrie `dequeueFileDelete` să citească `uploaded_remote_path` înainte de a șterge rândul, apoi să programeze ștergerea acelei căi (fallback flat dacă lipsește):

```ts
export async function dequeueFileDelete(filePath: string): Promise<void> {
  if (!filePath) return;
  const existing = await db.getFirstAsync<{ uploaded_remote_path: string | null }>(
    'SELECT uploaded_remote_path FROM pending_uploads WHERE file_path = ?',
    [filePath]
  );
  await db.runAsync('DELETE FROM pending_uploads WHERE file_path = ?', [filePath]);
  if (!(await cloudStorage.isAvailable())) return;
  const remoteRel = existing?.uploaded_remote_path ?? fileNameFromPath(filePath);
  const remote = remotePathForRel(remoteRel);
  try {
    if (!(await cloudStorage.exists(remote))) return;
  } catch {
    return;
  }
  await enqueueRemoteGraceDelete(filePath, remoteRel);
}
```

- [ ] **Step 3: `processPendingDeletes` — șterge `remote_rel`**

În `processPendingDeletes`, schimbă SELECT-ul + ștergerea:
```ts
  const due = await db.getAllAsync<{ file_path: string; remote_rel: string | null }>(
    'SELECT file_path, remote_rel FROM cloud_pending_deletes WHERE snapshots_remaining <= 0'
  );
  for (const row of due) {
    const remoteRel = row.remote_rel ?? fileNameFromPath(row.file_path);
    const remote = remotePathForRel(remoteRel);
    try {
      await cloudStorage.deleteFile(remote);
      await db.runAsync('DELETE FROM cloud_pending_deletes WHERE file_path = ?', [row.file_path]);
    } catch (e) {
      console.warn('[cloudSync.processPendingDeletes] delete failed:', row.file_path, e instanceof Error ? e.message : e);
    }
  }
```

- [ ] **Step 4: Type-check verde**

Run: `npm run type-check`
Expected: GREEN (enqueueRemoteGraceDelete acum definit; Task 4 se închide).

- [ ] **Step 5: Commit**

```bash
git add services/cloudSync.ts
git commit -m "feat(cloud): grace-delete by exact remote path (supports moves + deletes)"
```

---

## Task 6: Restore via fileMap + fallback flat (v3)

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Mapare remote din fileMap-ul manifestului**

În `restoreFromCloud`, după `const payload = JSON.parse(...)`, extrage fileMap-ul și definește un resolver local:
```ts
  const manifestFileMap = (payload.fileMap as Record<string, string> | undefined) ?? {};
  const remoteRelFor = (fileRel: string): string =>
    manifestFileMap[fileRel] ?? fileNameFromPath(fileRel);
```
(`fileRel` din `collectFileNamesFromPayload` e deja relativ — `documents/<uuid>.ext`. Pentru v3, `manifestFileMap` e gol → fallback flat basename. Pentru v4, întoarce calea structurată.)

- [ ] **Step 2: Folosește resolver-ul în cele 3 callsite-uri de restore**

Înlocuiește `${FILES_PREFIX}${fileNameFromPath(...)}` cu `remotePathForRel(remoteRelFor(...))` în:
- pre-stat loop (linia ~885): `const remote = remotePathForRel(remoteRelFor(f));`
- `downloadOne` (linia ~924): `const remote = remotePathForRel(remoteRelFor(fileRel));`

Pentru `estimateRestoreSize` (linia ~773) — funcție separată care nu are payload-ul în scope. Citește-o: dacă primește deja `fileNames` din manifest, trebuie să primească și fileMap-ul. Adaugă un parametru `fileMap` (sau citește manifestul în interior). Aplică `remotePathForRel(fileMap[f] ?? fileNameFromPath(f))`. Adaptează apelantul.

> Destinația pe disk rămâne `${FileSystem.documentDirectory}${fileRel}` — neschimbată (calea pe disk vine din `file_path`, nu din remote).

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add services/cloudSync.ts
git commit -m "feat(cloud): restore resolves remote paths via manifest fileMap (v3 flat fallback)"
```

---

## Task 7: Migrare one-time re-home a fișierelor flat existente

**Files:**
- Modify: `services/cloudSync.ts`

- [ ] **Step 1: Re-queue fișierele flat pentru conversie la structură**

Adaugă o funcție care marchează fișierele deja urcate (flat, fără `uploaded_remote_path`) pentru re-procesare: setează `uploaded_remote_path` = basename-ul flat curent și `uploaded_at = NULL`, ca `processOne` să le re-urce la calea structurată și să programeze ștergerea celei flat (move-on-rename reutilizat):

```ts
/**
 * Migrare one-time (spec 2026-06-05): fișierele urcate înainte de structurare au
 * `uploaded_remote_path` NULL și stau flat (`files/<uuid>.ext`). Le marcăm cu
 * locația flat curentă + `uploaded_at = NULL` ca next `processQueue` să le re-urce
 * la calea structurată și să grace-șteargă cea flat. Idempotentă: rulează doar
 * pentru rânduri uploaded fără remote path cunoscut.
 */
async function rehomeFlatFilesIfNeeded(): Promise<void> {
  const rows = await db.getAllAsync<{ id: number; file_path: string }>(
    'SELECT id, file_path FROM pending_uploads WHERE uploaded_at IS NOT NULL AND uploaded_remote_path IS NULL'
  );
  for (const r of rows) {
    await db.runAsync(
      'UPDATE pending_uploads SET uploaded_remote_path = ?, uploaded_at = NULL WHERE id = ?',
      [fileNameFromPath(r.file_path), r.id]
    );
  }
}
```

- [ ] **Step 2: Apeleaz-o la începutul `processQueue`**

În `processQueue`, după `reconcilePendingUploads()` și înainte de `buildStructuredFileMap()`:
```ts
  await rehomeFlatFilesIfNeeded();
```

> Efect: la primul backup după update, fișierele vechi se re-urcă o dată la căile structurate; cele flat intră în grace-delete. Cost de bandă acceptat (spec). Idempotent — după conversie, `uploaded_remote_path` nu mai e NULL.

- [ ] **Step 3: Type-check + commit**

Run: `npm run type-check`
```bash
git add services/cloudSync.ts
git commit -m "feat(cloud): one-time re-home of existing flat files to structured paths"
```

---

## Task 8: Teste characterization + audit

**Files:**
- Modify: `__tests__/characterization/cloudSync.test.ts`

- [ ] **Step 1: Adaugă teste**

Folosind harness-ul async din characterization (vezi celelalte teste din folder), adaugă:

```ts
describe('cloud structured files (v4)', () => {
  it('buildManifestPayload includes a fileMap field', async () => {
    // seed: un vehicul 'Dacia' + un document rca cu file_path 'documents/a.jpg'
    // assert: payload.version === 4 și payload.fileMap['documents/a.jpg'] === 'Dacia/RCA/a.jpg'
    const payload = await buildManifestPayload();
    expect(payload.version).toBe(4);
    expect(payload.fileMap['documents/a.jpg']).toBe('Dacia/RCA/a.jpg');
  });

  it('restore falls back to flat basename when manifest has no fileMap (v3)', () => {
    // unit pe resolver-ul remoteRelFor — extrage-l ca funcție pură exportată
    // (export `resolveRemoteRel(fileMap, fileRel)`) și testează:
    //   resolveRemoteRel({}, 'documents/a.jpg') === 'a.jpg'
    //   resolveRemoteRel({'documents/a.jpg':'Dacia/RCA/a.jpg'}, 'documents/a.jpg') === 'Dacia/RCA/a.jpg'
  });
});
```

> Pentru testabilitate, extrage resolver-ul din Task 6 ca funcție pură exportată `export function resolveRemoteRel(fileMap: Record<string,string>, fileRel: string): string`. Folosește-o atât în restore cât și în test.

- [ ] **Step 2: Audit complet**

Run: `npm run audit`
Expected: green. În special `backup-audit.js --strict` (tabelele/coloanele noi nu strică sync-ul — `uploaded_remote_path`/`remote_rel` sunt pe tabele de queue, nu user-data, deci nu intră în manifest backup; confirmă că auditul rămâne verde) și `db-destructive-init-audit` (niciun DROP).

- [ ] **Step 3: Commit**

```bash
git add __tests__/characterization/cloudSync.test.ts services/cloudSync.ts
git commit -m "test(cloud): cover structured fileMap manifest + flat-fallback resolver"
```

---

## Task 9: Verificare manuală (device fizic — controller/user)

- [ ] **Step 1: End-to-end pe device + iCloud** (nu se poate pe simulator, per `rules/backup.md`)
  1. Backup cloud → inspectează iCloud → Dosar → `files/<Entitate>/<TipDoc>/` populat; fișierele vechi flat dispar după grace (2 snapshot-uri).
  2. Redenumește o entitate → următor backup → fișierele apar sub folderul nou; cel vechi grace-șters.
  3. Restore pe alt device → toate fișierele revin la `file_path`-ul corect pe disk.
  4. Restore dintr-un backup cloud VECHI (manifest v3, flat) → fallback funcționează, fișierele se descarcă.

---

## Self-Review (rulat la scriere)

**Spec coverage:** fileMap în manifest (T3) ✓ · structură `<Entitate>/<TipDoc>/` (T1,T3,T4) ✓ · move-on-rename (T4,T5) ✓ · `uploaded_remote_path` (T2,T4) ✓ · delete pe remote rel (T2,T5) ✓ · restore via fileMap + fallback v3 (T6) ✓ · bump versiune 3→4 (T3) ✓ · helper naming partajat (T1) ✓ · migrare fișiere existente (T7) ✓ · teste (T8) ✓ · manual (T9) ✓.

**Placeholder scan:** fără TBD. Două locuri lasă implementatorului wiring precis (T4 Step 1 — adăugarea `uploaded_remote_path` în SELECT-ul existent al cozii, pe care nu l-am avut verbatim; T6 Step 2 — adaptarea `estimateRestoreSize`), cu instrucțiune explicită cum. Restul are cod exact.

**Type consistency:** `EntityNameMaps`, `buildEntityFileMap`, `relPathForDoc`, `sanitizeFolderName` — semnături unice în `fileOrganization.ts`, folosite identic în backup.ts + cloudSync.ts. `remotePathForRel`/`remoteRelFor`/`resolveRemoteRel`/`enqueueRemoteGraceDelete`/`buildStructuredFileMap`/`rehomeFlatFilesIfNeeded` — definite o dată. Coloane `uploaded_remote_path` (pending_uploads) + `remote_rel` (cloud_pending_deletes) — consistente schema↔cod.

**Ordine dependențe:** T1 (helper) → T2 (schema) → T3 (manifest fileMap) → T4 (upload+move, lasă type-check RED pe enqueueRemoteGraceDelete) → T5 (delete helper, închide type-check) → T6 (restore) → T7 (migrare) → T8 (teste/audit). Type-check redevine verde la T5.

**Risc rezidual (acceptat de spec):** două redenumiri în aceeași fereastră de grace pe același file_path → prima locație veche orfană (ON CONFLICT pe file_path suprascrie). Rar. Orfani din migrarea re-home (fișiere flat care nu se șterg dacă grace eșuează repetat) → best-effort. Ambele documentate, non-blocante.
