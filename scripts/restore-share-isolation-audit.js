#!/usr/bin/env node
/**
 * restore-share-isolation-audit.js
 *
 * Orice push spre zonele CloudKit pornit din `services/` (un `import('./cloudShare')`
 * dinamic, în afara lui cloudShare.ts) trebuie să stea într-o funcție care verifică
 * SINCRON `isRestoreInProgress()` înainte de import. Restaurarea cu înlocuire păstrează
 * ID-urile originale; un push din timpul ei ar suprascrie datele mai noi din zonă cu
 * starea din backup (la participant: datele owner-ului). Verificarea trebuie făcută la
 * locul apelului — `import()` se rezolvă după ce restaurarea s-a terminat și flag-ul a
 * fost resetat. Origine: P0 „restaurare cu ID-uri originale", 2026-10-14.
 *
 *   node scripts/restore-share-isolation-audit.js [--strict] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SERVICES = path.join(APP_DIR, 'services');
const EXEMPT = new Set(['cloudShare.ts']);
const DYNAMIC_SHARE_IMPORT = /import\(\s*['"]\.\/cloudShare['"]\s*\)/;
const GUARD = /isRestoreInProgress\(\)/;
const FUNCTION_START_RE = /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(/;

/** Corpurile funcțiilor declarate cu `function` (delimitare prin numărare de acolade). */
function extractFunctions(source) {
  const lines = source.split('\n');
  const functions = [];
  let i = 0;
  while (i < lines.length) {
    const m = FUNCTION_START_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    let depth = 0;
    let started = false;
    const body = [];
    let j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') depth--;
      }
      body.push(lines[j]);
      if (started && depth === 0) break;
    }
    functions.push({ name: m[3], startLine: i + 1, body: body.join('\n') });
    i = j + 1;
  }
  return functions;
}

function auditFile(rel, source) {
  const violations = [];
  for (const fn of extractFunctions(source)) {
    if (!DYNAMIC_SHARE_IMPORT.test(fn.body)) continue;
    const importAt = fn.body.search(DYNAMIC_SHARE_IMPORT);
    const guardAt = fn.body.search(GUARD);
    if (guardAt === -1 || guardAt > importAt) {
      violations.push({
        file: rel,
        line: fn.startLine,
        msg: `funcția "${fn.name}" împinge spre cloudShare fără gardă isRestoreInProgress() înainte de import()`,
      });
    }
  }
  return violations;
}

function audit() {
  const violations = [];
  for (const name of fs.readdirSync(SERVICES)) {
    if (!name.endsWith('.ts') || EXEMPT.has(name)) continue;
    const rel = `services/${name}`;
    const source = fs.readFileSync(path.join(SERVICES, name), 'utf8');
    violations.push(...auditFile(rel, source));
  }
  return violations;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Restore/share isolation: orice push spre cloudShare e gardat de isRestoreInProgress().';
  }
  const lines = [`✗ ${violations.length} push(uri) spre cloudShare fără gardă de restaurare:`, ''];
  for (const v of violations) lines.push(`  ${v.file}:${v.line} — ${v.msg}`);
  lines.push(
    '',
    'Fix: folosește pushEntityToShare / pushDocumentToShare sau verifică isRestoreInProgress() sincron.'
  );
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  process.stdout.write((args.has('--json') ? JSON.stringify(v, null, 2) : format(v)) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditFile, format };
