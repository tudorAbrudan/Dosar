#!/usr/bin/env node
/**
 * db-destructive-init-audit.js
 *
 * Detectează în `services/db.ts` `DROP TABLE [IF EXISTS] X` aplicat pe un tabel
 * `X` care e și `CREATE TABLE IF NOT EXISTS X` în același fișier — pattern care
 * șterge datele userului la FIECARE pornire de app (drop urmat de recreate gol
 * + cleanup orphan în document_entities = entitate dispărută, documente fără
 * legătură).
 *
 * Origine regulă: regresia 2026-05-24, entitatea „dosar medical" se ștergea la
 * fiecare restart. Cauză: blocul `DROP TABLE IF EXISTS medical_record` (etc.)
 * adăugat în 3.5.0-53 (când feature-ul a fost mutat) a rămas după reintegrarea
 * schemei medical în 3.6+ (commit 5ce2e11). Vezi CLAUDE.md §"DoD → Regresie →
 * audit nou".
 *
 * DROP-uri permise (legacy cleanup): DROP TABLE X unde X NU are CREATE TABLE
 * corespunzător în db.ts (ex: `vehicle_fuel_settings`, `medical_chunks_fts`).
 *
 * Rulare:
 *   node scripts/db-destructive-init-audit.js
 *   node scripts/db-destructive-init-audit.js --strict
 *   node scripts/db-destructive-init-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(APP_DIR, 'services/db.ts');

function collectCreated(source) {
  const created = new Set();
  const re = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    created.add(m[1].toLowerCase());
  }
  return created;
}

function collectDrops(source) {
  const drops = [];
  const re = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z_0-9]*)/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const line = source.slice(0, m.index).split('\n').length;
    drops.push({
      table: m[1].toLowerCase(),
      line,
      statement: m[0],
      index: m.index,
    });
  }
  return drops;
}

/**
 * Returnează limitele [start, end] ale string literal-ului (backtick / quote)
 * care conține poziția `pos`, sau null dacă pos e în afara unui literal.
 */
function enclosingLiteral(source, pos) {
  // Scanare liniară: detectăm intrarea/ieșirea în string literals
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', i);
      i = eol === -1 ? source.length : eol + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 2;
        else i++;
      }
      const end = i;
      if (pos >= start && pos <= end) return [start, end];
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/**
 * Pattern recreate-table SQLite: în același string literal cu DROP-ul,
 * apare `ALTER TABLE X_v2 RENAME TO <dropped_table>` (sau orice RENAME TO
 * cu același nume). E migrarea idiomatică pentru a schimba constraint-uri
 * pe coloane existente — datele sunt salvate în tabelul nou înainte.
 */
function isPartOfRecreatePattern(source, drop) {
  const literal = enclosingLiteral(source, drop.index);
  if (!literal) return false;
  const [start, end] = literal;
  const block = source.slice(start, end);
  const renameRe = new RegExp(`RENAME\\s+TO\\s+${drop.table}\\b`, 'i');
  return renameRe.test(block);
}

function auditSource(source) {
  const created = collectCreated(source);
  const drops = collectDrops(source);
  return drops.filter(d => created.has(d.table) && !isPartOfRecreatePattern(source, d));
}

function audit() {
  if (!fs.existsSync(DB_FILE)) return [];
  return auditSource(fs.readFileSync(DB_FILE, 'utf8'));
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Niciun DROP TABLE distructiv în services/db.ts.';
  }
  const lines = [
    `✗ ${violations.length} DROP TABLE care șterg date user la fiecare pornire:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  services/db.ts:${v.line} — ${v.statement}`);
  }
  lines.push('');
  lines.push('Fiecare tabel listat are și CREATE TABLE IF NOT EXISTS în db.ts.');
  lines.push('DROP urmat de CREATE = recreate gol → datele userului se pierd la fiecare');
  lines.push('app restart. Vezi regresia „dosar_medical" (2026-05-24).');
  lines.push('');
  lines.push('Fix: șterge DROP-urile. Pentru migrare schemă veche → nouă,');
  lines.push('detectează versiunea cu PRAGMA table_info și migrează explicit.');
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
