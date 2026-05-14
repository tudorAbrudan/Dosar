---
date: 2026-04-20
tags: [react-native, ios, navigation, alert, expo-router]
trigger: white screen after Alert with navigation in callback
---

# `router.push` din `Alert.alert` callback → ecran alb (iOS)

## Problemă
`router.push` apelat din callback-ul `onPress` al unui `Alert` pe iOS cauzează ecran alb la revenirea pe ecranul anterior.

## Cauză
Navigarea pornește în timp ce animația de dismiss a Alert-ului încă rulează. iOS capturează un snapshot al ecranului în mijlocul tranziției → ecran alb/gol.

## Regulă
Orice navigare declanșată din `Alert.alert` `onPress` → împacheteaz-o în:

```ts
InteractionManager.runAfterInteractions(() => router.push(...));
```

Niciodată `router.push` direct în callback Alert.

## Aplicabil
Orice loc unde `Alert.alert` + navigare sunt combinate.
