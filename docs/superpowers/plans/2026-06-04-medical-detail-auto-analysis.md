# Detalii medicale în auto-analiză — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-analiza („Analizez cu AI") extrage detaliile clinice complete (analize, medicamente, diagnostice) în câmpul `note` pentru toate tipurile medicale, nu doar headerul pacient/clinică.

**Architecture:** Schimbare de prompt + două plafoane de lungime într-un singur fișier (`services/aiOcrMapper.ts`). Se extrage descrierea `structuredNote` într-o constantă exportată (testabilă), i se adaugă clauze per-tip medical + plafon de rânduri condiționat, și se ridică cele două capace care trunchiau nota lungă (`max_tokens` 1400→1800, `AI_NOTES_MAX_LENGTH` 3000→6000). Pipeline-ul medical criptat, `ai_summary`, „Trimite la AI" și schema SQLite rămân neatinse.

**Tech Stack:** TypeScript, Expo/React Native, Jest (`__tests__/unit/`), Mistral via `aiProvider`.

**Spec:** `docs/superpowers/specs/2026-06-04-medical-detail-auto-analysis-design.md`

---

## File Structure

- **Modify:** `services/aiOcrMapper.ts`
  - Extrage `STRUCTURED_NOTE_SPEC` (export const) din string-ul inline de la ~linia 492; adaugă clauze medicale + plafon condiționat.
  - Export `MAPPER_VISION_MAX_TOKENS = 1800`; folosit la apelul `sendAiRequestWithImage`.
  - `AI_NOTES_MAX_LENGTH`: `3000` → `6000` + adaugă `export`.
- **Create:** `__tests__/unit/aiOcrMapperMedicalNote.test.ts` — testează conținutul `STRUCTURED_NOTE_SPEC` (toate tipurile din `MEDICAL_DOC_TYPES` + formatele) și valorile celor două plafoane.

Niciun alt fișier. Niciun audit script afectat (fără schemă, fără entități, fără manifest, fără chat medical/FTS).

---

### Task 1: Clauze medicale în `structuredNote` + ridicare plafoane

**Files:**
- Modify: `services/aiOcrMapper.ts` (string `structuredNote` ~linia 492; `AI_NOTES_MAX_LENGTH` linia 643; apel `sendAiRequestWithImage` ~linia 504)
- Test: `__tests__/unit/aiOcrMapperMedicalNote.test.ts`

- [ ] **Step 1: Write the failing test**

Creează `__tests__/unit/aiOcrMapperMedicalNote.test.ts`:

```typescript
import {
  STRUCTURED_NOTE_SPEC,
  MAPPER_VISION_MAX_TOKENS,
  AI_NOTES_MAX_LENGTH,
} from '@/services/aiOcrMapper';
import { MEDICAL_DOC_TYPES } from '@/types';

describe('STRUCTURED_NOTE_SPEC — clauze medicale', () => {
  it('menționează fiecare tip medical din MEDICAL_DOC_TYPES (guard la tipuri noi)', () => {
    for (const t of MEDICAL_DOC_TYPES) {
      expect(STRUCTURED_NOTE_SPEC).toContain(t);
    }
  });

  it('cere o linie per analiză cu interval de referință', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('o linie per analiză');
    expect(STRUCTURED_NOTE_SPEC).toContain('ref:');
  });

  it('cere o linie per medicament pentru rețete', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('o linie per medicament');
  });

  it('cere diagnostice + recomandări pentru scrisori/bilete/fișe', () => {
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Dd]iagnostic/);
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Rr]ecomand/);
  });

  it('cere cod ICD-10 pentru bilet de trimitere', () => {
    expect(STRUCTURED_NOTE_SPEC).toContain('ICD-10');
  });

  it('ridică plafonul de rânduri pentru medicale, păstrează 20 pentru rest', () => {
    expect(STRUCTURED_NOTE_SPEC).toMatch(/[Ff][Ăă]R[Ăă] limit/); // „FĂRĂ limită" pentru medicale
    expect(STRUCTURED_NOTE_SPEC).toContain('20 rânduri'); // plafon non-medical păstrat
  });
});

describe('Plafoane de lungime — nu trunchiază nota medicală lungă', () => {
  it('max_tokens vision e suficient pentru un panel mare', () => {
    expect(MAPPER_VISION_MAX_TOKENS).toBe(1800);
  });

  it('AI_NOTES_MAX_LENGTH încape un panel de ~50 analiți', () => {
    // ~50 linii × ~50 caractere + headere ≈ 3000+; 3000 tăia. ≥5000 dă headroom.
    expect(AI_NOTES_MAX_LENGTH).toBeGreaterThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/unit/aiOcrMapperMedicalNote.test.ts`
