# Audit Scripts (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acoperă gap-urile între regulile din `CLAUDE.md` + `.claude/rules/*.md` și enforcement-ul automat (audit scripts + pre-commit), pentru a reduce clasele de regresii care actualmente trec netulburate prin type-check + audits existente.

**Architecture:** 8 scripturi Node.js standalone în `scripts/`, plus mici fixtures de test în `__tests__/scripts/`. Fiecare script urmează pattern-ul `backup-audit.js`: CLI cu `--strict`/`--json`, exit code 1 la violare, output RO. Integrate în `npm run audit` (cu/fără `--strict`) și în `scripts/hooks/pre-commit` (toate `--strict`).

**Tech Stack:** Node.js (CommonJS, fără build), fără dependențe noi. Acolo unde un audit poate fi exprimat curat în ast-grep (DSL existent în `.ast-grep/rules/`), preferă un YAML peste un script Node.

**Pre-implementare — audits care SUNT deja acoperite (nu duplica):**
- SQL injection în services → `.ast-grep/rules/no-sql-template-literal.yml`
- `DOCUMENT_TYPE_LABELS` direct iteration → ast-grep `no-document-type-labels-direct` + ESLint `no-direct-doc-type-iteration`
- `private_notes` la AI (path principal `getDocuments()`) → ast-grep `no-getdocuments-in-ai-context`
- `useColorScheme` din `react-native` → ast-grep `no-react-native-use-color-scheme`
- Hex hardcoded în componente → ESLint `no-hardcoded-hex-colors`

**Pre-implementare — observații despre starea actuală:**
- `npm run audit` rulează: `type-check`, `backup-audit --strict`, `check-hardcoded-entities` (fără `--strict`), `knowledge-audit --strict`, `lint:ast` (ast-grep).
- `scripts/hooks/pre-commit` NU rulează `lint:ast` actualmente. Phase B Task 9 îl adaugă în hook ca să închidă gap-ul (ast-grep prinde regresii la commit, nu doar la `npm run audit` manual).
- Testele de audit folosesc strategia: fixture inline cu cod problematic + cod curat, importă `audit()` funcția pură, asertează detectare/non-detectare.

---

## File Structure

**Scripturi noi (8):**
- `scripts/hook-contract-audit.js` — verifică `hooks/*.ts` returnează `{loading, error, refresh}` (sau echivalent declarat).
- `scripts/catch-pattern-audit.js` — verifică `catch (e) { ... e.message ... }` folosește `e instanceof Error`.
- `scripts/alter-table-trycatch-audit.js` — verifică fiecare `ALTER TABLE` din `services/db.ts` e într-un bloc `try`.
- `scripts/modal-input-audit.js` — flag `<Modal transparent>` care conține `<TextInput>`/`<Switch>` (regresie scroll cu tastatură).
- `scripts/expo-public-secrets-audit.js` — flag variabile `EXPO_PUBLIC_*` cu nume care sugerează secret (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `APIKEY`).
- `scripts/pin-secure-store-audit.js` — flag `AsyncStorage.setItem`/`getItem` cu chei care conțin `pin`, `biometric`, `password`.
- `scripts/file-size-audit.js` — listează fișiere `.ts`/`.tsx` peste un prag (default 400) sortate descrescător; `--strict` la peste un prag dur (default 800).
- `scripts/worktree-age-audit.js` — listează `git worktree`-uri mai vechi de 14 zile (regula CLAUDE.md).

**Teste (Jest, în `__tests__/scripts/`):**
- `__tests__/scripts/hookContractAudit.test.ts`
- `__tests__/scripts/catchPatternAudit.test.ts`
- `__tests__/scripts/alterTableTryCatchAudit.test.ts`
- `__tests__/scripts/modalInputAudit.test.ts`
- `__tests__/scripts/expoPublicSecretsAudit.test.ts`
- `__tests__/scripts/pinSecureStoreAudit.test.ts`
- `__tests__/scripts/fileSizeAudit.test.ts`

(Worktree-age nu primește test — depinde de starea efectivă a `git worktree`; e cel mai simplu, verificat manual.)

**Modificări fișiere existente:**
- `package.json` — extinde `scripts.audit` cu noile audits.
- `scripts/hooks/pre-commit` — adaugă noile audits + `npm run lint:ast` (ast-grep).
- `CLAUDE.md` (rădăcina app) — actualizează secțiunea „Audit scripts" cu noile comenzi.

---

## Task 1: Hook contract audit

**Files:**
- Create: `app/scripts/hook-contract-audit.js`
- Test: `app/__tests__/scripts/hookContractAudit.test.ts`

**De ce:** `CLAUDE.md` declară explicit pattern obligatoriu `{loading, error, refresh}` și menționează acest audit ca „candidat real". Hook nou fără contract = ecran care nu poate afișa loading/error consistent.

**Logică:**
- Walk `app/hooks/*.ts` (exclude `.test.ts`, fișiere care nu definesc hook — fără export `useXxx`).
- Pentru fiecare hook (export default sau named export care începe cu `use`), găsește return statement(s).
- Asertează că obiectul returnat (sau tipul de return explicit) conține toate 3 chei: `loading`, `error`, și o funcție de refresh (acceptă orice nume care matchează `/^(refresh|reload|refetch|reset)$/`).
- Allowlist: hook-uri care nu fac I/O async (ex: `useThemeScheme`, `useFilteredDocTypes` pure-computed) → adaugă în `ALLOWED_HOOKS` set cu motiv.

