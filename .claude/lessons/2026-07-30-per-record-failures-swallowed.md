---
date: 2026-07-30
tags: [cloudkit, error-handling, batch, diagnostics, sharing]
trigger: API care întoarce rezultate per-element (succeeded/failed) dintr-un batch
---

# `{ succeeded, failed }` — a citi doar `succeeded` e o eroare, nu o simplificare

## Problemă
`shareEntity` partaja o entitate, arăta bifa verde și dădea userului un link.
La celălalt telefon nu ajungea nimic — nici entitate, nici documente, nicio
eroare, în niciunul din cele două device-uri.

## Cauză
`pushRecords` (CKModifyRecordsOperation cu `atomically: false`) întoarce
rezultate **per record**: `{ succeeded, failed }`. Codul destructura doar
`succeeded`. Orice eșec per-record (schemă CloudKit nepublicată în Production,
quota iCloud plină, asset lipsă) dispărea tăcut — se crea un CKShare peste o
zonă goală, plus rânduri în `cloud_records` care pretindeau că datele sunt pe
server (deci și push-urile incrementale ulterioare porneau de la o premisă falsă).

## Regulă
La orice API cu rezultate per-element, `failed` se tratează explicit, în trei pași:
1. **Eșecul care invalidează operația** (aici: record-ul rădăcină) → aruncă
   ÎNAINTE de partea ireversibilă/vizibilă (aici: prezentarea invitației).
2. **Eșecul parțial** → pune elementul în coada de retry și marchează eroarea pe
   entitatea afectată, ca să fie vizibilă în UI.
3. **Bookkeeping doar pentru ce a reușit** — nu înregistra ca „sincronizat" ce a
   picat.

Corolar pentru mesaje: într-un feature Beta, `friendlyCloudKitMessage` păstrează
textul brut al erorii în fallback. Un „Reîncearcă" generic a costat deja o rundă
de debugging pe două telefoane.

## Aplicabil
`pushRecords`, `modifyRecords`, orice batch API (CloudKit, upload multiplu,
`Promise.allSettled`).
