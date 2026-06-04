# Detalii medicale în auto-analiza („Analizez cu AI")

**Data:** 2026-06-04
**Status:** Aprobat (design), pending implementare
**Fișier atins:** `services/aiOcrMapper.ts` (un singur fișier)

## Problemă

La încărcarea unui document, auto-analiza („Analizez cu AI", declanșată automat la
creșterea OCR cu 80+ caractere) setează în câmpul `note` doar **headerul** documentului
medical — pacient + clinică + data. Detaliile efective (rândurile de analize, medicamente,
diagnostice) lipsesc.

Acțiunea manuală „Trimite la AI" extrage corect aceste detalii. Diferența nu e o limitare
tehnică, ci un **gap de prompt**:

- `mapOcrWithAi` (auto) construiește `structuredNote` cu clauze specifice pe tip **doar**
  pentru `factura`, `rca/casco`, `contract`, `garantie`. Tipurile medicale cad pe regula
  generică „alte tipuri" → doar identificatori/date/părți → header-only. În plus are plafon
  „Max 20 rânduri", iar un buletin de laborator are des 30–50 analiți.
- `extractFieldsWithLlm` (`ocrLlmExtractor.ts`, folosit de „Trimite la AI") are regulă OCR
  explicită — „o linie per analiză: «Nume: Valoare Unitate (ref: Min–Max)»" — și transcrie
  fiecare rând.

## Scop

Auto-analiza extrage detaliile complete pentru **toate tipurile medicale**
(`MEDICAL_DOC_TYPES` din `types/index.ts`):

| Tip | Detaliu extras în notă |
|---|---|
| `analize_medicale` | o linie per analiză: „Nume: Valoare Unitate (ref: Min–Max)" |
| `reteta_medicala` | o linie per medicament: „Denumire concentrație — doză, frecvență, durată" |
| `scrisoare_medicala` / `bilet_externare` / `fisa_consultatie` | diagnostice + recomandări, fiecare pe rând |
| `imagistica` | concluziile examinării (RMN/CT/Ecografie) |
| `bilet_trimitere` | diagnostic, cod ICD-10, specialitate, investigație |
| `vaccin_persoana` | vaccin, lot, data |

**Nu** se extinde la non-medical: `factura`/`rca`/`contract`/`garantie` au deja clauze
dedicate; pentru documente simple (buletin, permis, talon) headerul *este* informația utilă,
iar detaliul ar umfla nota și costul la fiecare auto-trigger.

## Soluție aleasă (Abordarea A)

Clauze medicale inline în promptul `structuredNote`, oglindind pattern-ul existent
`factura:`/`rca:` și prompturile per-tip `SYSTEM_BY_TYPE` din `medicalExtractor.ts`.

### 1. Clauze medicale în `structuredNote`
Se adaugă în șirul de instrucțiuni `structuredNote` (în prompt-ul din `mapOcrWithAi`,
~linia 492 a `aiOcrMapper.ts`) secțiuni per-tip medical, cu formatele din tabelul de mai sus.
Pentru `analize_medicale`: include **toate** analizele, grupate pe secțiuni dacă apar
(hematologie, biochimie, lipide, tiroidiene...).

### 2. Plafon de rânduri condiționat
„Max 20 rânduri" devine: pentru tipuri medicale **fără limită** (include tot conținutul
clinic), pentru restul rămâne max 20. Exprimat în limbajul promptului, nu în logică TS.

### 3. Două plafoane de lungime (ambele tăiau silențios nota medicală lungă)

**a. `max_tokens` output (`MAPPER_MAX_TOKENS = 1800`).** Un panel cu 40–50 analiți poate depăși
actualul `1400`. Se ridică **moderat** la `1800` printr-o constantă unică aplicată **pe ambele
căi** ale `mapOcrWithAi` — vision (`sendAiRequestWithImage`, era 1400) și text-only
(`sendAiRequest`, era 1200) — ca nota să nu fie tăiată de model înainte de plafonul app-side,
indiferent de cale. NU se ridică agresiv (ex. 2200): plafonul lovește fiecare auto-trigger,
pentru orice tip de document (tipul nu e cunoscut înainte de apel), deci `1800` acoperă cazul
medical lung fără să scumpească inutil fiecare upload non-medical.

