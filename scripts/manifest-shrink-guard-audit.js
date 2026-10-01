#!/usr/bin/env node
/**
 * manifest-shrink-guard-audit.js
 *
 * Orice cale care suprascrie `manifest.json` din iCloud (`writeFile(MANIFEST_PATH, …)`)
 * trebuie să treacă prin `detectManifestShrink` + `preserveManifestBeforeShrink`.
 * Fără guard, o stare locală redusă (restore parțial, reinstalare) se încarcă peste
 * singurul backup bun. Origine: pierderea dosarului medical, 2026-10-01.
 * Verifică și că restore-ul medical repară persoana lipsă (nu sare dosarul tăcut).
 *
 *   node scripts/manifest-shrink-guard-audit.js [--strict]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const problems = [];

const sync = fs.readFileSync(path.join(APP, 'services/cloudSync.ts'), 'utf8');
const writes = sync.match(/writeFile\(\s*MANIFEST_PATH/g) ?? [];
if (writes.length > 1) {
  problems.push(
    `services/cloudSync.ts: ${writes.length} scrieri de MANIFEST_PATH — fiecare trebuie să treacă prin guard-ul de scădere (verifică manual și extinde auditul).`
  );
}
if (
  !/detectManifestShrink\(\s*previousMeta/.test(sync) ||
  !/await preserveManifestBeforeShrink\(\)/.test(sync)
) {
  problems.push(
    'services/cloudSync.ts: uploadManifestIfChanged nu apelează detectManifestShrink + preserveManifestBeforeShrink înainte de suprascriere.'
  );
}

const backup = fs.readFileSync(path.join(APP, 'services/backup.ts'), 'utf8');
if (!/SELECT id FROM persons WHERE id = \?/.test(backup)) {
  problems.push(
    'services/backup.ts: restore-ul dosarului medical nu verifică existența persoanei (dosar sărit tăcut la FK).'
  );
}

if (problems.length === 0) {
  console.log('✓ manifest-shrink-guard-audit: OK');
  process.exit(0);
}
console.log('manifest-shrink-guard-audit:');
for (const p of problems) console.log('  ✗ ' + p);
process.exit(strict ? 1 : 0);
