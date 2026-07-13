# „Adaugă imagine din Fișiere" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opțiune nouă „Din Fișiere" în cele 4 meniuri de adăugare atașament/bon, ca imaginile din app-ul Fișiere (iCloud Drive, AirDrop, Descărcări) să poată fi selectate — nu doar cele din Poze.

**Architecture:** Fiecare meniu primește o intrare nouă care apelează `DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true })` — exact pattern-ul „Adaugă PDF" existent, cu filtru de imagine. URI-ul rezultat intră în pipeline-ul de procesare deja existent la fiecare call-site. **Amendament fuel.tsx:** base64-ul trimis la AI se normalizează întâi la JPEG prin `compressImageToBase64ForAi()` (helper existent), pentru că `mapFuelReceiptWithAi` are mime hardcodat `'image/jpeg'` iar fișierele din Files pot fi HEIC/PNG/WebP.

**Tech Stack:** React Native + Expo (TypeScript), `expo-document-picker` (deja importat în toate cele 4 fișiere — zero dependențe noi), `expo-image-manipulator` (indirect, prin helper existent).

**Spec:** `docs/superpowers/specs/2026-07-13-imagine-din-fisiere-design.md` (inclusiv secțiunea „Amendament").

## Global Constraints

- Toate textele UI în română. Label-ul nou: exact `Din Fișiere`.
- Mesaj de eroare la selecție eșuată: `Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta imaginea')` — pattern-ul catch standard al repo-ului (`e instanceof Error ? e.message : ...`).
- Poziția în meniu: după „Galerie", înainte de „Adaugă PDF" / „PDF".
- Zero dependențe noi în `package.json`.
- Fără selecție multiplă (`multiple` rămâne default `false`) — un fișier per apel, ca la Galerie.
- Nu se modifică `services/aiOcrMapper.ts`, nu se modifică scheme SQLite, tipuri sau contracte de hook.
- Commit messages în engleză. Toate comenzile se rulează din folderul `app/`.
- **De ce nu există pași de test jest:** nu se adaugă logică pură nouă — totul e wiring de picker-e native în handler-e de ecran, iar repo-ul nu are teste jest pentru ecrane (doar servicii/unit). Verificarea e cea din Definition of Done: `npm run type-check` + verificare vizuală în iOS Simulator (Task 6).

---

### Task 1: add.tsx — helper `cropAndProcessImage` + `pickImageFromFiles` + intrare meniu

**Files:**
- Modify: `app/(tabs)/documente/add.tsx` (handleAddPage la ~linia 972, pickImage la ~linia 1055)

**Interfaces:**
- Consumes: `processAndSaveImage(uri)`, `makeRequestId()`, `awaitCropper(requestId)`, `router`, `DocumentPicker` — toate deja existente/importate în fișier.
- Produces: `cropAndProcessImage(uri: string): Promise<void>` și `pickImageFromFiles(): Promise<void>` — folosite doar în acest fișier.

- [ ] **Step 1: Extrage partea de crop+salvare din `pickImage()` într-un helper**

Găsește funcția `pickImage()` (la ~linia 1055) și înlocuiește-o integral cu următoarele trei funcții (helper-ul + `pickImage` refăcut + `pickImageFromFiles` nou):

```tsx
  /** Trimite imaginea prin cropper (fullScreenModal) și salvează rezultatul
   *  ca pagină. Folosit de ambele surse: Galerie și Fișiere. */
  async function cropAndProcessImage(uri: string) {
    const requestId = makeRequestId();
    const cropPromise = awaitCropper(requestId);
    router.push({ pathname: '/cropper', params: { uri, requestId } });
    const croppedUri = await cropPromise;
    if (!croppedUri) return;

    // Imaginea cropped a fost generată de expo-perspective-crop → EXIF
    // normalizat în output, nu mai trecem orientarea originală mai departe.
    await processAndSaveImage(croppedUri);
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune', 'Este nevoie de acces la galerie.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
    });
    if (result.canceled || !result.assets[0]) return;
    await cropAndProcessImage(result.assets[0].uri);
  }

  async function pickImageFromFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      await cropAndProcessImage(asset.uri);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta imaginea');
    }
  }
```

Notă: comentariul despre EXIF exista în `pickImage()` original — se mută în helper, nu se duplică. Vechea funcție `pickImage()` conținea permisiunea + picker + crop + save; după edit, crop + save trăiesc doar în `cropAndProcessImage`.

- [ ] **Step 2: Adaugă intrarea de meniu**

Găsește `handleAddPage()` (la ~linia 972) și înlocuiește-o cu:

```tsx
  function handleAddPage() {
    Alert.alert('Adaugă atașament', '', [
      { text: 'Scanează document', onPress: scanDocumentHandler },
      { text: 'Galerie', onPress: pickImage },
      { text: 'Din Fișiere', onPress: pickImageFromFiles },
      { text: 'Adaugă PDF', onPress: pickPdf },
      { text: 'Anulează', style: 'cancel' },
    ]);
  }
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: exit 0, fără erori. (Hook-ul PostToolUse rulează oricum `tsc --noEmit` după edit — ambele trebuie să fie verzi.)

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/documente/add.tsx"
git commit -m "feat: add 'Din Fisiere' image source to document add screen"
```

---

### Task 2: edit.tsx — handler inline + intrare meniu

**Files:**
- Modify: `app/(tabs)/documente/edit.tsx` (handleAddPage la ~linia 516)

**Interfaces:**
- Consumes: `saveAndAddPage(uri: string): Promise<void>` (există la ~linia 456; salvează prin `saveImageAsPage` → `processDocumentImage` care re-encodează orice format în JPEG — HEIC/PNG/WebP sunt safe aici), `DocumentPicker` (importat la linia 10).
- Produces: nimic folosit de alte task-uri.

- [ ] **Step 1: Adaugă handler-ul inline în Alert**

În `handleAddPage()` (la ~linia 516), inserează obiectul de mai jos în array-ul de butoane, **între** intrarea `'Galerie'` și intrarea `'Adaugă PDF'`:

```tsx
      {
        text: 'Din Fișiere',
        onPress: async () => {
          try {
            const result = await DocumentPicker.getDocumentAsync({
              type: 'image/*',
              copyToCacheDirectory: true,
            });
            if (!result.canceled && result.assets[0]?.uri) {
              await saveAndAddPage(result.assets[0].uri);
            }
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta imaginea');
          }
        },
      },
```

Fără cropper aici — Galeria nu trece prin cropper în acest ecran; păstrăm simetria (decizie din spec).

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/documente/edit.tsx"
git commit -m "feat: add 'Din Fisiere' image source to document edit screen"
```

---

### Task 3: [id].tsx — handler inline + intrare meniu

**Files:**
- Modify: `app/(tabs)/documente/[id].tsx` (handleAddPage la ~linia 642)

**Interfaces:**
- Consumes: `saveAndAddPage(uri: string): Promise<void>` (există în fișier; același pipeline `saveImageAsPage` ca la edit.tsx), `DocumentPicker` (importat la linia 10).
- Produces: nimic folosit de alte task-uri.

- [ ] **Step 1: Adaugă handler-ul inline în Alert**

În `handleAddPage()` (la ~linia 642), inserează obiectul de mai jos în array-ul de butoane, **între** intrarea `'Galerie'` și intrarea `'Adaugă PDF'` (cod identic cu Task 2 — intenționat, e pattern-ul inline local al acestor două ecrane):

```tsx
      {
        text: 'Din Fișiere',
        onPress: async () => {
          try {
            const result = await DocumentPicker.getDocumentAsync({
              type: 'image/*',
              copyToCacheDirectory: true,
            });
            if (!result.canceled && result.assets[0]?.uri) {
              await saveAndAddPage(result.assets[0].uri);
            }
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta imaginea');
          }
        },
      },
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/documente/[id].tsx"
git commit -m "feat: add 'Din Fisiere' image source to document detail screen"
```

---

### Task 4: fuel.tsx — `handleScanFromFiles` cu normalizare JPEG (AMENDAMENT) + intrare meniu

**Files:**
- Modify: `app/(tabs)/entitati/fuel.tsx` (import nou lângă celelalte importuri `@/services/`; funcție nouă lângă `handleScanFromPdf` la ~linia 307; handleScanReceipt la ~linia 322)

**Interfaces:**
- Consumes: `processReceiptUri(uri: string, prefetchedBase64?: string): Promise<void>` (există la ~linia 217 — dacă primește `prefetchedBase64`, NU mai citește octeții bruti ai fișierului), `compressImageToBase64ForAi(uri: string): Promise<string>` din `@/services/imageProcessing` (helper EXISTENT: resize ≤2048px + re-encode JPEG q=0.8 + return base64; folosit deja de `services/pdfOcr.ts` pentru exact același motiv).
- Produces: `handleScanFromFiles(): Promise<void>` — folosit doar în acest fișier.

**De ce normalizarea (amendamentul din spec):** `mapFuelReceiptWithAi` trimite base64 la AI cu mime hardcodat `'image/jpeg'` (`services/aiOcrMapper.ts:262`). Scanner-ul și ImagePicker produc mereu JPEG, dar fișierele din Files pot fi HEIC (AirDrop), PNG (screenshot), WebP (web) → bytes non-JPEG etichetați JPEG → AI vision eșuează silențios. `compressImageToBase64ForAi` garantează bytes JPEG. OCR-ul on-device (`extractText`) rămâne pe URI-ul original — Vision decodează orice format nativ.

- [ ] **Step 1: Adaugă importul**

Sub linia `import { extractText, extractFuelInfo } from '@/services/ocr';` adaugă:

```tsx
import { compressImageToBase64ForAi } from '@/services/imageProcessing';
```

- [ ] **Step 2: Adaugă funcția nouă**

Imediat după funcția `handleScanFromPdf()` (se termină la ~linia 320), adaugă:

```tsx
  async function handleScanFromFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      // Fișierele din Files pot fi HEIC/PNG/WebP, iar mapFuelReceiptWithAi
      // trimite base64 cu mime hardcodat 'image/jpeg' — normalizăm la JPEG
      // înainte, altfel AI vision primește bytes care nu corespund mime-ului.
      let jpegBase64: string | undefined;
      try {
        jpegBase64 = await compressImageToBase64ForAi(asset.uri);
      } catch (err) {
        console.warn('[fuel-files] JPEG normalize failed:', err);
      }
      await processReceiptUri(asset.uri, jpegBase64);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta imaginea');
    }
  }
