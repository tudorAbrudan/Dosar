#!/usr/bin/env node
/**
 * modal-input-audit.js
 *
 * Flag `<Modal transparent>` care conține `<TextInput>`, `<Switch>`,
 * `<DatePickerField>` sau `<Picker>` — regresie cunoscută: bottom-sheet
 * cu input nu permite scroll cu tastatura deschisă.
 *
 * Vezi CLAUDE.md §"Pattern-uri formulare" și
 * docs/superpowers/specs/2026-05-02-form-uniformity-design.md.
 *
 * Rulare:
 *   node scripts/modal-input-audit.js
 *   node scripts/modal-input-audit.js --strict
 *   node scripts/modal-input-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

// Modaluri legitime single-purpose (CLAUDE.md §Pattern-uri formulare exemptii).
const ALLOWED = new Set([
  'components/AppLockPinModal.tsx',
  'components/CloudPasswordModal.tsx',
  'components/ReviewSentimentModal.tsx',
  'components/LegalModal.tsx',
]);

const INPUT_TAGS = ['TextInput', 'Switch', 'DatePickerField', 'Picker'];

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
    else if (ent.name.endsWith('.tsx') && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  const violations = [];
  // Match <Modal ...> ... </Modal> — non-greedy
  const re = /<Modal\b([^>]*)>([\s\S]*?)<\/Modal>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1];
    // transparent ca atribut boolean OR transparent={true}
    const isTransparent =
      /\btransparent\b(?!\s*=\s*\{?\s*false)/.test(attrs);
    if (!isTransparent) continue;
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
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  } else {
    process.stdout.write(format(v) + '\n');
  }
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format };
