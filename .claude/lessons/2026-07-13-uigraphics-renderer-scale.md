---
date: 2026-07-13
tags: [ios, swift, native-module, exif, coreimage, uikit, crop]
trigger: cod nativ iOS care redesenează un UIImage (normalizare EXIF, resize, watermark) sau primește coordonate pixel din JS
---

# UIGraphicsImageRenderer folosește scala ecranului, nu 1×

## Problemă

User report: la „Decupează documentul" selecta tot permisul, dar imaginea salvată
era doar colțul stânga-sus, mărit ~3×. Nereproductibil local — doar pe pozele
făcute direct cu camera iPhone (EXIF orientation ≠ up).

## Cauză

`normalizedCGImage` din `modules/expo-perspective-crop/ios/ExpoPerspectiveCropModule.swift`
redesena imaginea pentru a „coace" orientarea EXIF cu:

```swift
let renderer = UIGraphicsImageRenderer(size: image.size)  // BUG
```

Format-ul default al `UIGraphicsImageRenderer` are `scale = UIScreen.main.scale`
(3× pe iPhone-urile moderne) → CGImage-ul rezultat e de 3× dimensiunile pe care
le vede JS-ul (`RNImage.getSize` returnează dimensiuni orientate 1×). Colțurile
trimise din JS acopereau doar 1/3 × 1/3 din imagine; flip-ul Y pentru CoreImage
(origine bottom-left) ancora regiunea sus-stânga → crop = nona stânga-sus.

Fast-path-ul (`imageOrientation == .up`) nu trecea prin renderer, de-aici
nereproductibilitatea: screenshots, poze WhatsApp, imagini re-encodate au
orientation up; doar pozele de cameră native păstrează tag-ul EXIF.

## Regulă

Orice redesenare de `UIImage` în module native care produce pixeli pentru
coordonate/procesare (nu pentru afișare) TREBUIE să fixeze scala explicit:

```swift
let format = UIGraphicsImageRendererFormat()
format.scale = 1
let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
```

Test de reproducere: JPEG cu EXIF orientation 6 (generat cu ImageIO,
`kCGImagePropertyOrientation: 6`), `simctl addmedia`, apoi fluxul de crop.
Simetric: orice coordonate întoarse din nativ către JS (ex. `detectCorners`)
trebuie să fie în același spațiu 1× orientat pe care îl vede `RNImage.getSize`.

## Aplicabil

- `modules/expo-perspective-crop/ios/ExpoPerspectiveCropModule.swift`
  (`cropPerspective` + `detectCorners` — ambele trec prin `normalizedCGImage`)
- Orice modul nativ viitor care primește/întoarce coordonate pixel din/către JS
