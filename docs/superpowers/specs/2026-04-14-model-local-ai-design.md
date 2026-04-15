# Design: Model local AI (llama.rn)

**Data:** 2026-04-14  
**Status:** Aprobat (rev. 2)

---

## Problemă

Asistentul AI al aplicației funcționează exclusiv în cloud (Mistral/OpenAI). Utilizatorul nu are control asupra datelor trimise, este limitat la 20 interogări/zi cu cheia built-in, și nu poate folosi app-ul offline. Un model local rezolvă toate trei probleme: privat, nelimitat, offline.

---

## Obiective

1. Utilizatorul poate descărca un model LLM pe device (llama.rn / llama.cpp GGUF)
2. Catalogul afișează **doar modelele compatibile** cu telefonul utilizatorului — cele incompatibile sunt ascunse
3. Fiecare model: descriere, calitate (stele), dimensiune, badge compatibilitate
4. Verificare compatibilitate **înainte** de download (RAM, iOS)
5. Progress vizibil la download + buton anulare
6. Ștergere model din setări
7. Switch rapid între **toate configurările AI**: Fără AI / Dosar AI / Cheie API proprie / model local descărcat
8. Opțiune de a folosi modelul local și pentru OCR (dacă e instalat)
9. Onboarding: link spre site-ul static unde sunt descrise toate opțiunile în detaliu
10. La opțiunea „Cheie API proprie": link direct spre mistral.ai pentru creare cont/cheie

---

## Arhitectură

### Provider type

`AiProviderType` în `services/aiProvider.ts` primește `'local'` și `'none'` ca valori noi:

```typescript
export type AiProviderType = 'none' | 'builtin' | 'mistral' | 'openai' | 'custom' | 'local';
```

- `'none'` — AI dezactivat (utilizatorul nu dorește asistent AI)
- `'local'` — inferență locală via llama.rn

`sendAiRequest` detectează `type === 'local'` și rutează spre `localModel.runInference()`; detectează `type === 'none'` și returnează eroare clară.

### Serviciu nou: `services/localModel.ts`

Responsabilități:
- Catalog static de modele (nu se descarcă din rețea)
- Filtrare catalog per device (ascunde incompatibilele)
- Verificare compatibilitate cu device-ul curent (`expo-device`)
- Download cu progress callback (`expo-file-system`)
- Stocare: `FileSystem.documentDirectory + 'models/<model-id>.gguf'`
- Ștergere fișier model
- Init / inferență via `llama.rn`
- Persistență selecție: `AsyncStorage`

---

## Catalog de modele

Catalog static, toate instruction-tuned (IT), format GGUF Q4_K_M.  
**Catalogul afișat în UI conține doar modelele compatibile cu device-ul utilizatorului.**

| ID | Nume | Dimensiune | RAM minim | Dispozitiv minim | Calitate |
|----|------|-----------|-----------|-----------------|---------|
| `llama3-1b` | Llama 3.2 1B IT | ~800MB | 4GB | iPhone 12+ | ★★☆ |
| `gemma4-2b` | Gemma 4 2B IT | ~1.5GB | 4GB | iPhone 13+ | ★★★★ |
| `phi3-mini` | Phi-3 Mini 3.8B IT | ~2.3GB | 6GB | iPhone 14+ | ★★★★ |
| `ministral-3b` | Ministral 3B IT | ~2.0GB | 6GB | iPhone 14+ | ★★★★ |
| `gemma4-4b` | Gemma 4 4B IT | ~2.5GB | 6GB | iPhone 14+ | ★★★★★ |
| `mistral-7b` | Mistral 7B IT | ~4.1GB | 8GB | iPhone 15 Pro+ | ★★★★★ |

> Gemma 4 IT (google/gemma-4-it) — familie nouă Google, excelentă la înțelegerea documentelor și extracție structurată.  
> Ministral 3B — model Mistral compact, calitate bună la extracție și instrucțiuni, merge pe iPhone 14+.  
> Mistral 7B — calitate maximă pentru telefoane high-end (iPhone 15 Pro+).

Descrieri afișate utilizatorului:
- **Llama 3.2 1B IT** — „Cel mai mic și mai rapid. Bun pentru întrebări simple și căutări. Ocupă puțin spațiu."
- **Gemma 4 2B IT** — „Model Google de ultimă generație. Excelent la documente, răspunsuri precise. Recomandat pentru iPhone 13+."
- **Phi-3 Mini 3.8B IT** — „Model Microsoft, optimizat pentru raționament și extracție date structurate."
- **Ministral 3B IT** — „Model Mistral compact. Bun la urmarea instrucțiunilor și extracție date."
- **Gemma 4 4B IT** — „Versiunea extinsă Gemma 4. Calitate maximă în clasa 4B. Recomandat pentru iPhone 14+."
- **Mistral 7B IT** — „Calitate maximă disponibilă local. Necesită iPhone 15 Pro+ și ~4GB spațiu liber."

---

## Verificare compatibilitate și filtrare UI

Folosind `expo-device`:
- `Device.totalMemory` (bytes) → comparat cu `minRAM` al modelului
- `Device.modelName` → regex pentru a detecta generația iPhone

**Regula de afișare:** modelele incompatibile **nu apar** în catalog. Utilizatorul vede doar ce poate descărca și folosi pe telefonul lui.

Dacă niciun model nu e compatibil (telefon foarte vechi): mesaj „Telefonul tău nu suportă modele AI locale. Folosește Dosar AI sau cheie API proprie."