```

Notă: dacă normalizarea eșuează, `jpegBase64` rămâne `undefined` și `processReceiptUri` cade pe citirea brută existentă — degradare grațioasă (AI poate eșua pe non-JPEG, dar regex-ul pe OCR on-device funcționează oricum), nu blocare.

- [ ] **Step 3: Adaugă intrarea de meniu**

Înlocuiește `handleScanReceipt()` (la ~linia 322) cu:

```tsx
  function handleScanReceipt() {
    Alert.alert('Scanează bon', 'Alege sursa', [
      { text: 'Scaner', onPress: handleScanFromCamera },
      { text: 'Galerie', onPress: handleScanFromGallery },
      { text: 'Din Fișiere', onPress: handleScanFromFiles },
      { text: 'PDF', onPress: handleScanFromPdf },
      { text: 'Anulează', style: 'cancel' },
    ]);
  }
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/entitati/fuel.tsx"
git commit -m "feat: add 'Din Fisiere' receipt source with JPEG normalization for AI vision"
```

---

### Task 5: appKnowledge.ts — înregistrează fluxul nou (regula „Sincronizare cunoștințe")

**Files:**
- Modify: `services/appKnowledge.ts` (~linia 130-131, lista surselor de atașament)

**Interfaces:**
- Consumes: nimic din task-urile anterioare (text static).
- Produces: nimic — knowledge base pentru chatbot.

**De ce:** CLAUDE.md cere ca orice flux nou în UI să fie descris în `appKnowledge.ts` (sursa chatbot-ului). Lista surselor de atașament există deja la ~linia 129-132.

- [ ] **Step 1: Adaugă bullet-ul**

În `services/appKnowledge.ts`, între bullet-ul `- **„Galerie"** — importă o imagine existentă din galeria telefonului.` (~linia 130) și bullet-ul `- **„Adaugă PDF"** — atașează un PDF din file picker.` (~linia 131), inserează:

```
- **„Din Fișiere"** — importă o imagine din app-ul Fișiere (iCloud Drive, Descărcări, AirDrop) care nu e salvată în Poze. Disponibil și la scanarea bonurilor de combustibil.
```

Păstrează exact formatul bullet-urilor vecine (linie nouă, aceeași punctuație em-dash).

- [ ] **Step 2: Knowledge audit + type-check**

Run: `node scripts/knowledge-audit.js --strict && npm run type-check`
Expected: ambele exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/appKnowledge.ts
git commit -m "docs: register 'Din Fisiere' attachment source in app knowledge base"
```

