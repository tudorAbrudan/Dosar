# Design: Notă AI structurată din OCR

**Data:** 2026-04-14  
**Status:** Aprobat

## Problemă

Câmpul `note` al documentelor era completat de o funcție locală simplă (`formatOcrSummary`) — extracție regex, nu AI. Câmpul `aiNotes` returnat de `mapOcrWithAi` era complet ignorat. Chatbot-ul includea nota în context cu spațiu insuficient (trunchiată la câteva zeci de caractere împreună cu restul câmpurilor).

## Obiective

1. Câmpul `note` = lista structurată completă de câmpuri cheie extrase de AI din document (inclusiv ce e deja în metadata — chatbot-ul caută în `note` și `ocr_text`, nu în alte câmpuri)
2. AI suprascrie mereu `note` când rulează analiza OCR (simplu, fără flag-uri)
3. Chatbot primește mai mult spațiu pentru `note` față de OCR brut

## Design

### 1. `services/aiOcrMapper.ts` — prompt extins

Câmpul `aiNotes` din prompt devine `structuredNote` cu instrucțiuni clare:

```json
{
  "structuredNote": "<listă completă cu toate informațiile cheie extrase din document.\nFormat:\nCâmp: Valoare\nCâmp: Valoare\n...\nInclude TOT ce e relevant: tip document, date, câmpuri metadata, orice informație utilă din OCR.\nMaxim 15 rânduri, concis. null dacă OCR-ul nu conține nimic util.>"
}
```

- `AI_NOTES_MAX_LENGTH`: 300 → **1000 caractere**
- Câmpul se numește în continuare `aiNotes` în interfața `AiOcrResult` (redenumire internă în prompt only)

### 2. `app/(tabs)/documente/add.tsx` — salvarea notei

Când AI returnează `structuredNote` (non-null, non-empty):
- **Întotdeauna** `setNote(structuredNote)` — suprascrie orice valoare anterioară (inclusiv fallback-ul local)
- `formatOcrSummary` rămâne ca preview rapid (apare imediat, înainte de răspunsul AI)
- Când AI răspunde → suprascrie preview-ul local

Nu există flag `noteEditedByUser`. Simplitate deliberată: dacă AI rulează, nota e a AI-ului.

### 3. `services/chatbot.ts` — context chatbot

Limite OCR simplificate (eliminate diferențierile default/filtrat):

| Situație | Limit actual | Limit nou |
|----------|-------------|-----------|
| Notă document | ~50 chars (inline) | **500 chars** (câmp dedicat) |
| OCR default | 300 chars | **1000 chars** |
| OCR filtrat (entitate/tip) | 800 chars | **1000 chars** (eliminat, unificat) |
| OCR full (căutare text) | 3000 chars | 3000 chars (neschimbat) |

Ordinea câmpurilor per document în context:
```
- [DOC:label|id] (entitate) | emis: ... | expiră: ... | notă: <500 chars> | meta: ... | OCR: <1000 chars>…
```

Constantele devin:
```typescript
const NOTE_LIMIT = 500;
const OCR_LIMIT = 1000;       // toate documentele, înlocuiește DEFAULT și FILTERED
const OCR_LIMIT_FULL = 3000;  // doar pentru documente găsite prin căutare text
```

## Fișiere modificate

1. `services/aiOcrMapper.ts` — prompt `structuredNote`, `AI_NOTES_MAX_LENGTH` = 1000
2. `app/(tabs)/documente/add.tsx` — `setNote(result.aiNotes)` după AI call
3. `services/chatbot.ts` — `NOTE_LIMIT`, `OCR_LIMIT` unificate, ordine câmpuri în context

## Ce nu se schimbă

- `ocr_text` continuă să salveze textul brut/structurat complet din OCR
- Câmpul `note` rămâne editabil manual de utilizator în UI
- Structura DB — nicio migrare necesară
- Fluxul de adăugare document — nicio schimbare vizuală
