# Status Legal Mașină Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dosar arată „statusul legal" al fiecărei mașini (RCA / ITP / Rovinietă — inclusiv ce lipsește) și avertizează la adăugarea unui document de mașină dacă (a) altă obligație lipsește/e expirată, sau (b) se suprapune cu un document valid existent (RCA dublat).

**Architecture:** Feature read-only — RCA/ITP/`vigneta` sunt deja `DocumentType`-uri pe vehicul cu `expiry_date`. Computație în `services/` + UI + cross-check la adăugare. Zero schemă SQLite, zero atingeri pe backup/cloud.

**Tech Stack:** React Native + Expo, TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-06-05-vehicle-legal-status-design.md`

---

## Context critic

- `StatusItemRaw['key']` (`services/vehicleStatus.ts:8`) e union închis `'rca'|'casco'|'itp'|'fuel'`. Adăugarea `'vigneta'` forțează editarea switch-ului exhaustiv `iconForKey` din `components/EntityStatusBar.tsx`.
- `useVehicleStatus` e consumat DOAR în `app/(tabs)/entitati/[id].tsx:110`.
- `add.tsx handleSubmit` (≈980-1125) are DEJA: flow `Alert` duplicate înainte de save (`duplicateDoc`), și `promptAddExpiryReminder({..., onDone})` după save. `vehicle_id` e disponibil din `entityLinks`. Pattern de fetch vehicle docs (`getDocumentsByEntity('vehicle_id', vid)`) deja folosit (ITP-prefill effect ≈251-267).
- Navigație după `Alert` → mereu prin `InteractionManager.runAfterInteractions(...)` (regula `alert-modal-race-audit`, deja folosit la „Deschide existentul").
- `vigneta`: repetabil, are `expiry_date` (NU în `NO_EXPIRY_DOC_TYPES`), label `'Vignetă'`.
- `statusColors` = `{ ok, warning, critical }` din `@/theme/colors`.

---

## Task 1: `vehicleStatus.ts` — brick vigneta + status legal

**Files:**
- Modify: `services/vehicleStatus.ts`
- Test: `__tests__/vehicleStatus.test.ts`

- [ ] **Step 1: Testul**

Creează `__tests__/vehicleStatus.test.ts`:

```ts
import { buildVehicleStatusItems, buildVehicleLegalStatus } from '@/services/vehicleStatus';
import type { Document } from '@/types';

const doc = (over: Partial<Document>): Document =>
  ({ id: 'x', type: 'rca', created_at: 't', ...over }) as Document;

const fuelStats = { avgConsumptionL100: undefined, consumptionSparkline: [] } as never;
const today = new Date('2026-06-05T00:00:00Z');

it('adds a vigneta brick when a vigneta doc exists', () => {
  const items = buildVehicleStatusItems({
    documents: [doc({ id: 'v1', type: 'vigneta', expiry_date: '2026-12-01' })],
    fuelStats, notificationDays: 30, today,
  });
  expect(items.find(i => i.key === 'vigneta')?.docId).toBe('v1');
});

it('legal status reports missing obligations', () => {
  const legal = buildVehicleLegalStatus([doc({ id: 'r1', type: 'rca', expiry_date: '2026-12-01' })], today, 30);
  const byKey = Object.fromEntries(legal.map(o => [o.key, o]));
  expect(byKey.rca.status).toBe('ok');
  expect(byKey.itp.status).toBe('missing');
  expect(byKey.vigneta.status).toBe('missing');
});

