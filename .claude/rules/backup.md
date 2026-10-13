---
paths:
  - "services/backup.ts"
  - "services/cloudSync.ts"
  - "services/db.ts"
  - "app/(tabs)/setari.tsx"
  - "hooks/**"
---

# Backup & Restore Patterns

## Arhitectură

| Component | Stocare | Note |
|-----------|---------|------|
| Fișiere documente | Device local (`expo-file-system` DocumentsDirectory) | Sursă primară |
| Metadate (DB) | SQLite local (`expo-sqlite`) | Sursă primară |
| Backup | ZIP manual + iCloud Drive (`cloudSync.ts`) | Copie externă (Apple-only) |
| Format backup | **ZIP** (fișier `.zip`) conținând manifest JSON + fișiere organizate | Version 5 |

**Nu există backend pentru date.** Tot ce nu e pe device sau în iCloud e pierdut.

## Format export (version 5 — curent)

Fișier: `acte_backup_YYYY-MM-DD.zip`

Structura ZIP:
```
acte_backup_2024-01-15.zip
├── backup.json           ← manifest complet
└── files/
    ├── <NumeEntitate>/
    │   └── <TipDocument>/
    │       └── <fisier.jpg|pdf>
    └── General/
        └── <TipDocument>/
            └── <fisier>
```

`backup.json` — structura completă:
```json
{
  "version": 5,
  "exportDate": "ISO string",
  "persons": [...],
  "properties": [...],
  "vehicles": [...],
  "cards": [...],
  "animals": [...],
  "companies": [...],
  "customTypes": [...],
  "documents": [...],
  "documentPages": [...],
  "fileMap": {
    "documents/relativ/pe/disk.jpg": "NumeEntitate/TipDocument/fisier.jpg"
  }
}
```

`fileMap` este un obiect `diskRelativePath → zipRelativePath` (în interiorul `files/`).

### Organizarea fișierelor în ZIP

- Fiecare fișier merge în `files/<NumeEntitate>/<TipDocument>/<filename>`
- Entitatea = persoana / vehiculul / proprietatea / animalul / firma / cardul asociat documentului; fallback: `General`
- Cardurile: folderul e `<nickname> ····<last4>` sau `Card ····<last4>`
- Caractere speciale din nume (`/ \ ? % * : | " < >`) → înlocuite cu `_`

## Export (`exportBackup()`)

1. Colectează în paralel: persons, properties, vehicles, cards, animals, companies, documents, documentPages, customTypes
2. Construiește `fileMap` (disk → zip path) pentru documente și pagini
3. Creează manifest JSON (`backup.json`)
4. Adaugă fișierele ca base64 în ZIP sub `files/<zipRelPath>`
5. Scrie ZIP în cache, îl deschide cu `expo-sharing` (Files/iCloud)

## Import (`importBackup()`)

Acceptă:
- **ZIP** (`application/zip`) — format curent (version 5) și version 4
- **JSON** (`application/json`) — format vechi (version 1–3), fișiere din câmpul `images`

Pași:
1. Picker fișier (ZIP sau JSON)
2. Pentru ZIP: extrage `backup.json` + fișiere pe disk (folosind `fileMap` din manifest pentru reverse-map zip→disk)
3. Import entități cu deduplicare:
   - Persoane/Proprietăți/Vehicule/Animale: by `name` (case-insensitive)
   - Carduri: by `last4 + nickname`
   - Firme: by `cui` (primar) sau `name` (fallback)
   - CustomTypes: by `name`
   - Documente: by `type + issue_date + expiry_date`
4. Remapare ID-uri vechi → noi pentru foreign keys
5. Import documentPages cu noul `document_id`

## Reguli de implementare

- **Câmpuri noi în DB:** orice tabel sau coloană nouă se adaugă în `exportBackup()` (în manifest) și în `importBackup()` (în import loop)
- **Entitate nouă:** adaugă în manifest, în `buildFileMap()`, în deduplicare import și în `fileMap` reverse
- **Fișiere lipsă la export:** `readFileBase64` returnează `null` → fișierul e sărit, metadatele rămân în manifest
- **Version bump:** la orice modificare incompatibilă de schemă, incrementează `version` în `exportBackup()` și adaugă branch de compatibilitate în `importBackup()`
- **Progress:** UI cu ActivityIndicator pentru backup/restore (nu blocant)

## Istoricul versiunilor

| Version | Format | Schimbări |
|---------|--------|-----------|
| 1–3 | JSON | Fișiere în câmpul `images` |
| 4 | ZIP | `files/` cu cale relativă din disk |
| 5 | ZIP | `fileMap` explicit disk→zip; fișiere organizate pe entitate/tip; animals, companies, customTypes, documentPages |

## Testare manuală

1. Export complet → deschide ZIP → verifică structura `files/` și `backup.json`
2. Dezinstalare app → reinstalare → import ZIP → verifică toate entitățile + fișierele
3. Import cu fișier lipsă din ZIP → documentul apare, fără fișier atașat
4. Import ZIP version 4 (fără `fileMap`) → fișierele se restaurează corect

## Cloud backup în iCloud (Faza 2 — implementat)

### Arhitectură folder iCloud

```
iCloud Drive / Dosar /
├── manifest.json                    ← state-ul curent (suprascris)
├── manifest.meta.json               ← { version, hash, uploadedAt, deviceId, encrypted, ... }
├── snapshots/
│   └── manifest_YYYY-MM-DD.json
└── files/
    └── <uuid>.{jpg,pdf}             ← imutabile
```

### Versioning manifest cloud

Manifestul cloud are propriul `version` (separat de versiunea ZIP-urilor manuale, care e la 9). Pornește la 1 și incrementează la modificări incompatibile.

### Regulă critică — schemă DB

Orice modificare de schemă SQLite (tabel/coloană nouă, redenumire, ștergere) trebuie propagată în **TREI locuri**:

1. `services/db.ts` — migrare
2. `services/backup.ts` — `exportBackup()` (ZIP) și `applyManifest()` (folosit de `importBackup` și `cloudSync.restore`)
3. `services/cloudSync.ts` — `buildManifestPayload()` (ce urc) și implicit `applyManifest` la restore

### Servicii cloud

- `services/cloudStorage.ts` — wrapper peste `react-native-cloud-storage`
- `services/cloudSync.ts` — orchestrator (queue, upload manifest, snapshot, restore)
- `services/cloudCrypto.ts` — AES-256-GCM + PBKDF2 (opțional, configurabil)
- `services/manifestHash.ts` — serializare canonică + SHA-256 deduplication

### Edge cases

- iCloud delogat → status "unavailable", auto-backup pe pauză
- Quota plină → eroare clară, banner în Settings
- Offline upload → queue în `pending_uploads`, retry la următoarea acțiune
- Conflict cross-device → last-write-wins, banner pe celălalt device
- Criptare: pierderea parolei = pierderea backup-ului, by design

### Testare manuală obligatorie

iCloud Documents nu funcționează complet pe simulator. Testarea completă necesită device fizic + cont iCloud activ.
