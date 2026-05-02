# Bon Carburant AI OCR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Înlocuiește pipeline-ul on-device (ML Kit + regex) pentru scanarea bonurilor de carburant cu AI vision (Mistral/OpenAI), păstrând regex-ul ca fallback per-câmp.

**Architecture:** Adaugă `mapFuelReceiptWithAi` în `services/aiOcrMapper.ts` (funcție specializată cu prompt scurt, separată de `mapOcrWithAi` care e pentru documente). În `app/(tabs)/entitati/fuel.tsx:118` rulăm AI și regex în paralel; merge per-câmp prioritizează AI. Helper-ul `sanitizeOcrText` (deja existent ca privat) devine exportat pentru reuse.

**Tech Stack:** TypeScript, React Native + Expo, Jest (jest-expo preset), `services/aiProvider.ts` (`sendAiRequestWithImage`), `expo-image-picker` (camera + base64), `@react-native-ml-kit/text-recognition` (OCR on-device).

**Spec:** `docs/superpowers/specs/2026-05-02-bon-carburant-ai-ocr-design.md`

**File map:**
- Modify: `services/aiOcrMapper.ts` — face `sanitizeOcrText` exportat; adaugă `FuelAiResult`, `validateFuelAiResponse`, `mergeFuelResults`, `mapFuelReceiptWithAi`.
- Modify: `app/(tabs)/entitati/fuel.tsx:118` — `handleScanReceipt` cere base64 din ImagePicker, apelează AI cu fallback regex, merge per-câmp; schimbă textul butonului din `"Se procesează..."` în `"Se analizează bonul..."`.
- Create: `__tests__/unit/aiOcrMapperFuel.test.ts` — teste pentru `validateFuelAiResponse` și `mergeFuelResults` (funcții pure).

---

### Task 1: Export `sanitizeOcrText` din `aiOcrMapper.ts`

**Files:**
- Modify: `services/aiOcrMapper.ts:59`

Refactor preliminar: helper-ul deja există ca funcție privată; îl expunem ca să-l reutilizăm în `mapFuelReceiptWithAi` fără duplicare.

- [ ] **Step 1: Adaugă `export` pe `sanitizeOcrText`**

În `services/aiOcrMapper.ts`, schimbă:

```ts
function sanitizeOcrText(text: string): string {
```

În:

```ts
export function sanitizeOcrText(text: string): string {
```

- [ ] **Step 2: Verifică type-check**

Run (din folderul `app/`): `npm run type-check`
Expected: 0 erori.

- [ ] **Step 3: Commit**

```bash
git add services/aiOcrMapper.ts
git commit -m "refactor: export sanitizeOcrText for reuse in fuel receipt flow"
```

---

### Task 2: Adaugă tipul `FuelAiResult` în `aiOcrMapper.ts`

**Files:**
- Modify: `services/aiOcrMapper.ts` (adaugă export înainte de `mapOcrWithAi`)

- [ ] **Step 1: Adaugă tipul**

În `services/aiOcrMapper.ts`, după blocul `// ─── Sanitizare OCR ───`, înainte de `// ─── Mapper principal ───`, adaugă:

```ts
// ─── Bon carburant ────────────────────────────────────────────────────────────

export interface FuelAiResult {
  liters?: number;
  km?: number;
  price?: number;
  date?: string; // YYYY-MM-DD
  station?: string;
}
```

- [ ] **Step 2: Verifică type-check**

Run: `npm run type-check`
Expected: 0 erori.

- [ ] **Step 3: Commit**

```bash
git add services/aiOcrMapper.ts
git commit -m "feat: add FuelAiResult type for fuel receipt AI flow"
```

---

### Task 3: TDD `validateFuelAiResponse` — testul care eșuează

**Files:**
- Create: `__tests__/unit/aiOcrMapperFuel.test.ts`

- [ ] **Step 1: Scrie testul**

Creează `__tests__/unit/aiOcrMapperFuel.test.ts`:

```ts
import { validateFuelAiResponse, mergeFuelResults } from '@/services/aiOcrMapper';
import type { FuelAiResult } from '@/services/aiOcrMapper';

describe('validateFuelAiResponse', () => {
  it('returns empty object for non-object input', () => {
    expect(validateFuelAiResponse(null)).toEqual({});
    expect(validateFuelAiResponse(undefined)).toEqual({});
    expect(validateFuelAiResponse('text')).toEqual({});
    expect(validateFuelAiResponse(42)).toEqual({});
  });

  it('accepts plausible liters (0.5 < L < 200)', () => {
    expect(validateFuelAiResponse({ liters: 42.31 })).toEqual({ liters: 42.31 });
    expect(validateFuelAiResponse({ liters: 0.6 })).toEqual({ liters: 0.6 });
    expect(validateFuelAiResponse({ liters: 199 })).toEqual({ liters: 199 });
  });

  it('rejects implausible liters', () => {
    expect(validateFuelAiResponse({ liters: 0 })).toEqual({});
    expect(validateFuelAiResponse({ liters: 0.4 })).toEqual({});
    expect(validateFuelAiResponse({ liters: 200 })).toEqual({});
    expect(validateFuelAiResponse({ liters: -5 })).toEqual({});
    expect(validateFuelAiResponse({ liters: '42' })).toEqual({});
  });

  it('accepts plausible price (1 < RON < 5000)', () => {
    expect(validateFuelAiResponse({ price: 285.5 })).toEqual({ price: 285.5 });
    expect(validateFuelAiResponse({ price: 2 })).toEqual({ price: 2 });
    expect(validateFuelAiResponse({ price: 4999 })).toEqual({ price: 4999 });
  });

  it('rejects implausible price', () => {
    expect(validateFuelAiResponse({ price: 1 })).toEqual({});
    expect(validateFuelAiResponse({ price: 5000 })).toEqual({});
    expect(validateFuelAiResponse({ price: -10 })).toEqual({});
    expect(validateFuelAiResponse({ price: '285' })).toEqual({});
  });

  it('accepts plausible km (1000 < km < 9999999, integer)', () => {
    expect(validateFuelAiResponse({ km: 125430 })).toEqual({ km: 125430 });
    expect(validateFuelAiResponse({ km: 1001 })).toEqual({ km: 1001 });
    expect(validateFuelAiResponse({ km: 9999998 })).toEqual({ km: 9999998 });
  });

  it('rejects implausible km', () => {
    expect(validateFuelAiResponse({ km: 1000 })).toEqual({});
    expect(validateFuelAiResponse({ km: 9999999 })).toEqual({});
    expect(validateFuelAiResponse({ km: 1234.5 })).toEqual({});
    expect(validateFuelAiResponse({ km: '125430' })).toEqual({});
  });

  it('accepts valid date in last 2 years', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(validateFuelAiResponse({ date: today })).toEqual({ date: today });
  });

  it('rejects future date, ancient date, or wrong format', () => {
    expect(validateFuelAiResponse({ date: '2099-01-01' })).toEqual({});
    expect(validateFuelAiResponse({ date: '1985-06-15' })).toEqual({});
    expect(validateFuelAiResponse({ date: '02.05.2026' })).toEqual({});
    expect(validateFuelAiResponse({ date: 'not-a-date' })).toEqual({});
  });

  it('accepts station, trims and caps at 100 chars', () => {
    expect(validateFuelAiResponse({ station: '  OMV Cluj-Napoca  ' })).toEqual({
      station: 'OMV Cluj-Napoca',
    });
    const long = 'A'.repeat(150);
    expect(validateFuelAiResponse({ station: long })).toEqual({ station: 'A'.repeat(100) });
  });

  it('rejects empty or whitespace-only station', () => {
    expect(validateFuelAiResponse({ station: '' })).toEqual({});
    expect(validateFuelAiResponse({ station: '   ' })).toEqual({});
    expect(validateFuelAiResponse({ station: 42 })).toEqual({});
  });

  it('combines multiple valid fields', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      validateFuelAiResponse({
        liters: 42.31,
        price: 285.5,
        km: 125430,
        date: today,
        station: 'OMV Cluj',
      })
    ).toEqual({
      liters: 42.31,
      price: 285.5,
      km: 125430,
      date: today,
      station: 'OMV Cluj',
    });
  });

  it('drops invalid fields but keeps valid ones', () => {
    expect(
      validateFuelAiResponse({
        liters: 42.31,
        price: -5,
        km: 'bad',
        station: 'OMV Cluj',
      })
    ).toEqual({
      liters: 42.31,
      station: 'OMV Cluj',
    });
  });
});

describe('mergeFuelResults', () => {
  it('returns empty when both inputs are empty', () => {
    expect(mergeFuelResults({}, {})).toEqual({
      liters: undefined,
      km: undefined,
      price: undefined,
      date: undefined,
      station: undefined,
    });
  });

  it('AI per-field wins over regex', () => {
    const ai: FuelAiResult = { liters: 42.31, price: 285.5 };
    const regex = { liters: 40, price: 200, km: 125430, date: '2026-05-02', station: 'OMV' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 42.31,
      price: 285.5,
      km: 125430,
      date: '2026-05-02',
      station: 'OMV',
    });
  });

  it('falls back to regex when AI field missing', () => {
    const ai: FuelAiResult = { liters: 42.31 };
    const regex = { liters: 40, station: 'MOL' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 42.31,
      km: undefined,
      price: undefined,
      date: undefined,
      station: 'MOL',
    });
  });

  it('treats AI undefined the same as missing', () => {
    const ai: FuelAiResult = { liters: undefined, station: 'AI Station' };
    const regex = { liters: 40, station: 'Regex Station' };
    expect(mergeFuelResults(ai, regex)).toEqual({
      liters: 40,
      km: undefined,
      price: undefined,
      date: undefined,
      station: 'AI Station',
    });
  });
});
```

