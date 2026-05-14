---
date: 2026-04-20
tags: [react-native, ios, navigation, image, expo-router]
trigger: local image goes blank after navigating away and back
---

# Image rerender alb după navigare push/pop (iOS)

## Problemă
`<Image source={{ uri: 'file://...' }}>` apare alb când ecranul revine în focus după `router.push` → Back.

## Cauză
React Native pe iOS refolosește render-ul vechi al componentei `Image` fără a reîncărca sursa locală. Componenta nu se demontează/remontează la revenirea din navigare.

## Regulă
Pentru orice ecran care afișează imagini locale și poate fi navigat away + back:

1. Adaugă `useFocusEffect` care incrementează un `refreshKey` state.
2. Pasează `refreshKey` la componenta de imagini.
3. Include-l în `key`-ul wrapper-ului `View` (`key={id + '_' + refreshKey}`).

Asta forțează remontarea `Image` la fiecare revenire.

## Aplicabil
Orice componentă cu `<Image source={{ uri: localPath }}>` pe ecrane cu navigare push/pop.
