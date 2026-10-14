---
date: 2026-10-13
tags: [ai, privacy, gdpr, audit, regression]
trigger: adaugi/modifici un flux care trimite conținut de document la AI, sau un text care descrie ce pleacă la AI
---

# Gate-ul AI se verifică pe funcție, iar „local" se decide din ruta datelor

## Problemă
- Completarea automată din `documente/add.tsx` (`runAiOcrMapper` → `mapOcrWithAi`) trimitea în cloud
  textul + poza documentelor medicale și a buletinelor fără niciun gate. Audit-ul de guard trecea,
  fiindcă verifica doar că fișierul conține `ensureAiAnalysisAllowed` (folosit de butonul manual).
- „Model local + provider OCR remote" era tratat peste tot ca „nimic nu pleacă" (`type === 'local'`),
  deși pozele mergeau în cloud — fără acord medical, fără acord per tip, fără bara de consimțământ.
- Textele (Setări, onboarding, consimțământ medical, politica de confidențialitate) promiteau lucruri
  false: „niciodată automat", „fotografiile nu se trimit", „fără server intermediar".

## Cauză
Fluxuri noi adăugate în timp lângă unele vechi, fiecare cu propria idee despre „local" și propriul
gate (sau fără). Audit la nivel de fișier = o singură funcție gardată acoperă tot fișierul.

## Regulă
1. „Pleacă ceva de pe telefon?" → DOAR `getAiRoute` / `aiRouteLeavesDevice`. Niciodată `type === 'local'`.
2. Fiecare funcție care trimite la AI apelează ea însăși gate-ul potrivit (`ensureAiAnalysisAllowed` /
   `ensureAutoAiAllowed` / `getScanAiAccess`). Audit-ul AST verifică asta.
3. Acord medical → `isMedicalAiConsentValid`; text de consimțământ schimbat material → bump
   `MEDICAL_AI_CONSENT_VERSION`.
4. Un flux AI nou = actualizezi și textele care descriu ce pleacă (vezi checklist-ul din `rules/ai-privacy.md`).

## Aplicabil
`services/aiGuard.ts`, `services/aiProvider.ts`, orice ecran din `app/` / `components/` care cheamă
`aiOcrMapper`, `ocrLlmExtractor`, `aiClassifier` sau `sendAiRequestWithImage`.
