# Design — AI OCR pentru bonuri de carburant

**Data:** 2026-05-02
**Scope:** Înlocuiește pipeline-ul on-device (ML Kit + regex) pentru scanarea bonurilor de la benzinărie cu o variantă AI (Mistral/OpenAI vision) care păstrează regex-ul ca fallback per-câmp.
**Status:** approved (brainstorming)

## Problema

`handleScanReceipt` din `app/(tabs)/entitati/fuel.tsx:118` rulează:

```
poză → @react-native-ml-kit/text-recognition → text brut
     → extractFuelInfo(text)  (regex în services/ocr.ts:109)
     → câmpuri (liters, km, price, date, station)
```

Regex-ul greșește frecvent pe bonurile reale fiindcă:

- Layout-urile diferă mult între branduri (OMV / MOL / Petrom / Rompetrol).
- Informația critică (litri, preț unitar, total) e în coloane / tabel; regex-ul liniar pierde structura.
- "Total" prinde primul match — adesea subtotal sau preț/litru, nu totalul de plată.
- "KM" prinde uneori nr. bon sau cod fiscal cu 5-6 cifre.

Pipeline-ul AI există deja în app pentru documente (RCA, talon, factură) prin `services/aiOcrMapper.ts:71` (`mapOcrWithAi`) — dar e specific documentelor și include logică pe care bonurile nu o folosesc (entități, prompt mare cu 25+ tipuri).

## Decizii UX (din brainstorming)

| Decizie | Aleasă |
|---|---|
| Strategie AI vs on-device | (b) Înlocuire cu fallback per-câmp la regex |
| Câmpuri extrase | (a) Câmpurile actuale: `liters, km, price, date, station` (NU `pump_number`, `fuel_type`, `is_full`) |
| Vision (poza) sau text-only | (b) Text + poza base64 (vision) |

## Arhitectură

### Funcție nouă în `services/aiOcrMapper.ts`

```ts
export interface FuelAiResult {
  liters?: number;
  km?: number;
  price?: number;
  date?: string;    // YYYY-MM-DD
  station?: string;
}

export async function mapFuelReceiptWithAi(
  ocrText: string,
  imageBase64: string
): Promise<FuelAiResult>;
```

Returnează același shape ca `FuelInfo` din `services/ocr.ts:47` ca să nu modificăm modal-ul / state-ul din `fuel.tsx`.

**De ce funcție separată, nu reuses `mapOcrWithAi`:**

- `mapOcrWithAi` cere `AvailableEntities` (irelevant pentru bon — bonul e legat implicit de vehiculul deschis în ecran).
- Returnează `entitySuggestions`, `documentType`, `structuredNote` — nimic util aici.
- Promptul lui e ~2000 caractere despre 25+ tipuri de documente; scade acuratețea pe bon și consumă tokens inutil.
- Funcția nouă: prompt scurt (~600 char), output strict cu 5 câmpuri, mai puține halucinații.

### Helper-uri reutilizate

- `sanitizeOcrText(text)` din `aiOcrMapper.ts:59` — extras în top-level helper exportat (nu mai e privat).
- `sendAiRequestWithImage(systemMessage, prompt, imageBase64, 'image/jpeg', maxTokens)` din `services/aiProvider.ts`.
- `extractFuelInfo(text)` din `services/ocr.ts:109` — păstrat fără modificări (e fallback-ul).

### Flow nou în `handleScanReceipt`

```
1. ImagePicker.launchCameraAsync({ base64: true, ... })  ← adăugat base64
2. const { text } = await extractText(uri)               ← ML Kit, nemodificat
3. let aiResult: FuelAiResult = {}
   try {
     aiResult = await mapFuelReceiptWithAi(text, base64)
     aiResult = validateFuelAiResponse(aiResult)
   } catch (err) {
     console.warn('[fuel-ai] failed:', err.message)
     // aiResult rămâne gol → fallback per-câmp
   }
4. const regexResult = extractFuelInfo(text)             ← rulat ÎNTOTDEAUNA
5. const final = mergeFuelResults(aiResult, regexResult)
   // pentru fiecare câmp: AI dacă valid, altfel regex, altfel undefined
6. populează modal cu `final`; alert dacă e gol
```

