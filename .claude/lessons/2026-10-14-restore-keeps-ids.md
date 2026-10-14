---
date: 2026-10-14
tags: [backup, restore, sqlite, cloudkit, sharing, ids, testing, regression]
trigger: cod care reinserează date dintr-un backup / manifest, sau care referă rânduri locale din afara SQLite (CloudKit, calendar, deep-link)
---

# Restaurarea păstrează ID-urile; registrele externe referă rândurile prin ID

## Problemă
Restaurarea din iCloud recrea fiecare rând cu un ID nou și contopea entitățile cu
același nume. Două vehicule „Dacia" deveneau unul, cu documentele și alimentările
amândurora. Partajările CloudKit (zona `entity_<tip>_<id>`, recordurile
`<doc>__p__<pagină>`) și linkurile din calendar (`acte:///documente/<id>`) rămâneau
legate de ID-uri care nu mai existau: duplicate la participanți, partajări orfane
fără „Revocă".

## Cauză
Importul aditiv (ZIP peste date existente) și restaurarea cu înlocuire foloseau
aceeași logică de dedupe + ID nou. La restaurare baza e goală, deci dedupe-ul nu
avea ce proteja și doar strica identitatea rândurilor.

## Regulă
- **Restaurare cu înlocuire:** ID-ul din manifest se păstrează, fără dedupe
  (`services/restoreIds.ts`: lipsă → ID nou, duplicat → prima apariție câștigă).
- **Import aditiv:** dedupe doar față de datele dinainte de import; ID-ul original
  se păstrează când e liber, adică nu e în tabel și nu e cunoscut de registrul de partajare.
- **O restaurare care păstrează ID-urile se potrivește cu registrele externe.**
  Asta e scopul, dar e și un risc: mutațiile din timpul restaurării NU se împing în
  zone (`isRestoreInProgress`, verificat sincron la locul apelului), iar starea de
  sync a registrului se resetează în aceeași tranzacție (`resetShareStateAfterWipe`).
- **`import()` dinamic nu rulează în Jest** în configurația proiectului (lipsește
  transformarea). Codul din spatele lui (hook-uri de partajare, rebuild FTS) nu e
  exersat de teste. O gardă care trebuie să țină se testează prin efectul ei
  sincron sau se păzește cu un audit script (`restore-share-isolation-audit`).

## Aplicabil
`services/backup.ts` (`applyManifest`, `deleteAllUserData`), orice tabel nou cu
FK-uri sau cu referințe din CloudKit / calendar / notificări.
