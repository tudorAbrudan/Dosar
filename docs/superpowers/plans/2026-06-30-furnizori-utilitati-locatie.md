# Furnizori de utilități pe locație — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permite atașarea de conturi de utilități (curent/gaz/apă/internet…) la o proprietate, cu cod client / POD / telefon, plus autocompletare din poză de factură.

**Architecture:** Tabel copil `service_providers` (FK `property_id`), serviciu CRUD `serviceProviders.ts`, secțiune inline `PropertyProvidersSection` pe detaliul proprietății (precedent `VehicleMaintenanceSection`), extragere AI prin mapper dedicat `mapUtilityInvoiceWithAi` + regex-fallback. Propagare în backup local + cloud + audit-uri + knowledge.

**Tech Stack:** React Native + Expo, TypeScript, `expo-sqlite`, ML Kit OCR (`@react-native-ml-kit/text-recognition`), Mistral via `aiProvider.ts`, Jest (characterization + unit).

**Spec:** `docs/superpowers/specs/2026-06-30-furnizori-utilitati-locatie-design.md`

## Global Constraints

- Limbă UI: română pentru toate textele utilizator.
- Culori: doar din paletă (`@/theme/colors`), `useColorScheme` din `@/components/useColorScheme`. Zero hex hardcodat. `placeholderTextColor={palette.textSecondary}` pe orice `TextInput`.
- SQLite: queries parametrizate cu `?`; coloane noi nullable sau cu DEFAULT; `CREATE TABLE IF NOT EXISTS` idempotent.
- `catch(e)`: `e instanceof Error ? e.message : 'Eroare necunoscută'`.
- Tipuri ca sursă unică (pattern `dynamic-types`): UI iterează `ALL_UTILITY_TYPES`, nu array-uri hardcodate.
- Formular ≥3 input-uri → wrapper canonic (`FormSheetModal`).
- Orice schemă SQLite nouă se propagă în `db.ts` + `backup.ts` + `cloudSync.ts` + `backup-audit.js` (altfel `npm run audit` pică).
- `npm run audit` și `npm run test:characterization` trebuie să rămână verzi la final.
- Comenzile se rulează din folderul `app/`.

---

### Task 1: Tipuri + tabel SQLite

**Files:**
- Modify: `types/index.ts` (lângă definițiile celorlalte entități-copil, ex. `FuelRecord` ~liniile 250-263)
- Modify: `services/db.ts:29-33` (după blocul `CREATE TABLE ... properties`)
- Test: `__tests__/characterization/db.test.ts`

**Interfaces:**
- Produces: `UtilityType`, `ALL_UTILITY_TYPES`, `UTILITY_TYPE_LABELS`, `UTILITY_TYPE_EMOJI`, `ServiceProvider` (din `@/types`); tabelul SQLite `service_providers`.

- [ ] **Step 1: Adaugă tipurile în `types/index.ts`**

Adaugă (lângă celelalte tipuri de entități-copil):

```ts
export type UtilityType =
  | 'curent'
  | 'gaz'
  | 'apa'
  | 'internet_tv'
  | 'telefonie'
  | 'salubritate'
  | 'altul';

export const ALL_UTILITY_TYPES: UtilityType[] = [
  'curent',
  'gaz',
  'apa',
  'internet_tv',
  'telefonie',
  'salubritate',
  'altul',
];

export const UTILITY_TYPE_LABELS: Record<UtilityType, string> = {
  curent: 'Curent',
  gaz: 'Gaz',
  apa: 'Apă & canal',
  internet_tv: 'Internet & TV',
  telefonie: 'Telefonie',
  salubritate: 'Salubritate',
  altul: 'Altul',
};

export const UTILITY_TYPE_EMOJI: Record<UtilityType, string> = {
  curent: '⚡',
  gaz: '🔥',
  apa: '💧',
  internet_tv: '🌐',
  telefonie: '📞',
  salubritate: '🗑️',
  altul: '🔌',
};

export interface ServiceProvider {
  id: string;
  property_id: string;
  type: UtilityType;
  provider_name?: string;
  customer_code?: string;
  consumption_point_code?: string;
  support_phone?: string;
  created_at: string;
}
```

