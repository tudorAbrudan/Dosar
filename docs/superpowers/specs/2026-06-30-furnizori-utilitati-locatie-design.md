# Furnizori de utilități pe locație (proprietate) — design

**Dată:** 2026-06-30
**Status:** aprobat (design), urmează planul de implementare
**Entitate atinsă:** `property`

## Problemă

Pe o proprietate (locație) utilizatorul vrea să țină evidența furnizorilor de
utilități (curent, gaz, apă, internet etc.) împreună cu datele de cont specifice
(cod client, cod loc de consum / POD, telefon relații clienți), ca să le aibă la
îndemână când sună sau plătește. Codurile sunt greu de găsit și de tastat de pe
factură, așa că trebuie să se poată extrage automat dintr-o poză de factură.

## Model mental

Un „furnizor" = **un cont de utilitate atașat proprietății** — echivalentul
conceptual al unei alimentări (`fuel_records`) atașate unei mașini. Proprietatea
are o listă de astfel de conturi. (NU este o entitate de sine stătătoare, NU este
un document.)

## Decizii luate

- **Integrare UI:** secțiune inline pe pagina proprietății (ca
  `VehicleMaintenanceSection` la mașini), nu ecran separat.
- **Extragere AI:** mapper dedicat `mapUtilityInvoiceWithAi` (ca
  `mapFuelReceiptWithAi`), nu reutilizarea `mapOcrWithAi` generic.
