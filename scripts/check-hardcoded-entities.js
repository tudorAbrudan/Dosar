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
 *     în context de Record/array/switch within ~25 linii consecutive
 *   - 5+ chei distincte într-o fereastră scurtă = suspiciune hardcode
 *
 * Reduce false-positives:
 *   - skip linii cu import/export
 *   - skip linii cu comentariu (single + block)
 *   - skip conținutul template literals cu backtick (mai ales SQL: SELECT, INSERT, CREATE TABLE)
 *   - skip clusterul imediat după comentariul `// check-hardcoded-entities-disable-next-cluster`
 *
 * Folosire:
 *   node scripts/check-hardcoded-entities.js
 *   node scripts/check-hardcoded-entities.js --strict
 *   node scripts/check-hardcoded-entities.js --json
 *
 * Suppress directive (la o linie deasupra unui Record/array de tab/icon UI necesar):
 *   // check-hardcoded-entities-disable-next-cluster
 *   const ENTITY_ICON: Record<EntityType, IoniconName> = { ... };
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
const WINDOW = 25;
const MIN_KEYS = 5;

const SUPPRESS_DIRECTIVE = 'check-hardcoded-entities-disable-next-cluster';

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
 * Returnează un Set de indici de linii care sunt **înăuntrul** unui template
 * literal cu backtick (multi-line) sau în comentarii multi-linie /* ... *\/.
 * Aceste linii sunt sărite când căutăm chei (evită false positives pe SQL).
 */
function findIgnoredLines(lines) {
  const ignored = new Set();
  let inBacktick = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      const next = line[j + 1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          j += 2;
          continue;
        }
        j++;
        continue;
      }
      if (inBacktick) {
        if (ch === '`') {
          inBacktick = false;
        }
        j++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        j += 2;
        continue;
      }
      if (ch === '/' && next === '/') {
        break; // restul liniei e comentariu
      }
      if (ch === '`') {
        inBacktick = true;
        j++;
        continue;
      }
      if (ch === "'" || ch === '"') {
        const quote = ch;
        j++;
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\') j++;
          j++;
        }
        j++;
        continue;
      }
      j++;
    }
    if (inBacktick || inBlockComment) ignored.add(i);
  }
  return ignored;
}

function findClusters(source) {
  const lines = source.split('\n');
  const ignoredLines = findIgnoredLines(lines);

  // Pentru fiecare directivă, intervalul [directive_line+1 .. directive_line+WINDOW]
  // e suprimat — orice cluster cu firstNonEmpty în acea fereastră e ignorat.
  const suppressRanges = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(SUPPRESS_DIRECTIVE)) {
      suppressRanges.push({ from: i + 1, to: i + WINDOW });
    }
  }
  const isSuppressed = (start, firstNonEmpty) => {
    for (const r of suppressRanges) {
      if (start >= r.from && start <= r.to) return true;
      if (firstNonEmpty !== -1 && firstNonEmpty >= r.from && firstNonEmpty <= r.to) return true;
    }
    return false;
  };

  const perLine = lines.map((line, i) => {
    if (ignoredLines.has(i)) return new Set();
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return new Set();
    if (trimmed.startsWith('import') || trimmed.startsWith('export ')) return new Set();
    const found = new Set();
    for (const k of STANDARD_KEYS) {
      const inObjectKey = new RegExp(`(^|[\\s{,])${k}\\s*:`).test(trimmed);
      const inSwitchCase = new RegExp(`case\\s+['"]${k}['"]`).test(trimmed);
      const inKeyArray = new RegExp(`key:\\s*['"]${k}['"]`).test(trimmed);
      const inStringLiteral = new RegExp(`['"]${k}['"]\\s*,`).test(trimmed);
      if (inObjectKey || inSwitchCase || inKeyArray || inStringLiteral) found.add(k);
    }
    return found;
  });

  const clusters = [];
  for (let start = 0; start < perLine.length; start++) {
    const end = Math.min(start + WINDOW, perLine.length);
    const union = new Set();
    let firstNonEmpty = -1;
    for (let i = start; i < end; i++) {
      if (perLine[i].size > 0 && firstNonEmpty === -1) firstNonEmpty = i;
      for (const k of perLine[i]) union.add(k);
    }
    if (union.size >= MIN_KEYS) {
      if (!isSuppressed(start, firstNonEmpty)) {
        clusters.push({ line: start + 1, keys: Array.from(union) });
      }
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
  lines.push('  - sau, dacă mapping-ul e UI-specific (icon/culoare per entitate),');
  lines.push(`    pune comentariul \`// ${SUPPRESS_DIRECTIVE}\` deasupra Record-ului.`);
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