**Steps:**

- [ ] **Step 1: Scrie testul cu fixtures inline**

```typescript
// __tests__/scripts/hookContractAudit.test.ts
import { auditSource } from '../../scripts/hook-contract-audit';

describe('hook-contract-audit', () => {
  it('passes hook with loading, error, refresh', () => {
    const src = `
      export function useThing() {
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const refresh = async () => {};
        return { items: [], loading, error, refresh };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('flags hook missing error key', () => {
    const src = `
      export function useThing() {
        const [loading] = useState(false);
        return { items: [], loading, refresh: async () => {} };
      }
    `;
    const violations = auditSource('hooks/useThing.ts', src);
    expect(violations).toHaveLength(1);
    expect(violations[0].missing).toEqual(['error']);
  });

  it('accepts refetch as refresh equivalent', () => {
    const src = `
      export function useThing() {
        return { loading: false, error: null, refetch: () => {} };
      }
    `;
    expect(auditSource('hooks/useThing.ts', src)).toEqual([]);
  });

  it('skips hook in ALLOWED_HOOKS allowlist', () => {
    const src = `export function useThemeScheme() { return 'light'; }`;
    expect(auditSource('hooks/useThemeScheme.ts', src)).toEqual([]);
  });

  it('ignores non-hook exports', () => {
    const src = `export function helper() { return 42; }`;
    expect(auditSource('hooks/helpers.ts', src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rulează testul ca să confirmi că pică**

Run: `cd app && npm test -- hookContractAudit`
Expected: FAIL — modulul `hook-contract-audit` nu există.

- [ ] **Step 3: Implementează `hook-contract-audit.js`**

```javascript
#!/usr/bin/env node
/**
 * hook-contract-audit.js
 *
 * Verifică că orice hook din `hooks/*.ts` care face I/O async
 * returnează contractul standard {loading, error, refresh|refetch|reload|reset}.
 *
 * Vezi CLAUDE.md §"Standarde de calitate cod → Hook pattern obligatoriu".
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(APP_DIR, 'hooks');

// Hook-uri pure (fără I/O) care nu au nevoie de contract.
const ALLOWED_HOOKS = new Set([
  'useThemeScheme',         // citește doar context, sincron
  'useFilteredDocTypes',    // pure-computed peste props/settings
  'useColorScheme',         // wrapper peste theme context
  'useAutoActivateDocType', // pure-computed peste props
]);

const REFRESH_NAMES = ['refresh', 'reload', 'refetch', 'reset'];

function auditSource(relPath, source) {
  const violations = [];
  // Match named exports `export function useXxx(` SAU `export const useXxx = (`
  const fnRe = /export\s+(?:function|const)\s+(use[A-Z]\w*)\b/g;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const hookName = m[1];
    if (ALLOWED_HOOKS.has(hookName)) continue;

    // Găsește return-ul cu obiect literal pentru acest hook.
    // Strategie simplă: din poziția m.index, caută primul `return {` și ia până la `};`
    const after = source.slice(m.index);
    const returnMatch = after.match(/return\s*\{([\s\S]*?)\}\s*;/);
    if (!returnMatch) {
      // hook return non-obiect (ex: returnează direct o valoare) — ignoră dacă e în ALLOWED
      // altfel raportează ca lipsă contract complet
      violations.push({ hook: hookName, file: relPath, missing: ['loading', 'error', 'refresh'] });
      continue;
    }
    const body = returnMatch[1];
    const hasLoading = /\bloading\b/.test(body);
    const hasError = /\berror\b/.test(body);
    const hasRefresh = REFRESH_NAMES.some(n => new RegExp(`\\b${n}\\b`).test(body));
    const missing = [];
    if (!hasLoading) missing.push('loading');
    if (!hasError) missing.push('error');
    if (!hasRefresh) missing.push('refresh');
    if (missing.length > 0) {
      violations.push({ hook: hookName, file: relPath, missing });
    }
  }
  return violations;
}

function audit() {
  const all = [];
  for (const f of fs.readdirSync(HOOKS_DIR)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
    const abs = path.join(HOOKS_DIR, f);
    const src = fs.readFileSync(abs, 'utf8');
    all.push(...auditSource(`hooks/${f}`, src));
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Toate hook-urile respectă contractul {loading, error, refresh}.';
  }
  const lines = [`✗ ${violations.length} hook(uri) fără contract complet:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file} → ${v.hook}() — lipsă: [${v.missing.join(', ')}]`);
  }
  lines.push('');
  lines.push('Fix:');
  lines.push('  Hook-urile cu I/O async TREBUIE să returneze:');
  lines.push('    { ...data, loading: boolean, error: string | null, refresh: () => Promise<void> }');
  lines.push('  Sau echivalent: refetch / reload / reset.');
  lines.push('  Dacă hook-ul e pur (fără I/O), adaugă-l în ALLOWED_HOOKS din scripts/hook-contract-audit.js.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const violations = audit();
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  } else {
    process.stdout.write(format(violations) + '\n');
  }
  if (args.has('--strict') && violations.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format, ALLOWED_HOOKS };
```

- [ ] **Step 4: Rulează testul ca să confirme că trece**

Run: `cd app && npm test -- hookContractAudit`
Expected: PASS, toate 5 testele.

- [ ] **Step 5: Rulează auditul pe codul real ca să vezi starea actuală**

Run: `cd app && node scripts/hook-contract-audit.js`
Acțiune: dacă produce violări, NU le rezolva în această task — doar listează-le ca follow-up. Auditul însuși e success.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/hook-contract-audit.js app/__tests__/scripts/hookContractAudit.test.ts
git commit -m "feat: add hook-contract-audit script"
```

---

## Task 2: catch pattern audit

**Files:**
- Create: `app/scripts/catch-pattern-audit.js`
- Test: `app/__tests__/scripts/catchPatternAudit.test.ts`

**De ce:** Regulă CLAUDE.md: `catch(e): mereu \`e instanceof Error ? e.message : 'Eroare necunoscută'\``. Codul `e.message` direct strică la `throw 'string'` sau `throw {custom}`.

**Logică:**
- Walk `services/`, `hooks/`, `components/`, `app/`.
- Pentru fiecare `catch (NAME)` care urmează cu `NAME.message` în următoarele 20 linii, asertează că între ele apare `NAME instanceof Error`.
- Allowlist: fișiere unde se face explicit `throw new Error()` în catch + rethrow (rar).

**Steps:**

- [ ] **Step 1: Scrie testul cu fixtures inline**

```typescript
// __tests__/scripts/catchPatternAudit.test.ts
import { auditSource } from '../../scripts/catch-pattern-audit';

describe('catch-pattern-audit', () => {
  it('passes catch with instanceof Error guard', () => {
    const src = `
      try { foo(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
        Alert.alert(msg);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toEqual([]);
  });

  it('flags catch using e.message without guard', () => {
    const src = `
      try { foo(); }
      catch (e) {
        console.log(e.message);
      }
    `;
    const v = auditSource('services/foo.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].variable).toBe('e');
  });

  it('accepts catch where error is just logged generically', () => {
    const src = `
      try { foo(); }
      catch (e) {
        console.log('eroare', e);
      }
    `;
    expect(auditSource('services/foo.ts', src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rulează test ca să pice**

Run: `cd app && npm test -- catchPatternAudit`
Expected: FAIL — modul lipsă.

- [ ] **Step 3: Implementează `catch-pattern-audit.js`**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'components', 'app'];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === 'ios' || ent.name === 'android' ||
        ent.name === '.worktrees' || ent.name === 'build' || ent.name === 'dist' ||
        ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  const violations = [];
  // Match catch (VAR) { ... } (depth-aware brace match)
  const catchRe = /catch\s*\(\s*([a-zA-Z_$][\w$]*)\s*(?::\s*[^)]+)?\s*\)\s*\{/g;
  let m;
  while ((m = catchRe.exec(source)) !== null) {
    const variable = m[1];
    const start = m.index + m[0].length - 1; // pe `{`
    let depth = 1, i = start + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(start + 1, i - 1);
    const usesMessage = new RegExp(`\\b${variable}\\.message\\b`).test(body);
    if (!usesMessage) continue;
    const hasGuard = new RegExp(`\\b${variable}\\s+instanceof\\s+Error\\b`).test(body);
    if (hasGuard) continue;
    // poziție linie pentru raport
    const lineNumber = source.slice(0, m.index).split('\n').length;
    violations.push({ file: relPath, variable, line: lineNumber });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(APP_DIR, d);
    for (const f of walk(abs)) {
      const rel = path.relative(APP_DIR, f).replace(/\\/g, '/');
      const src = fs.readFileSync(f, 'utf8');
      all.push(...auditSource(rel, src));
    }
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) return '✓ Toate catch-urile cu .message folosesc instanceof Error.';
  const lines = [`✗ ${violations.length} catch(.message) fără guard instanceof Error:`, ''];
  for (const v of violations) lines.push(`  ${v.file}:${v.line} — catch (${v.variable})`);
  lines.push('');
  lines.push('Fix: const msg = e instanceof Error ? e.message : \'Eroare necunoscută\';');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
```

- [ ] **Step 4: Rulează test**

Run: `cd app && npm test -- catchPatternAudit`
Expected: PASS.

- [ ] **Step 5: Rulează pe codul real**

Run: `cd app && node scripts/catch-pattern-audit.js`
Acțiune: listează violări (NU le repara aici — follow-up separat).

- [ ] **Step 6: Commit**

```bash
git add app/scripts/catch-pattern-audit.js app/__tests__/scripts/catchPatternAudit.test.ts
git commit -m "feat: add catch-pattern-audit script"
```

---

## Task 3: ALTER TABLE try-catch audit

**Files:**
- Create: `app/scripts/alter-table-trycatch-audit.js`
- Test: `app/__tests__/scripts/alterTableTryCatchAudit.test.ts`

**De ce:** CLAUDE.md: „ALTER TABLE: mereu în try-catch (coloana poate exista deja)". Fără try, un app upgrade poate crăpa la start dacă SQLite raportează „duplicate column".

**Logică:**
- Citește `services/db.ts`.
- Găsește toate `ALTER TABLE` strings.
- Pentru fiecare, urcă în AST/source ca să verifici dacă e într-un bloc `try { ... }` (sau apel într-o funcție wrapper sigură).
- Heuristic acceptat: caută `try {` în următoarele 50 linii anterior poziției `ALTER TABLE` cu un `catch` în următoarele 100 linii după.

**Steps:**

- [ ] **Step 1: Test cu fixtures inline**

```typescript
// __tests__/scripts/alterTableTryCatchAudit.test.ts
import { auditSource } from '../../scripts/alter-table-trycatch-audit';

describe('alter-table-trycatch-audit', () => {
  it('passes ALTER TABLE inside try/catch', () => {
    const src = `
      try {
        await db.execAsync(\`ALTER TABLE documents ADD COLUMN tag TEXT;\`);
      } catch (e) {
        // coloana există
      }
    `;
    expect(auditSource(src)).toEqual([]);
  });

  it('flags ALTER TABLE without try wrapper', () => {
    const src = `await db.execAsync(\`ALTER TABLE documents ADD COLUMN tag TEXT;\`);`;
    const v = auditSource(src);
    expect(v).toHaveLength(1);
    expect(v[0].statement).toContain('ALTER TABLE documents');
  });

  it('flags ALTER TABLE where try block is too far', () => {
    const src = `
      try { foo(); } catch {}
      ${'\n'.repeat(60)}
      await db.execAsync(\`ALTER TABLE documents ADD COLUMN x TEXT;\`);
    `;
    expect(auditSource(src)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `cd app && npm test -- alterTableTryCatchAudit`

- [ ] **Step 3: Implementează scriptul**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(APP_DIR, 'services/db.ts');

function auditSource(source) {
  const violations = [];
  const re = /ALTER\s+TABLE\s+([a-z_][a-z_0-9]*)\s+[^`;]+/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const stmt = m[0].slice(0, 80);
    const pos = m.index;
    // Caută în înapoi maxim 2000 chars pentru `try {`
    const back = source.slice(Math.max(0, pos - 2000), pos);
    const lastTryIdx = back.lastIndexOf('try');
    if (lastTryIdx === -1) {
      violations.push({ statement: stmt, line: source.slice(0, pos).split('\n').length });
      continue;
    }
    // Verifică că `try` găsit nu e închis înainte de poziția curentă
    const fromTry = source.slice(Math.max(0, pos - 2000) + lastTryIdx);
    // Numără { și } între lastTryIdx și current pos
    const segment = fromTry.slice(0, pos - (Math.max(0, pos - 2000) + lastTryIdx));
    let depth = 0, opened = false;
    for (const ch of segment) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') depth--;
    }
    if (!opened || depth <= 0) {
      violations.push({ statement: stmt, line: source.slice(0, pos).split('\n').length });
    }
  }
  return violations;
}

function audit() {
  if (!fs.existsSync(DB_FILE)) return [];
  return auditSource(fs.readFileSync(DB_FILE, 'utf8'));
}

function format(v) {
  if (v.length === 0) return '✓ Toate ALTER TABLE sunt în try/catch.';
  const lines = [`✗ ${v.length} ALTER TABLE fără try wrap:`, ''];
  for (const x of v) lines.push(`  services/db.ts:${x.line} — ${x.statement}`);
  lines.push('');
  lines.push('Fix: try { await db.execAsync(`ALTER TABLE ...`); } catch (e) { /* coloana există */ }');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Rulează pe `db.ts` real**

Run: `cd app && node scripts/alter-table-trycatch-audit.js`

- [ ] **Step 6: Commit**

```bash
git add app/scripts/alter-table-trycatch-audit.js app/__tests__/scripts/alterTableTryCatchAudit.test.ts
git commit -m "feat: add alter-table-trycatch-audit script"
```

---

## Task 4: Modal with input audit

**Files:**
- Create: `app/scripts/modal-input-audit.js`
- Test: `app/__tests__/scripts/modalInputAudit.test.ts`

**De ce:** `CLAUDE.md` §Pattern-uri formulare: „Niciodată `<Modal transparent>` cu input-uri (bottom-sheet) — duce la imposibilitate scroll cu tastatura". Există deja `form-consistency-guard` ca AGENT, dar nu rulează la commit. Asta închide gap-ul.

**Logică:**
- Walk `app/`, `components/`.
- Pentru fiecare fișier `.tsx`, găsește `<Modal` cu atribut `transparent` (sau `transparent={true}`).
- Verifică dacă în body-ul JSX al Modal-ului (până la `</Modal>`) apare `<TextInput`, `<Switch`, `<DatePickerField`, `<Picker`.
- Allowlist: fișiere exempted listate în CLAUDE.md (`AppLockPinModal`, `CloudPasswordModal`, `ReviewSentimentModal`).

**Steps:**

- [ ] **Step 1: Test fixtures**

```typescript
import { auditSource } from '../../scripts/modal-input-audit';

describe('modal-input-audit', () => {
  it('passes Modal transparent without inputs', () => {
    const src = `<Modal transparent><View><Text>X</Text></View></Modal>`;
    expect(auditSource('components/Foo.tsx', src)).toEqual([]);
  });

  it('flags Modal transparent with TextInput', () => {
    const src = `<Modal transparent><TextInput /></Modal>`;
    const v = auditSource('components/Foo.tsx', src);
    expect(v).toHaveLength(1);
    expect(v[0].containedInputs).toContain('TextInput');
  });

  it('skips allowlisted file AppLockPinModal', () => {
    const src = `<Modal transparent><TextInput /></Modal>`;
    expect(auditSource('components/AppLockPinModal.tsx', src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];
const ALLOWED = new Set([
  'components/AppLockPinModal.tsx',
  'components/CloudPasswordModal.tsx',
  'components/ReviewSentimentModal.tsx',
  'components/LegalModal.tsx',
]);
const INPUT_TAGS = ['TextInput', 'Switch', 'DatePickerField', 'Picker'];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.') ||
        ent.name === 'ios' || ent.name === 'android') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.tsx') && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  const violations = [];
  // Match <Modal ... transparent ... > ... </Modal>, neambiguu
  const re = /<Modal\b([^>]*)>([\s\S]*?)<\/Modal>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1];
    if (!/\btransparent\b/.test(attrs)) continue;
    const body = m[2];
    const found = INPUT_TAGS.filter(t => new RegExp(`<${t}\\b`).test(body));
    if (found.length === 0) continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ file: relPath, line, containedInputs: found });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(APP_DIR, d);
    for (const f of walk(abs)) {
      const rel = path.relative(APP_DIR, f).replace(/\\/g, '/');
      all.push(...auditSource(rel, fs.readFileSync(f, 'utf8')));
    }
  }
  return all;
}

function format(v) {
  if (v.length === 0) return '✓ Niciun Modal transparent cu input.';
  const lines = [`✗ ${v.length} Modal transparent cu input(uri):`, ''];
  for (const x of v) lines.push(`  ${x.file}:${x.line} — conține [${x.containedInputs.join(', ')}]`);
  lines.push('');
  lines.push('Fix: migrează la <FormSheetModal> sau <FormPageScreen> (components/ui/).');
  lines.push('Detalii: docs/superpowers/specs/2026-05-02-form-uniformity-design.md');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Run real**

Run: `cd app && node scripts/modal-input-audit.js`

- [ ] **Step 6: Commit**

```bash
git add app/scripts/modal-input-audit.js app/__tests__/scripts/modalInputAudit.test.ts
git commit -m "feat: add modal-input-audit script"
```

---

## Task 5: EXPO_PUBLIC secrets audit

**Files:**
- Create: `app/scripts/expo-public-secrets-audit.js`
- Test: `app/__tests__/scripts/expoPublicSecretsAudit.test.ts`

**De ce:** CLAUDE.md: „Chei API externe: NICIODATĂ în `EXPO_PUBLIC_*` (sunt vizibile în bundle compilat!)". Singura clasă de bug-uri unde un commit ar putea expune un secret în App Store binary.

**Logică:**
- Scanează `.env`, `.env.local`, `.env.production`, `app.config.ts`, `app.config.js`, `app.json`.
- Pentru fiecare match `EXPO_PUBLIC_<NAME>=...` (env) sau `EXPO_PUBLIC_<NAME>` (config), verifică dacă numele conține una din: `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `APIKEY`, `PRIVKEY`.
- Raportează ca high-severity. `--strict` exit 1.

**Steps:**

- [ ] **Step 1: Test fixtures**

```typescript
import { auditEnvLine, auditConfigSource } from '../../scripts/expo-public-secrets-audit';

describe('expo-public-secrets-audit', () => {
  it('passes EXPO_PUBLIC_APP_VERSION', () => {
    expect(auditEnvLine('EXPO_PUBLIC_APP_VERSION=1.2.3', 1, '.env')).toBeNull();
  });

  it('flags EXPO_PUBLIC_MISTRAL_API_KEY', () => {
    const v = auditEnvLine('EXPO_PUBLIC_MISTRAL_API_KEY=sk-...', 5, '.env');
    expect(v?.name).toBe('EXPO_PUBLIC_MISTRAL_API_KEY');
    expect(v?.trigger).toBe('KEY');
  });

  it('flags EXPO_PUBLIC_SUPABASE_SECRET', () => {
    expect(auditEnvLine('EXPO_PUBLIC_SUPABASE_SECRET=x', 1, '.env')?.trigger).toBe('SECRET');
  });

  it('flags EXPO_PUBLIC_*_TOKEN in app.config.ts', () => {
    const src = `export default { extra: { EXPO_PUBLIC_GH_TOKEN: process.env.GH_TOKEN } };`;
    const v = auditConfigSource(src, 'app.config.ts');
    expect(v.some(x => x.name === 'EXPO_PUBLIC_GH_TOKEN')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementează**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const TRIGGERS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'APIKEY', 'PRIVKEY', 'PRIVATE'];
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];
const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.json'];

function detectTrigger(name) {
  const upper = name.toUpperCase();
  return TRIGGERS.find(t => upper.includes(t)) ?? null;
}

function auditEnvLine(line, lineNumber, file) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('EXPO_PUBLIC_')) return null;
  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;
  const name = trimmed.slice(0, eq).trim();
  const trigger = detectTrigger(name);
  if (!trigger) return null;
  return { file, line: lineNumber, name, trigger };
}

function auditConfigSource(source, file) {
  const violations = [];
  const re = /EXPO_PUBLIC_[A-Z0-9_]+/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(source)) !== null) {
    const name = m[0];
    if (seen.has(name)) continue;
    seen.add(name);
    const trigger = detectTrigger(name);
    if (!trigger) continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ file, line, name, trigger });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const f of ENV_FILES) {
    const abs = path.join(APP_DIR, f);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const v = auditEnvLine(ln, i + 1, f);
      if (v) all.push(v);
    });
  }
  for (const f of CONFIG_FILES) {
    const abs = path.join(APP_DIR, f);
    if (!fs.existsSync(abs)) continue;
    all.push(...auditConfigSource(fs.readFileSync(abs, 'utf8'), f));
  }
  return all;
}

function format(v) {
  if (v.length === 0) return '✓ Niciun EXPO_PUBLIC_* cu nume de secret.';
  const lines = [`✗ ${v.length} EXPO_PUBLIC_* cu pattern de secret (vor ajunge în bundle public!):`, ''];
  for (const x of v) lines.push(`  ${x.file}:${x.line} — ${x.name} (trigger: ${x.trigger})`);
  lines.push('');
  lines.push('Fix: redenumește fără EXPO_PUBLIC_ prefix și citește server-side, SAU fă proxy printr-un endpoint.');
  lines.push('EXPO_PUBLIC_* e injectat în bundle-ul JS compilat → vizibil oricui dezarhivează .ipa/.apk.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditEnvLine, auditConfigSource, format };
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Run real**

Run: `cd app && node scripts/expo-public-secrets-audit.js`

- [ ] **Step 6: Commit**

```bash
git add app/scripts/expo-public-secrets-audit.js app/__tests__/scripts/expoPublicSecretsAudit.test.ts
git commit -m "feat: add expo-public-secrets-audit script"
```

---

## Task 6: PIN / biometric SecureStore audit

**Files:**
- Create: `app/scripts/pin-secure-store-audit.js`
- Test: `app/__tests__/scripts/pinSecureStoreAudit.test.ts`

**De ce:** CLAUDE.md: „PIN / biometric: doar `expo-secure-store`". `AsyncStorage` e plain text pe disk; PIN-ul stocat acolo = bypassable cu file picker pe device rootat.

**Logică:**
- Walk `services/`, `hooks/`.
- Pentru fiecare `AsyncStorage.setItem/getItem/removeItem` cu argument string care conține `pin`, `biometric`, `password`, `secret`, `lock`, raportează.
- Verifică și template literals (`\`pin_\${id}\``).

**Steps:**

- [ ] **Step 1: Test**

```typescript
import { auditSource } from '../../scripts/pin-secure-store-audit';

describe('pin-secure-store-audit', () => {
  it('passes AsyncStorage on non-secret key', () => {
    const src = `AsyncStorage.setItem('theme', 'dark');`;
    expect(auditSource('services/x.ts', src)).toEqual([]);
  });

  it('flags AsyncStorage.setItem on pin key', () => {
    const src = `AsyncStorage.setItem('user_pin', '1234');`;
    const v = auditSource('services/x.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].key).toContain('pin');
  });

  it('flags AsyncStorage.getItem on biometric key', () => {
    const src = `await AsyncStorage.getItem('biometric_enabled');`;
    expect(auditSource('services/x.ts', src)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'components', 'app'];
const SECRET_KEYS = ['pin', 'biometric', 'password', 'secret', 'applock', 'app_lock', 'lockpin'];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.') ||
        ent.name === 'ios' || ent.name === 'android') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  const violations = [];
  const re = /AsyncStorage\.(setItem|getItem|removeItem|multiGet|multiSet)\s*\(\s*([`'"][^`'"]+[`'"])/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const method = m[1];
    const keyLit = m[2].slice(1, -1).toLowerCase();
    if (!SECRET_KEYS.some(k => keyLit.includes(k))) continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ file: relPath, line, method, key: keyLit });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(APP_DIR, d);
    for (const f of walk(abs)) {
      const rel = path.relative(APP_DIR, f).replace(/\\/g, '/');
      all.push(...auditSource(rel, fs.readFileSync(f, 'utf8')));
    }
  }
  return all;
}