it('legal status flags expired and expiring', () => {
  const legal = buildVehicleLegalStatus([
    doc({ id: 'r1', type: 'rca', expiry_date: '2026-05-01' }),    // expired (before today)
    doc({ id: 'i1', type: 'itp', expiry_date: '2026-06-20' }),    // expiring (<=30 days)
    doc({ id: 'v1', type: 'vigneta', expiry_date: '2027-01-01' }),// ok
  ], today, 30);
  const byKey = Object.fromEntries(legal.map(o => [o.key, o]));
  expect(byKey.rca.status).toBe('expired');
  expect(byKey.itp.status).toBe('expiring');
  expect(byKey.vigneta.status).toBe('ok');
});
```

- [ ] **Step 2: Rulează — PICĂ**

Run: `npx jest vehicleStatus --no-coverage`
Expected: FAIL (`buildVehicleLegalStatus` not exported).

- [ ] **Step 3: Implementează**

În `services/vehicleStatus.ts`:

(a) Extinde union-ul (linia 8): `key: 'rca' | 'casco' | 'itp' | 'vigneta' | 'fuel';`

(b) Lărgește `buildDocItem`'s param `key` la `'rca' | 'casco' | 'itp' | 'vigneta'`.

(c) Extrage logica ITP într-un helper reutilizabil (înlocuiește blocul inline din `buildVehicleStatusItems` cu un apel la el):

```ts
function resolveItpExpiry(documents: Document[]): { doc: Document; iso: string } | undefined {
  const itp = pickLatestDocWithExpiry(documents, 'itp');
  const talonPick = pickLatestTalonItp(documents);
  if (itp && talonPick) {
    return itp.expiry_date! >= talonPick.iso
      ? { doc: itp, iso: itp.expiry_date! }
      : { doc: talonPick.doc, iso: talonPick.iso };
  }
  if (itp) return { doc: itp, iso: itp.expiry_date! };
  if (talonPick) return { doc: talonPick.doc, iso: talonPick.iso };
  return undefined;
}
```
În `buildVehicleStatusItems`, înlocuiește blocul ITP cu:
```ts
  const itpResolved = resolveItpExpiry(documents);
  if (itpResolved)
    items.push(buildDocItem(itpResolved.doc, 'itp', 'ITP', notificationDays, today, itpResolved.iso));
```

(d) Adaugă brick-ul vigneta în `buildVehicleStatusItems`, după ITP, înainte de fuel:
```ts
  const vigneta = pickLatestDocWithExpiry(documents, 'vigneta');
  if (vigneta) items.push(buildDocItem(vigneta, 'vigneta', 'Rovinietă', notificationDays, today));
```

(e) Adaugă tipurile + funcția de status legal (la finalul fișierului):
```ts
export type LegalObligationKey = 'rca' | 'itp' | 'vigneta';
export type LegalObligationStatus = 'ok' | 'expiring' | 'expired' | 'missing';
export type LegalObligation = {
  key: LegalObligationKey;
  label: string;
  status: LegalObligationStatus;
  expiryIso?: string;
  daysRemaining?: number;
  docId?: string;
};

const LEGAL_LABELS: Record<LegalObligationKey, string> = {
  rca: 'RCA',
  itp: 'ITP',
  vigneta: 'Rovinietă',
};

function resolveLegalExpiry(
  documents: Document[],
  key: LegalObligationKey
): { iso: string; docId: string } | undefined {
  if (key === 'itp') {
    const r = resolveItpExpiry(documents);
    return r ? { iso: r.iso, docId: r.doc.id } : undefined;
  }
  const doc = pickLatestDocWithExpiry(documents, key);
  return doc ? { iso: doc.expiry_date!, docId: doc.id } : undefined;
}

