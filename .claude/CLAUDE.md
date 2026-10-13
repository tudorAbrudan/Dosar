# CLAUDE.md — Dosar (documente personale)

Aplicație iOS (React Native + Expo, TypeScript) pentru documente personale: acte, vehicule (talon, RCA, ITP, vignetă), proprietăți, carduri (fără CVV), animale, firme, dosar medical, facturi.

- **Apple-only.** Android nu se livrează — ignoră-l la decizii de arhitectură.
- **Local-first:** SQLite (`expo-sqlite`) + fișiere pe device = sursa de adevăr. Fără cont/login propriu.
- **Backup:** ZIP manual + iCloud Drive (`services/cloudSync.ts`). **Partajare household:** CloudKit (`CKShare` + `CKSyncEngine`, modul Swift `modules/expo-cloudkit-share`).
- **AI:** model local GGUF (`llama.rn`, text-only) sau cloud prin `ai-proxy/` (singura componentă server; cheia Mistral stă acolo, nu în bundle).
- **Repo PUBLIC** (`tudorAbrudan/Dosar`; `docs/` = site GitHub Pages). Plan și note interne stau intenționat în afara repo-ului: `../PLAN.md`, `../docs/` (DESIGN_SYSTEM, INTREBARI_SI_IDEE, specs/plans vechi).
- **Pornește Claude din `app/`** (rădăcina git) — aici e config-ul versionat.

La începutul sesiunii: citește `.claude/lessons/INDEX.md` și deschide doar lecțiile cu tag/trigger relevant.

## Comenzi

```bash
npm start                         # expo start --clear (Metro)
npm run ios                       # build + run pe iPhone-ul fizic
npm run prebuild                  # regenerează ios/ (gitignored) + scripts/patch-*.js
npm run audit                     # type-check + toate audit-urile + characterization + ast-grep
npm test                          # jest
npm run test:characterization     # db/backup/cloudSync lock-uite (~1s)
npm run lint / lint:fix / format
npm run setup-hooks               # activează scripts/hooks/pre-commit (o dată după clone)
node scripts/update-site.js       # regenerează docs/*.html + README din types/appKnowledge/localModel
node scripts/bump-version.js --check   # versiune sincronă app.json ↔ package.json ↔ ios/
```

Niciodată `npx react-native start`.

## Structură

```
app/            Expo Router (tabs: Home, Entități, Documente, Expirări, Setări)
components/     reutilizabile; components/ui/ = FormPageScreen, FormSheetModal, SheetHeader
hooks/          contract {loading, error, refresh}
services/       db, backup, cloudSync, documents, entities, appKnowledge, aiProvider, …
types/index.ts  sursa unică pentru EntityType / DocumentType
theme/          design system (colors, docTypeIcons, docTypeColors)
modules/        module native Swift (cloudkit-share, perspective-crop, pdf-renderer)
scripts/        audit scripts + patch-uri prebuild + hooks/pre-commit
ai-proxy/       proxy AI (Danube Rapids), teste proprii pe node --test
__tests__/      unit + characterization (better-sqlite3 in-memory)
```

## Workflow

1. **Plan first:** la task-uri cu 3+ pași sau mai multe fișiere — citește, listează fișierele și dependențele, prezintă planul, apoi implementează.
2. **Definition of Done** (secțiunea de mai jos) — obligatoriu pentru orice task non-trivial.
3. **Regresie → audit nou:** când userul raportează „ai stricat X", PRIMUL pas e un audit script care detectează automat pattern-ul (`scripts/`, legat în `npm run audit` + `scripts/hooks/pre-commit`, apoi `node scripts/audit-index.js`). Al doilea pas e fix-ul.
4. **Lecții:** după o corecție → `.claude/lessons/YYYY-MM-DD-<topic>.md` (front-matter `date`, `tags`, `trigger`) + rând în `.claude/lessons/INDEX.md`. Contextul de mașină/personal (căi locale, device-uri, incidente) merge în memoria auto, nu în repo.
5. **Fișiere mari (>400 linii):** la editări semnificative, planifică split incremental (`node scripts/file-size-audit.js`).
6. **Design:** un singur design system (EVPoint + `#9EB567`) — vezi `rules/design.md`.

## Definition of Done (obligatoriu)

„Done" = „am verificat că n-am rupt nimic colateral", nu „ce am modificat funcționează". Se aplică la: ≥3 fișiere, ecran nou, schemă SQLite, hook nou, orice modificare în `services/`.

