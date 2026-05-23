#!/usr/bin/env node
/**
 * catch-pattern-audit.js
 *
 * Detectează `catch(X) { ... X.message ... }` fără guard `X instanceof Error`.
 *
 * Vezi CLAUDE.md §"Error handling standard":
 *   catch(e): mereu `e instanceof Error ? e.message : 'Eroare necunoscută'`
 *
 * Rulare:
 *   node scripts/catch-pattern-audit.js
 *   node scripts/catch-pattern-audit.js --strict
 *   node scripts/catch-pattern-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'components', 'app'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (
      ent.name === 'node_modules' ||
      ent.name === 'ios' ||
      ent.name === 'android' ||
      ent.name === '.worktrees' ||
      ent.name === 'build' ||
      ent.name === 'dist' ||
      ent.name.startsWith('.')
    ) {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  const violations = [];
  // `catch (VAR)` sau `catch (VAR: TYPE)`
  const catchRe = /catch\s*\(\s*([a-zA-Z_$][\w$]*)\s*(?::\s*[^)]+)?\s*\)\s*\{/g;
  let m;
  while ((m = catchRe.exec(source)) !== null) {
    const variable = m[1];
    const braceIdx = m.index + m[0].length - 1; // index al `{`
    let depth = 1;
    let i = braceIdx + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(braceIdx + 1, i - 1);
    const usesMessage = new RegExp(`\\b${variable}\\.message\\b`).test(body);
    if (!usesMessage) continue;
    const hasGuard = new RegExp(`\\b${variable}\\s+instanceof\\s+Error\\b`).test(body);
    if (hasGuard) continue;
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
  if (violations.length === 0) {
    return '✓ Toate catch-urile cu .message folosesc instanceof Error.';
  }
  const lines = [`✗ ${violations.length} catch(.message) fără guard instanceof Error:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} — catch (${v.variable})`);
  }
  lines.push('');
  lines.push("Fix: const msg = e instanceof Error ? e.message : 'Eroare necunoscută';");
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  } else {
    process.stdout.write(format(v) + '\n');
  }
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
