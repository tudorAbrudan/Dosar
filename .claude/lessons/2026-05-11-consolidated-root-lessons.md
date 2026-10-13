---
date: 2026-05-11
tags: [expo, navigation, typescript, security, sqlite, architecture]
trigger: lecții scurte adunate în vechiul `.claude/lessons.md` din afara repo-ului; mutate aici la consolidarea config-ului Claude (2026-10-13)
---

# Lecții consolidate (fostul `.claude/lessons.md` din afara repo-ului)

Cele care au devenit reguli complete trăiesc acum în `rules/` (anti-hardcode entități → `dynamic-types.md`, culori → `design.md`, fără backwards-compat → `code-conventions.md`). Aici rămân doar cele fără altă casă.

## Navigare / refresh după editare

**Problemă:** Ecranele de vizualizare (ex. `documente/[id].tsx`) nu reîncărcau datele la revenirea din `edit.tsx` — `useEffect([id])` rulează doar la montare, nu la re-focus.
**Regulă:** Orice ecran de vizualizare cu ecran de editare asociat folosește `useFocusEffect(useCallback(() => { reload(); }, [id]))`.

## Valori din DB castate la enum

**Problemă:** `r.type as DocumentType` fără validare — un tip necunoscut (din backup vechi / alt device) trece de type-check și strică UI-ul.
**Regulă:** Validează valoarea față de lista sursă (`STANDARD_DOC_TYPES` etc.) înainte de cast. Vezi și `2026-03-15-union-types-runtime.md`.

## PIN în SecureStore

**Problemă:** PIN-ul era stocat în clar.
**Regulă:** PIN-ul se stochează hashed (SHA-256 minim); comparația se face pe hash. Doar `expo-secure-store` (audit: `pin-secure-store-audit.js`).

## Expo, nu React Native CLI

**Problemă:** `npx react-native start` într-un proiect Expo.
**Regulă:** `npm start` (= `expo start --clear`).

## Schemă SQLite → propagare

**Problemă:** Coloană nouă în SQLite fără actualizarea backup-ului și a tipurilor.
**Regulă:** `services/db.ts` → `types/index.ts` → `services/backup.ts` (export + `applyManifest`) → `services/cloudSync.ts` (`buildManifestPayload`). Plasa automată: `backup-audit.js --strict` (pre-commit + Stop gate).