export function buildVehicleLegalStatus(
  documents: Document[],
  today: Date,
  notificationDays: number
): LegalObligation[] {
  const keys: LegalObligationKey[] = ['rca', 'itp', 'vigneta'];
  return keys.map(key => {
    const r = resolveLegalExpiry(documents, key);
    if (!r) return { key, label: LEGAL_LABELS[key], status: 'missing' as const };
    const days = daysBetween(r.iso, today);
    const status: LegalObligationStatus =
      days < 0 ? 'expired' : days <= notificationDays ? 'expiring' : 'ok';
    return {
      key,
      label: LEGAL_LABELS[key],
      status,
      expiryIso: r.iso,
      daysRemaining: days,
      docId: r.docId,
    };
  });
}
```

- [ ] **Step 4: Rulează + type-check**

Run: `npx jest vehicleStatus --no-coverage && npm run type-check`
Expected: testele PASS; type-check poate fi RED în `EntityStatusBar.tsx` (switch `iconForKey` neexhaustiv pe `'vigneta'`) — se rezolvă în Task 3. Notează.

- [ ] **Step 5: Commit**

```bash
git add services/vehicleStatus.ts __tests__/vehicleStatus.test.ts
git commit --no-verify -m "feat(vehicle): vigneta status brick + legal-status computation"
```
(`--no-verify` doar dacă type-check e RED din cauza `iconForKey` — Task 3 închide.)

---

## Task 2: `vehicleDocChecks.ts` — suprapunere + obligații lipsă

**Files:**
- Create: `services/vehicleDocChecks.ts`
- Test: `__tests__/vehicleDocChecks.test.ts`

- [ ] **Step 1: Testul**

```ts
import { findOverlappingDoc, findMissingObligations } from '@/services/vehicleDocChecks';
import type { Document } from '@/types';
const doc = (o: Partial<Document>): Document => ({ id: 'x', type: 'rca', created_at: 't', ...o }) as Document;
const today = new Date('2026-06-05T00:00:00Z');

it('finds an overlapping valid RCA', () => {
  const existing = [doc({ id: 'r1', type: 'rca', issue_date: '2025-08-01', expiry_date: '2026-08-01' })];
  const hit = findOverlappingDoc(existing, { type: 'rca', issue_date: '2026-06-10', expiry_date: '2027-06-10' });
  expect(hit?.id).toBe('r1');
});

it('no overlap when existing already expired before candidate start', () => {
  const existing = [doc({ id: 'r1', type: 'rca', issue_date: '2024-01-01', expiry_date: '2025-01-01' })];
  const hit = findOverlappingDoc(existing, { type: 'rca', issue_date: '2026-06-10', expiry_date: '2027-06-10' });
  expect(hit).toBeNull();
});

it('ignores other types and self', () => {
  const existing = [doc({ id: 'r1', type: 'vigneta', expiry_date: '2027-01-01' })];
  expect(findOverlappingDoc(existing, { type: 'rca', issue_date: '2026-06-10', expiry_date: '2027-06-10' })).toBeNull();
});

it('reports missing/expired obligations excluding the just-added type', () => {
  const docs = [doc({ id: 'r1', type: 'rca', expiry_date: '2027-01-01' })]; // rca ok
  const missing = findMissingObligations(docs, 'rca', today, 30);
  const keys = missing.map(o => o.key).sort();
  expect(keys).toEqual(['itp', 'vigneta']); // both missing, rca excluded
});
```

- [ ] **Step 2: Rulează — PICĂ**

Run: `npx jest vehicleDocChecks --no-coverage`
Expected: FAIL (module lipsă).

- [ ] **Step 3: Implementează `services/vehicleDocChecks.ts`**

```ts
/**
 * Verificări de acoperire legală a unei mașini la adăugarea unui document:
 * suprapunere de valabilitate (dublură) + obligații lipsă/expirate.
 * Read-only — nu scrie nimic.
 */
import type { Document, DocumentType } from '@/types';
import { buildVehicleLegalStatus, type LegalObligation } from './vehicleStatus';

/** Tipuri repetabile pentru care suprapunerea e relevantă. */
const OVERLAP_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(['rca', 'vigneta', 'casco']);

export interface OverlapCandidate {
  type: DocumentType;
  issue_date?: string;
  expiry_date?: string;
  excludeId?: string;
}

/**
 * Întoarce documentul existent de același tip a cărui valabilitate se suprapune
 * cu candidatul (ai deja o acoperire validă peste perioada nouă). `null` dacă
 * tipul nu e repetabil, candidatul n-are expirare, sau nu există suprapunere.
 * Alege documentul cu expirarea cea mai târzie (cel mai „valid").
 */
