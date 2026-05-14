---
date: 2026-03-23
tags: [expo, prebuild, ios, deployment-target, podfile]
trigger: pod install failure during expo prebuild due to deployment target mismatch
---

# `expo prebuild --clean` + iOS deployment target

## Problemă
`npm run prebuild` eșua cu `CocoaPods could not find compatible versions for pod "RNMLKitTextRecognition"` (cere iOS ≥ 15.5, default prebuild este 15.1).

## Cauză
`expo prebuild --clean` regenerează `Podfile.properties.json` cu default `15.1`, rulează `pod install` intern (care eșuează), iar scriptul `postprebuild` care patchează la 16.0 vine prea târziu.

## Fix aplicat
Instalat `expo-build-properties` (~55.0.10) și configurat în `app.json` plugins:

```json
["expo-build-properties", { "ios": { "deploymentTarget": "16.0" } }]
```

Plugin-ul setează `ios.deploymentTarget` în `Podfile.properties.json` **înainte** de `pod install`. Scriptul `postprebuild` a fost eliminat din `package.json`.

## Regulă
Orice setare care trebuie să existe înaintea `pod install` → folosește `expo-build-properties` plugin, nu `postprebuild` npm script.