**De ce rulăm regex-ul mereu, nu doar la fallback:**

- Cost zero (pure function, milisecunde).
- Acoperă cazul în care AI a ratat un câmp dar regex-ul l-a prins (sau invers).
- AI = autoritate (mai precis), regex = safety net per-câmp, nu doar per-scan.

## Promptul AI

**System message:**

> Ești un expert în extragerea datelor din bonuri de carburant românești. Returnează exclusiv JSON valid, fără text suplimentar.

**User prompt** (~600 char):

```
Extrage datele din bonul de carburant. TEXT OCR:
"""
{sanitizedOcr}
"""

Câmpuri de extras (toate opționale, omite ce nu e clar):
- liters: cantitatea de carburant (număr cu zecimale, ex: 42.31)
- price: TOTALUL de plată (NU preț/litru, NU subtotal). Caută "Total", "De plată", "Suma" — ia ULTIMA valoare dacă apar mai multe (număr, ex: 285.50)
- km: kilometrajul total al vehiculului (5-7 cifre). Apare lângă "KM", "Odometru". NU confunda cu nr. bon, cod fiscal, ora, dată.
- date: data bonului (YYYY-MM-DD). Convertește din ZZ.LL.AAAA.
- station: brand benzinărie + oraș/adresă scurtă (ex: "OMV Cluj-Napoca, Calea Turzii"). Branduri RO: OMV, MOL, Petrom, Lukoil, Rompetrol, Socar, Gazprom, Shell, BP, Avia, Eko.

Returnează EXCLUSIV JSON:
{"liters": <număr|null>, "price": <număr|null>, "km": <int|null>, "date": "<YYYY-MM-DD|null>", "station": "<text|null>"}
```

**Decizii cheie:**

- `liters` și `price` ca numere (nu string) → fără parsing dublu.
- `km` ca integer strict.
- Avertismente explicite pe trap-uri comune (preț/litru vs total, nr. bon vs km).
- `max_tokens: 400`.
- Apel: `sendAiRequestWithImage(systemMessage, prompt, imageBase64, 'image/jpeg', 400)`.

## Validare răspuns

Toate validările aplicate **înainte** ca rezultatul să intre în merge:

```ts
function validateFuelAiResponse(parsed: unknown): FuelAiResult {
  const r: FuelAiResult = {};
  if (!parsed || typeof parsed !== 'object') return r;
  const p = parsed as Record<string, unknown>;

  // liters: număr pozitiv, plauzibil pentru un bon (0.5 < L < 200)
  if (typeof p.liters === 'number' && p.liters > 0.5 && p.liters < 200) {
    r.liters = p.liters;
  }

  // price: număr pozitiv, plauzibil (1 < RON < 5000)
  if (typeof p.price === 'number' && p.price > 1 && p.price < 5000) {
    r.price = p.price;
  }

  // km: integer plauzibil (1000 < km < 9_999_999)
  if (typeof p.km === 'number' && Number.isInteger(p.km) && p.km > 1000 && p.km < 9_999_999) {
    r.km = p.km;
  }

  // date: YYYY-MM-DD valid, în ultimii 2 ani și nu în viitor
  if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    const d = new Date(p.date);
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    if (!isNaN(d.getTime()) && d <= now && d >= twoYearsAgo) {
      r.date = p.date;
    }
  }

  // station: string non-vid, max 100 chars
  if (typeof p.station === 'string' && p.station.trim()) {
    r.station = p.station.trim().slice(0, 100);
  }

  return r;
}
```

Domenii alese:

- `liters > 0.5` — exclude valori absurde (ex: AI confundă "0.0" preț/litru cu litri).
- `liters < 200` — un rezervor normal e ≤ 100 L; 200 e safety net pentru tractare/rabă.
- `price < 5000` — chiar și cu motorină scumpă, > 5000 RON la o singură alimentare e implauzibil.
- `km > 1000` — exclude nr. bon cu 4 cifre (ex: "1234").
- `date` în ultimii 2 ani — exclude date OCR-ite greșit (ex: 2099, 1985).

## Merge AI + regex

