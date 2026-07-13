# iOS Share Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dosar apare în share sheet-ul iOS; o poză (sau mai multe) sau un PDF partajat deschide aplicația direct pe „Adaugă document" cu fișierele preîncărcate, prin pipeline-ul AI existent.

**Architecture:** `expo-share-intent@^6` (config plugin → target nativ ShareExtension + App Group la prebuild). `app/+native-intent.ts` redirecționează URL-ul extensiei către `/(tabs)/documente/add`. Un serviciu pur nou (`shareIntentIngest.ts`) validează/clasifică fișierele; `add.tsx` le consumă prin `useShareIntentContext()`: imaginile trec secvențial prin cropper, PDF-ul prin calea `pickPdf` existentă (refactorizată în `ingestPdf(uri)`).

**Tech Stack:** Expo SDK 55 (CNG pur, `ios/` gitignored), expo-router, expo-share-intent v6, jest (preset jest-expo).

**Spec:** `docs/superpowers/specs/2026-07-13-share-extension-design.md`

## Global Constraints

- **Versiune pachet:** `expo-share-intent@^6` — NU v7/v8 (acelea cer SDK 56/57; proiectul e pe SDK 55).
- **Texte UI:** toate în română.
- **Error handling:** `e instanceof Error ? e.message : 'Eroare necunoscută'` (audit strict `catch-pattern-audit`).
- **Culori:** nimic hardcodat; `useColorScheme` DOAR din `@/components/useColorScheme` (cropper.tsx respectă deja).
- **God file:** `add.tsx` are 1535 linii — delta minim; logica nouă merge în `services/shareIntentIngest.ts`.
- **Commits:** mesaje în engleză; pre-commit hook rulează type-check + toată suita de audit (durează ~1 min — normal).
- **Branch:** implementarea se face pe branch-ul curent de lucru (vezi nota de la finalul planului).

## Blast Radius (verificat cu grep la scrierea planului)

- `pickPdf` — folosit DOAR în `add.tsx` (refactor local sigur).
- Push către `/cropper` — DOAR din `add.tsx` (`pickImage`); param nou `progress` e opțional → backwards compatible.
- `_layout.tsx` — provider nou învelește `<RootLayoutNav />`; context static până la un share → fără re-render-uri noi.
- `app.json` — plugin nou → necesită `npm run prebuild` + build nativ nou.
- Audituri: `knowledge-audit` va flag-ui serviciul nou până la Task 6 (înregistrare ENTRIES); `backup-audit` neafectat (zero schimbări de schemă); `file-size-audit` — add.tsx crește cu ~90 linii (deja în lista god files, split planificat separat în P2.x).
- Jest: test unitar nou; characterization tests neafectate.

---

### Task 1: Instalare expo-share-intent + config plugin + prebuild

**Files:**
- Modify: `package.json` (dependință nouă)
- Modify: `app.json` (plugin nou în `expo.plugins`)
- Regenerat: `ios/` (gitignored, prin prebuild)

**Interfaces:**
- Produces: pachetul `expo-share-intent` instalat (exportă `ShareIntentProvider`, `useShareIntentContext`, `getShareExtensionKey`, tip `ShareIntentFile`) + target nativ ShareExtension generat la prebuild. Task-urile 2, 4, 5 depind de el.

- [ ] **Step 1: Instalează pachetul (versiunea v6, compatibilă SDK 55)**

```bash
cd /Users/ax/work/documents/app
npm install expo-share-intent@^6
```

Verifică: `node -e "console.log(require('expo-share-intent/package.json').version)"` → `6.x.y`.
(`expo-linking` e deja instalat: `~55.0.7` — nu mai instala nimic.)

- [ ] **Step 2: Adaugă config plugin-ul în app.json**

În `app.json`, în array-ul `expo.plugins`, după blocul `expo-build-properties`, adaugă:

```json
[
  "expo-share-intent",
  {
    "iosActivationRules": {
      "NSExtensionActivationSupportsImageWithMaxCount": 10,
      "NSExtensionActivationSupportsFileWithMaxCount": 1
    }
  }
]
```

NU adăuga `androidIntentFilters` — Android e out of scope (spec).
iOS nu poate filtra „doar PDF" prin reguli simple → validarea MIME se face în aplicație (Task 2).

- [ ] **Step 3: Rulează prebuild și verifică target-ul generat**

