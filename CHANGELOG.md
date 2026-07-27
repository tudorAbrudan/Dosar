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

## [3.10.1] (2026-07-27) — build 69

### Reparat — Partajare entități (recepția la destinatar)
- **Entitatea partajată apare acum și la destinatar.** Până acum, cine primea o partajare accepta invitația, dar entitatea nu se afișa: partea de recepție nu era conectată. Acum, la deschiderea ecranului Partajare, zonele acceptate sunt descoperite și sincronizate automat, iar entitatea + documentele ei apar în aplicație. Când proprietarul revocă accesul, partajarea primită se curăță local (ce s-a văzut deja rămâne).
- Link de invitație public read-only (`.readOnly`): un link trimis pe WhatsApp/Messages dă acces la citire, nu doar invitațiile punctuale pe Apple ID.
- Robustețe: revocarea tolerează zonele deja șterse pe server (nu mai rămâi blocat pe „Revocă"); starea locală se salvează doar după ce partajarea reușește (fără intrări orfane); mesaje de eroare CloudKit traduse în română.

## [3.10.0] (2026-07-23) — build 67

### Adăugat — Partajare entități între conturi (Beta)
- **Partajează o entitate cu familia prin iCloud** (Setări → Partajare): entitatea aleasă (persoană, vehicul, proprietate, animal, firmă) + documentele ei se sincronizează live între conturi iCloud, cu revocare oricând. Documentele medicale, notele private și cardurile rămân strict pe dispozitivul tău. Funcție în Beta — sincronizarea live între conturi se validează la testarea pe două dispozitive.

## [3.9.0] (2026-07-13) — build 66

### Adăugat — iOS Share Extension
- **Distribuie din alte aplicații direct în Dosar**: din Photos, Safari, Files, WhatsApp etc. poți folosi „Distribuie" → „Dosar" și fișierul (imagine sau PDF) ajunge direct pe ecranul de adăugare document — imaginile trec prin cropper ca la scanare normală, PDF-urile se atașează direct.
- Serviciu dedicat de ingest care validează și clasifică fișierele primite prin share intent înainte de a le trimite spre ecran; indicator de progres opțional în header-ul cropper-ului pentru distribuiri cu mai multe pagini/imagini.
- Reparat: o cursă (race condition) în `expo-share-intent` care putea pierde imagini la distribuiri multiple simultane; scalare forțată la 1 în randarea de normalizare EXIF (afecta crop-ul cu perspectivă).

### Adăugat — „Din Fișiere" ca sursă de imagine
- Ecranele de adăugare, editare și detaliu document au acum opțiunea „Din Fișiere" pe lângă cameră/galerie, pentru a atașa o imagine direct din aplicația Files.
- Aceeași sursă e disponibilă și la adăugarea unui bon de combustibil, cu normalizare JPEG pentru compatibilitate cu AI vision.

### Reparat — Interfață
- Selectorul de entități la adăugarea unui document nu mai blochează legarea la mai multe categorii deodată (ex. persoană + vehicul pe același document) — după prima entitate legată, celelalte categorii rămâneau inaccesibile.
- Buton „Adaugă atașament" expus și pe ecranul de detaliu document.

## [3.8.6] (2026-07-05) — build 65

### Reparat — Fiabilitate backup & restore (review adversarial 2026-07-04)
- **Restore complet fidel:** dosarul medical rămâne vizibil după restaurare (ID-urile persoanelor/documentelor sunt remapate corect în observații, sumaruri și dosare), legăturile document↔entitate (inclusiv multi-link și dosar medical) sunt incluse în backup și restaurate, notițele private și regula de auto-ștergere nu se mai pierd, documentele distincte cu același tip și aceleași date nu mai sunt colapsate la restore. Snapshot local de siguranță înainte de orice restore din iCloud.
- **Ștergeri curate:** ștergerea unui document șterge acum și fișierele de pe disc + paginile + legăturile (nu mai reapar în iCloud); ștergerea dosarului medical curăță în cascadă observațiile, conversațiile și share-urile (foreign keys active + curățare automată a orfanilor istorici).
- **Criptare iCloud retroactivă:** la activarea criptării, fișierele deja urcate se recriptează automat la următoarea sincronizare (pornește imediat); avertisment la export ZIP peste 300MB.

### Reparat — AI & model local
- Documentele medicale și cele sensibile (buletin, pașaport, card) nu mai pot fi trimise la un AI extern fără consimțământul dedicat; pe modelul local nimic nu părăsește telefonul. Text de consimțământ actualizat, onest despre cazul scanurilor ilizibile.
- Anularea descărcării unui model local nu mai lasă asistentul blocat pe un model inexistent; descărcările întrerupte nu mai apar ca „descărcate"; comutarea providerului în timpul unei analize nu mai poate închide aplicația.
- Asistentul anunță când vede doar o parte din documente („primele 6 din 30") și erorile tehnice apar acum ca mesaje clare în română.

### Reparat — Interfață
- Dismiss-ul unui reminder din Expirări se reflectă acum și pe Acasă și în notificări; statusul ITP de pe Acasă folosește aceeași logică ca ecranul vehiculului (inclusiv ștampila de pe talon).
- „Notificări de expirare" (fost „Notificări push"), ecranul 404 în română, butoane „Anulează" uniforme, „Remindere" în loc de „Reminders", răspunsurile chatbotului sincronizate cu funcțiile reale ale aplicației.

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