Stări posibile per model afișat (deci deja compatibil):
- **Disponibil** — buton „Descarcă" activ
- **Descărcat** — buton „Șterge" + indicator „Activ" dacă e selectat
- **Se descarcă** — progress bar + buton „Anulează"

---

## Flux download

1. User apasă „Descarcă"
2. Modal confirmare: „[Nume model] ocupă [X]GB. Asigură-te că ai spațiu liber. Continui?"
3. Download cu `FileSystem.downloadAsync()` + callback progress
4. UI: progress bar, procente, MB descărcați din total
5. La finalizare: modelul devine automat cel activ, provider setat pe `local`
6. La eroare / anulare: fișier parțial șters

---

## Stocare și persistență

**Fișiere:** `FileSystem.documentDirectory + 'models/'`  
Nu se sincronizează cu iCloud (modele prea mari, se re-descarcă).

**AsyncStorage:**
```
local_model_selected   → id model activ (ex: "gemma4-2b")
local_model_downloaded → JSON array cu id-urile descărcate (ex: ["gemma4-2b", "phi3-mini"])
```

---

## UI Setări (`setari.tsx`)

### Selector configurare AI

Switch vizibil între **toate configurările AI** — nu doar între modele locale:

```
── Asistent AI ──────────────────────────────────
  Fără AI
  Dosar AI  (recomandat, 20/zi gratuit)        ← activ
  Cheie API proprie  (Mistral / OpenAI)
  ── Modele locale ──
  Gemma 4 2B IT                                ← descărcat
  Phi-3 Mini 3.8B IT                           ← descărcat
─────────────────────────────────────────────────
```

Fiecare intrare e un radio button. Schimbarea e instantanee. Modelele locale apar în selector **doar după ce sunt descărcate**.

### Secțiunea „Modele locale"

Afișează catalogul filtrat (doar modele compatibile cu device-ul):

```
Gemma 4 2B IT  ★★★★  ~1.5GB  • ACTIV
Model Google de ultimă generație. Excelent la documente.
[Șterge]

Phi-3 Mini 3.8B IT  ★★★★  ~2.3GB
Model Microsoft, optimizat pentru extracție date.
[Șterge]

Llama 3.2 1B IT  ★★☆  ~800MB
Cel mai mic și rapid. Bun pentru întrebări simple.
[Descarcă]
```

Toggle la final:
```
[✓] Folosește modelul local și pentru OCR documente
    (La adăugare document, extracția datelor se face local, fără cloud)
```

---

## UI Onboarding (`components/OnboardingWizard.tsx`)

Pas „Asistent AI" — scurt, cu link spre site pentru detalii:

```
Asistentul AI te ajută să găsești documente,
să afli date și să extragi informații automat.

○ Dosar AI (recomandat)
  Cloud · 20 interogări/zi gratuit · Pornești imediat

○ Cheie API proprie
  Cloud · Nelimitat
  Creează-ți un cont gratuit pe mistral.ai →  [link]

○ Model local
  Pe device · Privat · Nelimitat · Offline
  Se descarcă din Setări după instalare

○ Fără AI
  Folosești aplicația fără asistent

[Află mai multe despre opțiunile AI →]   ← link spre docs/index.html#ai
```

Link „Află mai multe" deschide `docs/index.html#asistent-ai` — anchor direct spre secțiunea AI unde sunt descrise în detaliu toate opțiunile, modelele disponibile, avantaje/dezavantaje.

---

## Site static (`docs/index.html`) — secțiune AI nouă

Pagina de prezentare a aplicației primește o secțiune dedicată „Asistent AI" cu:
- Descrierea celor 4 configurări (Fără AI / Dosar AI / Cheie API / Model local)
- Tabel modele locale: nume, dimensiune, calitate, dispozitiv minim, descriere
- Avantaje model local vs cloud (privat, offline, nelimitat)
- Instrucțiuni pas cu pas: cum îți faci cheie Mistral (cu link direct mistral.ai)
- FAQ: „Ce date trimite Dosar AI în cloud?", „Pot folosi ambele?"

---

## Integrare OCR (`services/aiOcrMapper.ts`)

Când toggle-ul „Folosește și pentru OCR" e activ și provider = `local`:
- `sendAiRequest` deja rutează spre local inference — nicio modificare în `aiOcrMapper.ts`
- Dacă modelul local nu e inițializat (crash/cold start) → eroare clară: „Modelul local nu e disponibil. Verifică Setări → Asistent AI."
- Nu există fallback silențios la cloud (privacy-first: userul a ales local explicit)

---

## Fișiere de creat / modificat

| Fișier | Modificare |
|--------|-----------|
| `services/localModel.ts` | **NOU** — catalog, filtrare compatibilitate, download, inferență llama.rn |
| `services/aiProvider.ts` | Adaugă `'local'` și `'none'` în `AiProviderType`, `PROVIDER_DEFAULTS`, `sendAiRequest` |
| `app/(tabs)/setari.tsx` | Selector unificat AI (toate config-urile), catalog modele, progress, delete, OCR toggle |
| `components/OnboardingWizard.tsx` | Pas „Asistent AI" scurt cu link spre site |
| `docs/index.html` | Secțiune nouă „Asistent AI" cu detalii complete, modele, instrucțiuni |
| `package.json` | Adaugă `llama.rn` dependency |

---

## Ce nu se schimbă

- Sistemul cloud existent (`builtin` / `mistral` / `openai` / `custom`) — nemodificat funcțional
- Schema SQLite — nicio migrare
- `services/chatbot.ts` — folosește deja `sendAiRequest`, beneficiază automat
- `services/aiOcrMapper.ts` — idem