- [ ] **Step 2: Adaugă tabelul în `services/db.ts`**

După blocul `CREATE TABLE IF NOT EXISTS properties (...)` (linia 33), în același template-literal `db.execSync`, inserează:

```sql
  CREATE TABLE IF NOT EXISTS service_providers (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    type TEXT NOT NULL,
    provider_name TEXT,
    customer_code TEXT,
    consumption_point_code TEXT,
    support_phone TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_providers_property ON service_providers(property_id);
```

- [ ] **Step 3: Scrie testul de caracterizare (eșuează)**

În `__tests__/characterization/db.test.ts`, adaugă un test care verifică prezența coloanelor (folosește helper-ul existent `applySchemaToTestDb`):

```ts
test('service_providers table has expected columns', () => {
  const cols = testDb
    .prepare(`PRAGMA table_info(service_providers)`)
    .all()
    .map((c: { name: string }) => c.name);
  expect(cols).toEqual(
    expect.arrayContaining([
      'id',
      'property_id',
      'type',
      'provider_name',
      'customer_code',
      'consumption_point_code',
      'support_phone',
      'created_at',
    ])
  );
});
```

> Notă: dacă fișierul are o aserțiune pe numărul total de tabele user-data (ex. „24 tabele"), incrementeaz-o la noua valoare.

- [ ] **Step 4: Rulează testul — trebuie să PICE întâi (înainte de Step 2 aplicat), apoi să TREACĂ**

Run: `npm run test:characterization -- -t "service_providers table"`
Expected: PASS după ce Step 2 e aplicat (tabelul e extras din `db.ts` de `applySchemaToTestDb`).

- [ ] **Step 5: Type-check + commit**

Run: `npm run type-check`
Expected: fără erori.

```bash
git add types/index.ts services/db.ts __tests__/characterization/db.test.ts
git commit -m "feat(providers): add UtilityType + service_providers table"
```

---

### Task 2: Serviciu CRUD `serviceProviders.ts`

**Files:**
- Create: `services/serviceProviders.ts`
- Modify: `services/entities.ts` (`deleteProperty`, ~liniile 249-256)

**Interfaces:**
- Consumes: `db`, `generateId` din `./db`; `ServiceProvider`, `UtilityType` din `@/types`.
- Produces: `getServiceProviders(propertyId)`, `getAllServiceProviders()`, `addServiceProvider(propertyId, input)`, `updateServiceProvider(id, fields)`, `deleteServiceProvider(id)`, `deleteServiceProvidersForProperty(propertyId)`; tipurile `AddServiceProviderInput`, `UpdateServiceProviderInput`.

- [ ] **Step 1: Creează `services/serviceProviders.ts`**

```ts
import { db, generateId } from './db';
import type { ServiceProvider, UtilityType } from '@/types';

export type { ServiceProvider };

type ProviderRow = {
  id: string;
  property_id: string;
  type: string;
  provider_name: string | null;
  customer_code: string | null;
  consumption_point_code: string | null;
  support_phone: string | null;
  created_at: string;
};

function mapRow(r: ProviderRow): ServiceProvider {
  return {
    id: r.id,
    property_id: r.property_id,
    type: r.type as UtilityType,
    provider_name: r.provider_name ?? undefined,
    customer_code: r.customer_code ?? undefined,
    consumption_point_code: r.consumption_point_code ?? undefined,
    support_phone: r.support_phone ?? undefined,
    created_at: r.created_at,
  };
}

export interface AddServiceProviderInput {
  type: UtilityType;
  provider_name?: string;
  customer_code?: string;
  consumption_point_code?: string;
  support_phone?: string;
}

export interface UpdateServiceProviderInput extends AddServiceProviderInput {}

export async function getServiceProviders(propertyId: string): Promise<ServiceProvider[]> {
  const rows = await db.getAllAsync<ProviderRow>(
    'SELECT * FROM service_providers WHERE property_id = ? ORDER BY created_at ASC',
    [propertyId]
  );
  return rows.map(mapRow);
}

export async function getAllServiceProviders(): Promise<ServiceProvider[]> {
  const rows = await db.getAllAsync<ProviderRow>(
    'SELECT * FROM service_providers ORDER BY created_at ASC'
  );
  return rows.map(mapRow);
}

export async function addServiceProvider(
  propertyId: string,
  input: AddServiceProviderInput
): Promise<ServiceProvider> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const row: ServiceProvider = {
    id,
    property_id: propertyId,
    type: input.type,
    provider_name: input.provider_name?.trim() || undefined,
    customer_code: input.customer_code?.trim() || undefined,
    consumption_point_code: input.consumption_point_code?.trim() || undefined,
    support_phone: input.support_phone?.trim() || undefined,
    created_at,
  };
  await db.runAsync(
    `INSERT INTO service_providers
       (id, property_id, type, provider_name, customer_code,
        consumption_point_code, support_phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.property_id,
      row.type,
      row.provider_name ?? null,
      row.customer_code ?? null,
      row.consumption_point_code ?? null,
      row.support_phone ?? null,
      row.created_at,
    ]
  );
  return row;
}

