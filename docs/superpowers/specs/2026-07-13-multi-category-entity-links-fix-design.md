# Fix: selectare entități din mai multe categorii la adăugare document

**Data:** 2026-07-13
**Tip:** bug fix (nu feature nou)
**Fișier afectat:** `app/(tabs)/documente/add.tsx`

## Problema

Userul vrea ca la adăugarea unui document (ex: contract casă) să poată lega
documentul de entități din mai multe categorii simultan (persoanele implicate +
proprietatea). Arhitectura suportă deja acest lucru complet:

- `document_entities` — junction table many-to-many, orice tip de entitate.
- `add.tsx` ține `entityLinks: DocumentEntityLink[]` și salvează toate
  link-urile via `extra_entity_links` la `createDocument`.
- `EntityLinkPicker` are tab-uri pe categorii cu contoare `(n)` și sumar cu
  toate entitățile selectate.
- `edit.tsx` suportă deja multi-categorie (pattern modal).

**Bug-ul:** efectul din `add.tsx:254-260` resetează `pickerCategory` înapoi la
prima categorie cu link-uri de fiecare dată când userul comută pe un tab fără
link-uri. Odată selectată o persoană, tap pe „Proprietăți" → snap-back imediat
pe „Persoane". A doua categorie e inaccesibilă.

Efectul e și redundant: ambele căi de auto-link (fuzzy match OCR —
`add.tsx:368`, sugestie AI — `add.tsx:618`) apelează deja `setPickerCategory`
explicit. Singurul comportament real al efectului e snap-back-ul dăunător.

## Decizie (aprobată de user)

**Fix minimal:** ștergerea completă a efectului (liniile 251-260, inclusiv
comentariul). Fără schimbări de UX în picker.

Alternative respinse:
- Auto-switch doar la link-uri programatice (ref „manual choice") — complexitate
  inutilă; căile de auto-link își setează singure tab-ul.
- Redesign picker cu toate categoriile vizibile simultan — schimbare UX mare,
  nejustificată.

## Comportament după fix

- Tab-urile de categorie comută liber, indiferent de link-urile existente.
- Selecțiile din alte categorii rămân intacte (contorul `(n)` pe tab + sumarul
  de sub titlu arată tot ce e selectat).
- Auto-link (OCR / AI) comută în continuare tab-ul pe categoria sugerată, prin
  apelurile explicite existente.
- La ștergerea ultimului link din tab-ul curent, tab-ul rămâne pe loc (înainte
  sărea la altă categorie — comportament oricum nedorit).

## Verificare

- `npm run type-check` + lint.
- iOS Simulator: adaugă document → selectează persoană → comută pe
  „Proprietăți" (tab-ul NU mai sare înapoi) → selectează proprietatea →
  salvează → detaliul documentului arată ambele link-uri.
- Blast radius: `pickerCategory` e consumat doar de `EntityLinkPicker` și de
  `toggleEntityLink`/`pickerEntities` în `add.tsx`; nicio altă dependență.
