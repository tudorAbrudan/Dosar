#!/usr/bin/env node
/**
 * unique-filename-audit.js
 *
 * Flag nume de fișier din `documents/` construite doar din `Date.now()`
 * (`doc_${Date.now()}.jpg|pdf`). Două salvări în aceeași milisecundă produc același
 * nume → a doua suprascrie prima, iar două pagini ajung să împartă un fișier (permis:
 * pagina apărea de 2 ori, ștergerea/rotirea o afecta pe cealaltă). Folosește
 * `uniqueDocFilename()` din `services/documentPageStorage.ts`.
 *
 *   node scripts/unique-filename-audit.js [--strict]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', '__tests__', '.worktrees', 'docs']);
const PATTERN = /doc_\$\{Date\.now\(\)\}\.(jpg|pdf)/;
const hits = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(e.name)) {
      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (PATTERN.test(line)) hits.push(`${path.relative(APP, full)}:${i + 1}  ${line.trim()}`);
        });
    }
  }
}
walk(APP);

if (hits.length === 0) {
  console.log('✓ unique-filename-audit: OK');
  process.exit(0);
}
console.log('unique-filename-audit — nume de fișier doar din Date.now():');
hits.forEach(h => console.log('  ✗ ' + h));
process.exit(strict ? 1 : 0);
