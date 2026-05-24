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

## [3.8.0] (2026-05-24) — build 59

### Adăugat — Rezumat AI + Reminders în calendar pentru documente medicale
- **Rezumat AI** generat automat la upload pentru documente medicale (scrisori medicale, bilete externare, fișe consultație, bilete trimitere, analize, imagistică). Apare ca secțiune dedicată „Rezumat AI" pe document, formatat cu titluri și bullets — recomandări verbatim + valori out-of-range (ex: „Hb 13 — sub limita 13.2"). Independent de chat-ul medical (nu intră în context AI).
- **Modal Reminders în Calendar:** la prima vizitare a dosarului medical sau a documentului, dacă AI-ul a detectat recomandări cu termen explicit („control la 12 luni"), apare un modal cu listă bifabilă. Confirmarea adaugă evenimente în iOS Calendar / Google Calendar cu titlu, sursă (document + dată), nume dosar și link spre site-ul aplicației.
- **Buton „Re-extrage AI (medical)"** pe documentele medicale — re-rulează extracția manual (util după ce userul a adăugat propria cheie AI sau corectat tipul). Auto-leagă la dosarul medical dacă există unul singur.
- **Timeline curățat:** doar analize și valori cu evoluție numerică. Recomandările și diagnosticele apar acum în Rezumat AI pe document, nu amestecate ca grupuri sparkline.
- **Tap pe valoare în Timeline → deschide documentul sursă** (cu picker dacă există mai multe surse).

### Reparat — clasificator și extracție
- `detectDocumentType` (heuristic-ul rapid de la OCR) detectează acum corect tipurile medicale: `scrisoare_medicala`, `bilet_externare`, `imagistica`, `analize_medicale`, `reteta_medicala`, `vaccin_persoana`. Înainte, cuvântul „Contract" dintr-un antet administrativ („Contract/convenție Nr X" pe scrisori medicale CNAS) clasifica greșit întreg documentul ca tip „Contract" → extracția medicală nu se mai declanșa niciodată.
- `aiClassifier` are regulă nouă de prioritate: titlul central al documentului bate keyword-urile răzlețe.
- Auto-link entitate filtrează acum prin `ENTITY_DOCUMENT_TYPES` — documente medicale nu mai sunt asociate accidental la „proprietate" pe potrivire de adresă.

### Privacy
- Audit script nou `medical-ai-summary-isolation-audit.js` care blochează la build orice scurgere de `ai_summary` / `pending_reminders_json` în context-ul chat / FTS.

## [3.6.0] (2026-05-21) — build 57

### Adăugat — Dosar medical (reintegrare completă)
- **Entitate nouă `Dosar medical`** (1:1 cu o persoană): listă în Entități, ecran detaliu cu 3 tab-uri (Timeline · Documente · Chat AI).
- **6 tipuri noi de documente medicale**: Rețetă medicală, Analize medicale, Scrisoare medicală, Bilet de externare, Imagistică, Vaccin persoană.
- **Extracție automată observații AI**: la scanarea unui document medical, AI-ul extrage valori (HDL, TSH, glicemie etc.) cu confidence threshold și le adaugă în Timeline. Categorii: lipide, hematologie, tiroidiene, hormonal, hepatice, renale, urinare, microbiologie, imunologie, biochimie, biometric, altele.
- **Timeline cu sparkline + indicator de interval**: per parametru, vezi evoluția în timp + culoare automată după referință (verde = în interval, portocaliu = ↑/↓, roșu = ↑↑/↓↓ peste 50%).
- **Chat AI scoped pe dosar** cu retrieval hibrid (FTS5 pe OCR + observații decriptate în memorie) și citații obligatorii `[OBS:id]` / `[DOC:tip|id]`.
- **Criptare AES-256-GCM** locală pentru observații + mesaje chat (cheie 256-bit în Keychain, AAD = medical_record.id). Toggle „Date medicale (Art. 9 GDPR)" în Setări → Asistent AI; consent per dosar la prima activare AI.
- **App Lock dedicat** pentru ecranele medicale (5 min timeout, independent de App Lock global). Toggle în Setări → Securitate.
- **Câmpuri pacient**: grupa sanguină, alergii (afișate prominent cu badge ⚠️), persoană de contact urgență (telefon tappable).
- **Backup cloud al cheii medicale** (opțional, default OFF): cheia AES e criptată cu parola cloud și inclusă în manifest — restore automat pe device nou.
- **Onboarding step opțional** pentru activarea AI medical.
- **Wizard migrare**: detectează persoanele cu documente medicale orfane (legacy `person_id`) și oferă crearea automată a dosarelor.

### Adăugat — alte îmbunătățiri
- **`Person.date_of_birth`** (data nașterii) — câmp opțional în editorul persoanelor, folosit pentru afișarea vârstei în detaliul dosarului medical.
- **Categorii biometrice** pentru observații: Greutate / Înălțime se urmăresc ca observații în timp (sparkline), nu ca atribut static.

### Reparat
- **Certificat naștere — varianta veche** ("REPUBLICA SOCIALISTĂ ROMÂNIA / CONSILIUL POPULAR") detectat și clasificat corect. 8 câmpuri extrase: CNP, părinți, data + locul nașterii, nr. înregistrare, serie certificat.
- **Certificat botez** — clasificare îmbunătățită (anti-confuzie cu certificat naștere) + 5 câmpuri noi extrase: father_name, mother_name, birth_date, document_number, priest_name.
- **Tipurile medicale care nu expiră** (analize, scrisoare medicală, bilet externare, imagistică) — eliminat câmpul „Data expirare" din formularul de adăugare.

### Schimbat
- Schema SQLite: 6 tabele noi (`medical_record`, `medical_observations`, `medical_chat_threads`, `medical_chat_messages`, `medical_document_summaries`, `medical_shares`) + virtual FTS5 `medical_fts` + 3 trigger-i sync summary→FTS. Backup local (ZIP) și cloud (iCloud manifest v13) propagă toate cele 6.

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