```bash
npm run prebuild
```

(= `expo prebuild --clean`; regenerează `ios/` de la zero + pod install — durează câteva minute.)

Verifică:
```bash
ls ios/ | grep -i share          # așteptat: director ShareExtension (sau similar)
grep -r "group.com.ax.documente" ios --include="*.entitlements"
# așteptat: App Group în entitlements-urile ambelor target-uri (app + extensie)
```

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```
Expected: PASS (zero erori).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "feat: add expo-share-intent config plugin for iOS share extension"
```

---

### Task 2: Serviciul `shareIntentIngest` (TDD)

**Files:**
- Create: `services/shareIntentIngest.ts`
- Test: `__tests__/unit/shareIntentIngest.test.ts`

**Interfaces:**
- Consumes: tipul `ShareIntentFile` din `expo-share-intent` (import type-only — zero dependențe runtime, testabil fără mock-uri).
- Produces (folosite de Task 5):
  - `planShareIngest(files: ShareIntentFile[]): ShareIngestPlan` unde `ShareIngestPlan = { images: ShareIntentFile[]; pdf: ShareIntentFile | null; ignored: ShareIntentFile[] }`
  - `describeIgnored(plan: ShareIngestPlan): string | null` (mesaj RO sau null)
  - `toFileUri(path: string): string`
  - `MAX_SHARED_IMAGES = 10`

- [ ] **Step 1: Scrie testele (failing)**

`__tests__/unit/shareIntentIngest.test.ts`:

```typescript
import {
  planShareIngest,
  describeIgnored,
  toFileUri,
  MAX_SHARED_IMAGES,
} from '@/services/shareIntentIngest';
import type { ShareIntentFile } from 'expo-share-intent';

function file(over: Partial<ShareIntentFile>): ShareIntentFile {
  return {
    fileName: 'poza.jpg',
    mimeType: 'image/jpeg',
    path: '/tmp/poza.jpg',
    size: 100,
    width: null,
    height: null,
    duration: null,
    ...over,
  };
}

describe('planShareIngest', () => {
  it('pune imaginile în ordine, fără pdf', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.jpg' }),
      file({ fileName: 'b.png', mimeType: 'image/png' }),
    ]);
    expect(plan.images.map(f => f.fileName)).toEqual(['a.jpg', 'b.png']);
    expect(plan.pdf).toBeNull();
    expect(plan.ignored).toHaveLength(0);
  });

  it('separă PDF-ul de imagini', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.jpg' }),
      file({ fileName: 'doc.pdf', mimeType: 'application/pdf' }),
    ]);
    expect(plan.images).toHaveLength(1);
    expect(plan.pdf?.fileName).toBe('doc.pdf');
  });

  it('recunoaște PDF după extensie când mimeType e generic', () => {
    const plan = planShareIngest([
      file({ fileName: 'Contract.PDF', mimeType: 'application/octet-stream' }),
    ]);
    expect(plan.pdf?.fileName).toBe('Contract.PDF');
  });

  it('al doilea PDF e ignorat', () => {
    const plan = planShareIngest([
      file({ fileName: 'a.pdf', mimeType: 'application/pdf' }),
      file({ fileName: 'b.pdf', mimeType: 'application/pdf' }),
    ]);
    expect(plan.pdf?.fileName).toBe('a.pdf');
    expect(plan.ignored.map(f => f.fileName)).toEqual(['b.pdf']);
  });

  it('limitează imaginile la MAX_SHARED_IMAGES', () => {
    const files = Array.from({ length: MAX_SHARED_IMAGES + 2 }, (_, i) =>
      file({ fileName: `p${i}.jpg`, path: `/tmp/p${i}.jpg` })
    );
    const plan = planShareIngest(files);
    expect(plan.images).toHaveLength(MAX_SHARED_IMAGES);
    expect(plan.ignored).toHaveLength(2);
  });

  it('tipurile nesuportate merg la ignored', () => {
    const plan = planShareIngest([
      file({ fileName: 'x.docx', mimeType: 'application/vnd.openxmlformats' }),
    ]);
    expect(plan.images).toHaveLength(0);
    expect(plan.pdf).toBeNull();
    expect(plan.ignored).toHaveLength(1);
  });
});

describe('describeIgnored', () => {
  it('null când nu e nimic ignorat', () => {
    expect(describeIgnored(planShareIngest([file({})]))).toBeNull();
  });

  it('mesaj RO cu numele fișierelor ignorate', () => {
    const msg = describeIgnored(
      planShareIngest([file({ fileName: 'x.docx', mimeType: 'application/msword' })])
    );
    expect(msg).toContain('x.docx');
    expect(msg).toContain('imagini');
  });
});

describe('toFileUri', () => {
  it('adaugă prefixul file://', () => {
    expect(toFileUri('/var/mobile/f.jpg')).toBe('file:///var/mobile/f.jpg');
  });

  it('păstrează URI-urile care au deja prefix', () => {
    expect(toFileUri('file:///var/mobile/f.jpg')).toBe('file:///var/mobile/f.jpg');
  });
});
```

