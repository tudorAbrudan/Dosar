---
name: release
description: Pregătește un release Dosar pentru App Store — audit verde, bump de versiune sincron în app.json/package.json/Info.plist/pbxproj, commit „Bump version". Folosire - /release patch|minor|major|x.y.z
disable-model-invocation: true
argument-hint: "patch|minor|major|x.y.z"
---

# Release Dosar

Argument: `$ARGUMENTS` (patch | minor | major | x.y.z). Dacă lipsește, întreabă userul ce tip de bump vrea.

## 1. Pre-flight

1. `git status --short` — arată userului ce e necomis. Dacă există modificări care nu țin de release, întreabă dacă intră în release sau rămân deoparte. Nu face stash/reset fără acord.
2. `npm run audit` trebuie să fie verde. Dacă pică, oprește-te și raportează — nu face release peste un audit roșu.
3. `node scripts/bump-version.js --check` — dacă `ios/` și `app.json` sunt deja desincronizate, spune-i userului înainte de bump.
4. Dacă `ios/` lipsește: `npm run prebuild` (regenerează nativul + rulează `scripts/patch-*.js`). Avertizează că prebuild rescrie `ios/` — dacă userul are modificări native manuale necomise acolo, se pierd.

## 2. Bump

```bash
node scripts/bump-version.js $ARGUMENTS --dry-run   # arată 3.15.2 (79) → …
node scripts/bump-version.js $ARGUMENTS
```

Scriptul scrie în toate cele 4 locuri și rulează singur `--check` la final. **Nu edita manual** Info.plist / pbxproj — Info.plist ține versiunea literal, iar un bump parțial produce un archive cu versiunea veche și app + Share Extension nesincronizate.

## 3. Commit

Doar `app.json` și `package.json` (`ios/` e gitignored):

```bash
git add app.json package.json
git commit -m "Bump version to <X.Y.Z> (build <N>)"
```

Pre-commit hook-ul rulează audit-urile + `update-site.js` (re-stage-uiește `docs/`). Nu face `push` și nu crea tag fără să întrebi.

## 4. Archive (manual, de user)

Spune-i userului:
1. Deschide `ios/Dosar.xcworkspace` → Product → Archive.
2. În Organizer, verifică că apare **<X.Y.Z> (<N>)** — dacă apare versiunea veche, Info.plist nu s-a actualizat (rulează `node scripts/bump-version.js --check`).
3. Distribute → App Store Connect.

Workflow-ul acceptat e direct-to-live (fără gate TestFlight) cât timp feature-urile noi n-au useri externi reali — nu recomanda TestFlight-first implicit.

## Raport final

- versiunea veche → nouă, build-ul
- rezultatul `npm run audit` și `--check`
- hash-ul commit-ului
- ce rămâne de făcut manual (archive, upload, push)
