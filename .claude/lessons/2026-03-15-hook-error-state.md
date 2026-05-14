---
date: 2026-03-15
tags: [hooks, architecture, error-handling]
trigger: custom hook with async operations missing error state
---

# Hook async fără `error` state → eșuează silent

## Problemă
Hook-urile `useCustomTypes` și `useVisibilitySettings` nu aveau `error` state — eșecurile silențioase nu erau vizibile utilizatorului.

## Cauză
Pattern incomplet la crearea hook-urilor: s-a adăugat `loading` dar s-a omis `error`.

## Regulă
Orice hook cu operații async TREBUIE să aibă `error: string | null` state, resetat la `null` la start și setat în `catch`. Template:

```ts
{ loading: boolean, error: string | null, refresh(): Promise<void>, ...data }
```

## Aplicabil
Toate fișierele din `hooks/`. (Vezi și `app/.claude/CLAUDE.md` secțiunea Hook pattern obligatoriu.)
