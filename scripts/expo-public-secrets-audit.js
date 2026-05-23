#!/usr/bin/env node
/**
 * expo-public-secrets-audit.js
 *
 * Flag variabile `EXPO_PUBLIC_*` cu nume care sugerează secret (KEY, TOKEN,
 * SECRET, PASSWORD, APIKEY, PRIVKEY). Prefixul `EXPO_PUBLIC_` injectează
 * variabila în bundle-ul JS compilat → vizibil oricui dezarhivează .ipa/.apk.
 *
 * Vezi CLAUDE.md §"Securitate".
 *
 * Rulare:
 *   node scripts/expo-public-secrets-audit.js
 *   node scripts/expo-public-secrets-audit.js --strict
 *   node scripts/expo-public-secrets-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const TRIGGERS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'APIKEY', 'PRIVKEY', 'PRIVATE'];
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];
const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.json'];

function detectTrigger(name) {
  const upper = name.toUpperCase();
  return TRIGGERS.find(t => upper.includes(t)) ?? null;
}

function auditEnvLine(line, lineNumber, file) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed === '') return null;
  if (!trimmed.startsWith('EXPO_PUBLIC_')) return null;
  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;
  const name = trimmed.slice(0, eq).trim();
  const trigger = detectTrigger(name);
  if (!trigger) return null;
  return { file, line: lineNumber, name, trigger };
}

function auditConfigSource(source, file) {
  const violations = [];
  const re = /EXPO_PUBLIC_[A-Z0-9_]+/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(source)) !== null) {
    const name = m[0];
    if (seen.has(name)) continue;
    seen.add(name);
    const trigger = detectTrigger(name);
    if (!trigger) continue;
    const line = source.slice(0, m.index).split('\n').length;
    violations.push({ file, line, name, trigger });
  }
  return violations;
}

function audit() {
  const all = [];
  for (const f of ENV_FILES) {
    const abs = path.join(APP_DIR, f);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const v = auditEnvLine(ln, i + 1, f);
      if (v) all.push(v);
    });
  }
  for (const f of CONFIG_FILES) {
    const abs = path.join(APP_DIR, f);
    if (!fs.existsSync(abs)) continue;
    all.push(...auditConfigSource(fs.readFileSync(abs, 'utf8'), f));
  }
  return all;
}

function format(v) {
  if (v.length === 0) return '✓ Niciun EXPO_PUBLIC_* cu nume de secret.';
  const lines = [
    `✗ ${v.length} EXPO_PUBLIC_* cu pattern de secret (vor ajunge în bundle public!):`,
    '',
  ];
  for (const x of v) lines.push(`  ${x.file}:${x.line} — ${x.name} (trigger: ${x.trigger})`);
  lines.push('');
  lines.push(
    'Fix: redenumește fără EXPO_PUBLIC_ prefix și citește server-side, SAU fă proxy printr-un endpoint.'
  );
  lines.push(
    'EXPO_PUBLIC_* e injectat în bundle-ul JS compilat → vizibil oricui dezarhivează .ipa/.apk.'
  );
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

module.exports = { audit, auditEnvLine, auditConfigSource, format };