- [ ] **Step 2: Rulează testul, confirmă eșec**

Run: `npm test -- aiOcrMapperFuel`
Expected: FAIL — `validateFuelAiResponse is not a function` și `mergeFuelResults is not a function`.

---

### Task 4: Implementează `validateFuelAiResponse` și `mergeFuelResults`

**Files:**
- Modify: `services/aiOcrMapper.ts`

- [ ] **Step 1: Adaugă funcțiile**

În `services/aiOcrMapper.ts`, după interfața `FuelAiResult` adăugată în Task 2, adaugă:

```ts
export function validateFuelAiResponse(parsed: unknown): FuelAiResult {
  const r: FuelAiResult = {};
  if (!parsed || typeof parsed !== 'object') return r;
  const p = parsed as Record<string, unknown>;

  // liters: număr pozitiv, plauzibil pentru un bon (0.5 < L < 200)
  if (typeof p.liters === 'number' && p.liters > 0.5 && p.liters < 200) {
    r.liters = p.liters;
  }

  // price: număr pozitiv, plauzibil (1 < RON < 5000)
  if (typeof p.price === 'number' && p.price > 1 && p.price < 5000) {
    r.price = p.price;
  }

  // km: integer plauzibil (1000 < km < 9_999_999)
  if (
    typeof p.km === 'number' &&
    Number.isInteger(p.km) &&
    p.km > 1000 &&
    p.km < 9_999_999
  ) {
    r.km = p.km;
  }

  // date: YYYY-MM-DD valid, în ultimii 2 ani și nu în viitor
  if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    const d = new Date(p.date);
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    if (!isNaN(d.getTime()) && d <= now && d >= twoYearsAgo) {
      r.date = p.date;
    }
  }

  // station: string non-vid, max 100 chars
  if (typeof p.station === 'string' && p.station.trim()) {
    r.station = p.station.trim().slice(0, 100);
  }

  return r;
}

export interface FuelMergeRegexInput {
  liters?: number;
  km?: number;
  price?: number;
  date?: string;
  station?: string;
}

export function mergeFuelResults(
  ai: FuelAiResult,
  regex: FuelMergeRegexInput
): FuelAiResult {
  return {
    liters: ai.liters ?? regex.liters,
    km: ai.km ?? regex.km,
    price: ai.price ?? regex.price,
    date: ai.date ?? regex.date,
    station: ai.station ?? regex.station,
  };
}
```

`FuelMergeRegexInput` are exact aceeași structură ca `FuelInfo` din `services/ocr.ts:47` — separat ca să nu introducem dependență `aiOcrMapper.ts → ocr.ts`.

- [ ] **Step 2: Rulează testul, confirmă pass**

Run: `npm test -- aiOcrMapperFuel`
Expected: PASS — toate testele verzi.

- [ ] **Step 3: Verifică type-check**

Run: `npm run type-check`
Expected: 0 erori.

- [ ] **Step 4: Commit**

```bash
git add services/aiOcrMapper.ts __tests__/unit/aiOcrMapperFuel.test.ts
git commit -m "feat: add validateFuelAiResponse and mergeFuelResults pure helpers"
```

---

### Task 5: Implementează `mapFuelReceiptWithAi`

**Files:**
- Modify: `services/aiOcrMapper.ts`

Funcția care face efectiv apelul AI. Nu o testăm unitar (network call); o validăm manual pe device în Task 7.

- [ ] **Step 1: Adaugă funcția**

În `services/aiOcrMapper.ts`, după `mergeFuelResults` adăugat în Task 4, adaugă:

```ts
export async function mapFuelReceiptWithAi(
  ocrText: string,
  imageBase64: string
): Promise<FuelAiResult> {
  const sanitizedOcr = sanitizeOcrText(ocrText);

  const systemMessage =
    'Ești un expert în extragerea datelor din bonuri de carburant românești. Returnează exclusiv JSON valid, fără text suplimentar.';

  const prompt = `Extrage datele din bonul de carburant. TEXT OCR:
"""
${sanitizedOcr}
"""

Câmpuri de extras (toate opționale, omite ce nu e clar):
- liters: cantitatea de carburant (număr cu zecimale, ex: 42.31)
- price: TOTALUL de plată (NU preț/litru, NU subtotal). Caută "Total", "De plată", "Suma" — ia ULTIMA valoare dacă apar mai multe (număr, ex: 285.50)
- km: kilometrajul total al vehiculului (5-7 cifre). Apare lângă "KM", "Odometru". NU confunda cu nr. bon, cod fiscal, ora, dată.
- date: data bonului (YYYY-MM-DD). Convertește din ZZ.LL.AAAA.
- station: brand benzinărie + oraș/adresă scurtă (ex: "OMV Cluj-Napoca, Calea Turzii"). Branduri RO: OMV, MOL, Petrom, Lukoil, Rompetrol, Socar, Gazprom, Shell, BP, Avia, Eko.

Returnează EXCLUSIV JSON:
{"liters": <număr|null>, "price": <număr|null>, "km": <int|null>, "date": "<YYYY-MM-DD|null>", "station": "<text|null>"}

Răspunde DOAR cu JSON, fără text suplimentar.`;

  const rawResponse = await sendAiRequestWithImage(
    systemMessage,
    prompt,
    imageBase64,
    'image/jpeg',
    400
  );

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }

  return validateFuelAiResponse(parsed);
}
```

- [ ] **Step 2: Verifică type-check**

Run: `npm run type-check`
Expected: 0 erori.

- [ ] **Step 3: Verifică lint**

Run: `npm run lint`
Expected: 0 erori pe `services/aiOcrMapper.ts`.

- [ ] **Step 4: Commit**

```bash
git add services/aiOcrMapper.ts
git commit -m "feat: add mapFuelReceiptWithAi for AI vision fuel receipt extraction"
```

---

### Task 6: Integrează AI în `handleScanReceipt`

**Files:**
- Modify: `app/(tabs)/entitati/fuel.tsx:27` (import) și `:118-145` (funcție) și `:442` (text buton)

- [ ] **Step 1: Actualizează import-urile**

În `app/(tabs)/entitati/fuel.tsx`, schimbă linia 27:

```ts
import { extractText, extractFuelInfo } from '@/services/ocr';
```

Adaugă imediat după:

```ts
import { mapFuelReceiptWithAi, mergeFuelResults } from '@/services/aiOcrMapper';
import * as FileSystem from 'expo-file-system';
```

(`expo-file-system` e nevoie pentru `readAsStringAsync` cu encoding base64 ca fallback dacă `ImagePicker` nu returnează base64.)

- [ ] **Step 2: Înlocuiește `handleScanReceipt`**

Înlocuiește integral funcția existentă (`fuel.tsx:118-145`) cu:

```ts
async function handleScanReceipt() {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permisiune refuzată', 'Aplicația nu are acces la cameră.');
    return;
  }
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    quality: 0.9,
    base64: true,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) return;
  const asset = result.assets[0];
  const uri = asset.uri;

  setMLoading(true);
  try {
    let ocrText = '';
    try {
      const ocr = await extractText(uri);
      ocrText = ocr.text;
    } catch {
      Alert.alert('Eroare OCR', 'Nu s-a putut citi bonul. Completează manual.');
      return;
    }

    const base64 =
      asset.base64 ??
      (await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      }));

    let aiResult = {} as Awaited<ReturnType<typeof mapFuelReceiptWithAi>>;
    try {
      aiResult = await mapFuelReceiptWithAi(ocrText, base64);
    } catch (err) {
      console.warn(
        '[fuel-ai] failed:',
        err instanceof Error ? err.message : 'unknown error'
      );
    }

    const regexResult = extractFuelInfo(ocrText);
    const final = mergeFuelResults(aiResult, regexResult);

    if (
      final.liters === undefined &&
      final.km === undefined &&
      final.price === undefined &&
      final.date === undefined &&
      final.station === undefined
    ) {
      Alert.alert('OCR', 'Nu s-au putut extrage date din bon. Completează manual.');
      return;
    }

    if (final.date) setMDate(final.date);
    if (final.liters !== undefined) setMLiters(String(final.liters));
    if (final.km !== undefined) setMKm(String(final.km));
    if (final.price !== undefined) setMPrice(String(final.price));
    if (final.station) setMStation(final.station);
  } finally {
    setMLoading(false);
  }
}
```