**b. `AI_NOTES_MAX_LENGTH` (descoperit la planificare).** `parseAiResponse` taie `structuredNote`
la `AI_NOTES_MAX_LENGTH = 3000` caractere (`aiOcrMapper.ts:643,689`). Un panel mare (50+ analiți,
nume lungi în română + headere de secțiune) poate depăși 3000 → notă tăiată la mijloc, chiar dacă
AI-ul a returnat-o întreagă. Se ridică la `6000`, aliniat cu `max_tokens=1800` (~7k caractere
output total posibil). Fără asta, feature-ul eșuează silențios pe exact cazul-țintă (panel mare).

## Ce NU se schimbă

- Pipeline-ul medical criptat (`medical_observations`, `medical_document_summaries`,
  medical lock) — neatins.
- `private_notes` — neatins. Regula AI-privacy rămâne validă: schimbăm doar ce vine
  *înapoi* de la AI în `note`, nu ce trimitem la AI.
- „Trimite la AI" (`ocrLlmExtractor.ts`) — neatins.
- Schema SQLite — neatinsă (nicio migrare, fără impact backup/cloudSync).

## Roluri câmpuri (clarificare — de ce `note` e destinația corectă)

Investigarea a confirmat cine alimentează ce. `note` NU e un câmp mort — e indexat în RAG-ul
medical:

| Funcție | Câmpul care o alimentează |
|---|---|
| Chat medical (răspunsuri) | `medical_observations` + index FTS `medical_fts`, care indexează **`note`** (chunk „Rezumat document: …", `medicalFts.ts:94`) **+ `ocr_text`** |
| Timeline analize | `medical_observations` (valori structurate criptate) — NU `note`, NU `ai_summary` |
| Recomandări „mai ai de făcut analize" | `pending_reminders_json` → `MedicalRemindersModal` — NU `ai_summary` |
| „Rezumat AI" (card pe detaliu) | `ai_summary` (`generateAiSummary`) — **display-only**, izolat explicit de chat/FTS |

Consecințe pentru acest feature:
- **Îmbogățirea lui `note` îmbunătățește direct chat-ul medical** (FTS îl indexează), nu e doar
  cosmetic. Asta validează `note` ca destinație.
- **Timeline-ul și recomandările NU sunt atinse** de această schimbare — vin din
  `medical_observations` / `pending_reminders_json`, populate de pipeline-ul medical (flux
  „Dosar medical"), nu de „Analizez cu AI". `ai_summary` rămâne neschimbat și izolat.

## Punct de atenție (acceptat)

Detaliul medical ajunge în câmpul `note` în clar (necriptat, în afara medical lock-ului) și
`note` e trimis și la chatbot-ul **general** third-party (`chatbot.ts:557`), pe lângă cel
medical scoped. Aceasta este însă **deja** situația azi: (a) auto-analiza scrie deja pacient +
clinică în `note`; (b) `ocr_text` al documentelor medicale (care conține deja valorile brute
ML Kit) e deja trimis la chatbot-ul general (`chatbot.ts:574`). Schimbarea îmbogățește un câmp
care curge deja pe aceleași rute — nu introduce o clasă nouă de expunere. Închiderea breșei
chatbot-general pentru documente medicale e un fix de privacy separat, în afara scopului acestui
feature.

## Verificare (Definition of Done)

- `npm run type-check` verde (schimbare de string în prompt — risc TS minim).
- Simulator, document real:
  1. **Buletin de analize** → auto-analiza umple nota cu toate rândurile, nu doar headerul.
  2. **Rețetă medicală** → verificare al doilea tip medical (medicamente listate).
  3. **Document scurt non-medical** (ex. buletin/permis) → nota rămâne concisă (plafon
     non-medical neschimbat).
- Verificare colaterală: `aiOcrMapper.ts` e consumat doar de `app/(tabs)/documente/add.tsx`
  (`runAiOcrMapper`) — confirmă că `result.structuredNote` se aplică în continuare la `note`
  (linia ~530) fără alte presupuneri despre lungime.

## Blast radius

- **Simbol modificat:** `mapOcrWithAi` (semnătură neschimbată; doar conținut prompt +
  `max_tokens`). Consumator unic: `runAiOcrMapper` în `add.tsx`.
- **Tip refolosit:** `MEDICAL_DOC_TYPES` din `types/index.ts` (doar citit, dacă e nevoie de
  referință; altfel formatele sunt în textul promptului).
- **Audit scripts:** niciunul afectat (fără schemă, fără entități hardcodate, fără manifest).