---

### Task 6: Verificare vizuală în iOS Simulator (Definition of Done)

**Files:** niciunul — verificare manuală. Nu marca feature-ul „done" fără acest task.

**⚠️ Caveat automation:** picker-ul Files (`UIDocumentPickerViewController`) e remote view controller și poate ignora tap-urile sintetice (idem PHPicker — vezi memoria `sim_automation_quirks`). Dacă tap-urile automate nu funcționează în picker, cere userului să facă tap manual sau pre-plantează imagini de test în „On My iPhone" (drag & drop imagine peste fereastra Simulatorului cu Files deschis). Dacă verificarea nu se poate face deloc, raportează explicit „NU am verificat X pentru că Y" — nu declara done pe baza type-check-ului verde.

- [ ] **Step 1: Pornește app-ul în Simulator**

Run: `npm run ios` (sau folosește build-ul existent + `npx expo start --clear`)
Expected: app-ul pornește pe Simulator.

- [ ] **Step 2: Verifică fluxul nou în toate cele 4 ecrane**

Pentru fiecare, alege „Din Fișiere", selectează o imagine din Files și confirmă rezultatul:

1. **Documente → + (Adaugă document) → Adaugă atașament → Din Fișiere** → se deschide cropper-ul → după crop, pagina apare în listă și OCR pornește.
2. **Documente → un document existent → Editează → Adaugă pagină → Din Fișiere** → pagina se atașează direct (fără cropper).
3. **Documente → un document existent (ecran detaliu) → Adaugă atașament → Din Fișiere** → pagina se atașează direct (fără cropper).
4. **Entități → vehicul → Combustibil → Scanează bon → Din Fișiere** → câmpurile formularului se completează din OCR/AI.

Ideal la punctul 4: folosește un PNG sau HEIC (screenshot de bon), nu JPEG — asta exersează exact normalizarea din amendament.

- [ ] **Step 3: Regresie rapidă pe butoanele vecine**

În fiecare din cele 4 meniuri, verifică că „Galerie" și „Adaugă PDF"/„PDF" încă funcționează (butoane vecine în același Alert — risc de typo la editarea listei). Un singur flow complet per buton e suficient.

- [ ] **Step 4: Raport final**

Mesajul de încheiere către user TREBUIE să conțină secțiunea `**Verificat colateral:**` cu fiecare ecran/flux și cum a fost verificat (click în Simulator / citit cod / audit verde), conform Definition of Done din CLAUDE.md.
