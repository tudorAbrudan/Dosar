#!/usr/bin/env node
/**
 * sheet-header-audit.js
 *
 * Flag header-uri de modal/sheet construite de mână, cu butoane-text
 * „Anulează" / „Salvează" / „Aplică" / „Confirmă" în JSX. Ele se suprapun cu
 * titlul pe telefoane mici sau cu Dynamic Type mare. Fix: <SheetHeader> din
 * components/ui/SheetHeader.tsx (butoane icon-only cu lățime fixă).
 *
 * Detectează `>Anulează<` (text JSX, inclusiv pe linie separată) — NU
 * `{ text: 'Anulează' }` din Alert.alert.
 *
 * Rulare: node scripts/sheet-header-audit.js [--strict]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

// Exempții legitime (butoane de dialog single-purpose / acțiuni inline, nu header de sheet).
const ALLOWED = new Set([
  'components/CloudPasswordModal.tsx',
  'components/AppLockPinModal.tsx',
  'components/settings/LocalModelCatalog.tsx',
  'components/settings/AiActionBar.tsx',
  'components/ui/SheetHeader.tsx',
  // butoane inline de conținut (pill cu icon + text), nu header de sheet:
  'app/(tabs)/entitati/medical/[id]/review.tsx',
  'components/document/DocumentOcrTextSection.tsx',
  'components/onboarding/AiStep.tsx',
]);

const LABEL_RE = />\s*(Anulează|Salvează|Aplică|Confirmă)\s*</g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === 'ios' || ent.name === 'android' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const violations = [];
for (const d of ['app', 'components']) {
  for (const file of walk(path.join(APP_DIR, d))) {
    const rel = path.relative(APP_DIR, file);
    if (ALLOWED.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    let m;
    LABEL_RE.lastIndex = 0;
    while ((m = LABEL_RE.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(`${rel}:${line}  text „${m[1]}" în JSX → folosește <SheetHeader> (components/ui/SheetHeader.tsx)`);
    }
  }
}

if (violations.length) {
  console.log(`sheet-header-audit: ${violations.length} violări`);
  for (const v of violations) console.log('  ' + v);
  process.exit(STRICT ? 1 : 0);
}
console.log('sheet-header-audit: OK');
