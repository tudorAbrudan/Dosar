#!/usr/bin/env node
/**
 * entity-doc-links-audit.js
 *
 * Flag query-urile care caută documentele unei entități DOAR prin coloana legacy
 * `documents.<tip>_id`, fără să se uite și în junction table-ul `document_entities`.
 *
 * Coloana legacy e o denormalizare a PRIMULUI link de acel tip. Sursa completă e
 * `document_entities`. Două categorii de documente lipsesc din query-urile
 * legacy-only:
 *   1. documentele primite prin partajare CloudKit — `cloudShare.applyDocumentRow`
 *      creează legătura în junction;
 *   2. al doilea (al treilea…) link de același tip — multi-link din
 *      `addEntityLinkToDocument` / `extra_entity_links`.
 *
 * Origine regresie (2026-07-30, versiunea 3.11.x din App Store): ecranul entității
 * (`app/(tabs)/entitati/[id].tsx` → `getDocumentsByEntity`) filtra pe `vehicle_id`,
 * deci o entitate primită de la alt telefon apărea în listă „fără documente", deși
 * documentele ajunseseră în SQLite. Vezi `.claude/rules/dynamic-types.md`
 * („Câmpuri legacy în loc de entity_links").
 *
 * Rulare:
 *   node scripts/entity-doc-links-audit.js
 *   node scripts/entity-doc-links-audit.js --strict
 *   node scripts/entity-doc-links-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'app', 'components'];

/** Marker inline, pe linia dinaintea query-ului, pentru excepții justificate. */
const DISABLE_MARKER = 'entity-doc-links-audit-disable-next-line';

const ENTITY_COLUMNS = ['person', 'property', 'vehicle', 'card', 'animal', 'company'];

// Literali de string JS (backtick multi-linie, ghilimele simple/duble).
const STRING_LITERAL_RE = /`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

const FROM_DOCUMENTS_RE = /\bfrom\s+documents\b/i;
const READ_RE = /\b(select|delete)\b/i;
const LEGACY_FILTER_RE = new RegExp(
  `\\b(?:[a-z]+\\.)?(${ENTITY_COLUMNS.join('|')})_id\\s*(?:=|IN)\\s*`,
  'i'
);
const JUNCTION_RE = /document_entities/i;

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
    else if (
      (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function auditSource(source, file) {
  const violations = [];
  const lines = source.split('\n');
  let match;
  STRING_LITERAL_RE.lastIndex = 0;
  while ((match = STRING_LITERAL_RE.exec(source)) !== null) {
    const literal = match[0];
    if (!FROM_DOCUMENTS_RE.test(literal)) continue;
    if (!READ_RE.test(literal)) continue;
    const legacy = LEGACY_FILTER_RE.exec(literal);
    if (!legacy) continue;
    if (JUNCTION_RE.test(literal)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    const previous = (lines[line - 2] ?? '').trim();
    if (previous.includes(DISABLE_MARKER)) continue;

    violations.push({
      file,
      line,
      column: `${legacy[1]}_id`,
      snippet: literal.replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(APP_DIR, dir))) {
      const source = fs.readFileSync(file, 'utf8');
      all.push(...auditSource(source, path.relative(APP_DIR, file)));
    }
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Nicio căutare de documente pe entitate care ignoră document_entities.';
  }
  const lines = [`✗ ${violations.length} query pe documente filtrat DOAR pe coloana legacy:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} — ${v.column}`);
    lines.push(`      ${v.snippet}`);
  }
  lines.push('');
  lines.push('Coloana legacy `<tip>_id` ține doar PRIMUL link de acel tip. Lipsesc:');
  lines.push('  • documentele primite prin partajare (legate doar în document_entities);');
  lines.push('  • al doilea link de același tip (multi-link).');
  lines.push('');
  lines.push('Fix: folosește `getDocumentsByEntity()` din services/documents.ts, sau');
  lines.push('adaugă în query ramura pe junction:');
  lines.push('  OR EXISTS (SELECT 1 FROM document_entities de');
  lines.push('              WHERE de.document_id = d.id');
  lines.push('                AND de.entity_type = ? AND de.entity_id = ?)');
  lines.push('');
  lines.push(`Excepție justificată: comentariu \`// ${DISABLE_MARKER}\` pe linia dinainte.`);
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