**1. Blast Radius (în plan, ÎNAINTE de cod).** Listează explicit:
- simboluri modificate → toți consumatorii (find-references / Grep pe nume);
- tabel/coloană SQLite → toate locurile care citesc/scriu (`services/`, `hooks/`, `app/`);
- tip/enum (`EntityType`, `DocumentType`, `DOCUMENT_TYPE_LABELS`) → toate aparițiile;
- audit scripts care trebuie să rămână verzi;
- ecrane adiacente care folosesc același service/hook.
Dacă lista e goală, scrie „nicio dependență detectată".

**2. Verificare colaterală (DUPĂ implementare).** Pentru fiecare item: cod → callsite-ul e compatibil; UI → click prin flow în simulator (skill-ul `run-ios`), toate ecranele care folosesc același service/hook; schemă → `npm run audit` verde; date persistente → export + import backup testat.

**3. Raport final** — mesajul de încheiere conține EXPLICIT:

```
**Verificat colateral:**
- [consumator/ecran/audit]: cum am verificat (citit cod / simulator / `npm run audit` verde)
```

Ce n-ai putut verifica: „NU am verificat X pentru că Y" — niciodată „gata" doar pe type-check verde.

## Ce rulează automat

| Când | Ce | Efect |
|---|---|---|
| Înainte de Bash | `.claude/hooks/guard-destructive.sh` + `permissions.ask` | cere confirmare la `reset --hard`, `push --force`, `clean -f`, `rm -rf`, `branch -D` |
| Înainte de Edit/Write | `.claude/hooks/env-warn.sh` | avertizează la `.env` |
| După Edit/Write | `.claude/hooks/format-ts.sh` | prettier + `eslint --fix` pe fișierul .ts/.tsx |
| După Edit/Write | `.claude/hooks/backup-audit-hook.sh` | la db/backup/cloudSync/entities/documents/fuel/maintenance: raport injectat dacă backup-ul e desincronizat |
| La final de tură | `.claude/hooks/stop-gate.sh` | dacă există .ts modificate: `tsc` + `backup-audit --strict`; blochează „gata" dacă pică |
| La commit | `scripts/hooks/pre-commit` | type-check + audit-urile strict + ast-grep + regenerare `docs/` |
| Pe push/PR | `.github/workflows/` | audit + teste în CI |

## Agenți (`.claude/agents/`) și skill-uri (`.claude/skills/`)

| Agent | Activare | Rol |
|---|---|---|
| `solution-architect` | „Proiectează [feature]" | design: tabele SQLite, ecrane, ordine de implementare |
| `feature-implementer` | „Implementează task [ID]" | feature din `../PLAN.md`: plan → cod → verificare |
| `db-migrator` | „Migrează [tabel]" | schemă SQLite + tipuri; prezintă planul și așteaptă aprobare |
| `screen-builder` | „Construiește ecranul [nume]" | ecran nou conform design system |
| `backup-guardian` | „Verifică backup-ul" | sincronizează backup ZIP + iCloud cu schema |
| `form-consistency-guard` | „Auditează formularele" | FormPageScreen vs FormSheetModal; doar raportează |
| `ios-compliance` | „App Store review" | privacy manifest, NSUsageDescription, entitlements; doar raportează |

Skill-uri: `/release` (bump + commit; doar la cerere), `run-ios` (simulator + verificare UI prin XcodeBuildMCP), `backup-audit`. Review/securitate: built-in `/code-review`, `/security-review`, plugin-ul claude-security.

## Reguli (`.claude/rules/`, încărcate după calea fișierului atins)

| Fișier | Scope | Conținut |
|---|---|---|
| `rules/general.md` | mereu | platformă, stack, local-first, repo public |
| `rules/mcp-usage.md` | mereu | Context7 (înainte de API nou), XcodeBuildMCP (verificare UI la final) |
| `rules/code-conventions.md` | `*.ts`, `*.tsx` | structură, naming, fără backwards-compat |
| `rules/dynamic-types.md` | tabs, components, hooks, types | EntityType/DocumentType — sursă unică |
| `rules/design.md` | theme, components, tabs | EVPoint, culori din paletă, theme preference |
| `rules/backup.md` | backup, cloudSync, db, setari | format ZIP, manifest iCloud, propagare schemă |
| `rules/ai-privacy.md` | services, hooks, ai-proxy | `private_notes` și medical nu pleacă la AI |
| `rules/pipeline.md` | .github, .env, app.json, package.json | build, CI, secrets |