- [ ] **Step 3: Schimbă textul butonului**

Pe linia 442:

```tsx
{mLoading ? 'Se procesează...' : '📷 Fotografiază bonul (OCR)'}
```

În:

```tsx
{mLoading ? 'Se analizează bonul...' : '📷 Fotografiază bonul (OCR)'}
```

- [ ] **Step 4: Verifică type-check**

Run: `npm run type-check`
Expected: 0 erori.

- [ ] **Step 5: Verifică lint**

Run: `npm run lint`
Expected: 0 erori pe `app/(tabs)/entitati/fuel.tsx`.

- [ ] **Step 6: Rulează toate testele**

Run: `npm test`
Expected: PASS pe toate, inclusiv testele noi din Task 4.

- [ ] **Step 7: Commit**

```bash
git add app/\(tabs\)/entitati/fuel.tsx
git commit -m "feat: use AI vision for fuel receipt scan with regex fallback per-field"
```

---

### Task 7: Verificare manuală pe device

**Files:**
- N/A (test manual obligatoriu — bonurile reale variază)

Conform rule-ului din `.claude/rules/general.md`: **„Done = dovedit pe device/emulator"**.

- [ ] **Step 1: Pornește dev server**

Run (din `app/`): `npm run ios` (sau `npm start` și deschide pe device fizic via Expo Go / dev build).

- [ ] **Step 2: Bon real OMV (sau brand disponibil)**

Navighează: tab Entități → un vehicul → Carburant → "+ Înregistrare nouă" → "📷 Fotografiază bonul (OCR)".
Pozează un bon real.
Verifică:
- Spinner cu "Se analizează bonul...".
- După ~2-5s, modalul are: `Litri`, `Total`, `Data`, `Benzinărie` populate corect.
- `Total` = totalul de plată al bonului, NU preț/litru și NU subtotal.
- Niciun fals KM (dacă bonul nu are KM imprimat, câmpul rămâne gol).

- [ ] **Step 3: Bon dintr-un al doilea brand (ex. MOL, Petrom, Rompetrol)**

Repetă Step 2 cu un bon de la alt brand. Confirmă că `station` reflectă brandul corect.

- [ ] **Step 4: Test fallback offline**

Activează modul avion. Pozează un bon. Verifică:
- Spinner pornește.
- Console (dacă ai dev tools): `[fuel-ai] failed: <network error>`.
- Modalul se populează din regex (silent, fără alert).
- Dacă regex-ul nu prinde nimic, alert: `"Nu s-au putut extrage date din bon. Completează manual."`.

Dezactivează modul avion la final.

- [ ] **Step 5: Test poză aleatoare (NU un bon)**

Pozează ceva care nu e bon (perete, mâna ta etc.).
Verifică alert: `"Nu s-au putut extrage date din bon. Completează manual."`.

- [ ] **Step 6: Verificare AI privacy**

În aplicație, deschide un document existent, adaugă în `Note private` text recognoscibil: `CVV_TEST_BON_9876`.
Pornește dev tools / proxy HTTP (Charles, Proxyman, sau `aiProvider.ts` cu `console.log` temporar pe payload).
Pozează un bon de carburant.
Verifică în payload-ul HTTP trimis la AI provider: stringul `CVV_TEST_BON_9876` **NU apare** în `messages[].content`.
Șterge log-ul temporar dacă a fost adăugat.

- [ ] **Step 7: Update lessons (dacă e cazul)**

Dacă în testarea manuală apare un edge case nou (ex. un brand pe care AI-ul îl confundă), notează în `.claude/lessons.md` cu cauză + regulă.

---

## Definition of Done

- [ ] Toate testele unit pass: `npm test`
- [ ] Type-check pass: `npm run type-check`
- [ ] Lint pass: `npm run lint`
- [ ] Bon real scanat cu succes pe device (Step 2-3 din Task 7)
- [ ] Fallback offline confirmat (Step 4 din Task 7)
- [ ] Privacy check confirmat (Step 6 din Task 7)
- [ ] Toate cele 6 commits din Task 1-6 pe branch
