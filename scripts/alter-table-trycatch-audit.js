#!/usr/bin/env node
/**
 * alter-table-trycatch-audit.js
 *
 * Verifică că fiecare `ALTER TABLE` din `services/db.ts` e într-un bloc `try`.
 * Fără try, un app upgrade poate crăpa la start când SQLite raportează
 * „duplicate column" sau alte erori non-fatale.
 *
 * Vezi CLAUDE.md §"SQLite rules → ALTER TABLE mereu în try-catch".
 *
 * Rulare:
 *   node scripts/alter-table-trycatch-audit.js
 *   node scripts/alter-table-trycatch-audit.js --strict
 *   node scripts/alter-table-trycatch-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(APP_DIR, 'services/db.ts');

/**
 * Returnează true dacă poziția `pos` din `source` se află într-un bloc `try`
 * deschis (după `try {` și înainte de `}` care îl închide).
 */
function isInsideTry(source, pos) {
  // Scanează liniar până la `pos` ținând un stack al construcțiilor try active.
  // Folosim o euristică simplă: număr `try {` și ies din stack la `}` la depth-ul corespunzător.
  let i = 0;
  const tryStack = []; // depth-ul `{` la momentul când try-ul a fost deschis
  let depth = 0;
  while (i < pos) {
    // Skip strings și template literals și comentarii ca să nu numărăm `{` false.
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', i);
      i = eol === -1 ? source.length : eol + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          // template expression — sari peste până la `}` la depth 1
          i += 2;
          let td = 1;
          while (i < source.length && td > 0) {
            if (source[i] === '{') td++;
            else if (source[i] === '}') td--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      // Dacă închidem un { care a deschis un try, popp din stack
      while (tryStack.length > 0 && tryStack[tryStack.length - 1] > depth) {
        tryStack.pop();
      }
    } else if (
      ch === 't' &&
      source.slice(i, i + 3) === 'try' &&
      /\W/.test(source[i - 1] ?? ' ') &&
      /[\s{]/.test(source[i + 3] ?? '')
    ) {
      // găsește următorul `{`
      const open = source.indexOf('{', i + 3);
      if (open !== -1 && open < pos) {
        tryStack.push(depth + 1); // după `{`, depth va crește cu 1
      }
    }
    i++;
  }
  return tryStack.length > 0;
}

function auditSource(source) {
  const violations = [];
  const re = /ALTER\s+TABLE\s+([a-z_][a-z_0-9]*)[^`;]*/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const stmt = m[0].slice(0, 80).replace(/\s+/g, ' ').trim();
    if (!isInsideTry(source, m.index)) {
      const line = source.slice(0, m.index).split('\n').length;
      violations.push({ statement: stmt, line });
    }
  }
  return violations;
}

function audit() {
  if (!fs.existsSync(DB_FILE)) return [];
  return auditSource(fs.readFileSync(DB_FILE, 'utf8'));
}

function format(v) {
  if (v.length === 0) return '✓ Toate ALTER TABLE sunt în try/catch.';
  const lines = [`✗ ${v.length} ALTER TABLE fără try wrap:`, ''];
  for (const x of v) lines.push(`  services/db.ts:${x.line} — ${x.statement}`);
  lines.push('');
  lines.push(
    'Fix: try { await db.execAsync(`ALTER TABLE ...`); } catch (e) { /* coloana există */ }'
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

module.exports = { audit, auditSource, format };
