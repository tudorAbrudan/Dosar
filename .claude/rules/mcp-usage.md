# MCP servers — triggere specifice Dosar

Regula generică (când DA / când NU, ordinea de invocare) e în `~/.claude/CLAUDE.md`. Aici doar specificul acestui proiect.

## Context7 — pachete care declanșează invocarea

API necunoscut într-unul dintre acestea → Context7 înainte de prima linie:

- `expo`, `expo-router`
- `expo-sqlite` (semnături `.runAsync` / `.execAsync` / `.getAllAsync` se schimbă între versiuni)
- `expo-notifications`, `expo-file-system`, `expo-local-authentication`, `expo-secure-store`
- `expo-sharing`, `expo-image-picker`, `expo-share-intent`, `expo-calendar`
- `react-native-cloud-storage` (folosit în `services/cloudStorage.ts`)
- `llama.rn` (model local GGUF — semnăturile se schimbă des între versiuni)
- CloudKit (`CKSyncEngine`, `CKShare`) în modulele Swift din `modules/`
- React Native primitives doar dacă proiectul nu le folosește deja (ex. modul nou)

Excepție utilă: dacă pattern-ul e deja în `services/db.ts` / `services/cloudSync.ts` / un hook existent, **copiază din repo**, nu invoca Context7.

## XcodeBuildMCP — verificare UI în simulator

Server-ul e declarat în `.mcp.json` (versiune fixată), config în `.xcodebuildmcp/config.yaml` (workflows `simulator` + `ui-automation`, telemetrie oprită). Fluxul complet (build, Metro, deep-link, Face ID, date de test): skill-ul `run-ios`.

Verificare obligatorie la final dacă atingi:

- Orice fișier din `app/(tabs)/`.
- Componente din `components/` care randează (exclus tipuri, utils, hooks).
- `theme/colors.ts`, `theme/docTypeIcons.ts`, `theme/docTypeColors.ts`, `constants/Theme.ts`.
- `app/_layout.tsx` (atinge theme switching și app lock).
- Orice formular nou (verifică pattern-ul `FormPageScreen` / `FormSheetModal` vizual, nu doar prin `form-consistency-guard`).

Pe lângă verificare vizuală pură, testează:
- Theme switch (Setări → Aspect: Auto / Deschis / Întunecat) — vezi `rules/design.md`.
- Scroll cu tastatura deschisă pe formularele noi (issue-ul istoric cu `Modal transparent`).

NU e nevoie de simulator pentru:
- Audit scripts (`scripts/*.js`).
- `types/index.ts`, `services/appKnowledge.ts` standalone.
- `docs/` (HTML static).

Limite cunoscute ale simulatorului (nu le raporta ca bug-uri): iCloud Documents/CloudKit nu merg complet, PHPicker nu primește tap-uri automate, biometria se simulează. Pentru acestea → device fizic, spus explicit în raport.

## Aliniere cu workflow-ul existent

- „Done = dovedit pe device" înseamnă: dacă ai atins UI, XcodeBuildMCP (screenshot + snapshot UI) a rulat înainte de finalul task-ului.
- Dacă build-ul sau simulatorul nu pornește, scrie explicit „NU am verificat UI pentru că …" — nu te ascunde după type-check verde.
- Pre-commit și Stop gate (`tsc` + audituri) **nu** acoperă UI — simulatorul e singurul mod de a închide acel gap.
