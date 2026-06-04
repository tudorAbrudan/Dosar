# Documentele medicale — invizibile pentru chatbot-ul general

**Data:** 2026-06-04
**Status:** Aprobat (design), pending implementare
**Fișiere atinse:** `services/documents.ts`, `services/chatbot.ts`, `.claude/rules/ai-privacy.md` + test nou

## Problemă

Chatbot-ul **general** (`services/chatbot.ts`, asistentul din aplicație) trimite la modelul AI
third-party (Mistral/OpenAI) conținutul TUTUROR documentelor, inclusiv al celor medicale:
`doc.note` (`chatbot.ts:557`) și `doc.ocr_text` (`chatbot.ts:574`). Funcția care ar trebui să
curețe datele înainte de AI — `getDocumentsForAI()` — scoate doar `private_notes`, NU și
`note`/`ocr_text`.

Aceasta contrazice arhitectura de izolare medicală a aplicației (observații criptate în
`medical_observations`, `ai_summary` ținut explicit afară din chat printr-un audit dedicat,
medical lock, chat medical scoped separat). Datele clinice (valori analize, diagnostice, CNP) ajung
la un model extern, în afara medical lock-ului, din motive de confidențialitate/GDPR inacceptabil.

Descoperit pe 2026-06-04 în timpul feature-ului „detalii medicale în auto-analiză", care a
îmbogățit `note` medical → și mai mult detaliu clinic pe această rută deja deschisă.

## Scop

Chatbot-ul general NU mai are acces la niciun document medical (`MEDICAL_DOC_TYPES`): nici conținut,
nici existență. Doar **chat-ul medical** (scoped pe dosar, în spatele medical lock) are acces la ele.
Când utilizatorul întreabă chatbot-ul general despre subiecte medicale, e redirecționat politicos
către chat-ul medical — fără ca vreo dată medicală să ajungă la AI-ul general.

## Constatări care fac fix-ul sigur (verificate în cod)

- `getDocumentsForAI()` are **exact un consumator**: chatbot-ul general (`chatbot.ts:416`). Nimic
  altceva nu-l folosește.
- Chat-ul medical (`medicalChat.ts`) NU trece prin `getDocumentsForAI` — folosește `getDocumentById`
  scoped (`medicalChat.ts:289`) + RAG-ul lui propriu (`medical_observations` + `medical_fts`). Deci
  filtrarea în `getDocumentsForAI` NU îl afectează.
- `MEDICAL_DOC_TYPES` (`types/index.ts:523`) e un `ReadonlySet<DocumentType>` cu cele 8 tipuri
  medicale — sursa de filtrare.

## Soluție (Abordarea A — filtrare în sursa AI-safe)

### 1. Excludere date — `services/documents.ts`
În `getDocumentsForAI()`, după colectarea documentelor, filtrează tipurile medicale:
`documents.filter(d => !MEDICAL_DOC_TYPES.has(d.type))`. Documentele medicale dispar complet din tot
ce vede chatbot-ul general — inclusiv din `findDocsByOcrSearch` (lucrează pe aceeași listă) și din
lista „ce documente am". Actualizează JSDoc-ul funcției ca să reflecte că exclude și documentele
medicale, nu doar `private_notes`.

### 2. Redirect static — `services/chatbot.ts` (~linia 671, `systemPrompt`)
Adaugă o secțiune fixă în system prompt:
> „Nu ai acces la documentele medicale (analize, rețete, diagnostice, scrisori medicale, bilete de
> externare/trimitere, imagistică, vaccinuri) — din motive de confidențialitate/GDPR. Dacă
> utilizatorul întreabă despre subiecte medicale, NU inventa și NU spune că nu există documentele;
> îndrumă-l: «Pentru analizele și documentele tale medicale, deschide Dosarul medical — chat-ul de
> acolo are acces la ele»."

Text fix, fără date per-document → nicio scurgere. Doar comportamentul de redirect, nu cunoaștere de
conținut.

### 3. Plasă anti-regresie (CLAUDE.md §4)
Fiindcă închidem o clasă de scurgere, adaugă un test automat care verifică direct că un document
medical NU apare în output-ul `getDocumentsForAI()`, lângă un document non-medical care rămâne
prezent. Harness-ul concret (predicat pur extras vs. DB in-memory cu `applySchemaToTestDb`) se
fixează în plan. Extinde și regula `.claude/rules/ai-privacy.md` cu noua garanție.

## Ce NU se schimbă

- Chat-ul medical (`medicalChat.ts`, `getDocumentById` + RAG propriu) — acces medical neatins.
- `sanitizeDocumentForAI` — rămâne pentru `private_notes` (operație per-câmp, diferită de filtrarea
  list-level a documentelor medicale).
- Schema SQLite — neatinsă.
- Feature-ul „detalii medicale în auto-analiză" (mergeat în `bd0bdef`) — `note` medical rămâne
  îmbogățit; doar nu mai pleacă la AI-ul general.

## Efect secundar pozitiv

Tensiunea semnalată în [[dosar_medical_chatbot_leak]] (note+ocr_text medicale îmbogățite curgeau la
AI-ul general) e rezolvată: ruta e închisă la sursă.

## Verificare (Definition of Done)

- Test nou verde: document medical absent din `getDocumentsForAI()`, document non-medical prezent.
- `npm run type-check` verde; suita unit + smoke fără regresii.
- Verificare colaterală:
  - `chatbot.ts buildContext` — confirmă că lista filtrată e singura sursă de documente; medical
    absent și din `findDocsByOcrSearch`.
  - `medicalChat.ts` — confirmă că NU folosește `getDocumentsForAI` (acces medical neafectat).
- Manual (ai-privacy.md): pune o întrebare medicală în chatbot-ul general → primești redirect către
  Dosarul medical, NU date clinice. Inspectează payload-ul → niciun `note`/`ocr_text` de document
  medical în `messages[].content`.

## Blast radius

- **Simbol modificat:** `getDocumentsForAI` (semnătură neschimbată; output filtrat). Consumator unic:
  `buildContext` în `chatbot.ts`.
- **Tip folosit:** `MEDICAL_DOC_TYPES` din `types/index.ts` (doar citit).
- **Audit scripts:** niciunul existent afectat; se adaugă un test nou. Candidat pentru audit dedicat
  dacă apar consumatori AI generali noi.