- **Scanare factură:** poza doar **autocompletează** câmpurile contului. Factura
  NU se salvează automat ca document (rămâne fluxul existent „Adaugă doc").

## Scope

### Inclus (v1)
- Tabel `service_providers` (copil al `property`).
- CRUD în `services/serviceProviders.ts`.
- Secțiune inline `PropertyProvidersSection` pe detaliul proprietății: listă +
  adăugare/editare/ștergere prin `FormSheetModal`.
- Câmpuri: tip utilitate, nume furnizor, cod client, cod loc de consum (POD),
  telefon relații clienți.
- Telefon = tap-to-call.
- Buton „Scanează factură" în formular → OCR on-device + `mapUtilityInvoiceWithAi`
  → autocompletare câmpuri.
- Propagare completă în backup local + cloud + audit-uri + knowledge + test de
  caracterizare.

### Exclus explicit (v1, YAGNI)
- Factura NU se salvează automat ca document.
- Fără istoric de costuri / sume.
- Fără număr de contract.
- Fără notificări sau expirări legate de furnizori.

## Model de date

### Tabel SQLite `service_providers` (`services/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS service_providers (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- UtilityType (vezi mai jos)
  provider_name TEXT,
  customer_code TEXT,                  -- cod client / cod de încasare
  consumption_point_code TEXT,         -- POD (curent) / CLC (gaz)
  support_phone TEXT,                  -- telefon relații clienți
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_property ON service_providers(property_id);
```

- `property_id` NOT NULL (mereu legat de o proprietate).
- Coloanele de date sunt nullable (utilizatorul completează ce e relevant; POD nu
  există la toate tipurile).
- `ALTER TABLE`-uri viitoare în try-catch (regula proiectului). La v1 e doar
  `CREATE TABLE IF NOT EXISTS`, idempotent.

### Tipuri (`types/index.ts`)

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
  'curent', 'gaz', 'apa', 'internet_tv', 'telefonie', 'salubritate', 'altul',
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
  curent: '⚡', gaz: '🔥', apa: '💧', internet_tv: '🌐',
  telefonie: '📞', salubritate: '🗑️', altul: '🔌',
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

Sursă unică pentru tip (pattern `dynamic-types`): UI iterează `ALL_UTILITY_TYPES`
și citește labels/emoji din mapările de mai sus — niciun array hardcodat în ecrane.

## Serviciu (`services/serviceProviders.ts`)

```ts
getServiceProviders(propertyId: string): Promise<ServiceProvider[]>
getAllServiceProviders(): Promise<ServiceProvider[]>   // pentru backup
addServiceProvider(propertyId: string, fields: Omit<...>): Promise<ServiceProvider>
updateServiceProvider(id: string, fields: Partial<...>): Promise<void>
deleteServiceProvider(id: string): Promise<void>
```

- Queries parametrizate cu `?`.
- `catch(e)` cu guard `e instanceof Error ? e.message : 'Eroare necunoscută'`.
- La ștergere proprietate (`deleteProperty` în `entities.ts`): adaugă
  `DELETE FROM service_providers WHERE property_id = ?` în cleanup (altfel rămân
  orfane). De verificat în implementare.

## UI

### `components/PropertyProvidersSection.tsx`

Randat în `app/(tabs)/entitati/[id].tsx` când `entityKind === 'property_id'`
(precedent: `VehicleMaintenanceSection` pentru `vehicle_id`).

- **Titlu secțiune** „FURNIZORI UTILITĂȚI".
- **Listă carduri:** emoji tip + nume furnizor (sau eticheta tipului dacă lipsește
  numele); sub el cod client / POD; iconiță telefon → `Linking.openURL('tel:…')`.
- **Buton „+ Adaugă furnizor".**
- **Tap card** → editare; **long-press** → ștergere cu `Alert` de confirmare.
- Stare hook-style locală: `{ loading, error, refresh }` (regula de hook contract
  dacă logica ajunge într-un hook; dacă rămâne în componentă, păstrăm aceleași
  câmpuri în state).

### Formular adăugare/editare (`FormSheetModal`)

Conform regulilor de formulare (≥3 input-uri → wrapper canonic). Conținut:

1. Buton **„Scanează factură"** sus (ca `onScanReceipt` din `FuelRecordFormFields`).
2. Picker **tip utilitate** (chips din `ALL_UTILITY_TYPES`).
3. `ThemedTextInput` nume furnizor.
4. `ThemedTextInput` cod client.
5. `ThemedTextInput` cod loc de consum (POD).
6. `ThemedTextInput` telefon relații clienți (keyboardType phone-pad).

Toate textele în română; culori din paletă; `placeholderTextColor` setat.

## Extragere din factură

Flux identic cu `app/(tabs)/entitati/fuel.tsx`:

```
„Scanează factură"
  → Alert (Scaner / Galerie / PDF)
  → scanDocumentPages() | ImagePicker.launchImageLibraryAsync | DocumentPicker(pdf)
  → extractText(uri)           // ML Kit on-device
  → mapUtilityInvoiceWithAi(ocrText, imageBase64?)
  → autocompletează câmpurile (tip, nume, cod client, POD, telefon)
  → utilizatorul verifică și salvează
```

### `mapUtilityInvoiceWithAi(ocrText, imageBase64?)` (`services/aiOcrMapper.ts`)

- Aceeași infrastructură ca `mapFuelReceiptWithAi` (`sendAiRequest` /
  `sendAiRequestWithImage` din `aiProvider.ts`).
- System prompt: expert în facturi de utilități românești. Detectează furnizorul
  (E.ON, Engie, PPC/Enel, Hidroelectrica, Digi, Orange, Vodafone, Apa Nova etc.)
  și tipul de utilitate; extrage „Cod client" / „Cod de încasare", „Cod loc de
  consum" / POD / CLC, telefonul de relații clienți.
- Răspuns: exclusiv JSON. Token limit redus (~400).
- Return:
  ```ts
  interface UtilityInvoiceAiResult {
    type?: UtilityType;
    providerName?: string;
    customerCode?: string;
    consumptionPointCode?: string;
    supportPhone?: string;
  }
  ```

### Regex-fallback (`services/ocr.ts`)

`extractUtilityInvoiceInfo(text)` — best-effort, pentru robustețe când AI
eșuează sau returnează parțial:
- POD: pattern `RO\d{6,}` (cod loc de consum curent).
- Telefon: pattern telefon RO (call-center).
- Merge: AI câștigă unde are valoare, regex completează golurile (ca
  `mergeFuelResults`).

### Privacy

Textul OCR al facturii ajunge la modelul AI (Mistral), exact ca bonurile de
carburant azi. Nu există câmp `private_notes` implicat. Conform `ai-privacy.md`,
nimic sensibil dedicat nu pleacă — facturile conțin nume + adresă, la fel ca
fluxul generic existent.

## Propagare schemă (obligatoriu)

Ordine și locuri (din `backup.md` + `dynamic-types.md` + `knowledge-audit`):

1. `services/db.ts` — `CREATE TABLE` + index.
2. `services/backup.ts` — `exportBackup()` (colectează prin
   `getAllServiceProviders()`) + `applyManifest()` (restore iterează
   `payload.serviceProviders`) + `wipeUserData()` (`DELETE FROM service_providers`).
3. `services/cloudSync.ts` — `buildManifestPayload()` (colectare) + interfața
   manifest (`serviceProviders: ServiceProvider[]`) + bump versiune manifest.
4. `scripts/backup-audit.js` — `TABLE_TO_MANIFEST_FIELD.service_providers =
   'serviceProviders'`.
5. `types/index.ts` — `UtilityType`, mapări, `ServiceProvider`.
6. `services/appKnowledge.ts` — descrie feature-ul (secțiunea Funcții / Entități)
   + înregistrare în `scripts/knowledge-audit.js` `ENTRIES` (altfel pică
   `knowledge-audit --strict`).
7. `__tests__/characterization/` — test pentru noul tabel (prezență coloane,
   includere în export/apply/wipe), aliniat cu suita existentă.
8. `services/entities.ts` — `deleteProperty` șterge și furnizorii proprietății.

Bump versiune backup în `backup.ts` și `cloudSync.ts` (manifest version).

## Verificare (Definition of Done)

- `npm run audit` verde (type-check + backup-audit + knowledge-audit +
  characterization + lint:ast).
- `npm run test:characterization` verde (inclusiv noul test).
- iOS Simulator: pe o proprietate — adaugă furnizor manual, scanează o factură
  (autocompletare), editează, șterge; verifică light + dark; tap-to-call.
- Export + import backup: furnizorii supraviețuiesc round-trip.

## Riscuri / puncte de atenție

- `extractText` (ML Kit) pe facturi cu layout dens poate da OCR zgomotos →
  mapper-ul AI trebuie să fie tolerant; regex-ul POD e plasa de siguranță.
- Detecția automată a tipului de utilitate poate greși → utilizatorul poate
  oricând corecta din picker înainte de salvare.
- Orfani la ștergerea proprietății — acoperit prin cleanup în `deleteProperty`.