- [ ] **Step 2: Rulează testele — trebuie să pice**

```bash
npx jest __tests__/unit/shareIntentIngest.test.ts
```
Expected: FAIL — `Cannot find module '@/services/shareIntentIngest'`.

- [ ] **Step 3: Implementează serviciul**

`services/shareIntentIngest.ts`:

```typescript
/**
 * Validare și clasificare a fișierelor primite prin iOS Share Extension
 * (expo-share-intent). Pur — import type-only, zero dependențe runtime.
 *
 * iOS nu poate restrânge activation rules la „doar PDF" (regula acceptă
 * orice fișier), așa că filtrarea de tip se face aici, în aplicație.
 */
import type { ShareIntentFile } from 'expo-share-intent';

export const MAX_SHARED_IMAGES = 10;

export type ShareIngestPlan = {
  /** Imagini, în ordinea primită (devin pagini, fiecare prin cropper). */
  images: ShareIntentFile[];
  /** Maxim un PDF (activation rule permite 1; defensiv și aici). */
  pdf: ShareIntentFile | null;
  /** Tipuri nesuportate sau peste limită — raportate userului. */
  ignored: ShareIntentFile[];
};

function isImage(file: ShareIntentFile): boolean {
  return typeof file.mimeType === 'string' && file.mimeType.startsWith('image/');
}

function isPdf(file: ShareIntentFile): boolean {
  return (
    file.mimeType === 'application/pdf' ||
    (typeof file.fileName === 'string' && file.fileName.toLowerCase().endsWith('.pdf'))
  );
}

export function planShareIngest(files: ShareIntentFile[]): ShareIngestPlan {
  const plan: ShareIngestPlan = { images: [], pdf: null, ignored: [] };
  for (const file of files) {
    if (isImage(file) && plan.images.length < MAX_SHARED_IMAGES) {
      plan.images.push(file);
    } else if (isPdf(file) && plan.pdf === null) {
      plan.pdf = file;
    } else {
      plan.ignored.push(file);
    }
  }
  return plan;
}

export function describeIgnored(plan: ShareIngestPlan): string | null {
  if (plan.ignored.length === 0) return null;
  const names = plan.ignored
    .map(f => f.fileName)
    .filter(Boolean)
    .join(', ');
  return (
    `Dosar acceptă doar imagini (maxim ${MAX_SHARED_IMAGES}) și un PDF. ` +
    `Fișiere ignorate: ${names || String(plan.ignored.length)}.`
  );
}

/** Path-urile din App Group pot veni fără schemă — normalizează la file:// URI. */
export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}
```

- [ ] **Step 4: Rulează testele — trebuie să treacă**

```bash
npx jest __tests__/unit/shareIntentIngest.test.ts
```
Expected: PASS (10 teste).

- [ ] **Step 5: Commit**

```bash
git add services/shareIntentIngest.ts __tests__/unit/shareIntentIngest.test.ts
git commit -m "feat: add share intent ingest service (validation + classification)"
```

---

### Task 3: Param de progres în cropper

**Files:**
- Modify: `app/cropper.tsx:45` (params) și `:155` (titlu)

**Interfaces:**
- Produces: `/cropper` acceptă param opțional `progress?: string` (ex. `"2 din 5"`); titlul devine „Decupează pagina 2 din 5". Fără param → comportament identic cu azi („Decupează documentul"). Task 5 îl consumă.

- [ ] **Step 1: Extinde params**

În `app/cropper.tsx` linia 45, înlocuiește:

```typescript
const { uri, requestId } = useLocalSearchParams<{ uri: string; requestId: string }>();
```
cu:
```typescript
const { uri, requestId, progress } = useLocalSearchParams<{
  uri: string;
  requestId: string;
  progress?: string;
}>();
```

- [ ] **Step 2: Afișează progresul în titlu**

Linia 155, înlocuiește:

```tsx
<Text style={[styles.title, { color: palette.text }]}>Decupează documentul</Text>
```
cu:
```tsx
<Text style={[styles.title, { color: palette.text }]}>
  {progress ? `Decupează pagina ${progress}` : 'Decupează documentul'}
</Text>
```

- [ ] **Step 3: Type-check + suita jest existentă**

```bash
npm run type-check && npx jest
```
Expected: PASS ambele.

- [ ] **Step 4: Commit**

```bash
git add app/cropper.tsx
git commit -m "feat: optional page progress indicator in cropper header"
```

---

### Task 4: Rutare share intent (`+native-intent.ts` + provider)

**Files:**
- Create: `app/+native-intent.ts`
- Modify: `app/_layout.tsx:62` (wrap `<RootLayoutNav />`)

**Interfaces:**
- Consumes: `getShareExtensionKey`, `ShareIntentProvider` din `expo-share-intent` (Task 1).
- Produces: orice share către Dosar navighează la `/(tabs)/documente/add`; contextul `useShareIntentContext()` e disponibil în tot tree-ul (consumat de Task 5).

- [ ] **Step 1: Creează `app/+native-intent.ts`**

```typescript
import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Interceptează URL-urile generate de Share Extension (…dataUrl=<cheie>…) și
 * redirecționează către ecranul „Adaugă document". Fără interceptare,
 * expo-router ar încerca să deschidă path-ul brut → +not-found.
 * (Fișier special expo-router: rulează la orice deep link, cold și warm start.)
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/(tabs)/documente/add';
    }
    return path;
  } catch {
    return '/';
  }
}
```

- [ ] **Step 2: Învelește layout-ul în provider**

În `app/_layout.tsx`:

Adaugă importul (lângă celelalte importuri de librării, după linia 14 `import 'react-native-reanimated';`):
```typescript
import { ShareIntentProvider } from 'expo-share-intent';
```

Înlocuiește (linia 62, în `RootLayout`):
```tsx
  return <RootLayoutNav />;
```
cu:
```tsx
  return (
    <ShareIntentProvider>
      <RootLayoutNav />
    </ShareIntentProvider>
  );
```

Deep-link handler-ul existent din `RootLayoutNav` (liniile 99-114, `parseDeepLink` pentru `acte:///documente/{id}`) rămâne NEATINS — `parseDeepLink` face match pe `documente/<id>` iar URL-ul de share (`dataUrl=…ShareKey`) nu conține acel pattern, deci nu interferează.

- [ ] **Step 3: Type-check + jest**

```bash
npm run type-check && npx jest
```
Expected: PASS ambele.

- [ ] **Step 4: Commit**

```bash
git add app/+native-intent.ts app/_layout.tsx
git commit -m "feat: route share intents to add-document screen via native-intent redirect"
```

---

### Task 5: Consumul share intent în `add.tsx` (ingest imagini + PDF)

**Files:**
- Modify: `app/(tabs)/documente/add.tsx` — importuri noi, hook consum, `ingestSharedFiles`, refactor `pickPdf` → `ingestPdf(uri)`

**Interfaces:**
- Consumes: `planShareIngest` / `describeIgnored` / `toFileUri` (Task 2), param `progress` al cropper-ului (Task 3), `useShareIntentContext` (Task 1+4), plus existentele: `awaitCropper`, `makeRequestId`, `processAndSaveImage`, `savePdfAsPage`, `InteractionManager` (deja importat).
- Produces: fluxul complet share → pagini + OCR. Nimic nou exportat.

- [ ] **Step 1: Adaugă importurile**

După linia 3 (`import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';`):

```typescript
import { useIsFocused } from '@react-navigation/native';
import { useShareIntentContext } from 'expo-share-intent';
import type { ShareIntentFile } from 'expo-share-intent';
```

După linia 82 (blocul de import din `@/services/documentPageStorage`):

```typescript
import { planShareIngest, describeIgnored, toFileUri } from '@/services/shareIntentIngest';
```