## Standarde de cod (obligatorii)

**Formulare** — două pattern-uri canonice (spec: `../docs/superpowers/specs/2026-05-02-form-uniformity-design.md`):

| Container | Wrapper | Butoane |
|---|---|---|
| Pagină Stack | `FormPageScreen` | „Înapoi" sus-stânga + pill „Salvează" jos |
| Modal popup | `FormSheetModal` | „Anulează" sus-stânga + „Salvează" sus-dreapta |

Formular nou cu ≥3 câmpuri → unul dintre cele două. Niciodată `<Modal transparent>` cu input-uri. Header de sheet → `SheetHeader` (butoane icon-only). Exceptate: `setari.tsx`, `OnboardingWizard.tsx`, `AppLockPinModal`, `CloudPasswordModal`, `ReviewSentimentModal`.

**Hooks** — orice hook din `hooks/` expune `{ loading: boolean; error: string | null; refresh(): Promise<void> }` (sau `refetch`/`reload`/`reset`).

**Erori** — `catch (e)`: `e instanceof Error ? e.message : 'Eroare necunoscută'`; mesaje în română, fără stack traces; nu loga date sensibile.

**SQLite** — query-uri parametrizate cu `?` (niciodată template literals cu date user); `ALTER TABLE` mereu în try-catch; coloane noi cu DEFAULT sau nullable; index pe coloanele filtrate; niciodată `DROP TABLE` pe un tabel cu `CREATE TABLE IF NOT EXISTS`.

**Tipuri de documente în UI** — liste/picker-e selectabile doar prin `useFilteredDocTypes()`; `DOCUMENT_TYPE_LABELS[doc.type]` doar pentru afișarea unui document existent.

**AI** — context pentru chatbot doar din `getDocumentsForAI()` (exclude `private_notes` și documentele medicale); imagini spre AI vision doar prin `loadPageBase64ForAi()`.

**Securitate** — nicio cheie API în `EXPO_PUBLIC_*` (ajunge în bundle); PIN/biometrie doar în `expo-secure-store`; `.env` nu se comite.

## Audit scripts

Catalogul complet (ce prinde fiecare, unde rulează strict/warn) e generat: `scripts/AUDITS.md`. Header-ul fiecărui script explică originea (regresia care l-a creat). Toate: `npm run audit`.

## Sincronizare cunoștințe aplicație

Când adaugi sau modifici funcționalități, actualizează **în ordine**:

| Ce se schimbă | Fișiere |
|---|---|
| Tip nou de document | `types/index.ts` (`DOCUMENT_TYPE_LABELS` + `ENTITY_DOCUMENT_TYPES`) → `services/aiTypeRegistry.ts` → `services/appKnowledge.ts` (`DOC_CATEGORIES`) → `theme/docTypeIcons.ts` + `theme/docTypeColors.ts`; `docs/` se regenerează la commit |
| Tip nou de entitate | checklist-ul din `rules/dynamic-types.md` |
| Funcție majoră / flux nou în UI | `services/appKnowledge.ts` (+ `components/OnboardingWizard.tsx` dacă e relevantă la onboarding) |
| Schemă SQLite | `services/db.ts` → `services/backup.ts` (`exportBackup` + `applyManifest`) → `services/cloudSync.ts` (`buildManifestPayload`) → `services/appKnowledge.ts` |
| Model local nou/eliminat | `services/localModel.ts` (`LOCAL_MODEL_CATALOG`) → `node scripts/update-site.js` |
| URL App Store | constanta `APP_STORE_URL` din `scripts/update-site.js` → rulează scriptul |

Sursa unică pentru chatbot: `services/appKnowledge.ts`. Site-ul `docs/` e regenerat de `scripts/update-site.js` (markeri `DOSAR:*`); SEO din `<head>` e manual.

## Worktrees

Pentru experimente care ating ≥3 fișiere mari: `git worktree add .worktrees/<nume> -b feat/<nume>`. `.worktrees/` e ignorat de git, Jest și ESLint. Niciun worktree nu stă >14 zile nemerged (`node scripts/worktree-age-audit.js`).

## Git

Commit messages în engleză, descriptive; commit-uri mici, pe feature. Skip pre-commit o singură dată: `git commit --no-verify` (doar la cererea userului).
