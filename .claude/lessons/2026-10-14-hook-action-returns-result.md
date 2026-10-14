---
date: 2026-10-14
tags: [react, hooks, async, state, error-handling, backup, regression]
trigger: un handler din UI face `await hook.actiune()` și apoi citește `hook.status` / `hook.error`
---

# Acțiunile din hook-uri întorc rezultatul; UI-ul nu citește starea după `await`

## Problemă
Pe ecranul iCloud Backup, „Backup acum" afișa „Backup finalizat." și când backup-ul
eșua, inclusiv când cerea parola de criptare. Un succes venit după un eșec afișa
eroarea veche.

## Cauză
`handleBackupNow` făcea `await cloud.backupNow()` și apoi citea `cloud.status` și
`cloud.error`. `cloud` e obiectul din render-ul în care s-a creat handler-ul.
`setState` din hook nu schimbă o variabilă deja capturată, deci după `await`
handler-ul vedea starea de dinainte de apăsare. `backupNow()` nu întorcea nimic,
așa că UI-ul nu avea altă sursă.

## Regulă
- O acțiune async dintr-un hook (backup, restore, sync, import) **întoarce un rezultat
  explicit** (`{ ok, error, ... }`). UI-ul decide alerta sau următorul pas DIN rezultat.
- Starea hook-ului (`status`, `error`) e doar pentru randare, nu pentru decizii luate
  imediat după `await`.
- Logica acțiunii stă într-un serviciu pur care nu aruncă (`runBackupNow` în
  `services/cloud/backupNow.ts`), testat de caracterizare. Hook-ul doar o leagă de
  `setState`.
- Un no-op tăcut (iCloud indisponibil, sesiune blocată) e un rezultat cu `error`,
  nu un succes.

## Aplicabil
`hooks/useCloudBackup.ts` (`backupNow`) și orice hook nou care expune acțiuni
async consumate de un handler cu `Alert`.