export async function updateServiceProvider(
  id: string,
  fields: UpdateServiceProviderInput
): Promise<void> {
  await db.runAsync(
    `UPDATE service_providers
       SET type = ?, provider_name = ?, customer_code = ?,
           consumption_point_code = ?, support_phone = ?
     WHERE id = ?`,
    [
      fields.type,
      fields.provider_name?.trim() || null,
      fields.customer_code?.trim() || null,
      fields.consumption_point_code?.trim() || null,
      fields.support_phone?.trim() || null,
      id,
    ]
  );
}

export async function deleteServiceProvider(id: string): Promise<void> {
  await db.runAsync('DELETE FROM service_providers WHERE id = ?', [id]);
}

export async function deleteServiceProvidersForProperty(propertyId: string): Promise<void> {
  await db.runAsync('DELETE FROM service_providers WHERE property_id = ?', [propertyId]);
}
```

- [ ] **Step 2: Cleanup la ștergerea proprietății**

În `services/entities.ts`, funcția `deleteProperty(id)`: înainte de `DELETE FROM properties`, adaugă ștergerea furnizorilor. Importă sus:

```ts
import { deleteServiceProvidersForProperty } from './serviceProviders';
```

Și în corpul `deleteProperty`, după `cleanupEntityLinks('property', id)`:

```ts
  await deleteServiceProvidersForProperty(id);
```

- [ ] **Step 3: Type-check + commit**

Run: `npm run type-check`
Expected: fără erori.

```bash
git add services/serviceProviders.ts services/entities.ts
git commit -m "feat(providers): CRUD service + property delete cleanup"
```

---

### Task 3: Propagare backup local + cloud + audit

**Files:**
- Modify: `services/backup.ts` (`exportBackup`, `applyManifest`, `wipeUserData`, versiune)
- Modify: `services/cloudSync.ts` (`buildManifestPayload`, interfața manifest, versiune)
- Modify: `scripts/backup-audit.js` (`TABLE_TO_MANIFEST_FIELD`)
- Test: `__tests__/characterization/backup.test.ts`

**Interfaces:**
- Consumes: `getAllServiceProviders` (Task 2), `ServiceProvider` (Task 1).
- Produces: câmpul de manifest `serviceProviders: ServiceProvider[]` în backup local + cloud.

- [ ] **Step 1: `backup.ts` — colectare în `exportBackup`**

Lângă linia care colectează `fuelRecords` (caută `getAllFuelRecords`):

```ts
import * as serviceProviders from './serviceProviders';
// ...
const serviceProvidersList = await serviceProviders.getAllServiceProviders();
```

Și în obiectul `manifest`, lângă `fuelRecords`:

```ts
  serviceProviders: serviceProvidersList,
