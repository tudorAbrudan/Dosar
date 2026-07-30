#!/usr/bin/env node
/**
 * cloudkit-field-names-audit.js
 *
 * Flag numele de câmp / tip de record CloudKit construite DIN DATE (template
 * literal cu interpolare) în layer-ul de partajare.
 *
 * Schema mediului Production e blocată: un câmp sau tip care nu există acolo face
 * serverul să respingă recordul ÎNTREG, per record, nu doar câmpul. Un nume derivat
 * din date (ex. `file_page_${pageOrder}`) înseamnă că prima valoare nouă apărută în
 * producție — al treilea, al patrulea, al zecelea — nu are câmp publicat și eșuează
 * permanent. În Development nu se vede niciodată: acolo schema se creează singură.
 *
 * Origine regresie (2026-07-30): paginile documentelor plecau ca `file_page_<N>`.
 * Formatul v2 le mută în recorduri `document_page` cu un singur asset `file`.
 * Vezi docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md
 * („Formatul pe sârmă (v2)").
 *
 * Rulare:
 *   node scripts/cloudkit-field-names-audit.js
 *   node scripts/cloudkit-field-names-audit.js --strict
 *   node scripts/cloudkit-field-names-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');

/** Fișierele care compun payload-ul CloudKit. */
const SCAN_FILES = [
  'services/cloudShareMapping.ts',
  'services/cloudShare.ts',
  'services/sharing.ts',
];

/** Marker inline pentru excepții justificate (pe linia dinainte). */
const DISABLE_MARKER = 'cloudkit-field-names-audit-disable-next-line';

/**
 * Proprietăți care ajung nume de câmp/tip în CloudKit. Valoarea lor nu are voie
 * să fie template literal cu interpolare — doar constantă sau string literal.
 * `recordName` NU e aici: numele recordurilor sunt date, nu schemă, deci pot
 * (și trebuie să) fie derivate — vezi `pageRecordName`.
 */
const SCHEMA_PROPS = ['key', 'recordType'];

const INTERPOLATED_ASSIGNMENT = new RegExp(`\\b(${SCHEMA_PROPS.join('|')})\\s*:\\s*\`[^\`]*\\$\\{`);
// Al doilea tipar: cheie compusă cu `+` sau prin funcție care întoarce `file_${…}`.
const INTERPOLATED_FIELD_NAME = /`(?:file|document|page)[a-z_]*\$\{/i;

function auditSource(source, file) {
  const violations = [];
  const lines = source.split('\n');
  lines.forEach((line, idx) => {
    const previous = (lines[idx - 1] ?? '').trim();
    if (previous.includes(DISABLE_MARKER)) return;
    const match = INTERPOLATED_ASSIGNMENT.exec(line) || INTERPOLATED_FIELD_NAME.exec(line);
    if (!match) return;
    violations.push({ file, line: idx + 1, snippet: line.trim().slice(0, 120) });
  });
  return violations;
}

function audit() {
  const all = [];
  for (const rel of SCAN_FILES) {
    const full = path.join(APP_DIR, rel);
    if (!fs.existsSync(full)) continue;
    all.push(...auditSource(fs.readFileSync(full, 'utf8'), rel));
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Niciun nume de câmp/tip CloudKit derivat din date.';
  }
  const lines = [`✗ ${violations.length} nume de schemă CloudKit construit din date:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line}`);
    lines.push(`      ${v.snippet}`);
  }
  lines.push('');
  lines.push('Schema mediului Production e BLOCATĂ: un câmp/tip care nu există acolo');
  lines.push('face serverul să respingă recordul întreg. În Development nu se vede —');
  lines.push('schema se creează singură, deci bug-ul apare abia în App Store.');
  lines.push('');
  lines.push('Fix: nume fix (constantă exportată). Dacă ai nevoie de N valori,');
  lines.push('fă N recorduri de un tip fix, nu N câmpuri pe același record —');
  lines.push('vezi `document_page` în cloudShareMapping.ts.');
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
