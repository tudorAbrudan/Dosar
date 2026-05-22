# Spec — Partajare dosar medical cu medic (F8) prin link 1h criptat E2E

**Data:** 2026-05-22
**Status:** brainstormed
**Owner:** Tudor
**Estimat:** 2-3 săptămâni part-time
**Predecesor:** `2026-05-19-dosar-medical-merge-design.md` §6.6 (Doctor share)

---

## 1. Context

Faza 1 (medical merge, F1-F7) e implementată și lansată în versiunea 3.6.0. Userul are
acum dosare medicale cu observații extrase + Timeline + Chat AI. **Funcția
"Partajează cu medicul" e ultima piesă lipsă** pentru un flow complet pacient → doctor.

Schema DB e deja pregătită din F1: tabela `medical_shares` (id, medical_record_id,
created_at, expires_at, size_bytes, doc_count, obs_count, revoked_at) există în
`services/db.ts` cu indexuri corespunzătoare. Lipsesc serviciile, relay-ul de cloud,
viewer-ul static și UI-ul în app.

Spec-ul original (§6.6 din medical-merge) propunea Cloudflare Workers + R2.
**Schimbarea majoră în F8 vs spec original:** mutăm pe **EU hosting** pentru Art. 9 GDPR cleanliness.

---

## 2. Decizii (luate la brainstorming, 2026-05-22)

| # | Decizie | Motiv |
|---|---|---|
| D1 | **EU hosting (zero US transfer)** pentru date Art. 9, chiar criptate E2E | Eliminăm Schrems II + CLOUD Act + analiză transfer adecvat din privacy policy. Pentru €4/lună merită. |
| D2 | **Compute: Danubedata Rapids** (Falkenstein, Germania) | Serverless containere, Docker, free tier 2M req/lună. EU jurisdiction. DPA inclus. |
| D3 | **Storage: provider-agnostic la nivel cod**; alegere finală la deploy | Toate (Danubedata / Scaleway / OVH) sunt S3-compatible. Schimbi 3 env vars. |
| D4 | **Provider primar Storage: Danubedata Object Storage** (Falkenstein, DE) | €3.99/lună flat 1TB, DPA inclus, same provider ca compute = un singur cont/DPA |
| D5 | **Provider alternativ Storage: Scaleway Object Storage** (Paris, FR) | Free tier 75GB + 75GB egress. Alegere dacă vrem €0/lună absolut. EU. |
| D6 | **TTL fix 1h** pentru MVP | Configurabil în Faza 2 dacă apare cerere. |
| D7 | **Limită size: 100MB per share, max 50 documente** | Acoperă 95%+ din cazuri reale (15-25 documente medicale tipice). |
| D8 | **Pre-signed URLs pentru upload + download** | Blob-urile mari NU transit prin Rapids — direct pacient↔S3 și doctor↔S3. Rapids doar semnează URL-uri. Cost compute aproape zero. |
| D9 | **Viewer static** pe GitHub Pages (sub-path repo `tudorAbrudan.github.io/dosar-share/`) | Gratis, nu necesită cont extra. Mai târziu mutabil pe domain propriu. |
| D10 | **Feature flag "Beta share"** la launch | Buton ascuns implicit, activabil din Setări → Beta features. Tu testezi 2-3 doctori reali înainte de enable global. |
| D11 | **Domain MVP:** `dosar-share.serverless.danubedata.ro` (relay) + `tudorabrudan.github.io/dosar-share/` (viewer) | Gratis. Mutare pe `share.dosar.app` și `api.dosar.app` (~€10/an) post-launch dacă apare nevoie. |

---

## 3. Scope

### În scope (MVP)

1. **`services/medicalShare.ts`** — bundle ZIP (manifest + originale + thumbnails) + criptare AES-256-GCM + upload via pre-signed URL.
2. **`services/medicalShareHistory.ts`** — CRUD pe `medical_shares` (insert, list, revoke). Schema deja există din F1.
3. **`cloud/share-relay/`** — Rapids container TypeScript cu 4 endpoints (POST /upload, GET /share/:id, DELETE /share/:id, GET /health).
4. **`cloud/share-viewer/`** — static page (Vite + vanilla TS + JSZip + PDF.js) pentru deschidere link în browser, decriptare, randare Timeline + Documente.
5. **UI app:** buton "🔗 Partajează cu medicul" în detaliu dosar + sheet config + progress modal + modal succes + ecran istoric share-uri active.
6. **Feature flag** `betaShareEnabled` în Setări → Beta features (default OFF la launch).
7. **Privacy policy update** cu mențiune Danubedata (sau Scaleway, decizie la deploy) ca processor.

