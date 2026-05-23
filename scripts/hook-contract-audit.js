#!/usr/bin/env node
/**
 * hook-contract-audit.js
 *
 * Verifică că hook-urile din `hooks/*.ts` cu I/O async returnează contractul
 * standard `{loading, error, refresh|refetch|reload|reset}`.
 *
 * Vezi CLAUDE.md §"Standarde de calitate cod → Hook pattern obligatoriu".
 *
 * Rulare:
 *   node scripts/hook-contract-audit.js
 *   node scripts/hook-contract-audit.js --strict
 *   node scripts/hook-contract-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(APP_DIR, 'hooks');

// Hook-uri pure (fără I/O) care nu au nevoie de contract.
// Modifică aici DOAR cu motiv documentat.
const ALLOWED_HOOKS = new Set([
  'useThemeScheme', // citește doar context, sincron
  'useFilteredDocTypes', // pure-computed peste props/settings
  'useColorScheme', // wrapper peste theme context
  'useAutoActivateDocType', // pure-computed peste props
]);

const REFRESH_NAMES = ['refresh', 'reload', 'refetch', 'reset'];

function auditSource(relPath, source) {
  const violations = [];
  const fnRe = /export\s+(?:function|const)\s+(use[A-Z]\w*)\b/g;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const hookName = m[1];
    if (ALLOWED_HOOKS.has(hookName)) continue;

    // Caută în restul fișierului primul `return { ... };` cu obiect literal.
    const after = source.slice(m.index);
    const returnMatch = after.match(/return\s*\{([\s\S]*?)\}\s*;/);
    if (!returnMatch) {
      violations.push({
        hook: hookName,
        file: relPath,
        missing: ['loading', 'error', 'refresh'],
      });
      continue;
    }
    const body = returnMatch[1];
    const hasLoading = /\bloading\b/.test(body);
    const hasError = /\berror\b/.test(body);
    const hasRefresh = REFRESH_NAMES.some(n => new RegExp(`\\b${n}\\b`).test(body));
    const missing = [];
    if (!hasLoading) missing.push('loading');
    if (!hasError) missing.push('error');
    if (!hasRefresh) missing.push('refresh');
    if (missing.length > 0) {
      violations.push({ hook: hookName, file: relPath, missing });
    }
  }
  return violations;
}

function audit() {
  const all = [];
  let entries;
  try {
    entries = fs.readdirSync(HOOKS_DIR);
  } catch {
    return all;
  }
  for (const f of entries) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
    const abs = path.join(HOOKS_DIR, f);
    const src = fs.readFileSync(abs, 'utf8');
    all.push(...auditSource(`hooks/${f}`, src));
  }
  return all;
}

function format(violations) {
  if (violations.length === 0) {
    return '✓ Toate hook-urile respectă contractul {loading, error, refresh}.';
  }
  const lines = [`✗ ${violations.length} hook(uri) fără contract complet:`, ''];
  for (const v of violations) {
    lines.push(`  ${v.file} → ${v.hook}() — lipsă: [${v.missing.join(', ')}]`);
  }
  lines.push('');
  lines.push('Fix:');
  lines.push('  Hook-urile cu I/O async TREBUIE să returneze:');
  lines.push("    { ...data, loading: boolean, error: string | null, refresh: () => Promise<void> }");
  lines.push('  Sau echivalent: refetch / reload / reset.');
  lines.push(
    '  Dacă hook-ul e pur (fără I/O), adaugă-l în ALLOWED_HOOKS din scripts/hook-contract-audit.js.'
  );
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const violations = audit();
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  } else {
    process.stdout.write(format(violations) + '\n');
  }
  if (args.has('--strict') && violations.length > 0) process.exit(1);
}

module.exports = { audit, auditSource, format, ALLOWED_HOOKS };