- [ ] **Step 2: Refactor `pickPdf` → extrage `ingestPdf(uri)`**

Corpul actual al lui `pickPdf` (liniile 852-933) se împarte: picker-ul rămâne în `pickPdf`, procesarea (de la `savePdfAsPage` până la finalul lui `finally`) se MUTĂ neschimbată în `ingestPdf`. Rezultat:

```typescript
  /** Procesează un PDF de la un URI local: salvare ca pagină + extract text
   *  + detecție tip + câmpuri. Folosit de pickPdf (picker) și de share intent. */
  async function ingestPdf(uri: string) {
    try {
      const { localPath: dest } = await savePdfAsPage(uri);
      setPages(prev => [...prev, { uri: dest, localPath: dest }]);

      // Extragere text din PDF
      setOcrLoading(true);
      try {
        const text = await extractTextFromPdf(dest);
        const pdfText = text.trim();
        // Chiar dacă PDF-ul nu are text (scan), marcăm că există un PDF atașat
        const displayText = pdfText || '[PDF atașat – fișier tip imagine/scan, fără text extras]';
        ocrTextsRef.current.set(dest, displayText);
        ocrStructuredTextsRef.current.set(dest, displayText);
        setLiveOcrText(Array.from(ocrStructuredTextsRef.current.values()).join('\n\n---\n\n'));
        if (pdfText) {
          if (pdfText.length < 100) {
            Alert.alert(
              'PDF scanat',
              'PDF-ul pare a fi o scanare – textul extras este limitat. Poți folosi OCR manual pe imaginile atașate.'
            );
          }
          const detectedType = detectDocumentType(text);
          if (
            detectedType &&
            detectedType !== 'altul' &&
            detectedType !== 'custom' &&
            contextVisibleDocTypes.includes(detectedType)
          ) {
            setType(detectedType);
            setCustomTypeId(null);
            setMetadata({});
          }
          const info = extractDocumentInfo(text);
          const effectiveType = detectedType ?? type;
          const fields = extractFieldsForType(effectiveType, text);
          if (Object.keys(fields.metadata).length > 0) {
            setMetadata(prev => ({ ...fields.metadata, ...prev }));
          }
          const allowExpiryScan = !isNoExpiryType(effectiveType);
          if (fields.expiry_date && !expiryDateRef.current && allowExpiryScan) {
            setExpiryDate(fields.expiry_date);
            expiryDateRef.current = fields.expiry_date;
          } else if (info.expiry_date && !expiryDateRef.current && allowExpiryScan) {
            setExpiryDate(info.expiry_date);
            expiryDateRef.current = info.expiry_date;
          }
          if (fields.issue_date && !issueDateRef.current) {
            setIssueDate(fields.issue_date);
            issueDateRef.current = fields.issue_date;
          } else if (info.issue_date && !issueDateRef.current) {
            setIssueDate(info.issue_date);
            issueDateRef.current = info.issue_date;
          }
          const summary = formatOcrSummary(pdfText, info);
          if (summary) {
            setNote(prev => prev || summary);
          }
          const allStructured = Array.from(ocrStructuredTextsRef.current.values()).join(
            '\n\n---\n\n'
          );
          if (allStructured.trim().length > 20) {
            void runAiOcrMapper(allStructured);
          }
        }
      } catch {
        // Extracția text a eșuat — continuăm fără text
      } finally {
        setOcrLoading(false);
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut procesa PDF-ul');
    }
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      await ingestPdf(asset.uri);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta PDF-ul');
    }
  }
```

