#!/usr/bin/env node
/**
 * alert-modal-race-audit.js
 *
 * Flag pattern-ul: `Alert.alert(..., [{ onPress: () => setXxxVisible(true) }])`
 * — adică un buton de Alert care încearcă să prezinte imediat un `<Modal>`.
 *
 * Pe iOS, `UIAlertController` e încă în animația de dismiss când callback-ul
 * `onPress` fire-uiește. Prezentarea unui `<Modal>` în acel moment eșuează
 * silent (UIKit refuză present-on-presenting). Userul vede alertul dispărând
 * dar nu apare nimic.
 *
 * Fix: wrap setVisible în `setTimeout(..., 350)` ca să lași alertul să se închidă
 * complet. Sau folosește `InteractionManager.runAfterInteractions`.
 *
 * Origine regresie (2026-05-25): „Vezi detalii" în Documente Tab (extracție AI)
 * nu deschidea modalul de diagnostic; același pattern în MessageBubble.tsx
 * (chat: „Copiază tot").
 *
 * Rulare:
 *   node scripts/alert-modal-race-audit.js
 *   node scripts/alert-modal-race-audit.js --strict
 *   node scripts/alert-modal-race-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

const ALLOWED = new Set([
  // exempții explicite (cu motiv inline în fișier)
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
    else if (
      (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts')) &&
      !/\.test\./.test(ent.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Caută `onPress: () => set<Name>(true)` unde Name sugerează un Modal/popup
 * (Visible / Modal / Open / Show / Sheet). Ignoră dacă RHS-ul e wrap-uit în
 * setTimeout / requestAnimationFrame / InteractionManager.
 */
const OPEN_MODAL_RE = /onPress\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*(set\w*(?:Visible|Modal|Open|Show|Sheet|Dialog|Picker)\s*\(\s*true\s*\))/;

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  const lines = source.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(OPEN_MODAL_RE);
    if (!m) continue;
    // Verifică contextul anterior: e oare în interiorul unui `Alert.alert(`?
    // Heuristic: caută înapoi maxim 40 linii, până la prima `Alert.alert(`
    // sau până la o linie care „închide" contextul (ex. `function ` declaration
    // anterioară, sau o expresie care nu e parte din arrayul de butoane).
    const lookback = Math.max(0, i - 40);
    const ctx = lines.slice(lookback, i + 1).join('\n');
    // Trebuie să existe un `Alert.alert(` deschis înainte. Și nu trebuie
    // să fie deja închis cu `)` corespunzător înainte de linia curentă —
    // verificare simplă: dacă în ctx există `Alert.alert(`, presupunem că
    // suntem în interiorul ei (regex-ul nostru e per-linie).
    if (!/Alert\.alert\s*\(/.test(ctx)) continue;
    violations.push({
      file: relPath,
      line: i + 1,
      pattern: m[1].trim(),
    });
  }
  return violations;
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
    return '✓ Niciun Alert.alert → openModal direct (race iOS).';
  }
  const lines = [
    `✗ ${violations.length} Alert.alert(...) cu onPress care deschide direct un Modal:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} — ${v.pattern}`);
  }
  lines.push('');
  lines.push('Risc: pe iOS, UIAlertController e încă în dismiss-animation când');
  lines.push('onPress fire-uiește. Modal-ul prezentat în acel moment nu apare');
  lines.push('(UIKit refuză present-on-presenting). Userul vede alertul dispărând');
  lines.push('și nimic altceva.');
  lines.push('');
  lines.push('Fix: wrap-uiește în setTimeout cu ≥300ms:');
  lines.push('  onPress: () => {');
  lines.push('    setTimeout(() => setXxxVisible(true), 350);');
  lines.push('  }');
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
