---
date: 2026-03-15
tags: [security, env, secrets, api-keys, expo]
trigger: storing API keys in EXPO_PUBLIC_* env vars
---

# Cheile API nu se pun în `EXPO_PUBLIC_*`

## Problemă
Cheia API Mistral stocată ca `EXPO_PUBLIC_MISTRAL_API_KEY` — variabilele `EXPO_PUBLIC_*` sunt bundle-uite în aplicație și vizibile oricui dezasamblează APK/IPA.

## Cauză
Confuzie între variabile de build (sigure) și variabile runtime expuse în bundle.

## Regulă
Nicio cheie API externă (Mistral, OpenAI, etc.) NU se pune în `EXPO_PUBLIC_*`.

Alternative corecte:
1. Proxy server propriu (preferat pentru producție).
2. User introduce cheia manual în setările aplicației, stocată în `expo-secure-store`.

## Aplicabil
`services/chatbot.ts`, orice serviciu care apelează API extern.