(Singura diferență de comportament: mesajul de eroare la procesare e acum „Nu s-a putut procesa PDF-ul" — la selecție rămâne cel vechi.)

- [ ] **Step 3: Adaugă consumul share intent + `ingestSharedFiles`**

În corpul componentei, după hook-urile existente (după linia 134, `useAutoActivateDocType`):

```typescript
  const isFocused = useIsFocused();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  // Consum share intent: doar instanța focusată preia fișierele; reset imediat
  // ca altă instanță / un re-focus să nu re-ingereze (spec: edge cases).
  useEffect(() => {
    if (!isFocused || !hasShareIntent) return;
    const files = shareIntent.files ?? [];
    resetShareIntent();
    if (files.length === 0) return;
    void ingestSharedFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, hasShareIntent]);
```

Lângă `pickImage` (după `processAndSaveScannedPages`, ~linia 982), adaugă:

```typescript
  /** Delay între dismiss-ul unui fullScreenModal (cropper) și următorul push —
   *  iOS refuză present-on-dismissing (lecția alert-modal-race, 2026-05-25). */
  const CROPPER_SEQUENCE_DELAY_MS = 600;

  async function ingestSharedFiles(files: ShareIntentFile[]) {
    const plan = planShareIngest(files);

    const ignoredMsg = describeIgnored(plan);
    if (ignoredMsg) {
      // Așteaptă OK + dismiss-ul alertei înainte de a prezenta cropper-ul
      // (present-on-dismissing → modalul nu ar mai apărea).
      await new Promise<void>(resolve =>
        Alert.alert('Fișiere ignorate', ignoredMsg, [{ text: 'OK', onPress: () => resolve() }])
      );
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    // Cold start / push în curs: lasă tranziția de navigare să se termine.
    await new Promise(resolve => InteractionManager.runAfterInteractions(() => resolve(null)));

    if (plan.pdf) {
      await ingestPdf(toFileUri(plan.pdf.path));
    }

    const total = plan.images.length;
    for (let i = 0; i < total; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, CROPPER_SEQUENCE_DELAY_MS));
      }
      const requestId = makeRequestId();
      const cropPromise = awaitCropper(requestId);
      router.push({
        pathname: '/cropper',
        params: {
          uri: toFileUri(plan.images[i].path),
          requestId,
          ...(total > 1 ? { progress: `${i + 1} din ${total}` } : {}),
        },
      });
      const croppedUri = await cropPromise;
      if (!croppedUri) continue; // anulat → pagina e sărită (spec: edge cases)
      await processAndSaveImage(croppedUri);
    }
  }
```

- [ ] **Step 4: Type-check + toată suita jest**

```bash
npm run type-check && npx jest
```
Expected: PASS ambele (characterization incluse).

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/documente/add.tsx"
git commit -m "feat: ingest shared files in add-document screen (images via cropper, pdf)"
```

---

### Task 6: Înregistrare cunoștințe (appKnowledge + knowledge-audit)

**Files:**
- Modify: `services/appKnowledge.ts:124,128`
- Modify: `scripts/knowledge-audit.js` (ENTRIES.services)

**Interfaces:**
- Consumes: nimic din task-urile anterioare (doar numele serviciului `shareIntentIngest`).
- Produces: `node scripts/knowledge-audit.js --strict` verde; chatbot-ul poate explica feature-ul.

- [ ] **Step 1: Descrie feature-ul în appKnowledge.ts**

Linia 124 — la finalul listei `**Funcții:**` (înainte de punct final), adaugă:

```
, primire fișiere prin Share sheet iOS (din Photos/Files/Safari alegi Share → Dosar și poza sau PDF-ul ajunge direct în ecranul Adaugă document)
```

Linia 128 — înlocuiește `sunt 3 opțiuni:` cu `sunt 4 opțiuni:` și după bullet-ul `- **„Adaugă PDF"**…` (linia 131) adaugă:

```
- **Share din altă aplicație** — în Photos, Files sau Safari selectezi o poză (sau mai multe) ori un PDF → Share → Dosar. Aplicația se deschide direct pe ecranul Adaugă document cu fișierele preîncărcate; mai multe poze devin pagini ale aceluiași document, fiecare trecând prin decupare.
```

- [ ] **Step 2: Înregistrează serviciul în knowledge-audit**

În `scripts/knowledge-audit.js`, în `ENTRIES.services`, după linia `settings: { required: true, keywords: ['setări'] },`, adaugă:

```javascript
    shareIntentIngest: { required: true, keywords: ['Share', 'altă aplicație'] },
```

- [ ] **Step 3: Rulează auditul**

```bash
node scripts/knowledge-audit.js --strict
```
Expected: `✓ Knowledge audit OK`.

- [ ] **Step 4: Commit**

```bash
git add services/appKnowledge.ts scripts/knowledge-audit.js
git commit -m "docs: register share extension feature in app knowledge + audit manifest"
```
(Pre-commit-ul regenerează automat `docs/` + `README.md` prin update-site.js și le stage-uiește.)

---

### Task 7: Build nativ + verificare manuală completă

**Files:** niciunul nou — build, teste manuale pe simulator, raport final.

**Interfaces:**
- Consumes: tot ce e implementat în Task 1-6.
- Produces: dovada „done = dovedit pe device" + raportul `Verificat colateral` (obligatoriu, CLAUDE.md).

- [ ] **Step 1: Audit complet + build**

```bash
npm run audit        # type-check + toate audit-urile + characterization + lint:ast
npm run ios          # build nativ cu extensia inclusă, pe simulator
```
Expected: audit verde; build reușit. (Dacă apar erori de linker/pcm după prebuild, vezi memoria `ios_build_recovery.md` — cleanup complet, nu doar Clean Build Folder.)

- [ ] **Step 2: Pregătește simulatorul**

Trage 3-4 imagini de test în simulator (drag & drop pe fereastra Photos) și un PDF în Files. Notă din `sim_automation_quirks.md`: PHPicker ignoră tap-urile HID — pentru testele automate folosește deep-link `/cropper`; pentru share sheet interacțiunea manuală/idb funcționează.

- [ ] **Step 3: Testele manuale din spec (bifează fiecare)**

1. Photos → 1 poză → Share → **Dosar apare în share sheet** → se deschide pe „Adaugă document" → cropper („Decupează documentul") → OCR rulează → salvare OK.
2. Photos → 3 poze → Share → Dosar → cropper secvențial cu „Decupează pagina 1 din 3 / 2 din 3 / 3 din 3" → 3 pagini pe document; anularea paginii 2 → documentul are paginile 1 și 3.
3. Files → PDF → Share → Dosar → PDF atașat + text extras / detecție tip.
4. Fișier nesuportat (ex. .txt din Files, share ca fișier) → Alert „Fișiere ignorate" în română.
5. App lock activ (Setări → Blocare) → share → apare lock screen → deblochezi → ecranul e populat cu fișierele.
6. Cold start: kill app din app switcher → share din Photos → app pornește direct pe „Adaugă document" cu fișierul.
7. Warm: app deschisă pe alt tab → share → navighează la „Adaugă document".
8. Regresie: fluxurile vechi neatinse — „Scanează document", „Galerie" (cropper fără progres în titlu), „Adaugă PDF" din picker.
9. Dark mode: ecranele atinse arată corect în ambele teme (cropper-ul are titlu nou).