```ts
function mergeFuelResults(ai: FuelAiResult, regex: FuelInfo): FuelInfo {
  return {
    liters:  ai.liters  ?? regex.liters,
    km:      ai.km      ?? regex.km,
    price:   ai.price   ?? regex.price,
    date:    ai.date    ?? regex.date,
    station: ai.station ?? regex.station,
  };
}
```

Strategy: **AI per-câmp wins**. Dacă AI-ul a returnat `liters` valid, îl folosim. Dacă AI-ul l-a omis (sau a fost invalidat), cădem pe regex pentru acel câmp specific.

## UX & mesaje

| Situație | Comportament | Mesaj |
|---|---|---|
| AI succes, câmpuri populate | Modal cu valori pre-completate | (silent — UX neschimbat) |
| AI eșuează, regex prinde ceva | Modal cu valori pre-completate (din regex) | (silent — userul nu vede că AI-ul a picat) |
| AI + regex amândouă goale | Alert | `"Nu s-au putut extrage date din bon. Completează manual."` |
| Eroare la `extractText` (ML Kit) | Alert | `"Nu s-a putut citi bonul. Completează manual."` |

**Loading:** state existent `mLoading` rămâne. Textul butonului "Fotografiază bonul (OCR)" se schimbă din `"Se procesează..."` (existent la `fuel.tsx:442`) în `"Se analizează bonul..."` pe durata `mLoading`. Restul UI rămâne identic.

**Niciodată nu blocăm fluxul:** fail-ul AI nu cere acțiune (no "Reîncearcă cu AI?" buton). Userul completează manual.

**Logging:** `console.warn('[fuel-ai] failed:', err.message)` în catch — fără date sensibile.

## Privacy / AI rules check

Conform `app/.claude/rules/ai-privacy.md`:

- ✅ Nu trimitem `Document.private_notes` (bonurile nu sunt documente).
- ✅ Trimitem doar text OCR + poza bonului — date pe care userul le-a ales explicit să le scaneze.
- ✅ Niciun ID intern (vehicle_id) nu pleacă la AI — promptul nu are nevoie de context.

## Modificări necesare

| Fișier | Modificare |
|---|---|
| `services/aiOcrMapper.ts` | + `mapFuelReceiptWithAi`, `validateFuelAiResponse`, `mergeFuelResults`, `FuelAiResult`. Extrage `sanitizeOcrText` ca helper exportat. |
| `app/(tabs)/entitati/fuel.tsx` | `handleScanReceipt`: cere `base64: true` din ImagePicker, rulează AI cu fallback la regex, merge câmpurilor. Adaugă import `mapFuelReceiptWithAi`. |
| (opțional) `services/ocr.ts` | Niciun change. `extractFuelInfo` rămâne ca fallback. |

**Niciun:**

- DB schema change → niciun touch pe `services/db.ts`, `backup.ts`, `cloudSync.ts`.
- Tip nou în `types/index.ts`.
- Translații / texte UI noi (mesajele de alert sunt deja în RO).
- Setări noi (folosește configurația AI existentă).

## Testing

**Unit (Jest):**

- `validateFuelAiResponse` — date in/out cu valori la marginea plajelor (0.4 L → respins, 0.5 L → respins, 0.6 L → acceptat etc.).
- `mergeFuelResults` — AI complet, AI parțial, AI gol → merge corect cu regex.

**Manual pe device (obligatoriu — bonurile reale variază):**

1. Scanează bon OMV — verifică `station = "OMV ..."`, `liters` corect, `price` = total nu subtotal.
2. Scanează bon MOL / Petrom / Rompetrol — la fel.
3. Scanează bon fără KM imprimat — verifică că modalul nu primește un fals KM (din nr. bon).
4. Activează modul avion înainte de scan — verifică fallback la regex (silent), modal populat din regex.
5. Scanează o poză aleatoare (NU un bon) — verifică alert "Nu s-au putut extrage date".
6. Confirmă în devtools că `private_notes` (al unui document existent) NU apare în payload-ul HTTP trimis la AI provider.

## Out of scope

- `pump_number`, `fuel_type`, `is_full` (decis: nu).
- Buton separat "Scanează cu AI" (decis: nu, înlocuire totală cu fallback).
- Cache pe rezultate AI (un bon nu se rescanează).
- Trimitere multi-imagine (un bon = o poză).
- Schimbarea provider-ului AI sau a configurației.
