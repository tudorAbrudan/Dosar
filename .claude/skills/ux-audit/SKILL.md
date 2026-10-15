---
name: ux-audit
description: Analiză UX pentru o zonă a aplicației Dosar (ex. backup, AI, partajare) — capturi în simulator, verificare accesibilitate, texte confruntate cu codul, apoi propuneri ordonate pe impact. Doar analiză, fără implementare. Folosește-l când userul cere „analizează UX-ul pentru X", „de ce pare X un simplu titlu", „propune optimizări pentru ecranul Y".
argument-hint: "<zona sau ecranul>"
---

# Audit UX pe o zonă din Dosar

Rezultatul e un raport, nu un diff. Nu modifica fișierele aplicației până nu aprobă userul propunerile.

## 1. Harta zonei (din cod, înainte de simulator)

- Găsește toate ecranele/componentele zonei: `grep -rlnI -i "<cuvânt-cheie>" app components hooks`.
- Pentru fiecare: ruta, de unde se ajunge (câte tap-uri de pe Acasă), ce acțiuni oferă, ce stare afișează.
- Notează căile paralele care fac „același lucru" (ex. restore ZIP vs restore iCloud) — diferențele de semantică dintre ele sunt de obicei sursa confuziei.

## 2. Capturi (skill-ul `run-ios`)

- Verifică întâi mărimea textului din simulator: `xcrun simctl ui <udid> content_size`. Capturile reprezentative se fac la `large`; restaurează valoarea inițială la final. O captură în plus la o mărime accessibility e utilă dacă zona are text dens.
- Dacă aplicația e deja instalată și Metro rulează, `launch_app_sim` ajunge (JS-ul vine de la Metro); `build_run_sim` doar dacă s-a schimbat cod nativ.
- Capturează fiecare stare relevantă: gol / dezactivat / indisponibil / în progres / eroare. Stările care nu se pot produce în simulator (iCloud, CloudKit) se reconstruiesc din cod și se marchează „neverificat vizual".
- Salvează capturile cu nume descriptive în scratchpad (`01-<ecran>-<stare>.jpg`).

**Derulare precisă:** `swipe` din XcodeBuildMCP și `idb ui swipe` aruncă ScrollView-ul cu inerție până la capăt. Ce funcționează: `idb ui describe-all --udid <udid>` → citește `frame.y` al elementului țintă → un swipe lent (`--duration 5 --delta 2`) → re-citește poziția. Tap pe coordonate: `idb ui tap --udid <udid> x y` (puncte, nu pixeli). Primul tap după lansare se poate pierde — repetă-l.

## 3. Accesibilitate (din `idb ui describe-all`)

Pentru fiecare element interactiv:
- `type` = `Button` (nu `GenericElement`) → altfel lipsește `accessibilityRole`, VoiceOver nu-l anunță ca buton;
- `enabled` corespunde cu aspectul vizual (un buton dezactivat care arată activ e bug);
- `AXLabel` nu conține glife Ionicons (`\uf...`) → lipsește `accessibilityLabel`;
- înălțimea `frame.height` ≥ 44 pt pentru zonele de tap;
- selecțiile (radio, checkmark) expun starea selectată.

## 4. Texte vs cod

Delegă agentului de domeniu, în fundal, cât faci capturile:
- backup / iCloud / partajare → `backup-guardian`, modul „Verifică textele backup-ului";
- formulare → `form-consistency-guard`;
- altă zonă → `Explore` cu lista de texte și întrebarea „ce face codul de fapt?".

Cere verdict per text cu dovadă `fișier:linie`. Include și `services/appKnowledge.ts` — chatbot-ul repetă aceleași promisiuni.

## 5. Raport

Ordinea secțiunilor:
1. **Ce vede userul** — 3-5 observații principale, fiecare legată de o captură.
2. **Texte care nu spun adevărul** — doar cele cu verdict FALS / PARȚIAL, cu reformularea propusă.
3. **Bug-uri găsite în treacăt** — separat de UX, cu `fișier:linie`.
4. **Propuneri** — grupate pe impact (P0 = userul poate pierde date sau e indus în eroare; P1 = ierarhie/descoperire; P2 = finisaj), fiecare cu fișierele atinse și efort estimat (S/M/L).
5. **Ce n-am verificat** și de ce (ex. iCloud în simulator).

Dacă raportul e lung sau va fi citit de altcineva, publică-l ca artifact și dă link-ul.
