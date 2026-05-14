---
date: 2026-04-20
tags: [refactoring, large-files, ai-development]
trigger: editing files >500 lines or with many cross-references
---

# Checklist modificări în fișiere mari

## Problemă recurentă
La modificări în fișiere mari (ex: `add.tsx`, `setari.tsx`), state/props/funcții șterse rămân referențiate în altă parte, sau props noi adăugate nu sunt pasate peste tot.

## Checklist după orice modificare semnificativă

1. **State șters** → caută toate referințele cu `Grep` (inclusiv în JSX și în alte componente).
2. **Prop nou adăugat** la o componentă → verifică toate locurile unde componenta e folosită.
3. **Funcție redenumită/ștearsă** → grep pentru vechiul nume.
4. **Import adăugat** → verifică că nu era deja importat (duplicate import).
5. **Import șters** → verifică că nu mai e folosit nicăieri în fișier.

## Regulă derivată
Aplicabil la orice fișier cu >500 linii sau cu >3 locuri de utilizare a componentelor sale. **Soluția pe termen lung:** splitting în fișiere <400 linii (vezi `docs/superpowers/plans/2026-05-14-ai-dev-optimizations.md` Phase 2).