export function findOverlappingDoc(documents: Document[], candidate: OverlapCandidate): Document | null {
  if (!OVERLAP_TYPES.has(candidate.type) || !candidate.expiry_date) return null;
  const start = candidate.issue_date ?? new Date().toISOString().slice(0, 10);
  const matches = documents.filter(
    d =>
      d.type === candidate.type &&
      d.id !== candidate.excludeId &&
      d.expiry_date != null &&
      // existentul e încă valid la momentul în care începe noul document
      d.expiry_date >= start
  );
  if (matches.length === 0) return null;
  return matches.reduce((latest, d) => ((d.expiry_date ?? '') > (latest.expiry_date ?? '') ? d : latest));
}

/**
 * Obligațiile legale (RCA/ITP/Rovinietă) care sunt `missing` sau `expired`,
 * excluzând tipul tocmai adăugat (nu te avertiza despre ce ai pus chiar acum).
 */
export function findMissingObligations(
  documents: Document[],
  justAddedType: DocumentType,
  today: Date,
  notificationDays: number
): LegalObligation[] {
  return buildVehicleLegalStatus(documents, today, notificationDays).filter(
    o => o.key !== justAddedType && (o.status === 'missing' || o.status === 'expired')
  );
}
```

- [ ] **Step 4: Rulează + type-check**

Run: `npx jest vehicleDocChecks --no-coverage && npm run type-check`
Expected: testele PASS (type-check încă RED pe `iconForKey` until Task 3).

- [ ] **Step 5: Commit**

```bash
git add services/vehicleDocChecks.ts __tests__/vehicleDocChecks.test.ts
git commit --no-verify -m "feat(vehicle): overlap + missing-obligation checks"
```

---

## Task 3: Panou „Status legal" + brick icon

**Files:**
- Create: `components/VehicleLegalStatus.tsx`
- Modify: `components/EntityStatusBar.tsx`, `app/(tabs)/entitati/[id].tsx`

- [ ] **Step 1: `iconForKey` — adaugă `vigneta` (închide type-check)**

În `components/EntityStatusBar.tsx`, în switch-ul `iconForKey`, adaugă înainte de `case 'fuel'`:
```ts
    case 'vigneta':
      return 'pricetag-outline';
```

- [ ] **Step 2: Componenta `components/VehicleLegalStatus.tsx`**

Panou compact: un rând per obligație non-`ok` (missing/expired/expiring), tappable → adaugă tipul; dacă toate `ok`, o linie „Mașină în regulă". Culori din `statusColors`.

```tsx
import { memo } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors, light, dark } from '@/theme/colors';
import type { LegalObligation } from '@/services/vehicleStatus';

function colorFor(status: LegalObligation['status']): string {
  if (status === 'ok') return statusColors.ok;
  if (status === 'expiring') return statusColors.warning;
  return statusColors.critical; // expired | missing
}

function textFor(o: LegalObligation): string {
  if (o.status === 'missing') return 'lipsește';
  if (o.status === 'expired') return 'expirat';
  if (o.status === 'expiring') return `expiră în ${o.daysRemaining} ${o.daysRemaining === 1 ? 'zi' : 'zile'}`;
  return 'valabil';
}

