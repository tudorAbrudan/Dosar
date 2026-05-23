#!/usr/bin/env node
/**
 * file-size-audit.js
 *
 * Listează fișiere `.ts`/`.tsx` din services/, hooks/, components/, app/ care
 * depășesc pragul de linii. Default: warn la 400, strict la 800.
 *
 * Vezi CLAUDE.md §"Fișiere mari (>400 linii)" și memory/dosar_god_files.md.
 *
 * Rulare:
 *   node scripts/file-size-audit.js
 *   node scripts/file-size-audit.js --strict
 *   node scripts/file-size-audit.js --json
 *   node scripts/file-size-audit.js --warn-threshold=500 --strict-threshold=1000
 */

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

function parseArgs(argv) {
  let warn = 400;
  let strict = 800;
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
    lines.push(`✗ ${fails.length} fișier(e) peste pragul dur (≥${strict} linii):`);
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
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    process.stdout.write(format(results, warn, hard) + '\n');
  }
  if (args.has('--strict') && results.some(r => r.status === 'fail')) process.exit(1);
}

module.exports = { audit, countNonBlankLines, classify, format };
