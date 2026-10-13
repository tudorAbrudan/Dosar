---
paths:
  - ".github/**"
  - ".env*"
  - "app.json"
  - "app.config.*"
  - "eas.json"
  - "package.json"
  - "scripts/hooks/**"
  - "ai-proxy/**"
---

# Pipeline și mediu

## Comenzi
- Dev: `npm start` (expo start --clear)
- iOS pe device: `npm run ios` (expo run:ios --device …); simulator: XcodeBuildMCP (vezi skill-ul `run-ios`)
- Prebuild: `npm run prebuild` (expo prebuild --clean + `scripts/patch-*.js`) — regenerează `ios/` (gitignored)
- Release: skill-ul `/release` (bump în app.json + package.json + `ios/Dosar/Info.plist` + pbxproj)

## Calitate cod
- `npm run audit` — type-check + toate audit scripts + characterization tests + ast-grep (lista: `scripts/AUDITS.md`)
- Pre-commit: `scripts/hooks/pre-commit` (activ prin `npm run setup-hooks`)
- CI: `.github/workflows/audit.yml` (type-check, audituri principale, docs sincronizate, lint) + `test.yml` (jest)

## Secrets și .env
- Repo-ul e **public**. `.env` nu se comite niciodată.
- `EXPO_PUBLIC_*` ajunge în bundle-ul App Store → niciodată chei API acolo. Cheile AI stau doar pe `ai-proxy/` (setate cu `danube rapids update … --env K=V`).
- `EXPO_PUBLIC_DOSAR_AI_TOKEN` nu e cheie API (doar deschide poarta proxy-ului) — e allowlist-at în `expo-public-secrets-audit.js`.

## Structura de foldere
- Nu crea foldere noi fără motiv. Structura curentă: `app/`, `components/`, `hooks/`, `services/`, `types/`, `theme/`, `constants/`, `assets/`, `modules/`, `scripts/`, `ai-proxy/`.