- [ ] **Step 4: Verificare vizuală finală cu iOS Simulator MCP** (screenshot pe add + cropper cu progres, ambele teme — regula `mcp-usage.md`).

- [ ] **Step 5: Raport final către user** — obligatoriu cu secțiunea:

```
**Verificat colateral:**
- pickImage/galerie + scanner (add.tsx): flux vechi re-testat în simulator după refactor pickPdf
- cropper din galerie: titlu fără progres, comportament identic (click în simulator)
- deep link acte:///documente/{id}: neafectat de +native-intent (verificat în simulator cu xcrun simctl openurl)
- npm run audit: verde (include knowledge-audit cu serviciul nou)
- jest: toată suita verde (characterization incluse)
```
Plus orice NU a putut fi verificat, explicit („NU am verificat X pentru că Y").

- [ ] **Step 6: Commit final (dacă au apărut fix-uri la verificare)**

```bash
git add -A && git commit -m "fix: share extension polish after manual verification"
```

---

## Note pentru executor

- **Branch:** repo-ul e acum pe `fix/review-2026-07-findings` (nemergeat, cu working tree murdar: `add.tsx`, modulul de crop, o lecție). Înainte de Task 1, întreabă userul dacă implementăm peste acest branch sau pe unul nou din el (recomandat: branch nou `feat/share-extension` din `fix/review-2026-07-findings`, ca să nu se amestece cu review fixes; spec+plan se cherry-pick-uiesc). NU face stash/reset pe modificările existente.
- **Prebuild:** `npm run prebuild` șterge și regenerează `ios/` — e normal (CNG). Modulul local `modules/expo-perspective-crop` are config plugin propriu care supraviețuiește.
- **Expo Go nu suportă share extensions** — testează exclusiv cu `npm run ios` (dev build).
- **TestFlight (în afara acestui plan):** la primul archive, verifică în Xcode/App Store Connect că App Group-ul `group.com.ax.documente` e provisioned pe AMBELE bundle ID-uri (`com.ax.documente`, `com.ax.documente.ShareExtension`).