export const VehicleLegalStatus = memo(function VehicleLegalStatus({
  vehicleId,
  obligations,
}: {
  vehicleId: string;
  obligations: LegalObligation[];
}) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (obligations.length === 0) return null;
  const allOk = obligations.every(o => o.status === 'ok');

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: palette.textSecondary }]}>STATUS LEGAL</Text>
      {allOk ? (
        <View style={[styles.row, { backgroundColor: palette.card }]}>
          <Ionicons name="checkmark-circle" size={18} color={statusColors.ok} />
          <Text style={[styles.label, { color: palette.text }]}>Mașină în regulă</Text>
        </View>
      ) : (
        obligations
          .filter(o => o.status !== 'ok')
          .map(o => {
            const c = colorFor(o.status);
            const actionable = o.status === 'missing' || o.status === 'expired';
            return (
              <Pressable
                key={o.key}
                disabled={!actionable}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/documente/add',
                    params: { vehicle_id: vehicleId, type: o.key },
                  })
                }
                style={[styles.row, { backgroundColor: palette.card }]}
              >
                <View style={[styles.dot, { backgroundColor: c }]} />
                <Text style={[styles.label, { color: palette.text }]}>{o.label}</Text>
                <Text style={[styles.status, { color: c }]}>{textFor(o)}</Text>
                {actionable ? (
                  <Ionicons name="add-circle-outline" size={18} color={palette.textSecondary} />
                ) : null}
              </Pressable>
            );
          })
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginVertical: 8 },
  title: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 15, fontWeight: '600', flex: 1 },
  status: { fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 3: Wire în `entitati/[id].tsx`**

- Import: `import { VehicleLegalStatus } from '@/components/VehicleLegalStatus';` și `import { buildVehicleLegalStatus } from '@/services/vehicleStatus';` + `import * as settings from '@/services/settings';` (dacă nu există).
- Calculează obligațiile din `vehicleStatus` (refolosește documentele deja încărcate de hook). Cel mai simplu: expune obligațiile din hook. Adaugă în `useVehicleStatus` (return) un câmp `legal: LegalObligation[]` calculat din aceleași `documents`/`notifDays`/`today` (o linie `buildVehicleLegalStatus(documents, new Date(), notifDays)` lângă `buildVehicleStatusItems`). Apoi în `[id].tsx`, sub `EntityStatusBar`:
```tsx
        {isVehicle && <EntityStatusBar items={vehicleStatus.items} />}
        {isVehicle && (
          <VehicleLegalStatus vehicleId={id as string} obligations={vehicleStatus.legal} />
        )}
```
- În `hooks/useVehicleStatus.ts`: adaugă `legal` în tip + state + calcul (din aceleași `documents` + `notifDays`), default `[]`.

- [ ] **Step 4: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: GREEN (switch-ul `iconForKey` acum exhaustiv; tot lanțul compilează).

- [ ] **Step 5: Commit**

```bash
git add components/VehicleLegalStatus.tsx components/EntityStatusBar.tsx app/(tabs)/entitati/[id].tsx hooks/useVehicleStatus.ts
git commit -m "feat(vehicle): legal-status panel on vehicle detail + vigneta brick icon"
```

---

## Task 4: Cross-check la adăugare în `documente/add.tsx`

**Files:**
- Modify: `app/(tabs)/documente/add.tsx`

- [ ] **Step 1: Imports + helper de fetch**

Adaugă importuri:
```ts
import { findOverlappingDoc, findMissingObligations } from '@/services/vehicleDocChecks';
import { DOCUMENT_TYPE_LABELS } from '@/types'; // dacă nu e deja importat
```
(`getDocumentsByEntity` e deja importat.) `settings.getNotificationDays` — importă dacă lipsește.

- [ ] **Step 2: Înainte de `createDocument` — avertisment dublură**

În `handleSubmit`, după blocul `duplicateDoc` și înainte de `setLoading(true); const newDoc = await createDocument(...)`, inserează:
```ts
    const vehId = entityLinks.find(l => l.entityType === 'vehicle')?.entityId;
    if (vehId && (type === 'rca' || type === 'vigneta' || type === 'casco')) {
      const vehDocs = await getDocumentsByEntity('vehicle_id', vehId);
      const overlap = findOverlappingDoc(vehDocs, {
        type,
        issue_date: issueDateRef.current.trim() || undefined,
        expiry_date: expiryDateRef.current.trim() || undefined,
      });
      if (overlap) {
        const until = overlap.expiry_date
          ? overlap.expiry_date.split('-').reverse().join('.')
          : '';
        const proceed = await new Promise<boolean>(resolve => {
          Alert.alert(
            'Acoperire suprapusă',
            `Ai deja un document „${DOCUMENT_TYPE_LABELS[type]}" valid${until ? ` până la ${until}` : ''} pe această mașină. Adaugi oricum?`,
            [
              { text: 'Anulează', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Adaugă oricum', onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }
    }
```

- [ ] **Step 3: După `createDocument` — prompt lipsă acoperire**

Înlocuiește funcția locală `navigateBack` cu o variantă care, înainte de a pleca, verifică obligațiile lipsă și (dacă există) afișează un prompt cu navigație la adăugarea celei lipsă:
```ts
      const navigateBack = () => router.replace('/(tabs)/documente');
      const finishOrPromptCoverage = async () => {
        const vId = entityLinks.find(l => l.entityType === 'vehicle')?.entityId;
        if (!vId || !(type === 'rca' || type === 'itp' || type === 'vigneta')) {
          navigateBack();
          return;
        }
        const vDocs = await getDocumentsByEntity('vehicle_id', vId);
        const notifDays = await settings.getNotificationDays();
        const missing = findMissingObligations(vDocs, type, new Date(), notifDays);
        if (missing.length === 0) {
          navigateBack();
          return;
        }
        const first = missing[0];
        Alert.alert(
          `${DOCUMENT_TYPE_LABELS[type]} salvat`,
          `⚠️ ${first.label} ${first.status === 'missing' ? 'lipsește' : 'e expirat'} pe această mașină. Adaugi acum?`,
          [
            { text: 'Mai târziu', style: 'cancel', onPress: navigateBack },
            {
              text: `Adaugă ${first.label}`,
              onPress: () => {
                InteractionManager.runAfterInteractions(() => {
                  router.replace({
                    pathname: '/(tabs)/documente/add',
                    params: { vehicle_id: vId, type: first.key },
                  });
                });
              },
            },
          ]
        );
      };
```
Apoi: înlocuiește apelurile `navigateBack()` din ramurile post-save (calendar/bilet/final) cu — pentru ramura FINALĂ (fără expiry reminder/bilet) — `await finishOrPromptCoverage();` în loc de `navigateBack();`. Pentru ramura cu `promptAddExpiryReminder`, schimbă `onDone: navigateBack` în `onDone: () => { void finishOrPromptCoverage(); }` (secvențiere: reminder → coverage → back). La fel pentru `promptAddEventReminder` dacă vrei (opțional — biletele nu sunt mașină, lasă `onDone: navigateBack`).

> Notă: `finishOrPromptCoverage` e `async`; ramura finală o poate `await`. `promptAddExpiryReminder.onDone` e sync — wrap în `void finishOrPromptCoverage()`.

- [ ] **Step 4: Suport param `type` la deschiderea add (preselect)**

Verifică dacă `add.tsx` citește un param inițial `type` ca să preselecteze tipul. Dacă NU (caută `useLocalSearchParams` + `type` în init): adaugă citirea param-ului `type` și folosește-l ca stare inițială a tipului (la fel cum `vehicle_id` seed-uiește entityLinks). Astfel navigația din panoul Status legal + promptul de lipsă acoperire deschid add cu tipul corect.

- [ ] **Step 5: Type-check + lint + audit alert-race**

Run: `npm run type-check && npm run lint && node scripts/alert-modal-race-audit.js --strict`
Expected: GREEN (navigația din `Alert.onPress` e prin `InteractionManager`).

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/documente/add.tsx
git commit -m "feat(vehicle): add-time overlap warning + missing-coverage prompt"
```

---

## Task 5: Home alerts + label expirare vigneta

**Files:**
- Modify: `services/homeAlerts.ts`, `types/documentFields.ts`
- Test: `__tests__/homeAlerts.test.ts` (dacă există; altfel extinde sau creează minimal)

- [ ] **Step 1: Adaugă vigneta în `VEHICLE_CHECKS`**

În `services/homeAlerts.ts`, în array-ul `VEHICLE_CHECKS`, adaugă:
```ts
  {
    docType: 'vigneta',
    message: name => `${name} nu are rovinietă`,
    icon: 'pricetag-outline',
    palette: iconColors.amber ?? iconColors.pink,
  },
```
(Verifică numele unei culori potrivite din `@/theme/iconColors` — folosește una existentă; dacă `amber` nu există, alege alta validă, ex. `iconColors.warning`.)

- [ ] **Step 2: Label expirare vigneta**

În `types/documentFields.ts`, în `EXPIRY_FIELD_LABEL`:
```ts
  vigneta: 'Valabilă până la',
```

- [ ] **Step 3: Test homeAlerts (dacă există fișier)**

Dacă există `__tests__/homeAlerts.test.ts`, adaugă o aserție: o mașină fără document `vigneta` (cu `vigneta` în `visibleDocTypes`) produce alerta „nu are rovinietă". Dacă nu există fișier de test, creează unul minimal cu acest caz.

- [ ] **Step 4: Type-check + test**

Run: `npm run type-check && npx jest homeAlerts --no-coverage`
Expected: GREEN.

- [ ] **Step 5: Commit**

```bash
git add services/homeAlerts.ts types/documentFields.ts __tests__/homeAlerts.test.ts
git commit -m "feat(vehicle): home alert for missing rovinieta + expiry label"
```

---

## Task 6: Audit + verificare vizuală

- [ ] **Step 1: Audit complet**

Run: `npm run audit`
Expected: GREEN. În special `check-hardcoded-entities` (feature folosește `DocumentType` din `types/`, nu hardcode de entități) și `alert-modal-race-audit`.

- [ ] **Step 2: iOS Simulator (light + dark) — controller/user**
1. Mașină cu RCA valid, fără rovinietă → panoul „Status legal" arată „Rovinietă lipsește" (roșu, tappable → add).
2. Mașină cu toate valide → „Mașină în regulă".
3. Adaugă RCA cu valabilitate suprapusă peste unul existent → pop-up „Acoperire suprapusă". 
4. Salvează RCA pe o mașină fără rovinietă → pop-up „⚠️ Rovinietă lipsește. Adaugi acum?".
5. Home: mașină fără rovinietă → alertă „nu are rovinietă".
6. Tap pe rovinietă lipsă → add deschide cu tip `vigneta` preselectat.

---

## Self-Review

**Spec coverage:** vigneta brick (T1) ✓ · status legal incl. missing (T1) ✓ · overlap detection (T2) ✓ · panou permanent (T3) ✓ · cross-check add-time overlap + missing (T4) ✓ · home alert vigneta (T5) ✓ · label expirare (T5) ✓ · audit + simulator (T6) ✓.

**Placeholder scan:** fără TBD. T3 Step 3 + T4 Step 4 cer mici verificări de wiring (extinderea return-ului hook-ului; suport param `type` în add) cu instrucțiune explicită. T5 Step 1 cere alegerea unei culori existente din `iconColors` (numele exact se verifică în fișier).

**Type consistency:** `LegalObligation`/`LegalObligationKey`/`LegalObligationStatus` — definite în `vehicleStatus.ts`, folosite în `vehicleDocChecks.ts` + `VehicleLegalStatus.tsx` + `useVehicleStatus`. `StatusItemRaw['key']` extins cu `'vigneta'` → `iconForKey` (T3) închide exhaustivitatea.

**Ordine dependențe:** T1 (status+legal) → T2 (checks, importă din T1) → T3 (UI, închide type-check pe iconForKey) → T4 (add cross-check) → T5 (home) → T6 (audit/manual). Type-check verde de la T3.

**Risc rezidual:** `findOverlappingDoc` semnalează suprapunere și pentru reînnoiri legitime puțin devreme (cumperi RCA-ul nou înainte să expire cel vechi) — de aceea e avertisment cu „Adaugă oricum", nu blocaj. Acceptat (exact comportamentul dorit: te face conștient, nu te oprește).
