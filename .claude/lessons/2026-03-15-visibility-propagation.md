---
date: 2026-03-15
tags: [architecture, hooks, dynamic-types, visibility, document-types]
trigger: filtering by visibility settings applied inconsistently across screens
---

# Vizibilitate tipuri — sursă unică, niciodată duplicată

## Problemă
`visibleDocTypes` aplicat parțial — în `add.tsx` și `expirari.tsx`, dar omis în `documente/index.tsx` (chip filtrare) și `documente/[id].tsx` (edit modal). Tipurile dezactivate apăreau în acele ecrane.

## Cauză
Fiecare ecran construia propria listă din `DOCUMENT_TYPE_LABELS` direct, fără sursă unică de adevăr.

## Regulă
Creează hook dedicat (`useFilteredDocTypes`) ca sursă unică.

**Niciodată** nu construi liste selectabile de tipuri din `DOCUMENT_TYPE_LABELS` direct — mereu prin `useFilteredDocTypes()`.

La orice feature nou cu picker de tipuri, verifică dacă folosește hook-ul.

## Enforcement
- Regulă scrisă: `.claude/rules/dynamic-types.md`
- Lint rule: `local-rules/no-direct-doc-type-iteration` (P1.3, 2026-05-14)
- Audit script: `scripts/check-hardcoded-entities.js`

## Aplicabil
Orice screen cu picker/chip list de tipuri de documente.
