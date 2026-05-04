# Documente personale – App

Aplicație React Native + Expo (TypeScript) pentru gestionarea documentelor personale (acte, mașini, proprietăți, carduri). Plan: [../PLAN.md](../PLAN.md).

App **local-first**: date în SQLite pe device, fișiere locale, backup în iCloud/Google Drive. Fără backend, fără login online.

## Funcționalități

<!-- DOSAR:APP_FEATURES_START -->
- Blocare Face ID / Touch ID / PIN
- Notificări locale de expirare (configurabile)
- Organizat pe Persoane / Vehicule / Proprietăți / Carduri / Animale / Firme
- Backup complet în iCloud / Drive și transfer între dispozitive
- Export reminder expirare în calendarul nativ
- Scanner nativ multi-pagină cu detecție margini (VisionKit / ML Kit)
- OCR on-device pentru extragere automată de text
- Tracker auto (RCA, ITP, CASCO, Vignetă, Talon)
- Remindere mentenanță vehicul (km + luni) cu sync calendar
- Documente veterinare per animal (vaccin, deparazitare, vizite)
- Câmp „Notă privată" per document (CVV/PIN/parole) — nu pleacă niciodată la AI
- Detecție duplicate la adăugare și afișare în detaliu (fișier identic + tip+entitate)
- Asistent AI local-aware (chatbot cu context din documentele tale)
  <!-- DOSAR:APP_FEATURES_END -->

> Lista de mai sus și paginile `docs/index.html` / `docs/support.html` sunt generate automat din `scripts/update-site.js` (manifestul `FEATURES` + `types/index.ts`). Rulează `node scripts/update-site.js` după orice schimbare de feature/tip de document.

## Pornire

```bash
cd app
npm install
npm start          # expo start --clear
```

- **iOS:** `npm run ios` sau scan QR în Expo Go
- **Android:** `npm run android` sau scan QR

## Calitate cod

```bash
npm run type-check    # TypeScript
npm run lint          # ESLint
npm run format        # Prettier
```

## Structură

- `app/` – rute Expo Router (tabs: Acasă, Entități, Documente, Expirări, Setări)
- `components/` – componente UI reutilizabile
- `theme/` – design system (primary color, spacing, palete light/dark)
- `constants/` – culori, temă navigare
- `services/` – SQLite (db.ts), entități, documente, backup, notificări, OCR, chatbot
- `hooks/` – useDocuments, useEntities, useAppLock, useFilteredDocTypes
- `types/` – tipuri TypeScript + `DOCUMENT_TYPE_LABELS`
- `scripts/update-site.js` – sincronizare automată docs/

## Design

Design system: [../docs/DESIGN_SYSTEM.md](../docs/DESIGN_SYSTEM.md). Primary color: vezi `theme/colors.ts` (export `primary`).
