---
name: backup-audit
description: Auditează sincronizarea backup-ului local (ZIP) + cloud (iCloud) cu schema SQLite. Folosește-l după orice modificare în services/db.ts, backup.ts sau cloudSync.ts, sau când userul cere „verifică backup-ul".
---

Rulează `node scripts/backup-audit.js` și prezintă raportul.

Dacă raportul indică `DESINCRONIZAT`:
1. Pentru fiecare tabel lipsă, propune patch concret pentru `cloudSync.ts:buildManifestPayload`, `backup.ts:exportBackup`, `backup.ts:applyManifestBody` și `backup.ts:wipeUserData`.
2. Pentru fiecare coloană fișier fără backfill sau collector, propune migrarea în `db.ts` și extinderea `collectFileNamesFromPayload`.
3. Nu aplica patch-urile fără confirmare. Pentru implementare folosește agentul `backup-guardian`.

Dacă raportul indică `OK`, confirmă că schema, manifestul cloud și manifestul ZIP sunt sincronizate.

Dacă s-a atins schema: după fix, `npm run test:characterization` (lock-uiește restore-ul) și, pentru date persistente, export + import backup testat manual.