### Out of scope (faza 2+)

- TTL configurabil (1h / 6h / 24h)
- Domain propriu (`share.dosar.app`)
- Watermark dinamic pe documente cu nume doctor + timestamp
- Auto-revoke după prima vizualizare (tehnic dificil, browser poate refresh)
- Doctor app dedicată (B2B) — viewer-ul web acoperă MVP
- Multi-recipient share (același link → mai mulți doctori, fiecare cu cheie distinctă)
- Audit log per share view (cine a accesat, când)
- App Lock / autentificare suplimentară doctor (link = secret key)

---

## 4. Arhitectură generală

### 4.1 Vedere ansamblu

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PACIENT — Dosar app (iOS)                                              │
│                                                                          │
│  1. Tap "Partajează cu medicul" în detaliu dosar                        │
│  2. Sheet config (ce includ, interval)                                  │
│  3. Build bundle.zip local                                              │
│  4. Generează cheie AES-256 + nonce random                              │
│  5. Criptează ZIP cu AES-GCM                                            │
│  6. POST /upload la Rapids → primește pre-signed PUT URL                │
│  7. PUT direct la S3 cu pre-signed URL                                  │
│  8. Construiește URL viewer cu k+n+id în fragment                       │
│  9. Copy în clipboard / Share sheet nativ → SMS/WhatsApp/email          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼ POST /upload (mic, doar metadata)
┌─────────────────────────────────────────────────────────────────────────┐
│  RAPIDS — dosar-share.serverless.danubedata.ro                          │
│  (Falkenstein, Germany — EU)                                            │
│                                                                          │
│  • POST /upload (mic, < 1KB body)                                       │
│    - Acceptă { sizeBytes, docCount, obsCount } din app                  │
│    - Generează UUID                                                     │
│    - Cheamă S3 API: getSignedUrl(PUT, expires=5min)                     │
│    - Salvează metadata în in-memory KV (sau Redis)                      │
│    - Returnează { id, uploadUrl, expiresAt }                            │
│  • GET /share/:id                                                       │
│    - Verifică id există + nu e expirat + nu e revoked                   │
│    - Cheamă S3 API: getSignedUrl(GET, expires=remainingTime)            │
│    - Returnează { downloadUrl, expiresAt }                              │
│  • DELETE /share/:id                                                    │
│    - Cheamă S3 API: DeleteObject                                        │
│    - Marchează revoked în KV                                            │
│    - Returnează 204                                                     │
│  • GET /health                                                          │
│    - Returnează { status: 'ok', timestamp }                             │
│                                                                          │
│  Rate limit: 10 upload-uri/IP/zi (in-memory cu reset zilnic, sau Redis)│
│  Logging: minim — request method + status code + timestamp.             │
│           IP-uri NU stocate >24h (cleanup automat).                     │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ S3 SDK
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  S3 OBJECT STORAGE (Danubedata sau Scaleway — decizie la deploy)        │
│                                                                          │
│  Bucket: dosar-shares                                                   │
│  • Stocează blob-uri OPACE (E2E criptate cu cheie pe care provider     │
│    NU o vede niciodată — cheia stă în URL fragment, never sent)         │
│  • Lifecycle rule: auto-delete obiecte > 24h (safety net dincolo de TTL │
│    1h al pre-signed URL-urilor)                                         │
│  • Bucket policy: deny public read (accesare doar via pre-signed)       │
│  • TLS 1.3 in transit, SSE-S3 (AES-256) at rest (în plus de E2E)        │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
       Link trimis: https://tudorabrudan.github.io/dosar-share/#k=...&n=...&b=...
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DOCTOR — orice browser modern (Web Crypto API)                         │
│                                                                          │
│  1. Tap link → deschide viewer static (GitHub Pages)                    │
│  2. JS citește #fragment (k, n, id) — NU pleacă la server               │
│  3. GET /share/:id la Rapids → primește pre-signed download URL         │
│  4. Fetch direct din S3 → blob criptat                                  │
│  5. Web Crypto API decriptează cu k+n în memorie                        │
│  6. JSZip extrage bundle în memorie                                     │
│  7. Render UI:                                                          │
│     - Header pacient + dată snapshot + countdown "expiră în 47 min"     │
│     - Tab Timeline: observații cu sparkline (SVG inline)                │
│     - Tab Documente: listă cu thumbnail tap → modal PDF/imagine         │
│     - Footer: avertisment GDPR + buton "Cere date noi"                  │
│  8. La închidere browser/tab: bundle dispare din memorie                │
│  9. După 1h: pre-signed URL expiră → 404 la GET. Lifecycle rule        │
│     șterge blob-ul din S3 după 24h dacă rămâne neaccesat.              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Module noi în app (`/Users/ax/work/documents/app/services/`)

