# Tipuri și entități — sursă unică, niciodată hardcodate

## Regulă critică

**Listele de `EntityType` și `DocumentType` NU se duplică în UI.** Sursa unică e `types/index.ts`:

| Concept | Sursa unică |
|---|---|
| Lista entităților | `ALL_ENTITY_TYPES` |
| Eticheta entității (RO) | `ENTITY_TYPE_LABELS[type]` |
| Emoji entitate | `ENTITY_TYPE_EMOJI[type]` |
| Lista documentelor standard | `STANDARD_DOC_TYPES` |
| Eticheta documentului (RO) | `DOCUMENT_TYPE_LABELS[type]` |
| Tipuri document per entitate | `ENTITY_DOCUMENT_TYPES[entityType]` |
| Primary entity per tip document | `DOC_PRIMARY_ENTITY[docType]` |
| Tipuri repetabile | `REPEATABLE_DOC_TYPES` |

**Rezolvare nume entitate dintr-un link → `useEntities().resolveEntityName(link)`** (singura funcție; format compus pentru carduri).

Filtrare prin vizibilitate → `useVisibilitySettings().visibleEntityTypes` / `visibleDocTypes`.

## Anti-patterns interzise

### ❌ Array hardcodat de entități

```ts
// GREȘIT — pierde orice tip viitor de entitate
const TABS = [
  { key: 'person', label: 'Persoană' },
  { key: 'vehicle', label: 'Vehicul' },
  // ...
];
```

```ts
// CORECT
import { ALL_ENTITY_TYPES, ENTITY_TYPE_LABELS } from '@/types';
const TABS = ALL_ENTITY_TYPES.map(t => ({ key: t, label: ENTITY_TYPE_LABELS[t] }));
```

### ❌ Switch hardcodat pentru name lookup

```ts
// GREȘIT — duplicare în 3+ ecrane
switch (link.entityType) {
  case 'person': return persons.find(...)?.name ?? link.entityId;
  case 'vehicle': return vehicles.find(...)?.name ?? link.entityId;
  // ...
}
```

```ts
// CORECT
const { resolveEntityName } = useEntities();
const name = resolveEntityName(link);
```

### ❌ Record exhaustiv recreat în fiecare ecran

```ts
// GREȘIT — duplicare; la adăugare tip nou trebuie modificat în N locuri
const ENTITY_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  // ...
};

const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  // ...
};
```

```ts
// CORECT
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI } from '@/types';
const ENTITY_LABELS = ENTITY_TYPE_LABELS;
const ENTITY_ICONS = ENTITY_TYPE_EMOJI;
```

### ❌ Iterare manuală peste `DOCUMENT_TYPE_LABELS`

```ts
// GREȘIT — ignoră vizibilitatea per user și logica per entitate
{Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => ...)}
```

```ts
// CORECT — folosește hook-ul filtrat
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
const { docTypeOptions } = useFilteredDocTypes(/* opțional: { entityTypes } */);
{docTypeOptions.map(({ value, label }) => ...)}
```

### ❌ Câmpuri legacy în loc de entity_links

```ts
// GREȘIT — ratează multi-link (entitățile pot avea mai multe legături prin junction table)
const personDocs = documents.filter(d => d.person_id === personId);
```

```ts
// CORECT
import { getDocumentsByEntityId } from '@/services/documents';
const docs = await getDocumentsByEntityId('person', personId);
// SAU folosește d.entity_links
```

## Adăugarea unui `EntityType` nou (checklist)

Singurele locuri unde adăugarea trebuie făcută manual:

1. `types/index.ts`:
   - `EntityType` union (adaugă valoarea)
   - `ALL_ENTITY_TYPES` (ordinea afișării)
   - `ENTITY_TYPE_LABELS` (etichetă RO)
   - `ENTITY_TYPE_EMOJI` (emoji)
   - `ENTITY_DOCUMENT_TYPES` (tipurile de documente permise)
2. `services/db.ts` — tabel SQLite + index-uri
3. `services/entities.ts` SAU `services/<entity>.ts` — CRUD
4. `hooks/useEntities.ts`:
   - Adaugă state + `Promise.all` în refresh
   - Adaugă case în `resolveEntityName`
   - Adaugă în return object
5. `services/backup.ts` — collect + restore + wipe
6. `services/cloudSync.ts` — manifest payload
7. `scripts/backup-audit.js` — `TABLE_TO_MANIFEST_FIELD` (dacă numele tabel ≠ camelCase)

**Restul (Setări/Vizibilitate, „Adaugă entitate", picker entități, „Legat de", chip-uri Onboarding, emoji-uri detail document, PDF filename) ridică automat din sursele de mai sus.** Dacă editezi un ecran ca să adaugi case pentru tipul nou — e bug în arhitectură, nu refactor.

## Adăugarea unui `DocumentType` nou (checklist)

1. `types/index.ts`:
   - `DocumentType` union
   - `STANDARD_DOC_TYPES`
   - `DOCUMENT_TYPE_LABELS`
   - `ENTITY_DOCUMENT_TYPES[<entitate>]` — la ce entități e relevant
   - `DOC_PRIMARY_ENTITY` (entitatea principală)
   - Opțional: `REPEATABLE_DOC_TYPES` dacă se repetă (ex: facturi lunare)
   - Opțional: `DEFAULT_VISIBLE_DOC_TYPES`
2. `services/aiTypeRegistry.ts` — `DOC_TYPE_AI_REGISTRY[<tip>]` cu aliases + description
3. `scripts/update-site.js` — `EMOJI_MAP[<tip>]` (opțional, default 📄)
4. `app/(tabs)/documente/index.tsx` și `app/(tabs)/expirari.tsx` — adaugă în `DOC_ICON`, `DOC_ICON_BG`, `DOC_ICON_COLOR` (Ionicons + culoare custom — singurul caz unde nu putem evita)

**Restul (picker tipuri, setări vizibilitate, chatbot knowledge, site documentație) ridică automat.**

## Verificare automată

Înainte de commit pe modificări în:
- `types/index.ts`
- `hooks/useEntities.ts`
- `app/(tabs)/entitati/`
- `app/(tabs)/documente/`

Rulează:
```bash
node scripts/check-hardcoded-entities.js
```

Script-ul raportează:
- Record-uri exhaustive pe `EntityType` care duplică `ENTITY_TYPE_LABELS` / `ENTITY_TYPE_EMOJI`
- Switch-uri `case 'person': ... case 'company':` care duplică `resolveEntityName`
- Array-uri `[{ key: 'person', label }, ...]` care ar trebui generate din `ALL_ENTITY_TYPES`

Exit code 0 = curat, exit code 1 = discrepanțe. Folosit în pre-commit + CI.