function format(v) {
  if (v.length === 0) return '✓ Niciun secret în AsyncStorage.';
  const lines = [`✗ ${v.length} chei sensibile în AsyncStorage:`, ''];
  for (const x of v) lines.push(`  ${x.file}:${x.line} — AsyncStorage.${x.method}('${x.key}')`);
  lines.push('');
  lines.push('Fix: import * as SecureStore from \'expo-secure-store\';');
  lines.push('     await SecureStore.setItemAsync(key, value);  // criptat keychain/keystore');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Run real**

Run: `cd app && node scripts/pin-secure-store-audit.js`

- [ ] **Step 6: Commit**

```bash
git add app/scripts/pin-secure-store-audit.js app/__tests__/scripts/pinSecureStoreAudit.test.ts
git commit -m "feat: add pin-secure-store-audit script"
```

---

## Task 7: File size audit

**Files:**
- Create: `app/scripts/file-size-audit.js`
- Test: `app/__tests__/scripts/fileSizeAudit.test.ts`

**De ce:** CLAUDE.md: „Fișiere mari (>400 linii): la editări semnificative planifică split incremental". `dosar_god_files.md` (memory) tracks god files. Audit-ul îi listează automat și pică doar la depășire de prag dur.

**Logică:**
- Walk `services/`, `hooks/`, `components/`, `app/`.
- Numără linii non-blank.
- Listează sortate descrescător. `--strict` pică la prag dur (default 800 linii).
- Permite override prin `--warn-threshold=N --strict-threshold=M`.

**Steps:**

- [ ] **Step 1: Test**

```typescript
import { countNonBlankLines, classify } from '../../scripts/file-size-audit';

describe('file-size-audit', () => {
  it('counts non-blank lines', () => {
    expect(countNonBlankLines('a\n\nb\n  \nc')).toBe(3);
  });

  it('classifies under warn threshold as ok', () => {
    expect(classify(300, 400, 800)).toBe('ok');
  });

  it('classifies between warn and strict as warn', () => {
    expect(classify(500, 400, 800)).toBe('warn');
  });

  it('classifies over strict as fail', () => {
    expect(classify(900, 400, 800)).toBe('fail');
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'components', 'app'];

function countNonBlankLines(source) {
  return source.split('\n').filter(l => l.trim().length > 0).length;
}

function classify(lines, warn, strict) {
  if (lines >= strict) return 'fail';
  if (lines >= warn) return 'warn';
  return 'ok';
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.') ||
        ent.name === 'ios' || ent.name === 'android') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  let warn = 400, strict = 800;
  for (const a of argv) {
    const w = a.match(/^--warn-threshold=(\d+)$/);
    if (w) warn = Number(w[1]);
    const s = a.match(/^--strict-threshold=(\d+)$/);
    if (s) strict = Number(s[1]);
  }
  return { warn, strict };
}

function audit(warn, strict) {
  const results = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(APP_DIR, d);
    for (const f of walk(abs)) {
      const rel = path.relative(APP_DIR, f).replace(/\\/g, '/');
      const lines = countNonBlankLines(fs.readFileSync(f, 'utf8'));
      const status = classify(lines, warn, strict);
      if (status !== 'ok') results.push({ file: rel, lines, status });
    }
  }
  return results.sort((a, b) => b.lines - a.lines);
}

function format(results, warn, strict) {
  if (results.length === 0) return `✓ Niciun fișier peste ${warn} linii.`;
  const fails = results.filter(r => r.status === 'fail');
  const warns = results.filter(r => r.status === 'warn');
  const lines = [];
  if (fails.length > 0) {
    lines.push(`✗ ${fails.length} fișier(e) peste pragul dur (${strict} linii):`);
    for (const r of fails) lines.push(`  ${r.lines.toString().padStart(5)}  ${r.file}`);
    lines.push('');
  }
  if (warns.length > 0) {
    lines.push(`⚠ ${warns.length} fișier(e) peste pragul de warning (${warn}-${strict - 1} linii):`);
    for (const r of warns) lines.push(`  ${r.lines.toString().padStart(5)}  ${r.file}`);
    lines.push('');
  }
  lines.push('Fix: planifică split. Vezi memory/dosar_god_files.md pentru tracking.');
  return lines.join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const { warn, strict: hard } = parseArgs(argv);
  const args = new Set(argv);
  const results = audit(warn, hard);
  if (args.has('--json')) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  else process.stdout.write(format(results, warn, hard) + '\n');
  if (args.has('--strict') && results.some(r => r.status === 'fail')) process.exit(1);
}

module.exports = { audit, countNonBlankLines, classify, format };
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Run real**

Run: `cd app && node scripts/file-size-audit.js`

- [ ] **Step 6: Commit**

```bash
git add app/scripts/file-size-audit.js app/__tests__/scripts/fileSizeAudit.test.ts
git commit -m "feat: add file-size-audit script"
```

---

## Task 8: Worktree age audit

**Files:**
- Create: `app/scripts/worktree-age-audit.js`

**De ce:** CLAUDE.md: „Niciun worktree nu rămâne mai mult de 2 săptămâni nemerged". Trivial dar util la sesiuni paralele cu agenți.

**Logică:**
- Rulează `git worktree list --porcelain` în `APP_DIR`.
- Parsează output (linii `worktree <path>` și `HEAD <sha>`).
- Pentru fiecare worktree (skip main), citește `mtime` al `worktree/.git` sau `worktree/CLAUDE.md`/oricare fișier, sau `git log -1 --format=%ct HEAD` pe acel worktree.
- Mai vechi de 14 zile → raportează.

**Steps:**

- [ ] **Step 1: Implementare directă (fără test — depinde de git state)**

```javascript
#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const MAX_AGE_DAYS = 14;

function listWorktrees() {
  let out;
  try {
    out = execSync('git worktree list --porcelain', { cwd: APP_DIR, encoding: 'utf8' });
  } catch {
    return [];
  }
  const blocks = out.split('\n\n').filter(b => b.trim());
  return blocks.map(b => {
    const lines = b.split('\n');
    const wt = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length);
    const branch = lines.find(l => l.startsWith('branch '))?.slice('branch '.length) ?? '(detached)';
    return { path: wt, branch };
  }).filter(w => w.path);
}

