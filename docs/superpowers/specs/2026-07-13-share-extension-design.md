# iOS Share Extension — „Trimite către Dosar" din share sheet

**Data:** 2026-07-13
**Status:** aprobat (brainstorming cu userul)

## Context și scop

Azi, Dosar nu apare în share sheet-ul iOS: o poză din Photos sau un PDF din
Files/Safari/Mail nu pot fi trimise direct în aplicație. Userul trebuie să
deschidă manual Dosar → Adaugă document → import din galerie.

**Scop:** share o poză (sau mai multe) sau un PDF din orice aplicație → apare
„Dosar" în share sheet → se deschide aplicația direct pe ecranul „Adaugă
document" cu fișierele preîncărcate → pipeline-ul AI existent (OCR →
clasificare → extragere câmpuri) → user verifică → salvează.

## Decizii de UX (validate cu userul)

1. **Se deschide aplicația** — nu UI custom în share sheet. Refolosește 100%
   pipeline-ul existent din `add.tsx`; AI-ul local (llama.rn) nu ar putea rula
   în limita de ~120MB a unei extensii.
2. **Multi-select → un document multi-pagină.** N poze partajate devin N pagini
   ale unui singur document (cazul tipic: contract fotografiat în 3 poze).
3. **Toate imaginile trec prin cropper, secvențial.** Fiecare imagine partajată
   deschide cropper-ul pe rând (perspective correction → OCR mai bun), cu
   indicator de progres („Pagina 2 din 5") în header. Anularea unui crop sare
   doar acea imagine.

## Abordare tehnică (validată cu userul)

**`expo-share-intent@^6`** (linia de versiuni pentru Expo SDK 55; matrice:
SDK 55 → v6, SDK 56 → v7, SDK 57 → v8). De la v6 nu mai necesită
patch-package. Config plugin-ul generează la `expo prebuild` target-ul nativ
ShareExtension + App Group (`group.com.ax.documente`) — compatibil cu CNG pur
(`ios/` gitignored), nimic manual în Xcode.

Alternativa respinsă: extensie Swift proprie + config plugin scris de noi —
control total, dar mentenanța injectării de target Xcode la fiecare SDK
upgrade cade pe noi; efort 5-10x pentru același rezultat.

**Cum funcționează:** extensia copiază fișierele partajate în App Group și
redirecționează instant în aplicație. În RN, fișierele apar prin
`useShareIntentContext()`.

## Arhitectură — fișiere atinse

| Fișier | Modificare |
|---|---|
| `package.json` | + `expo-share-intent@^6` |
| `app.json` | config plugin cu `iosActivationRules`: imagini max 10 + fișiere max 1 (PDF). iOS nu filtrează „doar PDF" cu reguli simple → validare MIME în aplicație |
| `app/_layout.tsx` | wrap în `<ShareIntentProvider>`; `useEffect` nou lângă deep-link handler: share intent prezent **și** `!appLock.locked` **și** `onboardingDone` → `router.push('/(tabs)/documente/add')` |
| `services/shareIntentIngest.ts` | **nou, mic** — validare MIME (imagine/PDF), split imagini/PDF, mesaje de eroare RO. Separat de `add.tsx` (god file 1535 linii, nu-l creștem) |
| `app/(tabs)/documente/add.tsx` | la focus, dacă există share intent neconsumat: ingest (vezi fluxul) + `resetShareIntent()` |
| `app/cropper.tsx` | param opțional de progres („Pagina k din N") afișat în header |
| `services/appKnowledge.ts` | descriere feature pentru chatbot („trimite o poză din Photos către Dosar…") |
| `scripts/knowledge-audit.js` | înregistrare `shareIntentIngest.ts` în `ENTRIES` |

**Fără schimbare de schemă SQLite** → `backup.ts`/`cloudSync.ts` neatinse,
backup-audit neafectat.

## Flux de date

1. User selectează 1-10 poze (sau 1 PDF) → Share → „Dosar".
2. Extensia copiază fișierele în App Group → deschide `acte://…` (gestionat de
   pachet) → aplicația pornește / revine în foreground.
3. `_layout.tsx`: efectul vede share intent + app deblocat → push pe
   `/documente/add` (instanță nouă pe stack — un draft existent rămâne în
   spate, nu se pierde).
4. `add.tsx` la focus: preia fișierele din context, `resetShareIntent()`.
   - **Imagini:** secvențial, fiecare prin cropper (`awaitCropper` existent) →
     `processAndSaveImage` → `runOcrOnImage`.
   - **PDF:** calea existentă din `pickPdf` (copiere + extract text /
     render primă pagină pentru vision).
5. Din acest punct, comportament identic cu fluxul actual: badge OCR, buton
   „Analizează cu AI" (gated de consimțământul AI existent —
   `textAiConsentAvailable`), user verifică câmpurile, salvează.

## Edge cases

| Situație | Comportament |
|---|---|
| Cold start (app închisă) | pachetul acoperă cold + warm; efectul din `_layout.tsx` rulează când contextul se populează |
| App lock activ | redirect-ul așteaptă unlock-ul; fișierele rămân în context |
| „Adaugă" deja deschis cu date nesalvate | `router.push` → instanță nouă pe stack; draftul vechi rămâne în spate |
| Imagini + PDF în același share | toate devin pagini ale aceluiași document (imagini prin cropper, PDF prin calea lui; max 1 PDF prin activation rule) |
| Fișier nesuportat (.docx etc.) | Alert RO „Dosar acceptă doar imagini și PDF-uri"; fișierele valide continuă |
| Anulare cropper la pagina k | pagina k sărită, continuă cu k+1 |
| Eroare copiere fișier | mesaj RO pentru acel fișier, restul continuă |
| Re-focus pe ecran | `resetShareIntent()` imediat după preluare — nu re-ingerează |

**Error handling:** pattern-ul standard al proiectului
(`e instanceof Error ? e.message : 'Eroare necunoscută'`, mesaje RO).

## Testare

1. **Unit (jest):** `shareIntentIngest.ts` — validare MIME, split
   imagini/PDF, cazuri de eroare.
2. **Manual pe simulator** (share sheet funcționează în Photos din simulator):
   1 poză · 3 poze · PDF din Files · tip nesuportat · app lock activ ·
   cold start vs. app deschisă. Verificare finală cu iOS Simulator MCP.
3. **Audituri:** `npm run audit` (type-check, knowledge-audit pentru serviciul
   nou, restul suitei).

## Note de build / release

- Extensia apare doar într-un build nativ nou: `npm run prebuild` +
  `npm run ios`. Nu funcționează în Expo Go.
- La primul archive pentru TestFlight: target-ul nou + App Group se semnează
  cu automatic signing; de verificat că App Store Connect a înregistrat
  capability-ul App Group pe ambele bundle ID-uri
  (`com.ax.documente`, `com.ax.documente.ShareExtension`).
- La fiecare upgrade Expo SDK: bump corespunzător `expo-share-intent`
  (matricea din README-ul pachetului).

## Out of scope

- Android share intents (vine aproape gratis din același pachet — fază
  ulterioară, când Android devine țintă).
- UI custom în share sheet / salvare fără deschiderea aplicației.
- Procesare AI automată fără tap pe „Analizează cu AI" (păstrăm gating-ul de
  consimțământ existent).