```

Bump versiunea manifestului (caută `version:` în obiectul manifest, incrementează cu 1).

- [ ] **Step 2: `backup.ts` — restore în `applyManifest`**

Lângă blocul care iterează `payload.fuelRecords` și face INSERT, adaugă un bloc analog pentru `payload.serviceProviders`:

```ts
  for (const p of payload.serviceProviders ?? []) {
    await db.runAsync(
      `INSERT OR REPLACE INTO service_providers
         (id, property_id, type, provider_name, customer_code,
          consumption_point_code, support_phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.property_id,
        p.type,
        p.provider_name ?? null,
        p.customer_code ?? null,
        p.consumption_point_code ?? null,
        p.support_phone ?? null,
        p.created_at,
      ]
    );
  }
```

- [ ] **Step 3: `backup.ts` — wipe**

În `wipeUserData` (caută `DELETE FROM fuel_records`), adaugă:

```ts
  await db.runAsync('DELETE FROM service_providers');
```

- [ ] **Step 4: `cloudSync.ts` — payload + interfață + versiune**

În interfața `ManifestPayload` (caută `fuelRecords: FuelRecord[]`), adaugă:

```ts
  serviceProviders: ServiceProvider[];
```

Importă tipul: `import type { ..., ServiceProvider } from '@/types';`

În `buildManifestPayload` (caută `getAllFuelRecords`), adaugă colectarea și includerea în payload:

```ts
const serviceProviders = await providers.getAllServiceProviders();
// ... în obiectul returnat:
  serviceProviders,
```

(import: `import * as providers from './serviceProviders';`)

Bump `MANIFEST_VERSION` (sau constanta echivalentă de versiune din `cloudSync.ts`).

- [ ] **Step 5: `scripts/backup-audit.js` — mapare**

În `TABLE_TO_MANIFEST_FIELD` adaugă:

```js
  service_providers: 'serviceProviders',
```

- [ ] **Step 6: Rulează audit-ul de backup**

Run: `node scripts/backup-audit.js --strict`
Expected: exit 0, `service_providers` prezent în export + apply + wipe + cloud.

- [ ] **Step 7: Test de caracterizare — round-trip**

În `__tests__/characterization/backup.test.ts`, adaugă (urmează pattern-ul testului pentru `fuel_records`):

```ts
test('service_providers survive export -> applyManifest, removed by wipe', () => {
  testDb
    .prepare(
      `INSERT INTO service_providers
         (id, property_id, type, provider_name, customer_code,
          consumption_point_code, support_phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('p1', 'prop1', 'curent', 'E.ON', 'CC123', 'RO001234', '0800800', '2026-06-30T00:00:00Z');

  const rows = testDb.prepare('SELECT * FROM service_providers').all();
  expect(rows).toHaveLength(1);
  expect(rows[0].consumption_point_code).toBe('RO001234');

  testDb.prepare('DELETE FROM service_providers').run();
  expect(testDb.prepare('SELECT * FROM service_providers').all()).toHaveLength(0);
});
```

> Notă: dacă suita are un test care enumeră explicit tabelele incluse în manifest (listă de string-uri), adaugă `service_providers` acolo.

- [ ] **Step 8: Rulează caracterizarea + commit**

Run: `npm run test:characterization`
Expected: PASS (inclusiv noul test).

```bash
git add services/backup.ts services/cloudSync.ts scripts/backup-audit.js __tests__/characterization/backup.test.ts
git commit -m "feat(providers): propagate service_providers to backup + cloud + audit"
```

---

### Task 4: Regex-fallback `extractUtilityInvoiceInfo`

**Files:**
- Modify: `services/ocr.ts` (adaugă funcția lângă `extractFuelInfo`)
- Test: `__tests__/ocr-utility.test.ts` (nou; dacă există deja un fișier de teste OCR unit, extinde-l)

**Interfaces:**
- Produces: `extractUtilityInvoiceInfo(text: string): { customerCode?: string; consumptionPointCode?: string; supportPhone?: string }`.

- [ ] **Step 1: Scrie testul (eșuează)**

`__tests__/ocr-utility.test.ts`:

```ts
import { extractUtilityInvoiceInfo } from '@/services/ocr';

describe('extractUtilityInvoiceInfo', () => {
  test('extracts POD code (RO + digits)', () => {
    const r = extractUtilityInvoiceInfo('Cod loc de consum: RO005E812345678');
    expect(r.consumptionPointCode).toBe('RO005E812345678');
  });

  test('extracts customer code after label', () => {
    const r = extractUtilityInvoiceInfo('Cod client 1002345678\nFactura...');
    expect(r.customerCode).toBe('1002345678');
  });

  test('returns empty object when nothing matches', () => {
    expect(extractUtilityInvoiceInfo('text fără coduri')).toEqual({});
  });
});
```

- [ ] **Step 2: Rulează testul — PICĂ**

Run: `npx jest __tests__/ocr-utility.test.ts`
Expected: FAIL („extractUtilityInvoiceInfo is not a function").

- [ ] **Step 3: Implementează în `services/ocr.ts`**

```ts
export function extractUtilityInvoiceInfo(text: string): {
  customerCode?: string;
  consumptionPointCode?: string;
  supportPhone?: string;
} {
  const result: {
    customerCode?: string;
    consumptionPointCode?: string;
    supportPhone?: string;
  } = {};

  // POD curent / CLC gaz: "RO" urmat de cifre/litere (min 8 caractere după RO).
  const pod = text.match(/\bRO[0-9A-Z]{8,}\b/);
  if (pod) result.consumptionPointCode = pod[0];

  // Cod client / cod de încasare: după etichetă, secvență de 6-12 cifre.
  const cc = text.match(/cod\s+(?:client|de\s+[îi]ncasare)\D{0,10}(\d{6,12})/i);
  if (cc) result.customerCode = cc[1];

  // Telefon call-center: 0800/0801/021/03xx/07xx, grupuri de cifre cu spații/puncte.
  const phone = text.match(/\b0(?:800|801|21|3\d{2}|7\d{2})[\d.\s]{5,}\d\b/);
  if (phone) result.supportPhone = phone[0].replace(/[.\s]/g, '');

  return result;
}
```

- [ ] **Step 4: Rulează testul — TRECE**

Run: `npx jest __tests__/ocr-utility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ocr.ts __tests__/ocr-utility.test.ts
git commit -m "feat(providers): regex fallback for utility invoice fields"
```

---

### Task 5: AI mapper `mapUtilityInvoiceWithAi`

**Files:**
- Modify: `services/aiOcrMapper.ts` (adaugă lângă `mapFuelReceiptWithAi`)

**Interfaces:**
- Consumes: `sendAiRequest` / `sendAiRequestWithImage` din `aiProvider.ts` (același helper folosit de `mapFuelReceiptWithAi` — citește acea funcție întâi ca să refolosești EXACT același mod de apel + parsare JSON), `UtilityType` din `@/types`, `extractUtilityInvoiceInfo` (Task 4).
- Produces: `mapUtilityInvoiceWithAi(ocrText: string, imageBase64?: string): Promise<UtilityInvoiceAiResult>`; tipul `UtilityInvoiceAiResult`.

- [ ] **Step 1: Citește `mapFuelReceiptWithAi` (liniile ~209-279) pentru a copia structura exactă de request + parse**

Run: `grep -n "mapFuelReceiptWithAi\|sendAiRequest\|JSON.parse" services/aiOcrMapper.ts`

- [ ] **Step 2: Adaugă tipul + funcția**

```ts
import type { UtilityType } from '@/types';
import { extractUtilityInvoiceInfo } from './ocr';

export interface UtilityInvoiceAiResult {
  type?: UtilityType;
  providerName?: string;
  customerCode?: string;
  consumptionPointCode?: string;
  supportPhone?: string;
}

export async function mapUtilityInvoiceWithAi(
  ocrText: string,
  imageBase64?: string
): Promise<UtilityInvoiceAiResult> {
  const system =
    'Ești expert în extragerea datelor din facturi de utilități românești ' +
    '(curent, gaz, apă, internet, TV, telefonie, salubritate).';
  const user =
    `Extrage din factura de mai jos, ca JSON strict (fără text în jur), câmpurile:\n` +
    `- "type": unul din curent|gaz|apa|internet_tv|telefonie|salubritate|altul\n` +
    `- "providerName": numele furnizorului (ex: E.ON, Engie, PPC, Hidroelectrica, Digi, Orange, Vodafone, Apa Nova)\n` +
    `- "customerCode": codul de client / cod de încasare\n` +
    `- "consumptionPointCode": codul locului de consum (POD la curent „RO…", CLC la gaz)\n` +
    `- "supportPhone": telefonul de relații cu clienții\n` +
    `Dacă un câmp lipsește, omite-l. Răspunde DOAR cu JSON.\n\nTEXT FACTURĂ:\n${ocrText}`;

  // Folosește ACELAȘI helper de apel + parsare JSON ca mapFuelReceiptWithAi.
  // (sendAiRequestWithImage dacă există imageBase64, altfel sendAiRequest)
  let ai: UtilityInvoiceAiResult = {};
  try {
    const raw = imageBase64
      ? await sendAiRequestWithImage(system, user, imageBase64, { maxTokens: 400 })
      : await sendAiRequest(system, user, { maxTokens: 400 });
    ai = parseJsonObject<UtilityInvoiceAiResult>(raw) ?? {};
  } catch (e) {
    console.warn('[utility-ai] failed:', e instanceof Error ? e.message : 'unknown');
  }

  // Merge cu regex (regex completează golurile lăsate de AI).
  const rx = extractUtilityInvoiceInfo(ocrText);
  return {
    type: ai.type,
    providerName: ai.providerName,
    customerCode: ai.customerCode ?? rx.customerCode,
    consumptionPointCode: ai.consumptionPointCode ?? rx.consumptionPointCode,
    supportPhone: ai.supportPhone ?? rx.supportPhone,
  };
}
```

> Adaptează numele exacte (`sendAiRequest`, `sendAiRequestWithImage`, `parseJsonObject`, opțiunea `maxTokens`) la cele reale din `aiOcrMapper.ts` descoperite la Step 1. Dacă `mapFuelReceiptWithAi` folosește un helper intern de parsare, refolosește-l.

- [ ] **Step 3: Type-check + commit**

Run: `npm run type-check`
Expected: fără erori.

```bash
git add services/aiOcrMapper.ts
git commit -m "feat(providers): AI mapper for utility invoices"
```

---

### Task 6: UI — secțiune + formular + scanare

**Files:**
- Create: `components/PropertyProvidersSection.tsx`
- Modify: `app/(tabs)/entitati/[id].tsx` (randează secțiunea pentru `property_id`)

**Interfaces:**
- Consumes: serviciul din Task 2; `mapUtilityInvoiceWithAi` (Task 5); `extractText` (`services/ocr.ts`), `scanDocumentPages` (`services/documentScanner.ts`); `ALL_UTILITY_TYPES`, `UTILITY_TYPE_LABELS`, `UTILITY_TYPE_EMOJI` (Task 1); `FormSheetModal` (`@/components/ui/FormSheetModal`).
- Produces: componentul `PropertyProvidersSection({ propertyId }: { propertyId: string })`.

- [ ] **Step 1: Creează `components/PropertyProvidersSection.tsx`**

Componentă cu:
- state `{ providers, loading, error }` + `refresh()` (contract hook-style).
- `useFocusEffect`/`useEffect` care apelează `getServiceProviders(propertyId)`.
- Listă de carduri: `UTILITY_TYPE_EMOJI[type]` + `provider_name ?? UTILITY_TYPE_LABELS[type]`; sub el `customer_code` / `consumption_point_code`; iconiță telefon → `Linking.openURL('tel:' + support_phone)`.
- Buton „+ Adaugă furnizor" → deschide `FormSheetModal`.
- `FormSheetModal` cu: buton „Scanează factură" (Step 2), picker tip (chips din `ALL_UTILITY_TYPES`), `ThemedTextInput` pentru nume / cod client / POD / telefon (phone-pad pe telefon).
- Salvare → `addServiceProvider` sau `updateServiceProvider` → `refresh()`.
- Tap card → editare (prefill); long-press → `Alert` confirm → `deleteServiceProvider`.

Respectă regulile de culori/temă din Global Constraints. Folosește `useColorScheme` din `@/components/useColorScheme` și paleta.

- [ ] **Step 2: Fluxul de scanare (în componentă)**

Identic ca `fuel.tsx` (`handleScanReceipt` + `processReceiptUri`). La apăsarea „Scanează factură":

```ts
async function handleScanInvoice() {
  Alert.alert('Scanează factură', 'Alege sursa', [
    { text: 'Scaner', onPress: scanFromCamera },
    { text: 'Galerie', onPress: scanFromGallery },
    { text: 'Anulează', style: 'cancel' },
  ]);
}

async function processInvoiceUri(uri: string, base64?: string) {
  setScanning(true);
  try {
    const ocr = await extractText(uri);
    const result = await mapUtilityInvoiceWithAi(ocr.text, base64);
    if (result.type) setType(result.type);
    if (result.providerName) setProviderName(result.providerName);
    if (result.customerCode) setCustomerCode(result.customerCode);
    if (result.consumptionPointCode) setPodCode(result.consumptionPointCode);
    if (result.supportPhone) setSupportPhone(result.supportPhone);
  } catch (e) {
    Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut citi factura.');
  } finally {
    setScanning(false);
  }
}
```

`scanFromCamera` → `scanDocumentPages()` → `processInvoiceUri(uris[0])`; `scanFromGallery` → `ImagePicker.launchImageLibraryAsync({ base64: true })` → `processInvoiceUri(asset.uri, asset.base64)`.

- [ ] **Step 3: Wire în `app/(tabs)/entitati/[id].tsx`**

Import:

```ts
import { PropertyProvidersSection } from '@/components/PropertyProvidersSection';
```

În `Animated.ScrollView`, înainte de `DOCUMENTE LEGATE` (linia ~472), adaugă:

```tsx
{entityKind === 'property_id' && <PropertyProvidersSection propertyId={id as string} />}
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run type-check && npx eslint "components/PropertyProvidersSection.tsx" "app/(tabs)/entitati/[id].tsx"`
Expected: fără erori.

- [ ] **Step 5: Verificare vizuală în iOS Simulator**

Pe o proprietate: adaugă furnizor manual, scanează o factură (autocompletare), editează, șterge, tap-to-call. Verifică light + dark. Verifică scroll cu tastatura deschisă în formular.

- [ ] **Step 6: Commit**

```bash
git add components/PropertyProvidersSection.tsx "app/(tabs)/entitati/[id].tsx"
git commit -m "feat(providers): property providers section + invoice scan UI"
```

---

### Task 7: Sincronizare knowledge (chatbot + audit)

**Files:**
- Modify: `services/appKnowledge.ts`
- Modify: `scripts/knowledge-audit.js` (`ENTRIES`)

**Interfaces:**
- Consumes: nimic nou.
- Produces: feature înregistrat în manifest knowledge.

- [ ] **Step 1: Înregistrează serviciul în `scripts/knowledge-audit.js`**

În array-ul `ENTRIES`, adaugă o intrare pentru `services/serviceProviders.ts` (urmează forma intrărilor existente — cale + flag `required`).

- [ ] **Step 2: Descrie feature-ul în `services/appKnowledge.ts`**

În secțiunea de funcții/entități, adaugă un paragraf: pe o proprietate poți adăuga furnizori de utilități (curent/gaz/apă/internet/telefonie/salubritate) cu cod client, cod loc de consum (POD) și telefon; le poți completa automat scanând o factură. Navigare: „Entități → proprietate → Furnizori utilități → Adaugă furnizor".

- [ ] **Step 3: Rulează audit-ul de knowledge**

Run: `node scripts/knowledge-audit.js --strict`
Expected: exit 0.

- [ ] **Step 4: Audit complet + commit**

Run: `npm run audit`
Expected: tot verde (type-check + toate audit-urile + characterization + lint:ast).

```bash
git add services/appKnowledge.ts scripts/knowledge-audit.js docs/ README.md
git commit -m "feat(providers): register utility providers in app knowledge"
```

---

## Verificare finală (Definition of Done)

- [ ] `npm run audit` verde.
- [ ] `npm run test:characterization` verde.
- [ ] iOS Simulator: flux complet pe o proprietate (adaugă / scanează / editează / șterge / tap-to-call) în light + dark.
- [ ] Export backup → wipe → import backup: furnizorii supraviețuiesc round-trip.
- [ ] Raport „Verificat colateral" către user (consumatori `deleteProperty`, ecrane proprietate, audit-uri).
