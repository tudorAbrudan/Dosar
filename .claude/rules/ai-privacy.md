# AI Privacy — câmpul `private_notes`

## Regulă critică

**Câmpul `private_notes` de pe `Document` NU ajunge niciodată la niciun model AI** — nici la chatbot, nici la OCR LLM, nici la clasificare/sumarizare, nici la vreun serviciu viitor care trimite date la un model extern sau local de inferență.

Utilizatorul îl folosește pentru date strict sensibile (CVV, PIN, parole, coduri de acces). Dacă scurge, e un bug de securitate, nu un bug UX.

## Mecanisme de enforcement

### 1. Helper-ul centralizat

În `services/documents.ts`:

```ts
export function sanitizeDocumentForAI(doc: Document): Document
export async function getDocumentsForAI(): Promise<Document[]>
```

`sanitizeDocumentForAI` elimină `private_notes` din obiect. `getDocumentsForAI` returnează toate documentele deja sanitizate.

### 2. Folosire obligatorie

- **Construiești context pentru chatbot / LLM?** → folosește `getDocumentsForAI()`, NU `getDocuments()`.
- **Ai deja un `Document` în mână și vrei să-l trimiți la AI?** → treci-l prin `sanitizeDocumentForAI(doc)` înainte.
- **Serializezi un `Document` în system prompt / user message / tool input trimis la AI?** → întâi sanitizează.

### 3. Unde NU pleacă la AI (OK să rămână câmpul)

- Backup local (ZIP pentru iCloud/Drive) — rămâne, e datele userului.
- UI (detaliu document, edit) — afișat doar pe device, cu toggle „Arată/Ascunde".
- Share text / print PDF — verifică manual că template-ul referă doar `doc.note`, nu `doc.private_notes`.

## Checklist la orice feature nou AI

Înainte de merge pe un feature care adaugă un apel AI (nou chatbot, OCR LLM, clasificare, sumarizare, agent, etc.):

- [ ] Sursa de documente e `getDocumentsForAI()` sau trecută prin `sanitizeDocumentForAI`?
- [ ] Câmpul `private_notes` e absent din orice string serializat inclus în prompt?
- [ ] Nu există branch care, în anumite condiții (retry, fallback, error-path), să trimită documentul brut?

Dacă un test nou face `JSON.stringify(doc)` și rezultatul e inclus într-un `AiMessage.content`, asta e un leak — foloseste sanitize.

## Extinderi viitoare

Dacă se adaugă câmpuri noi sensibile (ex. pe entități: `Card.cvv`, `Person.parole`), aplică același pattern:
1. Tipul la sursă — JSDoc explicit că nu pleacă la AI.
2. Helper dedicat `sanitizeXForAI`.
3. Ruta AI-safe (`getXForAI`).
4. Adaugă în lista de mai sus.

## Testare manuală înainte de release

1. Introdu text recognoscibil în `private_notes` (ex. „CVV_TEST_9876").
2. Pornește chatbot-ul, pune o întrebare despre acel document.
3. Inspectează payload-ul HTTP (dev tools / proxy) trimis la Mistral/OpenAI.
4. Verifică că stringul „CVV_TEST_9876" NU apare în `messages[].content`.
