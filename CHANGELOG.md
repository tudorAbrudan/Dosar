# Changelog

Toate modificările notabile ale aplicației Dosar sunt înregistrate aici.

Formatul respectă [Keep a Changelog](https://keepachangelog.com/) și versionarea
[Semantic Versioning](https://semver.org/). Generat automat de
[`standard-version`](https://github.com/conventional-changelog/standard-version)
din commits convenționale (`feat`, `fix`, `refactor`, `docs`, etc.).

Rulează:

```bash
npm run release          # bump auto (patch/minor/major) din commits
npm run release:dry      # preview fără modificări
```

## [3.5.2] (2026-05-18) — build 56

### Adăugat
- **Cropper de perspectivă in-app** (`expo-perspective-crop` module nativ iOS): ecran `/cropper` dedicat care înlocuiește flow-ul implicit al scanner-ului — corecție de perspectivă cu 4 colțuri manipulabile + Vision framework pentru detecție automată. Bridge promise-based (`services/cropperBridge.ts`) integrat cu Expo Router.
- **Vision provider separat de chat** (Setări → Asistent AI): toggle nou „Modelul de chat suportă imagini" + secțiune dedicată pentru provider OCR distinct. Util pentru combinații chat-pe-Mistral-free + OCR-pe-Claude-Haiku.
- **Certificat de botez** ca tip complet suportat: 5 câmpuri structurate (`subject_name`, `baptism_date`, `baptism_name`, `godparents`, `church`) extrase de AI (Vision + text) și de regex fallback. Distincție explicită între data botezului (eveniment istoric) și data eliberării certificatului.

### Reparat
- **Certificat de înregistrare PFA**: extragerea CUI / nr. registru comerțului / denumire firmă nu mai pierdea valorile pe formatul „Cod Unic de Înregistrare: NNNNN" și pe registrul de comerț cu prefix F (PFA) — regex-urile + promptul AI primesc acum scheme explicite pentru certificat_inregistrare + autorizatie_activitate + act_constitutiv + certificat_tva + asigurare_profesionala (anterior toate 5 erau goluri în prompt).

### Modificat
- **Refactor `AiExternalProviderConfig`**: separat secțiunea Vision într-o componentă proprie (`AiVisionProviderSection`), simplificare logică `canDoVision`.

## [3.5.0] (2026-05-12)

Baseline — istoricul anterior a fost capturat în taguri git și commit messages.
Începând cu versiunile următoare, fiecare release va popula automat această secțiune.

### Highlights (recap)
- Faza 2 cloud backup în iCloud (manifest + snapshots + criptare opțională)
- AI document classification pipeline (mistral/openai opt-in)
- Eliminat feature medical (3.5.0-53)
- Auto-activare tipuri document detectate de AI

[3.5.0]: https://github.com/tudorAbrudan/Dosar/releases/tag/v3.5.0
