---
date: 2026-10-15
tags: [cloudkit, sharing, sync, echo, deletion, data-loss]
trigger: cod care aplică ștergeri primite dintr-o zonă CloudKit în care scrie și telefonul curent
---

# Pull-ul propriei zone întoarce și propriile ștergeri

## Problemă
Owner cu partajare „Poate edita": dezlega un document de entitatea partajată, iar la
sync-ul următor documentul dispărea complet de pe telefonul lui. Nicio eroare.

## Cauză
Dezlegarea trimite un tombstone în zonă. Owner-ul trage și propria zonă (ca să primească
editările participantului), iar `fetchZoneChanges` întoarce TOATE schimbările de după token,
inclusiv pe cele făcute de același telefon. `applyDeletions` trata tombstone-ul ca pe o
ștergere venită de la participant: scotea legătura, nu mai găsea nicio zonă pentru document
și îl ștergea local. Supresia de ecou exista doar pentru recordurile modificate
(`shouldApplyRecord`, pe `change_tag`), nu și pentru ștergeri.

## Regulă
Orice ștergere aplicată dintr-o zonă în care scrii și tu are nevoie de supresie de ecou.
Aici: push-ul reușit de `delete` scoate rândul din `cloud_records`, deci o ștergere fără
evidență = propriul ecou → ignorată. Ștergerile participantului au încă evidență.

## Aplicabil
`services/cloudShare.ts` (`applyDeletions`), orice semnal nou transmis prin ștergeri de
recorduri (ex. ștergerea entității „și la ei").
