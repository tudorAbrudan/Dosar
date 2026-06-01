#!/usr/bin/env node
/**
 * double-modal-audit.js
 *
 * Flag fișiere TSX care randează ≥2 componente Modal-like cu `visible={...}`
 * ca siblings în aceeași componentă React.
 *
 * Origine regresie (2026-05-25): `CreateMedicalRecordModal` randa
 * `<FormSheetModal>` și `<MedicalConsentModal>` simultan cu `visible=true` —
 * iOS UIKit refuză `presentViewController` peste un controller deja prezentat,
 * deci al doilea modal nu apărea. Userul vedea formularul neschimbat după
 * Save și concluziona „nu se întâmplă nimic".
 *
 * Soluția corectă: ori sequence (folosește `onDismiss` ca să deschizi al doilea
 * după ce primul s-a închis complet), ori inline (randează conținutul celui de
 * al doilea Modal în interiorul primului, fără un al doilea `<Modal>`).
 *
 * Rulare:
 *   node scripts/double-modal-audit.js
 *   node scripts/double-modal-audit.js --strict
 *   node scripts/double-modal-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

// Componente care prezintă un UIViewController peste UI-ul curent — adică
// wrap-ează `<Modal>` din react-native intern. Două dintre acestea ca siblings
// cu visible-uri independente = stacking risk pe iOS.
const MODAL_LIKE = new Set([
  'Modal', // react-native primitive
  'FormSheetModal',
  'MedicalConsentModal',
  'AppLockPinModal',
  'CloudPasswordModal',
  'ReviewSentimentModal',
  'LegalModal',
  'AiConfigModal',
  'ClassifyConfirmSheet',
  'MedicalRemindersModal',
  'OnboardingWizard',
  'RenameModal',
  'SelectTextModal',
  'DuplicateBanner',
]);

// Fișiere care au verificat manual sequencing-ul corect (onDismiss, route
// transition, etc.) — exempt.
const ALLOWED = new Set([
  // (gol pentru moment — orice exempție viitoare cere comentariu inline cu
  // motivul în fișierul respectiv)
]);

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
    else if (ent.name.endsWith('.tsx') && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

/**
 * Caută JSX opening tags de forma `<ComponentName ... visible={...} ...>` sau
 * `<ComponentName ... visible={...} ... />` și returnează lista lor.
 */
function findVisibleModals(source) {
  const out = [];
  // Match JSX opening tag: <Foo ...attrs... > sau <Foo ...attrs... />
  // Limitat la 1500 caractere de atribute (modaluri lungi nu sunt tipice).
  const tagRe = /<([A-Z][A-Za-z0-9_]*)\b([^<>]{0,1500})\/?>/g;
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    const name = m[1];
    if (!MODAL_LIKE.has(name)) continue;
    const attrs = m[2] || '';
    // Trebuie să aibă atributul `visible={...}` ca să fie controlat extern.
    const visMatch = attrs.match(/\bvisible\s*=\s*\{([^}]+)\}/);
    if (!visMatch) continue;
    const visibleExpr = visMatch[1].trim();
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ name, visibleExpr, line });
  }
  return out;
}

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  // Skip definițiile wrapper-ului în sine — Modal e folosit intern, e ok.
  // Heuristic: fișierul declară wrapper-ul dacă conține `export function <Name>`
  // pentru unul dintre componentele din MODAL_LIKE.
  for (const name of MODAL_LIKE) {
    const reDef = new RegExp(`export\\s+function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
    if (reDef.test(source)) {
      // Nu sare complet — verifică doar JSX-ul EXTERIOR definițiilor. Pentru
      // simplitate, dacă fișierul exportă un wrapper, presupunem că `<Modal>`
      // intern e intenționat. Verificăm doar JSX-uri compuse.
      // Excludem `Modal` (RN) din count în acest fișier:
      const externals = findVisibleModals(source).filter(x => x.name !== 'Modal' && x.name !== name);
      if (externals.length < 2) return [];
      const distinct = new Set(externals.map(x => x.visibleExpr));
      if (distinct.size < 2) return [];
      return [{
        file: relPath,
        count: externals.length,
        modals: externals,
      }];
    }
  }
  const modals = findVisibleModals(source);
  if (modals.length < 2) return [];
  const distinctExpr = new Set(modals.map(m => m.visibleExpr));
  if (distinctExpr.size < 2) return [];
  return [{
    file: relPath,
    count: modals.length,
    modals,
  }];
}

function audit() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(APP_DIR, d);
    for (const f of walk(abs)) {
      const rel = path.relative(APP_DIR, f).replace(/\\/g, '/');
      all.push(...auditSource(rel, fs.readFileSync(f, 'utf8')));
    }
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Niciun fișier cu ≥2 Modal-like siblings independente.';
  }
  const lines = [
    `✗ ${violations.length} fișier(e) cu ≥2 Modal-like siblings cu visible-uri distincte:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}`);
    for (const m of v.modals) {
      lines.push(`    ${m.line}: <${m.name} visible={${m.visibleExpr}}>`);
    }
    lines.push('');
  }
  lines.push('Risc: pe iOS, două <Modal> simultane cu visible=true nu se prezintă');
  lines.push('corect (UIKit refuză present-on-presented). Al doilea modal nu apare,');
  lines.push('userul vede primul modal neschimbat.');
  lines.push('');
  lines.push('Fix:');
  lines.push('  A) Inline — randează conținutul al doilea ÎN INTERIORUL primului');
  lines.push('     (fără un al doilea <Modal>). Vezi MedicalConsentBody folosit în');
  lines.push('     CreateMedicalRecordModal.tsx (2026-05-25 fix).');
  lines.push('  B) Sequence — închide primul, așteaptă `onDismiss` (iOS-only callback),');
  lines.push('     apoi setează visible-ul celui de-al doilea pe true.');
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
