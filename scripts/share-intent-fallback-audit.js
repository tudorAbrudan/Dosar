#!/usr/bin/env node
/**
 * share-intent-fallback-audit.js
 *
 * iOS 27 livrează aplicației URL-ul extensiei de share ca `acte:///` (fără cheia
 * `dataUrl=` și fără `#media|#file`), deci doar `+native-intent.ts` / URL-ul din
 * expo-share-intent nu mai pornesc „Adaugă document" (regresie 2026-10-01). Root layout
 * trebuie să (1) ceară datele extensiei direct (`pullPendingShareIntent`) și (2) să
 * navigheze la ecranul de adăugare pe `hasShareIntent`, independent de URL.
 *
 *   node scripts/share-intent-fallback-audit.js [--strict]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const strict = process.argv.includes('--strict');
const layout = fs.readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const problems = [];
if (!/pullPendingShareIntent\(\)/.test(layout)) {
  problems.push(
    'app/_layout.tsx nu apelează pullPendingShareIntent() la pornire / revenire în prim-plan.'
  );
}
if (!/hasShareIntent/.test(layout) || !/documente\/add/.test(layout)) {
  problems.push('app/_layout.tsx nu navighează la documente/add pe hasShareIntent.');
}
if (problems.length === 0) {
  console.log('✓ share-intent-fallback-audit: OK');
  process.exit(0);
}
console.log('share-intent-fallback-audit:');
problems.forEach(p => console.log('  ✗ ' + p));
process.exit(strict ? 1 : 0);