| Fișier | Rol |
|---|---|
| `medicalShare.ts` | Bundle ZIP + criptare + apel /upload + construire URL viewer |
| `medicalShareHistory.ts` | CRUD pe `medical_shares` (deja există tabela din F1) |
| `medicalShareConfig.ts` | Constante: URL Rapids, URL viewer, limite size/count, format URL fragment |

### 4.3 Module noi în repo (fără Expo) — `/Users/ax/work/documents/cloud/`

| Folder | Rol | Deploy |
|---|---|---|
| `cloud/share-relay/` | Rapids container TypeScript: 4 endpoints + signing | Docker push la Container Registry Danubedata → deploy în Rapids dashboard |
| `cloud/share-viewer/` | Static viewer Vite + vanilla TS + JSZip + PDF.js | Build → `dist/` → push la branch `gh-pages` în repo `tudorabrudan.github.io` cu sub-path `/dosar-share/` |

Ambele cu propriile `package.json`, `tsconfig.json`, teste, `README.md` cu pași de deploy.

### 4.4 UI app — fișiere noi/modificate

| Fișier | Modificare |
|---|---|
| `components/medical/ShareDoctorSheet.tsx` | **NOU** — modal pageSheet cu config share (toggles + interval + estimare size) |
| `components/medical/ShareSuccessModal.tsx` | **NOU** — modal cu link copiabil + share sheet nativ + buton revoke |
| `components/medical/ShareHistoryList.tsx` | **NOU** — lista share-uri active/expirate cu revoke per item |
| `app/(tabs)/entitati/medical/[id]/index.tsx` | Adaugă buton 🔗 "Partajează" în action bar |
| `app/(tabs)/entitati/medical/[id]/share-history.tsx` | **NOU** — ecran istoric share-uri pentru un dosar |
| `app/(tabs)/setari.tsx` | Adaugă secțiune "Beta features" cu toggle `betaShareEnabled` |
| `services/settings.ts` | `getBetaShareEnabled` / `setBetaShareEnabled` |

### 4.5 Module NEschimbate

- `services/medicalRecord.ts`, `services/medicalObservations.ts`, `services/medicalCrypto.ts` etc. — share-ul reutilizează decriptarea existentă pentru construirea manifest-ului.
- `services/medicalFts.ts`, `services/medicalChat.ts` — share-ul nu folosește FTS sau chat.
- Schema DB — `medical_shares` deja există din F1 Task 4.

---

## 5. Bundle structure

```
bundle.zip (max 100MB criptat, max 50 documente)
├── manifest.json
├── documents/
│   ├── <doc-id-1>.pdf  (originale)
│   ├── <doc-id-2>.jpg
│   └── ...
└── thumbnails/
    ├── <doc-id-1>.jpg  (200x200, JPEG q70, generate la share)
    └── ...
```

**`manifest.json`:**

