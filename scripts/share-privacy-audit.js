#!/usr/bin/env node
/**
 * share-privacy-audit.js
 *
 * Păzește granița de privacy a partajării entităților între conturi (CloudKit).
 * Un leak aici = date medicale / CVV / PIN ajung pe alt cont iCloud = eșec
 * catastrofal (GDPR). Vezi `docs/superpowers/specs/2026-07-22-cloudkit-entity-sharing.md`
 * și `services/sharing.ts`.
 *
 * Reguli (pe fișierele din calea de share):
 *   A. `private_notes` NU apare în cod (whitelist-ul nu are nevoie de el).
 *   B. Fără spread de Document (`...doc`) — ocolește whitelist-ul.
 *   C. `services/sharing.ts` folosește `MEDICAL_DOC_TYPES` (excludere medicală)
 *      ȘI păstrează whitelist-ul `SHAREABLE_DOC_FIELDS`.
 *   D. `services/sharing.ts` NU folosește `getDocuments()` raw (fetch over-broad).
 *
 * Rulare:
 *   node scripts/share-privacy-audit.js
 *   node scripts/share-privacy-audit.js --strict
 *   node scripts/share-privacy-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');

const SHARING_SERVICE = 'services/sharing.ts';
const NATIVE_MODULE_DIR = 'modules/expo-cloudkit-share/src';

const EXTRA_SHARE_FILES = ['services/cloudShare.ts', 'services/cloudShareMapping.ts'];

function collectTargets() {
  const targets = [];
  const svc = path.join(APP_DIR, SHARING_SERVICE);
  if (fs.existsSync(svc)) targets.push(SHARING_SERVICE);
  for (const rel of EXTRA_SHARE_FILES) {
    if (fs.existsSync(path.join(APP_DIR, rel))) targets.push(rel);
  }
  const nativeDir = path.join(APP_DIR, NATIVE_MODULE_DIR);
  if (fs.existsSync(nativeDir)) {
    for (const f of fs.readdirSync(nativeDir)) {
      if (/\.ts$/.test(f) && !/\.test\./.test(f)) {
        targets.push(`${NATIVE_MODULE_DIR}/${f}`);
      }
    }
  }
  return targets;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function auditFile(rel, source) {
  const violations = [];
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    // Rule A — token private_notes în cod (nu în comentariu). Excepție strictă:
    // DOAR liniile gărzii `assertNoSensitiveLeak` (`.includes(` de detecție sau
    // `throw new Error(` cu mesajul). Un identificator care conține „leak" NU
    // e o scuză.
    if (/private_notes/.test(line) && !/\.includes\(|throw new Error\(/.test(line)) {
      violations.push({ file: rel, line: i + 1, rule: 'A', msg: 'private_notes referit în calea de share (folosește whitelist, nu-l atinge)' });
    }
    // Rule B — spread de Document
    if (/\.\.\.(doc|document|d)\b/.test(line)) {
      violations.push({ file: rel, line: i + 1, rule: 'B', msg: 'spread de Document ocolește whitelist-ul — construiește explicit câmpurile' });
    }
  });

  // Rule C + D — doar pe serviciul de sharing
  if (rel === SHARING_SERVICE) {
    if (!/MEDICAL_DOC_TYPES/.test(source)) {
      violations.push({ file: rel, line: 0, rule: 'C', msg: 'excluderea medicală (MEDICAL_DOC_TYPES) lipsește' });
    }
    if (!/SHAREABLE_DOC_FIELDS/.test(source)) {
      violations.push({ file: rel, line: 0, rule: 'C', msg: 'whitelist-ul SHAREABLE_DOC_FIELDS lipsește' });
    }
    if (/\bgetDocuments\s*\(/.test(source)) {
      violations.push({ file: rel, line: 0, rule: 'D', msg: 'getDocuments() raw — folosește getDocumentsByEntity / getShareBundle' });
    }
  }

  return violations;
}

function audit() {
  const all = [];
  for (const rel of collectTargets()) {
    const src = fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
    all.push(...auditFile(rel, src));
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Share privacy: whitelist intactă, fără private_notes / medical / spread de Document.';
  }
  const lines = [`✗ ${violations.length} problemă/e de privacy în calea de share:`, ''];
  for (const v of violations) {
    const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    lines.push(`  [${v.rule}] ${loc} — ${v.msg}`);
  }
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

module.exports = { audit, auditFile, format };
