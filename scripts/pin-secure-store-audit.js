#!/usr/bin/env node
/**
 * pin-secure-store-audit.js
 *
 * Flag `AsyncStorage.{set,get,remove}Item` cu chei care conțin `pin`,
 * `biometric`, `password`, `secret`, `lock`. Aceste chei trebuie să folosească
 * `expo-secure-store` (criptat în keychain/keystore), NU `AsyncStorage`
 * (plain text pe disk, citibil cu file picker pe device rootat).
 *
 * Vezi CLAUDE.md §"Securitate → PIN / biometric: doar expo-secure-store".
 *
 * Rulare:
 *   node scripts/pin-secure-store-audit.js
 *   node scripts/pin-secure-store-audit.js --strict
 *   node scripts/pin-secure-store-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['services', 'hooks', 'components', 'app'];
const SECRET_KEYS = [
  'pin',
  'biometric',
  'password',
  'secret',
  'applock',
  'app_lock',
  'lockpin',
];

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
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(full);
  }
  return out;
}

function auditSource(relPath, source) {
  const violations = [];
  const re =
    /AsyncStorage\.(setItem|getItem|removeItem|multiGet|multiSet)\s*\(\s*([`'"][^`'"]+[`'"])/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const method = m[1];
    const keyLit = m[2].slice(1, -1).toLowerCase();
    if (!SECRET_KEYS.some(k => keyLit.includes(k))) continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ file: relPath, line, method, key: keyLit });
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

function format(v) {
  if (v.length === 0) return '✓ Niciun secret în AsyncStorage.';
  const lines = [`✗ ${v.length} chei sensibile în AsyncStorage:`, ''];
  for (const x of v) lines.push(`  ${x.file}:${x.line} — AsyncStorage.${x.method}('${x.key}')`);
  lines.push('');
  lines.push("Fix: import * as SecureStore from 'expo-secure-store';");
  lines.push('     await SecureStore.setItemAsync(key, value);  // criptat keychain/keystore');
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
