#!/usr/bin/env node
/**
 * check-hardcoded-entities.js
 *
 * Detectează hardcode-uri de `EntityType` care ar trebui să folosească
 * sursele unice din `types/index.ts`:
 *   - ALL_ENTITY_TYPES, ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI
 *   - resolveEntityName() din useEntities()
 *
 * Strategie line-by-line (rapid, fără regex backtracking):
 *   - numără apariții de chei standard (person/vehicle/property/card/animal/company)
 *     în context de Record/array/switch within ~30 linii consecutive
 *   - 5+ chei distincte într-o fereastră scurtă = suspiciune hardcode
 *
 * Folosire:
 *   node scripts/check-hardcoded-entities.js
 *   node scripts/check-hardcoded-entities.js --strict
 *   node scripts/check-hardcoded-entities.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const ALLOWED_FILES = new Set([
  'types/index.ts',
  'hooks/useEntities.ts',
  'scripts/check-hardcoded-entities.js',
  'scripts/backup-audit.js',
]);

const STANDARD_KEYS = ['person', 'vehicle', 'property', 'card', 'animal', 'company'];
const WINDOW = 25; // linii consecutive pentru a considera „context comun"
const MIN_KEYS = 5;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === 'ios' ||
      name === 'android' ||
      name === '.worktrees' ||
      name === 'build' ||
      name === 'dist' ||
      name.startsWith('.')
    ) {
      continue;
    }
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function rel(abs) {
  return path.relative(APP_DIR, abs).replace(/\\/g, '/');
}

function isAllowed(relPath) {
  return ALLOWED_FILES.has(relPath) || relPath.includes('__tests__/');
}

/**
 * Pentru fiecare linie a fișierului, găsește cheile standard menționate ca
 * literali (`'person'`, `"vehicle"`, sau `person:` în obiect). Apoi cu sliding
 * window de WINDOW linii, dacă găsim MIN_KEYS chei distincte → posibil hardcode.
 *
 * Reduce false-positives:
 *   - skip linii cu „import" sau „export" (deklarațiile din types)
 *   - skip linii cu comentariu // sau /*
 */
function findClusters(source) {
  const lines = source.split('\n');
  // Pe fiecare linie, set de chei detectate.
  const perLine = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return new Set();
    if (trimmed.startsWith('import') || trimmed.startsWith('export ')) return new Set();
    const found = new Set();
    for (const k of STANDARD_KEYS) {
      const inObjectKey = new RegExp(`(^|[\\s{,])${k}\\s*:`).test(trimmed);
      const inSwitchCase = new RegExp(`case\\s+['\"]${k}['\"]`).test(trimmed);
      const inKeyArray = new RegExp(`key:\\s*['\"]${k}['\"]`).test(trimmed);
      const inStringLiteral = new RegExp(`['\"]${k}['\"]\\s*,`).test(trimmed);
      if (inObjectKey || inSwitchCase || inKeyArray || inStringLiteral) found.add(k);
    }
    return found;
  });

  const clusters = [];
  for (let start = 0; start < perLine.length; start++) {
    const end = Math.min(start + WINDOW, perLine.length);
    const union = new Set();
    for (let i = start; i < end; i++) {
      for (const k of perLine[i]) union.add(k);
    }
    if (union.size >= MIN_KEYS) {
      // Avansăm până ieșim din clusterul curent (skip overlapping)
      clusters.push({ line: start + 1, keys: Array.from(union) });
      start = end - 1;
    }
  }
  return clusters;
}

function audit() {
  const files = walk(APP_DIR);
  const violations = [];
  for (const abs of files) {
    const r = rel(abs);
    if (isAllowed(r)) continue;
    let source;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    // Skip fișiere fără cuvinte cheie deloc (perf)
    if (!STANDARD_KEYS.some(k => source.includes(k))) continue;
    const clusters = findClusters(source);
    if (clusters.length > 0) violations.push({ file: r, clusters });
  }
  return violations;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Nicio entitate hardcodată detectată.';
  }
  const lines = [`✗ ${violations.length} fișiere cu cluster-uri de EntityType hardcoded:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file}`);
    for (const c of v.clusters) {
      lines.push(`    L${c.line}: ${c.keys.length} chei consecutive [${c.keys.join(', ')}]`);
    }
    lines.push('');
  }
  lines.push('Fix:');
  lines.push('  - Record<EntityType, X> → folosește ENTITY_TYPE_LABELS / ENTITY_TYPE_EMOJI');
  lines.push('  - switch(entityType) → folosește useEntities().resolveEntityName(link)');
  lines.push('  - [{ key: "person" }, ...] → ALL_ENTITY_TYPES.map(t => ({ key: t, ... }))');
  lines.push('');
  lines.push('Vezi .claude/rules/dynamic-types.md');
  return lines.join('\n');
}

const args = new Set(process.argv.slice(2));
const violations = audit();

if (args.has('--json')) {
  console.log(JSON.stringify(violations, null, 2));
} else {
  console.log(format(violations));
}

if (args.has('--strict') && violations.length > 0) {
  process.exit(1);
}

module.exports = { audit, format };