```json
{
  "version": 1,
  "generatedAt": "2026-05-22T14:32:00Z",
  "expiresAt": "2026-05-22T15:32:00Z",
  "patient": {
    "name": "Maria Pop",
    "dateOfBirth": "1975-03-15",
    "bloodGroup": "A pozitiv",
    "allergies": "penicilină, fragi",
    "emergencyContact": { "name": "Ion Pop", "phone": "+40..." }
  },
  "observations": [
    {
      "name": "HDL",
      "value": "62",
      "unit": "mg/dL",
      "ref_min": "40",
      "ref_max": "80",
      "observed_at": "2026-04-15",
      "category": "lipide",
      "source_document_id": "<id>"
    }
  ],
  "documents": [
    {
      "id": "<doc-id-1>",
      "type": "analize_medicale",
      "type_label": "Analize medicale",
      "title": "Analize Synevo - profilul lipidic",
      "issue_date": "2026-04-15",
      "filename": "documents/<doc-id-1>.pdf",
      "thumbnail": "thumbnails/<doc-id-1>.jpg",
      "size_bytes": 1842340,
      "summary": "Profil lipidic în limite normale..."
    }
  ]
}
```

**Patient info (D4 medical-merge polish):**
- `name`, `dateOfBirth` derivate din person linked
- `bloodGroup`, `allergies`, `emergencyContact` directly din medical_record fields (F8 polish)

---

## 6. Criptare end-to-end

### 6.1 Algoritm

- **AES-256-GCM** prin `@noble/ciphers` (deja în Dosar din F2 medical-merge)
- **Cheie:** 256-bit aleatoare per share, generată cu `crypto.getRandomValues`
- **Nonce:** 96-bit aleator per share
- **AAD:** `dosar-share-v1:<blob-id>` — împiedică reaplicarea blob-ului la alt ID

### 6.2 Encode în URL fragment

```
https://tudorabrudan.github.io/dosar-share/#k=<base64url-key>&n=<base64url-nonce>&b=<blob-id>
```

- `k`: 43 chars base64url (256 bits / 6 = 43)
- `n`: 16 chars base64url (96 bits / 6 = 16)
- `b`: ~22 chars UUID base64url
- URL total: ~120 chars — copy-paste-able în SMS/WhatsApp/email

**Fragment-uri NU se trimit la server în HTTP requests** → Rapids și S3 nu văd cheia niciodată.

### 6.3 Browser support

Web Crypto API necesar:
- Safari 11+ (2017)
- Chrome 37+ (2014)
- Firefox 34+ (2014)
- Edge 12+ (2015)

Acoperire >99.5% browsers actuali. Pentru cazuri marginale, viewer afișează mesaj clar: "Browser-ul tău nu suportă criptarea modernă. Folosește Chrome, Safari sau Firefox recent."

---

## 7. Provider storage — decizie la deploy

### 7.1 Decizia se ia când deschidem cont, NU acum

Codul folosește S3 SDK standard (`@aws-sdk/client-s3` în Rapids + `S3Client` cu endpoint configurabil). Schimbarea provider-ului = update la 3 env vars în Rapids:

```
S3_ENDPOINT=https://s3.danubedata.ro     # sau https://s3.fr-par.scw.cloud
S3_REGION=eu-central-1                    # sau fr-par
S3_BUCKET=dosar-shares
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

Zero modificări de cod la schimbarea provider-ului. Migrare ulterioară = re-deploy cu env nou + redirect linkuri vechi (sau expiră natural în 1h).

### 7.2 Comparare la momentul deploy

| | Danubedata Object Storage | Scaleway Object Storage |
|---|---|---|
| Datacenter | Falkenstein, Germania | Paris, Franța |
| Free tier | ❌ | ✅ 75 GB + 75 GB egress |
| Cost min | €3.99/lună flat (1TB) | €0/lună până la limită; apoi €0.012/GB/lună |
| API | S3-compatible (Ceph) | S3-compatible |
| Lifecycle rules | ✅ | ✅ |
| Pre-signed URLs | ✅ | ✅ |
| SSE-S3 | ✅ AES-256 | ✅ |
| TLS | 1.3 | 1.3 |
| DPA | Inclus | Inclus |
| **Verdict cost la scale-ul nostru** | €48/an | **€0/an** |
| **Avantaj** | Same provider ca compute → un singur DPA/factură | Free tier la scale-ul prevăzut |

### 7.3 Recomandare la deploy

**Default: Scaleway** (€0/lună, EU clean, free tier acoperă mult peste nevoile noastre).
**Excepție:** dacă alegi să muți și alte proiecte (cadourile.ro etc.) la Danubedata, unificare = preferi Danubedata pentru un singur cont/DPA chiar dacă plătești €3.99 incremental.

Decizia finală la momentul Task 19 din plan (deploy).

---

## 8. Fluxuri user

### 8.1 Generare share (pacient în app)

1. Detaliu dosar medical → buton 🔗 "Partajează cu medicul" în action bar.
2. **Sheet config** (`ShareDoctorSheet`):
   - **Ce includ:** toggle "Observații recente" (ON), "Documente originale" (ON), "Rezumate AI" (ON dacă există).
   - **Interval:** select "Ultimele 3 luni / 6 luni / 12 luni / Toate" (default 6 luni).
   - **Filtru tipuri:** chip-uri tappabile pentru fiecare `MEDICAL_DOC_TYPES` (default toate ON).
   - **Estimare live:** "~24 MB · 12 documente · 47 observații" — recalculat când userul modifică toggle-uri.
   - Buton "Generează link" + "Anulează".
3. **Validare pre-generare:**
   - Dacă size estimat > 100MB → arată warning + sugerează restrângerea intervalului.
   - Dacă doc count > 50 → același warning.
4. **Progress modal** (`ShareProgressModal`):
   - "Pregătesc bundle... (1/5)"
   - "Comprim documente... (2/5)"
   - "Generez thumbnails... (3/5)"
   - "Criptez bundle... (4/5)"
   - "Trimit la server criptat... (5/5)"
5. **Succes modal** (`ShareSuccessModal`):
   - Link afișat cu copy button: `https://tudorabrudan.github.io/dosar-share/#k=AbC...`
   - Mesaj: "Linkul e valabil 1 oră. După expirare, datele dispar automat. Doctorul nu are nevoie de cont sau aplicație."
   - Buton **"Copiază link"** + buton **"Trimite..."** (deschide share sheet nativ iOS cu textul linkului).
   - Buton **"Revoke acum"** — apel `DELETE /share/:id` care șterge blob-ul imediat.
   - Mesaj sub buton revoke: "Folosește dacă ai trimis greșit linkul."

### 8.2 Vizualizare share (doctor în browser)

1. Tap link → deschide viewer static `tudorabrudan.github.io/dosar-share/`.
2. **Splash screen** scurt cu logo Dosar + "Se decriptează datele pacientului..." (~2-5 sec).
3. **Header:**
   - Numele pacientului + vârsta (dacă DoB existent)
   - Grupa sanguină + alergii (badge ⚠️ dacă există)
   - Persoană de contact urgență (telefon tappable → `tel:`)
   - Countdown "Acest link expiră în 47 min 23 sec" (live)
   - Disclaimer: "Datele au fost partajate de pacient pentru consultația cu dvs. Vă rugăm să le tratați ca date Art. 9 GDPR."
4. **Tab Timeline:**
   - Lista observații grupate pe parametru (HDL, TSH, etc.)
   - Sparkline SVG inline pentru evoluție
   - Culoare valoare după interval (verde / portocaliu / roșu — același cod ca în app)
   - Tap pe observație → drill-down la documentul sursă din tab Documente
5. **Tab Documente:**
   - Listă cu thumbnail + titlu + dată + dimensiune
   - Tap → modal full-screen cu PDF (pdf.js) sau imagine (img tag)
   - Zoom + pan pentru imagini
6. **Footer:**
   - Avertisment GDPR
   - Buton "Cere date noi" → deschide `tel:` la pacient (dacă există în manifest)
7. **La închidere tab:** bundle e cleanup-uit din memorie automat (garbage collector). Nimic nu se cache-uiește (service worker disabled).

### 8.3 Istoric share-uri (pacient în app)

