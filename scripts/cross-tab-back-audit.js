#!/usr/bin/env node
/**
 * cross-tab-back-audit.js
 *
 * Orice `router.push` / `replace` / `navigate` către un ecran din stack-ul
 * Documente (`/(tabs)/documente/[id]`, `/(tabs)/documente/${id}`,
 * `/(tabs)/documente/add`) făcut din AFARA tabului Documente trebuie să trimită
 * `from` (+ `entityId`). Fără el, „Înapoi" și salvarea duc pe lista Documente,
 * nu înapoi la ecranul sursă (lecția 2026-05-31; repetat la adăugarea unui
 * document din ecranul entității și din Home, 2026-10-25).
 *
 * Excepție punctuală: `// cross-tab-back-audit-ignore: <motiv>` pe linia de
 * deasupra apelului (ex. share intent, care n-are ecran sursă).
 *
 * Rulare: node scripts/cross-tab-back-audit.js [--strict]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const DIRS = ['app', 'components', 'hooks'];
// Navigarea din interiorul tabului Documente rămâne în același stack.
const SAME_STACK_DIR = path.join('app', '(tabs)', 'documente') + path.sep;
const IGNORE_MARK = 'cross-tab-back-audit-ignore';

const CALL_RE = /router\.(push|replace|navigate)\(/g;
const TARGET_RE = /\/\(tabs\)\/documente\/(\[id\]|\$\{|add\b)/;
const FROM_RE = /\bfrom\s*:|[?&]from=/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Textul argumentelor apelului, până la paranteza care îl închide. */
function callArgs(src, openIndex) {
  let depth = 1;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(openIndex, i);
  }
  return src.slice(openIndex);
}

const violations = [];
for (const d of DIRS) {
  for (const file of walk(path.join(APP_DIR, d))) {
    const rel = path.relative(APP_DIR, file);
    if (rel.startsWith(SAME_STACK_DIR)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let m;
    CALL_RE.lastIndex = 0;
    while ((m = CALL_RE.exec(src))) {
      const args = callArgs(src, m.index + m[0].length);
      if (!TARGET_RE.test(args) || FROM_RE.test(args)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if ((lines[line - 2] ?? '').includes(IGNORE_MARK)) continue;
      violations.push(
        `${rel}:${line}  router.${m[1]} spre stack-ul Documente fără \`from\` → „Înapoi" ajunge pe lista Documente`
      );
    }
  }
}

if (violations.length) {
  console.log(`cross-tab-back-audit: ${violations.length} violări`);
  for (const v of violations) console.log('  ' + v);
  console.log('  Fix: params { from: "entity" | "home" | …, entityId } — vezi services/backNavigation.ts');
  process.exit(STRICT ? 1 : 0);
}
console.log('cross-tab-back-audit: OK');
