# Adaugă imagine din Fișiere la atașamente document — design

**Dată:** 2026-07-13
**Status:** aprobat (design + amendament), plan: `docs/superpowers/plans/2026-07-13-imagine-din-fisiere.md`

## Problemă

Meniul „Adaugă atașament" / „Adaugă pagină" (folosit la crearea unui document nou
și la adăugarea de pagini pe unul existent) oferă doar:
- „Scanează document" (cameră, prin `scanDocumentPages`)
- „Galerie" (`ImagePicker.launchImageLibraryAsync` — strict Photos)
- „Adaugă PDF" (`DocumentPicker`, filtrat la `application/pdf`)

O imagine care există în app-ul **Fișiere** (iCloud Drive, Descărcări, primită
prin AirDrop/WhatsApp/email și nesalvată în Poze) nu poate fi selectată — nu
există niciun picker de imagini prin Files, doar prin Photos.

Același pattern e duplicat identic în 4 locuri:
- `app/(tabs)/documente/add.tsx` — `handleAddPage()` (document nou)
- `app/(tabs)/documente/edit.tsx` — `handleAddPage()` (pagină nouă pe document existent)
- `app/(tabs)/documente/[id].tsx` — `handleAddPage()` (pagină nouă, din ecranul de detaliu)
- `app/(tabs)/entitati/fuel.tsx` — `handleScanReceipt()` (scanare bon combustibil)

## Decizie

Adaugă o opțiune nouă **„Din Fișiere"** în fiecare din cele 4 meniuri, folosind
`DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true })`
— exact pattern-ul deja folosit pentru „Adaugă PDF", doar cu filtru de tip imagine
în loc de `application/pdf`. `expo-document-picker` e deja importat în toate cele
4 fișiere; nu se adaugă nicio dependență nouă. Nu necesită permisiune runtime
(Files app nu cere `MediaLibrary` permission, spre deosebire de Galerie).

Rezultatul (`result.assets[0].uri`) e un URI local (`copyToCacheDirectory: true`)
și intră în același pipeline de procesare ca imaginea din Galerie la fiecare
call-site — deci OCR / AI mapping / crop rulează identic, indiferent de sursă.

## Scope

### Inclus
- `add.tsx`: opțiune nouă → `pickImageFromFiles()`. Extrag partea comună de
  crop+salvare din `pickImage()` existent într-un helper `cropAndProcessImage(uri)`
  (folosit de ambele surse, Galerie și Fișiere) — evită duplicarea fluxului cropper.
- `edit.tsx` / `[id].tsx`: handler inline în Alert (ca handler-ul „Adaugă PDF"
  deja existent acolo) → `DocumentPicker` → `saveAndAddPage(uri)`. Fără cropper
  (Galeria nu trece prin cropper în aceste două ecrane; păstrăm simetria).
- `fuel.tsx`: funcție nouă `handleScanFromFiles()` → `processReceiptUri(uri)`
  (funcția deja citește base64 singură dacă nu i-l dai).
- Label meniu: `Scanează document / Galerie / Din Fișiere / Adaugă PDF / Anulează`.
- Eroare la selecție eșuată: `Alert.alert('Eroare', ...)`, la fel ca handler-ul PDF.

### Exclus explicit
- `components/PropertyProvidersSection.tsx` (scanare factură utilități) — nu are
  deloc opțiune PDF/Fișiere azi; nu a fost confirmat ca fiind în scope.
- Photo picker-ul de vehicul din `app/(tabs)/entitati/[id].tsx`
  (`handlePickPhoto`) — e un buton unic „schimbă poza", nu un meniu cu surse
  multiple; pattern diferit, nu în scope.
- Fără selecție multiplă de imagini din Fișiere (rămâne un fișier per apel, ca
  la Galerie).
- Fără audit script nou — nu e o regresie de schemă/date, e o opțiune UI lipsă.

## Amendament (2026-07-13, code review pre-implementare)

**fuel.tsx: normalizare JPEG obligatorie înainte de base64.** Afirmația
„pipeline identic indiferent de sursă" e adevărată pentru add/edit/[id]
(`processDocumentImage` re-encodează orice input în JPEG), dar NU pentru
fuel.tsx: `processReceiptUri` citește octeții bruti ai fișierului ca base64,
iar `mapFuelReceiptWithAi` îi trimite la AI cu mime hardcodat `'image/jpeg'`
(`services/aiOcrMapper.ts:262`). Sursele de azi (scanner, ImagePicker) produc
mereu JPEG, dar exact imaginile țintite de feature — HEIC din AirDrop, PNG din
screenshot-uri, WebP din WhatsApp/web — ar ajunge cu bytes non-JPEG etichetați
JPEG → AI vision silențios inutil (fallback grațios pe regex, dar degradat).

**Fix:** în noul `handleScanFromFiles()`, base64-ul pentru AI se obține prin
`compressImageToBase64ForAi(uri)` (helper EXISTENT în
`services/imageProcessing.ts`, folosit deja de `pdfOcr.ts` pentru același
motiv) și se pasează ca `prefetchedBase64` la `processReceiptUri(uri, base64)`.
OCR-ul on-device (`extractText(uri)`) rămâne pe URI-ul original — Vision
decodează HEIC/PNG/WebP nativ. Zero modificări în `aiOcrMapper.ts`.

**Notă verificare Simulator:** picker-ul Files (`UIDocumentPickerViewController`)
e remote view controller — poate ignora tap-urile sintetice (idem PHPicker,
vezi memoria `sim_automation_quirks`). Verificarea fluxului „Din Fișiere" poate
cere tap-uri manuale în Simulator + fișiere pre-plantate în „On My iPhone".

## Verificare colaterală (Blast Radius)

- **Simboluri modificate:** `handleAddPage` (add.tsx, edit.tsx, [id].tsx),
  `handleScanReceipt` (fuel.tsx). Fiecare e apelat doar din butonul „+" /
  „Adaugă atașament" al ecranului propriu — niciun alt consumator.
- **Fără schimbare de schemă SQLite, tip/enum, sau contract de hook.**
- **Ecrane de verificat vizual în Simulator:** Documente → Adaugă document,
  Documente → detaliu → Adaugă pagină, Entități → Combustibil → Scanează bon.
  Testez explicit fluxul „Din Fișiere" (alegere imagine din Files/iCloud Drive)
  pe fiecare, plus regresie rapidă pe „Galerie" și „Adaugă PDF" (butoane vecine
  în același Alert, risc de typo la editare listă).
