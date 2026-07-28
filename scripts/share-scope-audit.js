#!/usr/bin/env node
/**
 * share-scope-audit.js
 *
 * Păzește gate-ul de permisiune la push-back-ul participantului (CloudKit
 * sharing, Faza 2). Un push cu `scope:'shared'` NEGARDAT de o verificare
 * `permission === 'readwrite'` ar lăsa un participant read-only să scrie în
 * zona owner-ului. Vezi `services/cloudShare.ts` (`pushLocalChange`) și
 * `docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md`.
 *
 * Heuristică (nu AST precis — provenance generală, stil identic cu
 * `share-privacy-audit.js`): pentru fiecare funcție top-level din
 * `services/cloudShare.ts` care apelează `enqueueSharePush(` și construiește
 * un `scope: 'shared'` (literal sau ternar), funcția trebuie să conțină și un
 * gard `permission === 'readwrite'` / `permission !== 'readwrite'`.
 *
 * Rulare:
 *   node scripts/share-scope-audit.js
 *   node scripts/share-scope-audit.js --strict
 *   node scripts/share-scope-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const CLOUD_SHARE_SERVICE = 'services/cloudShare.ts';

const FUNCTION_START_RE =
  /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(/;

const READWRITE_GUARD_RE = /permission\s*(===|!==)\s*['"]readwrite['"]/;
const SHARED_SCOPE_RE = /scope:\s*(['"]shared['"]|[a-zA-Z.]+\s*\?\s*['"]\w*['"]\s*:\s*['"]shared['"])/;

/** Extrage corpurile funcțiilor top-level (delimitare prin numărare de acolade). */
function extractFunctions(source) {
  const lines = source.split('\n');
  const functions = [];
  let i = 0;
  while (i < lines.length) {
    const m = FUNCTION_START_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const name = m[3];
    const startLine = i + 1;
    let depth = 0;
    let started = false;
    const bodyLines = [];
    let j = i;
    for (; j < lines.length; j++) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') {
          depth--;
        }
      }
      bodyLines.push(line);
      if (started && depth === 0) break;
    }
    functions.push({ name, startLine, body: bodyLines.join('\n') });
    i = j + 1;
  }
  return functions;
}

function auditFile(rel, source) {
  const violations = [];
  for (const fn of extractFunctions(source)) {
    if (!fn.body.includes('enqueueSharePush(')) continue;
    if (!SHARED_SCOPE_RE.test(fn.body)) continue;
    if (!READWRITE_GUARD_RE.test(fn.body)) {
      violations.push({
        file: rel,
        line: fn.startLine,
        rule: 'SCOPE',
        msg: `funcția "${fn.name}" pushuiește pe scope='shared' fără gard permission==='readwrite'`,
      });
    }
  }
  return violations;
}

function audit() {
  const abs = path.join(APP_DIR, CLOUD_SHARE_SERVICE);
  if (!fs.existsSync(abs)) return [];
  const source = fs.readFileSync(abs, 'utf8');
  return auditFile(CLOUD_SHARE_SERVICE, source);
}

function format(violations) {
  if (violations.length === 0) {
    return "✓ Share scope: orice push scope='shared' e gardat de permission==='readwrite'.";
  }
  const lines = [`✗ ${violations.length} problemă/e de scope la push-back:`, ''];
  for (const v of violations) {
    lines.push(`  [${v.rule}] ${v.file}:${v.line} — ${v.msg}`);
  }
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

module.exports = { audit, auditFile, format };