Ecran nou `share-history.tsx`:
- Listă toate share-urile pentru un dosar (din tabela `medical_shares`).
- Per item: dată generare, dimensiune, # documente, status (`activ` / `expirat` / `revocat`).
- Pentru cele active: buton "Revoke" (apel DELETE).
- Pentru cele expirate: doar informativ.
- Refresh cu pull-to-refresh.
- Empty state: "Nu ai generat încă niciun share. Atinge butonul Partajează din detaliul dosarului."

Acces din detaliu dosar → menu "..." → "Istoric partajări".

---

## 9. Securitate și privacy

### 9.1 Zero-knowledge față de provider

- Cheia AES generată în memorie app, niciodată trimisă la Rapids sau S3.
- Blob criptat înainte de upload → Rapids și S3 văd doar bytes opace.
- Cheia ajunge la doctor doar prin URL fragment, transmis prin canale ne-controlate de noi (SMS/WA/email/etc.).
- Fragmentele URL NU se trimit la server în niciun HTTP request → Rapids și S3 nu pot logga cheia chiar dacă vor.

### 9.2 GDPR

| Aspect | Implementare |
|---|---|
| Consent | Buton "Partajează" e action explicit al utilizatorului. Sheet config explică ce date pleacă. |
| Drept ștergere | Buton "Revoke" + auto-expiry 1h + lifecycle 24h în S3 |
| Drept acces | Userul are tot ce-i trebuie în app local; share-ul e read-only outgoing |
| Minimizare | Sheet config permite filtrare interval + tipuri |
| Data residency | EU only (Falkenstein DE pentru Rapids; DE/FR pentru S3 depending pe provider) |
| Processor | Danubedata (compute + opțional storage) sau Scaleway (storage) — DPA EU |
| Zero-knowledge | Demonstrat — cheia nu părăsește dispozitivele pacient + doctor |

### 9.3 Threat model

| Atac | Mitigare |
|---|---|
| Provider read blob | E2E criptat, fără cheie. Blob = ciphertext opac. |
| Provider read URL fragment | Imposibil tehnic — fragment-ul nu se transmite în HTTP |
| Interceptare link în transit | Atacatorul are URL → are TOATĂ cheia. **Asta E modelul** — userul e responsabil pentru canalul ales (SMS/WA/email). Mitigare: comunicare în privacy policy că linkul = secret. |
| Atac brute force pe blob | AES-256 = 2^256 chei. Imposibil. |
| Replay attack (refolosire blob) | AAD = blob-id; criptarea cu același key+nonce pe alt blob-id eșuează decriptare. |
| Rate limit DOS | 10 upload-uri/IP/zi în Rapids. Limita size 100MB/blob. |
| Storage cost attack (cineva uploadează 1TB) | Limita 100MB + rate limit 10/zi/IP = max 1GB/IP/zi. |
| Doctor cache linkul după 1h | Browser cache disabled via headers. Doctor poate refresh — la 1h primește 404. |

### 9.4 Logging și retention

**Rapids:**
- Log per request: method + path + status code + timestamp + size. **NU IP, NU user-agent.**
- Retention 24h max (auto-cleanup).
- Acces log-uri: doar developer (tu) prin Danubedata dashboard.

**S3:**
- Access logs disabled (default Danubedata).
- Bucket policy: doar pre-signed access permis.

---

## 10. Privacy policy update (in-app + site)

Adaugă în Setări → Despre + în site `docs/privacy.html`:

> ### Partajare cu medic (feature opțional)
>
> Când folosești funcția "Partajează cu medicul", aplicația:
> 1. Construiește un bundle ZIP cu observațiile și documentele tale medicale.
> 2. Generează o cheie de criptare unică, valabilă o singură dată.
> 3. Criptează bundle-ul pe dispozitivul tău cu cheia respectivă.
> 4. Trimite bundle-ul criptat la un server din **[Danubedata / Scaleway — actualizează la deploy]**, situat în **Uniunea Europeană** (Germania / Franța).
> 5. Construiește un link care conține un identificator + cheia de criptare, **într-un fragment URL care nu pleacă niciodată la server**.
> 6. Linkul îți este afișat — îl trimiți doctorului prin orice canal alegi (SMS, WhatsApp, email).
>
> **Doctorul accesează linkul într-un browser.** Browser-ul descarcă bundle-ul criptat, citește cheia din linkul în sine, și decriptează datele local — în memoria browser-ului, fără salvare pe disc.
>
> **Durată de viață:** maximum 1 oră de la generare. După 1 oră, linkul expiră automat și datele sunt șterse. Poți revoca un link mai devreme din ecranul "Istoric partajări".
>
> **Sub-processor:** [Danubedata / Scaleway] este sub-processor declarat pentru găzduirea temporară (max 1h) a bundle-urilor criptate end-to-end. Sub-processor-ul **nu poate decripta** conținutul — cheia rămâne între dispozitivele tale și ale doctorului.

