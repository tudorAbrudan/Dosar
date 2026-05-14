---
date: 2026-04-22
tags: [ios, build, pods, xcode, linker, pcm]
trigger: linker errors or .pcm not found after version bump or Xcode/SDK update
---

# iOS linker / pcm errors după version bump sau update Xcode

## Simptome
- `Undefined symbols for architecture arm64: facebook::react::Sealable::Sealable()` referenced from `libExpoModulesCore.a`
- `Module file 'UIKit-XXXXX.pcm' not found: module file not found`
- Alte erori tip „missing framework" sau mismatch între React-Fabric și ExpoModulesCore

## Cauză
DerivedData + ios/Pods + ios/build conțin obiecte compilate împotriva unor headere React Native / SDK iOS vechi. Un `Clean Build Folder` din Xcode (⇧⌘K) NU curăță `ModuleCache.noindex` și nici Pods. `Podfile.lock` ↔ `Pods/Manifest.lock` pot fi în sync și totuși obiectele compilate să fie stale.

## Fix complet (ordinea contează)

```bash
# 1. Oprește Xcode complet (nu doar close workspace)
osascript -e 'quit app "Xcode"'

# 2. Șterge toate cache-urile native
rm -rf ~/Library/Developer/Xcode/DerivedData/Dosar-*
rm -rf /Users/ax/work/documents/app/ios/build
rm -rf /Users/ax/work/documents/app/ios/Pods

# 3. Reinstalare Pods (păstrează Podfile.lock → versiuni pinned)
cd /Users/ax/work/documents/app/ios && pod install

# 4. Rebuild
cd /Users/ax/work/documents/app && npm run ios
```

## De ce NU merge doar Clean Build Folder în Xcode
- Clean Build Folder atinge doar `Products` și `Intermediates`, nu `ModuleCache.noindex` unde stau `.pcm`.
- `ios/Pods/` rămâne intact și referințele sale pot fi stale față de React prebuilts.

## Variante mai puțin agresive (încearcă în ordine)
1. Doar `rm -rf ~/Library/Developer/Xcode/DerivedData/Dosar-*` + Clean Build Folder în Xcode.
2. Dacă nu merge: adaugă `rm -rf ios/Pods && cd ios && pod install`.
3. Dacă tot nu merge: ștergi și `ios/Podfile.lock` apoi `pod install --repo-update` (ultim resort — upgrade de versiuni).

## Regulă
- După version bump pe `app.json`/`Info.plist` → NU e nevoie de cleanup, doar rebuild.
- După `expo prebuild --clean`, upgrade Xcode, upgrade Expo SDK, sau modificări în Podfile → full cleanup ca mai sus.
- Dacă Xcode dă „module X.pcm not found" → full cleanup imediat, nu pierde timp căutând.
