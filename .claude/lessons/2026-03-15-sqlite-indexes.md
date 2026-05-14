---
date: 2026-03-15
tags: [sqlite, performance, indexes, db-migration]
trigger: creating SQLite tables without indexes on filter columns
---

# SQLite: indexuri pe coloanele frecvent filtrate

## Problemă
Schema SQLite inițială fără indexuri pe coloanele frecvent filtrate (`expiry_date`, `person_id`, `vehicle_id`, etc.) — queries lente pe date mari.

## Cauză
La MVP, datele sunt puține și problema nu e vizibilă; indexurile se uită.

## Regulă
La crearea oricărei tabele noi cu coloane de filtrare/sortare frecventă, adaugă imediat:

```sql
CREATE INDEX IF NOT EXISTS idx_<tabel>_<coloana> ON <tabel>(<coloana>);
```

Coloane care necesită index:
- Foreign keys (`person_id`, `vehicle_id`, etc.)
- Date de expirare
- Orice coloană folosită în `WHERE`

## Aplicabil
`services/db.ts`, orice migrare nouă.
