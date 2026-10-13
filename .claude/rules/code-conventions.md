---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Convenții de cod

## TypeScript
- Evita `any`; folosește tipuri din `types/index.ts`.
- Tipuri noi → adaugă în `types/index.ts`.
- Funcții publice din servicii → tip de return explicit.

## React Native / Expo
- Componente funcționale cu hooks.
- Stiluri: `StyleSheet.create` (nu inline styles la scară).
- Navigare: Expo Router (file-based routing în `app/`).
- Text: mereu în `<Text>` sau `<ThemedText>` – niciodată string raw în JSX.

## Structură
- Ecrane → `app/(tabs)/` sau `app/modal.tsx`.
- Componente reutilizabile → `components/`.
- Logica de business → `services/` (db.ts, documents.ts, entities.ts, etc.).
- Custom hooks → `hooks/`.
- Tipuri → `types/index.ts`.
- Design system → `theme/` și `constants/Theme.ts`.
- Module native Swift → `modules/`; patch-uri native care nu trec prin `app.json` → `scripts/patch-*.js` idempotent, legat de `npm run prebuild`.

## Naming
- Fișiere: `camelCase.ts` / `PascalCase.tsx` pentru componente.
- Variabile/funcții: `camelCase`.
- Tipuri/Interfețe: `PascalCase`.
- Constante: `UPPER_SNAKE_CASE`.

## Fără backwards compatibility — REGULĂ STRICTĂ

**Nu adăuga niciodată shim-uri, alias-uri sau cod de compatibilitate inversă.**

Interzis explicit:
- Redenumit variabile neutilizate ca `_oldName` pentru a păstra compatibilitatea
- Re-exporturi de tipuri/funcții eliminate (`export { X } from './old'`)
- Comentarii `// removed` sau `// deprecated` pe cod șters
- Feature flags sau branch-uri de cod pentru versiuni vechi
- Orice cod care există **doar** ca să nu strice ceva vechi

Regula: dacă ceva nu mai e folosit, **șterge-l complet**. Dacă o interfață se schimbă, **schimb-o direct** în toate locurile. Cod mort = datorie tehnică imediată.

Excepție: compatibilitatea **datelor** (backup-uri vechi, manifest cloud, coloane legacy din SQLite) — acolo userii au fișiere reale; vezi `rules/backup.md`.

## Git
- Commit messages în engleză, descriptive.
- Commit-uri mici, pe feature.
- Înainte de commit: `npm run audit` (pre-commit hook-ul rulează oricum subsetul strict).