---

## 11. Faze și ordine de implementare

Vezi planul de implementare separat: `2026-05-22-doctor-share.md`.

Pe scurt:
- **F8a** — Cod relay Rapids (TypeScript + Docker)
- **F8b** — Cod viewer static (Vite + vanilla TS + JSZip + PDF.js)
- **F8c** — Servicii app (medicalShare.ts, medicalShareHistory.ts) + UI
- **F8d** — Deploy + smoke test end-to-end
- **F8e** — Privacy policy + feature flag rollout

---

## 12. Criterii "done"

- [ ] `npm run audit` verde (type-check + backup-audit + check-hardcoded-entities + knowledge-audit + update-site).
- [ ] Container Rapids deploy reușit + endpoint health returnează 200.
- [ ] Viewer static deploy pe GitHub Pages reușit + URL accesibil.
- [ ] Pe device fizic iOS: user generează un share, copiază linkul, îl trimite la propriul email/WhatsApp.
- [ ] Doctorul (simulat — alt device) deschide linkul în browser. Vede: header pacient, Timeline cu observații, Documente cu thumbnails. PDF-urile se deschid corect.
- [ ] Revoke manual: după revoke, linkul → 404 imediat.
- [ ] Expiry natural: după 1h, linkul → 404.
- [ ] Lifecycle S3: după 24h, blob complet șters din S3 (verificare prin S3 CLI).
- [ ] Privacy policy actualizat în-app și pe site.
- [ ] Feature flag funcțional: buton ascuns când `betaShareEnabled === false`.

---

## 13. Riscuri și non-decizii

### 13.1 Riscuri

| Risc | Mitigare |
|---|---|
| Free tier Scaleway depășit la creștere | Migrare la Danubedata €3.99 = 5 min env update + bucket move |
| Rapids free tier (2M req/lună) depășit | Plătit doar pay-per-use de la milionul 2.000.001 → ~€5/lună la 10M req |
| Viewer static GH Pages flaky | Mutare la Static Sites Danubedata (€0 sau plan mic) = git remote add |
| Cineva uploadează blob foarte mare → cost S3 | Limita 100MB hard în Rapids + estimare în app înainte de upload |
| Doctor primește link pe browser foarte vechi fără Web Crypto | Viewer detectează și afișează mesaj clar (Chrome/Safari/Firefox recent) |
| Cheia leaked în istoric browser doctor | Browser-ul nu salvează URL fragment-uri în istoric (verificat) |
| Pacient trimite linkul greșit | Buton Revoke pentru cleanup imediat |

### 13.2 Non-decizii (de discutat la implementare)

- **Viewer i18n:** doar RO la MVP? Doctorii pot fi RO-only deocamdată; engleză adăugat dacă apare cerere.
- **Watermark documente cu nume doctor:** complicat fără rebuild PDF — defer la Faza 2.
- **Limita rate per pacient (nu per IP):** pacient poate avea IP dinamic; rate per device-id necesită auth în Rapids = scope creep. Defer.

---

## 14. Documente conexe

- Spec medical merge: `docs/superpowers/specs/2026-05-19-dosar-medical-merge-design.md` §6.6 (versiunea inițială Cloudflare)
- Plan medical merge: `docs/superpowers/plans/2026-05-19-dosar-medical-merge.md`
- Plan implementare F8: `docs/superpowers/plans/2026-05-22-doctor-share.md`
- Reguli AI privacy: `app/.claude/rules/ai-privacy.md` (`private_notes` niciodată în bundle)
- Reguli backup: `app/.claude/rules/backup.md` (medical_shares deja în 3 locuri)
