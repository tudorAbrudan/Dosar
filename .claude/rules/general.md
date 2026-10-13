# Reguli generale

- **Limbă UI:** Toate textele vizibile utilizatorului sunt în română.
- **Platformă:** Apple-only (iOS). Android nu se livrează — nu-l lua în calcul la decizii de arhitectură, chiar dacă mai există `npm run android` / folderul `android/`.
- **Stack:** React Native + Expo (TypeScript). Comenzi Expo (`npm start` = `expo start --clear`), niciodată `react-native start`.
- **Local-first:** SQLite pe device e sursa de adevăr; fișiere în `expo-file-system`. Fără login/cont propriu.
  - Backup: ZIP manual + iCloud Drive (`cloudSync.ts`). Partajare household: CloudKit (`CKShare`/`CKSyncEngine`).
  - Singura componentă server: `ai-proxy/` (proxy AI pe Danube Rapids; cheia Mistral stă acolo, nu în bundle). Nu adăuga alt backend fără decizie explicită în `../PLAN.md`.
- **Plan first:** La orice task cu 3+ pași sau mai multe fișiere: citește, listează fișierele, prezintă planul, implementează.
- **Done = dovedit:** UI → văzut în simulator/device (XcodeBuildMCP). Logică → teste / audit scripts.
- **Repo PUBLIC** (`tudorAbrudan/Dosar`, GitHub Pages din `docs/`): nu pune în repo chei, date personale sau note interne. `../PLAN.md` și `../docs/` sunt în afara repo-ului intenționat.
