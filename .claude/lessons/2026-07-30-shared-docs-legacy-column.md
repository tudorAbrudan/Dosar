---
date: 2026-07-30
tags: [sqlite, sharing, cloudkit, junction-table, regression, entity-links]
trigger: date care intră în aplicație din exterior (partajare, import, sync) și nu apar pe ecranul care ar trebui să le arate
---

# Datele primite din exterior trebuie scrise pe TOATE căile pe care UI-ul citește

## Problemă
Entitate primită prin partajare CloudKit apărea în lista Entități, dar ecranul ei
arăta „fără documente" — deși documentele erau deja în SQLite, corect inserate.

## Cauză
Legătura document↔entitate există în două forme:
- `document_entities` (junction, sursa completă);
- `documents.<tip>_id` (denormalizare a PRIMULUI link de acel tip).

`cloudShare.applyDocumentRow` scria doar în junction. Ecranul entității
(`app/(tabs)/entitati/[id].tsx` → `getDocumentsByEntity`) citea doar coloana
legacy. Ambele „corecte" individual, incompatibile împreună. Nicio eroare,
niciun log — doar o listă goală, care arăta identic cu „sincronizarea nu merge"
și a trimis debugging-ul în direcția greșită (CloudKit, în loc de un `WHERE`).

## Regulă
Când adaugi o cale prin care datele **intră** în aplicație (partajare, import
backup, sync, share extension), pentru fiecare tabel atins întreabă:
**cine citește asta și pe ce coloană?** `Grep` pe numele tabelului și pe fiecare
coloană de legătură. Dacă un consumator citește pe altă cale decât cea pe care
scrii, ai un bug invizibil, nu o diferență de stil.

Pentru legătura document↔entitate, concret:
- citire → `getDocumentsByEntity()` (acoperă ambele căi, cu `EXISTS` pe junction);
- scriere → junction + backfill pe coloana legacy când e `NULL` (ca
  `addEntityLinkToDocument`);
- verificare → `node scripts/entity-doc-links-audit.js --strict`.

## Aplicabil
Orice tabel cu date denormalizate în paralel cu sursa normalizată. Un simptom de
tip „datele sunt acolo, dar ecranul e gol" e aproape întotdeauna o divergență
scriere/citire, nu un transport rupt.
