# DB Audit – /db-audit

Auditează schema și queries SQLite pentru performanță și siguranță.

## Pași

### 1. Citește schema curentă
Citește `/Users/ax/work/documents/app/services/db.ts` complet.

### 2. Verifică indexuri
Compară tabelele și coloanele frecvent filtrate cu indexurile existente.
Coloane care trebuie să aibă index:
- `documents.expiry_date` (pentru Expirări)
- `documents.person_id`, `vehicle_id`, `property_id`, `card_id`, `animal_id` (pentru filtrare pe entitate)
- `document_pages.document_id` (pentru încărcare pagini)
- `fuel_records.vehicle_id` (pentru statistici combustibil)

### 3. Verifică migrări
Toate coloanele adăugate ulterior trebuie să aibă try-catch. Verifică că nu lipsește niciuna.

### 4. Verifică queries
Caută `services/documents.ts`, `services/entities.ts`, `services/fuel.ts` pentru:
- String interpolation în queries (RISC SQL injection)
- Queries fără LIMIT pe tabele mari
- N+1 patterns (query în loop)

### 5. Raport
- Indexuri lipsă
- Queries problematice (fișier:linie)
- Migrări fără try-catch
- Recomandări

Nu face modificări automat — raportează și întreabă.
