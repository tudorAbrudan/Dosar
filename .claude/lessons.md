# Lessons learned

_Adaugă lecții după corecții: cauză + regulă._

## 2026-03-15 – TypeScript

**Problemă:** Export `ALL_STANDARD_DOC_TYPES` creat cu `Object.keys({} as Record<...>)` — returnează array gol în loc de lista completă.
**Cauză:** Pattern incorect de a extrage cheile dintr-un tip TypeScript la runtime; tipurile nu există la runtime.
**Regulă:** Pentru a lista toate valorile unui union type, declară explicit un array constant (ex: `STANDARD_DOC_TYPES: DocumentType[] = ['buletin', 'pasaport', ...]`). Nu folosi `Object.keys()` pe un tip TypeScript.
**Aplicabil în:** `types/index.ts`, orice loc unde se încearcă iterarea unui union type

---

## 2026-03-15 – Architecture

**Problemă:** Hook-urile `useCustomTypes` și `useVisibilitySettings` nu aveau `error` state — eșecurile silențioase nu erau vizibile utilizatorului.
**Cauză:** Pattern incomplet la crearea hook-urilor: s-a adăugat `loading` dar s-a omis `error`.
**Regulă:** Orice hook cu operații async TREBUIE să aibă `error: string | null` state, resetat la `null` la start și setat în `catch`. Template: `{ loading, error, refresh, ...data }`.
**Aplicabil în:** Toate fișierele din `hooks/`

---

## 2026-03-15 – Security

**Problemă:** Cheia API Mistral stocată ca `EXPO_PUBLIC_MISTRAL_API_KEY` — variabilele `EXPO_PUBLIC_*` sunt bundle-uite în aplicație și vizibile oricui dezasamblează APK/IPA.
**Cauză:** Confuzie între variabile de build (sigure) și variabile runtime expuse în bundle.
**Regulă:** Nicio cheie API externă (Mistral, OpenAI, etc.) NU se pune în `EXPO_PUBLIC_*`. Alternativa corectă: proxy server propriu, sau user introduce cheia manual în setările aplicației (stocată în SecureStore).
**Aplicabil în:** `services/chatbot.ts`, orice serviciu care apelează API extern

---

## 2026-03-15 – SQLite

**Problemă:** Schema SQLite inițială fără indexuri pe coloanele frecvent filtrate (expiry_date, person_id, vehicle_id, etc.) — queries lente pe date mari.
**Cauză:** La MVP, datele sunt puține și problema nu e vizibilă; indexurile se uită.
**Regulă:** La crearea oricărei tabele noi cu coloane de filtrare/sortare frecventă, adaugă imediat `CREATE INDEX IF NOT EXISTS`. Coloane care necesită index: foreign keys (person_id, vehicle_id, etc.), date de expirare, orice coloană în WHERE.
**Aplicabil în:** `services/db.ts`, orice migrare nouă

---

## 2026-03-15 – Architecture (visibility propagation)

**Problemă:** `visibleDocTypes` aplicat parțial — în `add.tsx` și `expirari.tsx`, dar omis în `documente/index.tsx` (chip filtrare) și `documente/[id].tsx` (edit modal). Tipurile dezactivate apăreau în acele ecrane.
**Cauză:** Fiecare ecran construia propria listă din `DOCUMENT_TYPE_LABELS` direct, fără sursă unică de adevăr.
**Regulă:** Creează hook dedicat (`useFilteredDocTypes`) ca sursă unică. **Niciodată** nu construi liste selectabile de tipuri din `DOCUMENT_TYPE_LABELS` direct — mereu prin `useFilteredDocTypes()`. La orice feature nou cu picker de tipuri, verifică dacă folosește hook-ul.
**Aplicabil în:** Orice screen cu picker/chip list de tipuri de documente
