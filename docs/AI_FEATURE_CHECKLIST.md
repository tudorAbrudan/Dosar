# Definition of Done — feature-uri AI / OCR

Lecție din sesiunea 2026-05-24: `npm run type-check` + characterization tests +
subagent code review = NECESAR dar NU SUFICIENT pentru feature-uri AI/OCR.
Singurul lucru care prinde bug-urile reale e rularea efectivă împotriva
input-ului real al userului.

Înainte de a declara done un feature AI/OCR, bifează FIECARE punct.
Dacă nu poți bifa unul, feature-ul nu e done — explică în mesajul către user.

## Checklist

### 1. Prompt-ul testat împotriva input real

- [ ] Există un fixture OCR în `__tests__/fixtures/ocr/<descriere>.txt` cu
      conținut real (nu inventat de tine).
- [ ] `scripts/test-ai-prompts.js` rulat împotriva fixture-ului afișează
      output AI complet + parsed result + verificare automată „ar trebui să
      returneze X" cu ✅/❌.
- [ ] Pentru clasificator: ambele căi (heuristic `detectDocumentType` + AI
      `aiClassifier`) returnează ACELAȘI rezultat — verificat automat prin
      `scripts/classifier-divergence-audit.js`.

### 2. Eșec-ul AI e VIZIBIL pe device

- [ ] Niciun `catch { console.warn(...) }` în jurul apelului AI fără
      surfacing vizibil (Alert / Toast / inline UI status).
- [ ] User-ul vede mesajul AI (`e.message`) când eșuează, nu doar „eroare
      necunoscută".
- [ ] Sugestia de acțiune e prezentă în mesajul de eroare („verifică cheia",
      „adaugă propria cheie în Setări", „limita zilnică atinsă").
- [ ] `scripts/silent-catch-audit.js` rulat — nu raportează violări noi.

### 3. Background async are feedback

Dacă feature-ul folosește `extractAsync` (fire-and-forget) sau pattern
similar:

- [ ] Există indicator vizibil pe document/entitate cât timp rulează („AI
      procesează…" badge / spinner).
- [ ] La finalizare, toast / notificare cu rezultat scurt („Rezumat AI
      generat" sau „Extracție eșuată — verifică Setări").
- [ ] Există un punct UI clar pentru retry manual (buton „Re-extrage" sau
      echivalent) dacă feature-ul a eșuat silent în background.

### 4. Triggere multiple acoperite

Pentru feature-uri legate de tipul / starea documentului:

- [ ] Trigger la upload inițial — verificat.
- [ ] Trigger la schimbare manuală tip (în Edit) — verificat că re-rulează.
- [ ] Trigger la asociere nouă entitate (entity link change) — verificat.
- [ ] Trigger la modificare câmp relevant (issue_date pentru reminders) —
      verificat sau intenționat exclus.

### 5. Calendar events — format consistent

Dacă feature-ul creează calendar events:

- [ ] Folosește `buildCalendarEventPayload` din `services/calendarEvent.ts`
      (NU construiește direct cu `createEventAsync`).
- [ ] Câmpuri obligatorii prezente: title, notes cu label + sursă +
      entitate-context + link site `https://tudorabrudan.github.io/Dosar`
      + deep link `acte:///`, timezone `Europe/Bucharest`, url field setat.

### 6. Privacy / izolare

Pentru feature-uri care generează text via AI și-l persistă:

- [ ] Decis explicit: textul intră în context-ul chat-ului (FTS) SAU NU.
- [ ] Audit script blochează scurgerea accidentală (vezi
      `scripts/medical-ai-summary-isolation-audit.js` ca model).
- [ ] Backup + cloudSync includ noul câmp (verificat cu
      `scripts/backup-audit.js --strict`).

### 7. Rulat pe device cu user real

- [ ] Build cu `npm run ios` sau `npx expo run:ios --device`.
- [ ] Test scenario complet rulat manual: upload → extracție → vezi
      rezultatul → confirm acțiunea finală (event în Calendar etc.).
- [ ] Screenshot la rezultatul final atașat în PR sau raportat user-ului.

---

## Anti-pattern-uri (NU face)

- ❌ Declarat „done" pe baza că type-check + tests trec (asta dovedește
     forma codului, nu comportamentul).
- ❌ Plan cu „Task N: E2E manual rulează userul" ca punct final — userul a
     plătit pentru implementare, nu pentru testare.
- ❌ `catch (e) { console.warn('AI failed:', e); return null; }` —
     trebuie surfacing vizibil sau nu surface deloc.
- ❌ Asumat că AI returnează exact ce zice prompt-ul — întotdeauna parsez
     defensiv cu fallback.
- ❌ Două căi care fac același lucru (regex + AI clasificator) fără audit
     că rămân sincronizate.

## Update istoric

| Data | Cauza adăugării | Cine |
|---|---|---|
| 2026-05-24 | 13 task-uri „done" toate cu bug-uri critice care s-au descoperit doar la rulare pe device | Tudor |
