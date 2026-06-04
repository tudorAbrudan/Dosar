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

### 3. `max_tokens` pentru calea vision
Un panel cu 40–50 analiți poate depăși actualul `1400`. Se ridică la ~`2200` pe apelul
`sendAiRequestWithImage` din `mapOcrWithAi`, ca nota să nu se trunchieze.
Trade-off acceptat: ușor mai mult cost pe apel, doar când output-ul chiar e lung.

## Ce NU se schimbă

- Pipeline-ul medical criptat (`medical_observations`, `medical_document_summaries`,
  medical lock) — neatins.
- `private_notes` — neatins. Regula AI-privacy rămâne validă: schimbăm doar ce vine
  *înapoi* de la AI în `note`, nu ce trimitem la AI.
- „Trimite la AI" (`ocrLlmExtractor.ts`) — neatins.
- Schema SQLite — neatinsă (nicio migrare, fără impact backup/cloudSync).

## Punct de atenție (acceptat)

Detaliul medical ajunge în câmpul `note` în clar (necriptat, în afara medical lock-ului).
Aceasta este **deja** situația azi: auto-analiza scrie deja pacient + clinică în `note`, iar
„Trimite la AI" scrie deja detaliile acolo. Schimbarea aliniază cele două butoane, nu
introduce o clasă nouă de expunere.

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