function lastCommitTimestamp(worktreePath) {
  try {
    const ts = execSync('git log -1 --format=%ct HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();
    return Number(ts) * 1000;
  } catch {
    return null;
  }
}

function audit() {
  const worktrees = listWorktrees();
  const now = Date.now();
  const stale = [];
  for (const w of worktrees) {
    if (w.path === APP_DIR) continue; // main
    const ts = lastCommitTimestamp(w.path);
    if (ts === null) continue;
    const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_AGE_DAYS) stale.push({ ...w, ageDays: Math.floor(ageDays) });
  }
  return stale;
}

function format(stale) {
  if (stale.length === 0) return `✓ Niciun worktree mai vechi de ${MAX_AGE_DAYS} zile.`;
  const lines = [`✗ ${stale.length} worktree(uri) stale:`, ''];
  for (const w of stale) {
    lines.push(`  ${w.ageDays}z  ${w.branch.padEnd(40)} ${w.path}`);
  }
  lines.push('');
  lines.push('Fix: cherry-pick/merge în main, apoi `git worktree remove <path>`.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const stale = audit();
  if (args.has('--json')) process.stdout.write(JSON.stringify(stale, null, 2) + '\n');
  else process.stdout.write(format(stale) + '\n');
  if (args.has('--strict') && stale.length > 0) process.exit(1);
}

module.exports = { audit, format, MAX_AGE_DAYS };
```

- [ ] **Step 2: Test manual**

Run: `cd app && node scripts/worktree-age-audit.js`
Expected: listă goală sau worktree-uri.

- [ ] **Step 3: Commit**

```bash
git add app/scripts/worktree-age-audit.js
git commit -m "feat: add worktree-age-audit script"
```

---

## Task 9: Integrare în npm run audit + pre-commit

**Files:**
- Modify: `app/package.json` — scriptul `audit`.
- Modify: `app/scripts/hooks/pre-commit`.
- Modify: `app/.claude/CLAUDE.md` (secțiunea Audit scripts) și/sau rădăcina `CLAUDE.md`.

**Strategie de integrare:**
- `npm run audit` — toate scripturile noi `--strict`, EXCEPȚIE `file-size-audit` care nu primește `--strict` (ar pica imediat pe god files existente), și `worktree-age-audit` (poate pica local fără să fie problemă de cod).
- `pre-commit` — TOATE noile scripturi `--strict` minus `worktree-age` și `file-size`. PLUS adăugare `npm run lint:ast` (acoperă gap-ul ast-grep existent dar neapelat la commit).

**Steps:**

- [ ] **Step 1: Update `package.json` script `audit`**

Înlocuiește valoarea existentă:
```json
"audit": "npm run type-check && node scripts/backup-audit.js --strict && node scripts/check-hardcoded-entities.js && node scripts/knowledge-audit.js --strict && npm run lint:ast"
```
Cu:
```json
"audit": "npm run type-check && node scripts/backup-audit.js --strict && node scripts/check-hardcoded-entities.js && node scripts/knowledge-audit.js --strict && node scripts/hook-contract-audit.js --strict && node scripts/catch-pattern-audit.js --strict && node scripts/alter-table-trycatch-audit.js --strict && node scripts/modal-input-audit.js --strict && node scripts/expo-public-secrets-audit.js --strict && node scripts/pin-secure-store-audit.js --strict && node scripts/file-size-audit.js && node scripts/worktree-age-audit.js && npm run lint:ast"
```

- [ ] **Step 2: Update `scripts/hooks/pre-commit`**

Adaugă blocuri între `knowledge-audit` și `update-site`:
```bash
echo "▸ Hook contract audit (strict)..."
node scripts/hook-contract-audit.js --strict

echo "▸ Catch pattern audit (strict)..."
node scripts/catch-pattern-audit.js --strict

echo "▸ ALTER TABLE try-catch audit (strict)..."
node scripts/alter-table-trycatch-audit.js --strict

echo "▸ Modal-input audit (strict)..."
node scripts/modal-input-audit.js --strict

echo "▸ EXPO_PUBLIC secrets audit (strict)..."
node scripts/expo-public-secrets-audit.js --strict

echo "▸ PIN SecureStore audit (strict)..."
node scripts/pin-secure-store-audit.js --strict

echo "▸ ast-grep scan..."
npm run -s lint:ast
```

- [ ] **Step 3: Update CLAUDE.md secțiunea „Audit scripts"**

În `app/.claude/CLAUDE.md` (sau `/Users/ax/work/documents/.claude/CLAUDE.md` la secțiunea „Audit scripts"), adaugă lista celor 8 audits noi cu o linie/audit + linkul către regula CLAUDE.md pe care o enforce-ază. Format identic cu cele 3 existente.

- [ ] **Step 4: Verificare integrare**

Run: `cd app && npm run audit`
Expected: rulează toate; pică doar pe violări REALE de cod (nu pe scripturile lipsă).

Acțiune: dacă pică pe violări reale, NU le rezolva aici — listează-le într-un fișier `docs/audit-violations-2026-05-23.md` ca follow-up.

- [ ] **Step 5: Commit final**

```bash
git add app/package.json app/scripts/hooks/pre-commit app/.claude/CLAUDE.md
git commit -m "feat: wire new audit scripts into npm run audit and pre-commit"
```

---

## Self-Review

**1. Spec coverage:** Cele 8 audits acoperă fiecare gap identificat în conversația cu user-ul, minus cele 5 deja implementate (documentate în header). Romanian-only UI strings a fost intenționat omis (false positive rate prea mare pentru audit cu valoare net pozitivă).

**2. Placeholder scan:** Nicio referință la „TBD", „add validation", „handle edge cases" fără cod concret. Fiecare task are scriptul complet inline.

**3. Type consistency:** Toate scripturile expun același API: `audit()` și `auditSource(...)`/`auditEnvLine(...)` ca funcții pure (testabile), `format()` pentru text, `main()` la `require.main === module`. Toate suportă `--strict` și `--json`. Ieșire RO unitară (✓ / ✗ + acțiune Fix).

**4. Risc rezidual:** Niciun audit nu detectează violări care necesită analiză semantică profundă (ex: flow analysis pentru data flow `private_notes` → AI). Acelea sunt acoperite parțial de ast-grep `no-getdocuments-in-ai-context`; o extensie ulterioară ar fi un script care urmărește toate funcțiile care construiesc payload AI și verifică sanitize.
