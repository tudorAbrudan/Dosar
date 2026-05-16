# MCP servers — triggere specifice Dosar

Regula generică (când DA / când NU, ordinea de invocare) e în `~/.claude/CLAUDE.md`. Aici doar specificul acestui proiect.

## Context7 — pachete care declanșează invocarea

API necunoscut într-unul dintre acestea → Context7 înainte de prima linie:

- `expo`, `expo-router`
- `expo-sqlite` (semnături `.runAsync` / `.execAsync` / `.getAllAsync` se schimbă între versiuni)
- `expo-notifications`, `expo-file-system`, `expo-local-authentication`, `expo-secure-store`
- `expo-sharing`, `expo-image-picker`, `expo-camera`
- `react-native-cloud-storage` (folosit în `services/cloudStorage.ts`)
- React Native primitives doar dacă proiectul nu le folosește deja (ex. modul nou)

Excepție utilă: dacă pattern-ul e deja în `services/db.ts` / `services/cloudSync.ts` / un hook existent, **copiază din repo**, nu invoca Context7.

## iOS Simulator — ce ecrane / componente o cer

Verificare obligatorie la final dacă atingi:

- Orice fișier din `app/(tabs)/`.
- Componente din `components/` care randează (exclus tipuri, utils, hooks).
- `theme/colors.ts`, `theme/docTypeIcons.ts`, `theme/docTypeColors.ts`, `constants/Theme.ts`.
- `app/_layout.tsx` (atinge theme switching și app lock).
- Orice formular nou (verifică pattern-ul `FormPageScreen` / `FormSheetModal` vizual, nu doar prin `form-consistency-guard`).

Pe lângă verificare vizuală pură, testează:
- Theme switch (Setări → Aspect: Auto / Deschis / Întunecat) — vezi `rules/design.md`.
- Scroll cu tastatura deschisă pe formularele noi (issue-ul istoric cu `Modal transparent`).

NU e nevoie de Simulator pentru:
- Audit scripts (`scripts/*.js`).
- `types/index.ts`, `services/appKnowledge.ts` standalone.
- `docs/` (HTML static).

## Aliniere cu workflow-ul existent

- Regula „done = dovedit pe device" din `.claude/CLAUDE.md` se traduce în: dacă ai atins UI, Simulator MCP a rulat înainte de finalul task-ului.
- Pre-commit hook (`npm run type-check` + audit scripts) **nu** acoperă UI — Simulator e singurul mod de a închide acel gap.
