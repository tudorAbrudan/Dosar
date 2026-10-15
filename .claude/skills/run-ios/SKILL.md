---
name: run-ios
description: Lansează Dosar în iOS Simulator prin XcodeBuildMCP și verifică vizual o modificare UI (screenshot, snapshot UI, tap, light/dark). Folosește-l la finalul oricărui task care atinge app/(tabs)/, components/ randabile, theme/ sau formulare — „done = văzut în simulator".
---

# Rulează Dosar în simulator și verifică UI-ul

Config: `.mcp.json` (XcodeBuildMCP fixat la o versiune) + `.xcodebuildmcp/config.yaml` (workspace `ios/Dosar.xcworkspace`, scheme `Dosar`, Debug, iPhone 17 Pro, bundle `com.ax.documente`). Uneltele MCP apar ca `mcp__XcodeBuildMCP__*` (încarcă-le cu ToolSearch).

## Flux

1. **Native prezent?** Dacă lipsește `ios/Dosar.xcworkspace` → `npm run prebuild` (întreabă userul întâi — rescrie `ios/`).
2. **Metro:** `curl -s localhost:8081/status` → dacă nu răspunde `packager-status:running`, pornește `npm start` în background. Build-ul Debug încarcă JS-ul de la Metro.
3. **Build + run:** `build_run_sim` (folosește session defaults; nu repeta workspace/scheme). Prima compilare durează minute — e normal.
4. **Verificare:** navighează la ecranul modificat și capturează:
   - `screenshot` — ce vede userul
   - `snapshot_ui` — arborele de accesibilitate (texte, butoane, element refs pentru `tap`)
   - `tap` / `type_text` / `swipe` pentru a parcurge flow-ul — nu doar ecranul modificat, ci și ecranele care folosesc același service/hook (Blast Radius din CLAUDE.md)
5. **Light + dark:** Setări → Aspect → Deschis, apoi Întunecat; screenshot în ambele. Verifică contrast, culori hardcodate, `Switch`/`TextInput` pe dark.
6. **Formulare:** deschide tastatura și verifică scroll-ul (bug-ul istoric cu `Modal transparent`).

## Capcane cunoscute pe mașina asta

- **App lock (Face ID):** enrolează în simulator, relansează app-ul, apoi potrivește la prompt:
  ```bash
  xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
  xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit.enrollmentChanged
  # la prompt:
  xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match
  ```
- **Galeria (PHPicker) nu primește tap-uri automate** — rulează în proces remote. Pentru cropper: copiază imaginea în containerul app-ului și deschide ruta direct:
  ```bash
  C=$(xcrun simctl get_app_container booted com.ax.documente data)
  cp test.jpg "$C/Documents/"
  xcrun simctl openurl booted "com.ax.documente://cropper?uri=<file-uri-encodat>&requestId=x"
  ```
- **Deep-link-urile `com.ax.documente://entitati/<id>` nu navighează în dev client** — navighează prin `snapshot_ui` + `tap`.
- **Derularea sare la capătul listei** (`swipe` și `idb ui swipe` lasă inerție pe ScrollView): ia `frame.y` din `idb ui describe-all`, fă swipe lent (`--duration 5 --delta 2`) și re-citește poziția. Rândurile fără `accessibilityRole` nu apar ca ținte în `snapshot_ui` — tap pe coordonate cu `idb ui tap`.
- **Mărimea textului:** verifică `xcrun simctl ui <udid> content_size` înainte de capturi; la o mărime „accessibility-*" layout-ul nu e reprezentativ. După ce o schimbi, relansează aplicația (layout-ul vechi rămâne în cache).
- **Date de test:** inserează direct în `<container>/Documents/SQLite/documente.db` (vehicles / documents / document_entities) și **șterge-le la final**.
- **Simulator agățat** (launch/listapps nu răspund după un boot întrerupt): `xcrun simctl shutdown all`, apoi `killall -9 com.apple.CoreSimulator.CoreSimulatorService`, apoi build_run_sim din nou.
- **Erori de linker / `.pcm` la build:** secvența de cleanup din `.claude/lessons/2026-04-22-ios-linker-pcm.md` (Clean Build Folder nu ajunge).
- **Nu merg în simulator:** iCloud Documents / CloudKit sharing complet, notificări push reale, biometrie reală. Pentru acestea → device fizic; spune explicit în raport ce n-ai putut verifica.

## Raport

În secțiunea „Verificat colateral" din mesajul final, pentru fiecare ecran: ce ai făcut (tap-uri, theme switch) + ce ai văzut. Dacă build-ul sau simulatorul n-a pornit: „NU am verificat UI pentru că …" — niciodată „gata" doar pe baza type-check-ului.