Expected: FAIL la compilare — `STRUCTURED_NOTE_SPEC` și `MAPPER_VISION_MAX_TOKENS` nu sunt exportate din `aiOcrMapper.ts` (TS2305 „has no exported member").

- [ ] **Step 3: Adaugă constantele exportate + clauzele medicale**

În `services/aiOcrMapper.ts`, ÎNAINTE de `export async function mapOcrWithAi` (~linia 280), adaugă constantele:

```typescript
/**
 * Plafon output pentru calea vision a mapper-ului. 1800 (vs. 1400 anterior)
 * ca un buletin de analize cu 40–50 analiți să nu trunchieze structuredNote.
 * Nu mai mare: plafonul lovește fiecare auto-trigger, orice tip de document.
 */
export const MAPPER_VISION_MAX_TOKENS = 1800;

/**
 * Descrierea câmpului `structuredNote` din promptul mapper-ului. Extrasă ca
 * să fie testabilă. Conține clauze per-tip; pentru tipurile medicale cere
 * detaliul clinic complet (oglindește SYSTEM_BY_TYPE din medicalExtractor.ts),
 * fără limita de 20 de rânduri aplicată restului.
 */
export const STRUCTURED_NOTE_SPEC =
  `rezumat structurat al TUTUROR fișierelor din textul OCR (separate prin '---'):\n` +
  `- Dacă există mai multe fișiere diferite: secțiune separată pentru FIECARE cu header clar (ex: 'RCA:', 'Factură:')\n` +
  `- factura: Furnizor, Nr. factură, Sumă totală, Scadență, Perioadă facturare, Adresă livrare/consum, Nr. client/contract, detalii consum (kWh, m³, Gcal etc. dacă apar). Include toate valorile și identificatorii găsiți.\n` +
  `- rca/casco: Nr. poliță, Asigurator, Vehicul, Perioadă valabilitate, Primă\n` +
  `- contract: Tip, Valoare, Toate părțile (nume, CNP/CUI), Durată, Obiect\n` +
  `- garantie: Produs, Serie, Perioadă garanție, Vânzător, Data cumpărare\n` +
  `- analize_medicale: o linie per analiză, format „Nume: Valoare Unitate (ref: Min–Max)". Include TOATE analizele găsite, grupate pe secțiuni dacă apar (hematologie, biochimie, lipide, tiroidiene, hepatice, renale, urinare). Nu omite niciun rând.\n` +
  `- reteta_medicala: o linie per medicament, format „Denumire concentrație — doză, frecvență, durată".\n` +
  `- scrisoare_medicala, bilet_externare, fisa_consultatie: fiecare diagnostic și recomandare pe rândul lui, cu etichetă („Diagnostic: ...", „Recomandare: ..."). Include perioada de internare dacă apare.\n` +
  `- imagistica: concluziile examinării (RMN/CT/Ecografie), fiecare concluzie pe rândul ei.\n` +
  `- bilet_trimitere: Diagnostic, Cod ICD-10, Specialitate trimis, Investigație.\n` +
  `- vaccin_persoana: Vaccin, Lot, Data administrării.\n` +
  `- alte tipuri: câmpurile cheie — identificatori, date, sume, părți implicate — format 'Câmp: Valoare'. Omite texte administrative și informații redundante.\n` +
  `LUNGIME: pentru tipurile medicale (analize_medicale, reteta_medicala, scrisoare_medicala, bilet_externare, imagistica, fisa_consultatie, bilet_trimitere, vaccin_persoana) include TOT conținutul clinic, FĂRĂ limită de rânduri. Pentru restul tipurilor: max 20 rânduri. null dacă OCR-ul nu conține nimic util.`;
```

- [ ] **Step 4: Folosește `STRUCTURED_NOTE_SPEC` în prompt**

În `services/aiOcrMapper.ts`, înlocuiește linia ~492 (valoarea inline a `"structuredNote"` din blocul FORMAT RĂSPUNS):

```typescript
  "structuredNote": "<rezumat structurat al TUTUROR fișierelor din textul OCR (separate prin '---'):\n- Dacă există mai multe fișiere diferite: secțiune separată pentru FIECARE cu header clar (ex: 'RCA:', 'Factură:')\n- factura: Furnizor, Nr. factură, Sumă totală, Scadență, Perioadă facturare, Adresă livrare/consum, Nr. client/contract, detalii consum (kWh, m³, Gcal etc. dacă apar). Include toate valorile și identificatorii găsiți.\n- rca/casco: Nr. poliță, Asigurator, Vehicul, Perioadă valabilitate, Primă\n- contract: Tip, Valoare, Toate părțile (nume, CNP/CUI), Durată, Obiect\n- garantie: Produs, Serie, Perioadă garanție, Vânzător, Data cumpărare\n- alte tipuri: câmpurile cheie — identificatori, date, sume, părți implicate — format 'Câmp: Valoare'. Omite texte administrative și informații redundante.\nMax 20 rânduri. null dacă OCR-ul nu conține nimic util.>"
```

cu:

```typescript
  "structuredNote": "<${STRUCTURED_NOTE_SPEC}>"
```

- [ ] **Step 5: Ridică `max_tokens` pe calea vision**

În `services/aiOcrMapper.ts`, la apelul `sendAiRequestWithImage` (~linia 499-505), înlocuiește literalul `1400`:

```typescript
    rawResponse = await sendAiRequestWithImage(
      systemMessage,
      prompt,
      imageBase64,
      'image/jpeg',
      1400
    );
```

cu:

```typescript
    rawResponse = await sendAiRequestWithImage(
      systemMessage,
      prompt,
      imageBase64,
      'image/jpeg',
      MAPPER_VISION_MAX_TOKENS
    );
```

- [ ] **Step 6: Ridică `AI_NOTES_MAX_LENGTH` și exportă-l**

În `services/aiOcrMapper.ts`, linia 643, înlocuiește:

```typescript
const AI_NOTES_MAX_LENGTH = 3000;
```

cu:

```typescript
export const AI_NOTES_MAX_LENGTH = 6000;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest __tests__/unit/aiOcrMapperMedicalNote.test.ts`
Expected: PASS (toate cele 8 it-uri verzi).

- [ ] **Step 8: Type-check + suita completă + audit**

Run: `npm run type-check`
Expected: zero erori.

Run: `npx jest __tests__/unit/ __tests__/smoke/`
Expected: PASS (nicio regresie; `aiOcrMapperFuel.test.ts` rămâne verde — n-am atins helperele).

Run: `node scripts/knowledge-audit.js --strict`
Expected: OK (`aiOcrMapper` deja înregistrat; n-am adăugat serviciu nou).

- [ ] **Step 9: Commit**

```bash
git add services/aiOcrMapper.ts __tests__/unit/aiOcrMapperMedicalNote.test.ts
git commit -m "feat: extract full medical detail into note in auto-analysis"
```

---

### Task 2: Verificare vizuală pe Simulator (Definition of Done) + raport colateral

**Files:** niciunul (verificare runtime).

- [ ] **Step 1: Pornește app-ul pe iOS Simulator**

Run: `npm run ios`
Expected: build OK, app pornit. Dacă build-ul pică, vezi `memory/ios_build_recovery.md` și raportează „NU am verificat UI pentru că build-ul a picat".

- [ ] **Step 2: Test buletin de analize (cazul-țintă)**

Necesită consimțământ AI activ (Setări → AI). Flux: Documente → Adaugă → atașează un buletin de laborator cu multe analize → așteaptă auto-analiza.
Expected: câmpul „Notă (rezumat)" conține o linie per analiză cu valoare + interval de referință (nu doar pacient + clinică + data). Nota NU e tăiată la mijloc.

- [ ] **Step 3: Test al doilea tip medical (rețetă)**

Atașează o rețetă medicală → auto-analiză.
Expected: nota listează medicamentele cu doză/frecvență/durată.

- [ ] **Step 4: Test non-medical (regresie plafon)**

Atașează un buletin/permis (document de identitate simplu) → auto-analiză.
Expected: nota rămâne concisă (headerul util), nu se umflă. Confirmă că plafonul de 20 de rânduri pentru non-medical e respectat.

- [ ] **Step 5: Verificare colaterală — consumatorul unic**

Citește `app/(tabs)/documente/add.tsx` în jur de linia 530 (`runAiOcrMapper`).
Expected: `result.structuredNote` se aplică la `note` fără presupuneri despre lungime (`setNote(result.structuredNote)`). Singurul consumator al `mapOcrWithAi`. Confirmă că nimic nu mai trunchiază nota după parse.

- [ ] **Step 6: Raport final „Verificat colateral"**

Scrie în mesajul de încheiere secțiunea obligatorie (CLAUDE.md §Definition of Done):

```
**Verificat colateral:**
- runAiOcrMapper (add.tsx): citit cod — aplică structuredNote la note, fără trunchiere proprie
- Simulator: buletin analize (detaliu complet), rețetă (medicamente), document simplu (notă concisă)
- npm run type-check + jest unit/smoke: verde
- knowledge-audit --strict: verde
- Pipeline medical / ai_summary / Trimite la AI: neatinse (doar prompt + plafoane în aiOcrMapper.ts)
```
```

---

## Self-Review

**1. Spec coverage:**
- Spec §1 „clauze medicale în structuredNote" → Task 1 Step 3-4. ✓
- Spec §2 „plafon de rânduri condiționat" → Task 1 Step 3 (linia LUNGIME) + test Step 1. ✓
- Spec §3a „max_tokens 1800" → Task 1 Step 5 + test. ✓
- Spec §3b „AI_NOTES_MAX_LENGTH 6000" → Task 1 Step 6 + test. ✓
- Spec „ce NU se schimbă (medical pipeline, ai_summary, private_notes, Trimite la AI, schemă)" → niciun task le atinge; raport Task 2 Step 6 confirmă. ✓
- Spec „verificare DoD (buletin, rețetă, doc scurt)" → Task 2 Step 2-4. ✓

**2. Placeholder scan:** Fără TBD/TODO. Toate step-urile de cod conțin codul efectiv (old + new string). ✓

**3. Type consistency:** `STRUCTURED_NOTE_SPEC`, `MAPPER_VISION_MAX_TOKENS`, `AI_NOTES_MAX_LENGTH` — aceleași nume în implementare (Task 1) și test (Step 1). `MEDICAL_DOC_TYPES` importat din `@/types` (confirmat existent, `types/index.ts:523`). ✓
