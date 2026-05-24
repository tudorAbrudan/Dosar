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

// Hook-uri pure sau state-machine care nu au nevoie de contract.
// Modifică aici DOAR cu motiv documentat.
const ALLOWED_HOOKS = new Set([
  'useThemeScheme', // citește doar context, sincron
  'useFilteredDocTypes', // pure-computed peste props/settings
  'useColorScheme', // wrapper peste theme context
  'useAutoActivateDocType', // pure-computed peste props
  'useThemePreference', // wrapper useContext peste ThemePreferenceContext
  'useAppLock', // state-machine lock: unlockWith{Biometric,Pin} returnează succes/eșec direct
  'useMedicalLock', // state-machine identic cu useAppLock peste dosar medical
  'useReviewPrompt', // event listener pentru promptul de App Store; nu face data fetching
]);

const REFRESH_NAMES = ['refresh', 'reload', 'refetch', 'reset'];

/**
 * Returnează ULTIMUL `return { ... };` la nivelul top al funcției identificate
 * (sare peste return-uri din arrow functions / nested functions).
 *
 * `fnStart` e index-ul caracterului din `export function useXxx`. Scanăm de la
 * `{`-ul corpului funcției și păstrăm ultimul object-literal return găsit la
 * `depth === 1` (corpul funcției top-level).
 */
function findLastTopLevelReturn(source, fnStart) {
  const openIdx = source.indexOf('{', fnStart);
  if (openIdx === -1) return null;
  let depth = 0;
  let lastReturnBody = null;
  let i = openIdx;
  const length = source.length;
  while (i < length) {
    const ch = source[i];
    const next = source[i + 1];

    // Skip comments
    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', i);
      i = eol === -1 ? length : eol + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? length : end + 2;
      continue;
    }
    // Skip strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Am ieșit din corpul funcției top-level
        return lastReturnBody;
      }
      i++;
      continue;
    }

    // Detectează `return {` doar la depth 1 (corpul funcției top-level)
    if (
      depth === 1 &&
      ch === 'r' &&
      source.slice(i, i + 6) === 'return' &&
      /\W/.test(source[i - 1] ?? ' ') &&
      /\s/.test(source[i + 6] ?? '')
    ) {
      let j = i + 6;
      while (j < length && /\s/.test(source[j])) j++;
      if (source[j] === '{') {
        // Găsește închiderea `}` care match-uiește
        let bd = 1;
        let k = j + 1;
        while (k < length && bd > 0) {
          const c2 = source[k];
          if (c2 === '"' || c2 === "'" || c2 === '`') {
            const q = c2;
            k++;
            while (k < length && source[k] !== q) {
              if (source[k] === '\\') k++;
              k++;
            }
            k++;
            continue;
          }
          if (c2 === '/' && source[k + 1] === '/') {
            const eol = source.indexOf('\n', k);
            k = eol === -1 ? length : eol + 1;
            continue;
          }
          if (c2 === '{') bd++;
          else if (c2 === '}') bd--;
          k++;
        }
        lastReturnBody = source.slice(j + 1, k - 1);
        i = k;
        continue;
      }
    }
    i++;
  }
  return lastReturnBody;
}

function auditSource(relPath, source) {
  const violations = [];
  const fnRe = /export\s+(?:function|const)\s+(use[A-Z]\w*)\b/g;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const hookName = m[1];
    if (ALLOWED_HOOKS.has(hookName)) continue;

    const body = findLastTopLevelReturn(source, m.index);
    if (body === null) {
      violations.push({
        hook: hookName,
        file: relPath,
        missing: ['loading', 'error', 'refresh'],
      });
      continue;
    }

    // Acceptă `...state` ca proof că loading/error/refresh sunt incluse via spread
    // (verificare loose, dar pattern-ul real în Dosar e mereu să spread-uiești
    // o `State` interface care conține contractul).
    const hasSpread = /\.\.\.[a-zA-Z_$][\w$]*/.test(body);
    const hasLoading = hasSpread || /\bloading\b/.test(body);
    const hasError = hasSpread || /\berror\b/.test(body);
    const hasRefresh =
      hasSpread || REFRESH_NAMES.some(n => new RegExp(`\\b${n}\\b`).test(body));
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
