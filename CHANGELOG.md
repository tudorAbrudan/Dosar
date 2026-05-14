# Changelog

Toate modificările notabile ale aplicației Dosar sunt înregistrate aici.

Formatul respectă [Keep a Changelog](https://keepachangelog.com/) și versionarea
[Semantic Versioning](https://semver.org/). Generat automat de
[`standard-version`](https://github.com/conventional-changelog/standard-version)
din commits convenționale (`feat`, `fix`, `refactor`, `docs`, etc.).

Rulează:

```bash
npm run release          # bump auto (patch/minor/major) din commits
npm run release:dry      # preview fără modificări
```

## [3.5.0] (2026-05-12)

Baseline — istoricul anterior a fost capturat în taguri git și commit messages.
Începând cu versiunile următoare, fiecare release va popula automat această secțiune.

### Highlights (recap)
- Faza 2 cloud backup în iCloud (manifest + snapshots + criptare opțională)
- AI document classification pipeline (mistral/openai opt-in)
- Eliminat feature medical (3.5.0-53)
- Auto-activare tipuri document detectate de AI

[3.5.0]: https://github.com/tudorAbrudan/Dosar/releases/tag/v3.5.0
