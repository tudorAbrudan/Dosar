#!/usr/bin/env node
/**
 * audit-index.js
 *
 * Generează `scripts/AUDITS.md` — catalogul audit scripts-urilor, din două surse unice:
 *   - lista + ordinea: `npm run audit` (package.json) și `scripts/hooks/pre-commit`
 *   - descrierea: primul paragraf din header-ul JSDoc al fiecărui script
 *
 * De ce: catalogul scris de mână în CLAUDE.md rămăsese cu 14 scripturi lipsă și statusuri
 * strict/warn învechite (2026-10-13). Generat, nu mai poate deriva.
 *
 * Rulare:
 *   node scripts/audit-index.js           # rescrie scripts/AUDITS.md
 *   node scripts/audit-index.js --check   # exit 1 dacă AUDITS.md nu e la zi (folosit de claude-config-audit)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'scripts/AUDITS.md');

function invocations(text) {
  const re = /node scripts\/([a-z0-9-]+\.js)([^&|\n]*)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const args = m[2];
    const warnOnly = /\|\|\s*true/.test(text.slice(m.index, text.indexOf('\n', m.index)));
    if (!out.has(name))
      out.set(name, /--strict|--check/.test(args) && !warnOnly ? 'strict' : 'warn');
  }
  return out;
}

function describe(file) {
  const src = fs.readFileSync(path.join(APP, 'scripts', file), 'utf8');
  const block = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!block) return '_(fără header — adaugă un bloc /** … */ cu descrierea)_';
  const lines = block[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '').trimEnd());
  const para = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (para.length) break;
      continue;
    }
    if (/^[a-z0-9-]+\.js\b/.test(l.trim()) && !para.length) continue; // linia cu numele fișierului
    para.push(l.trim());
  }
  let text = para.join(' ');
  const sentence = text.search(/[.:]\s/);
  if (sentence > 40 && sentence < 220) text = text.slice(0, sentence + 1);
  else if (text.length > 220) text = text.slice(0, 217).trimEnd() + '…';
  return text.replace(/\|/g, '\\|');
}

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const inAudit = invocations(pkg.scripts.audit || '');
  const inPreCommit = invocations(
    fs.readFileSync(path.join(APP, 'scripts/hooks/pre-commit'), 'utf8')
  );
  const names = [...new Set([...inAudit.keys(), ...inPreCommit.keys()])].filter(
    n => n !== 'update-site.js'
  );

  const rows = names.map(n => {
    const a = inAudit.get(n) || '—';
    const p = inPreCommit.get(n) || '—';
    return `| \`${n}\` | ${a} | ${p} | ${describe(n)} |`;
  });

  return [
    '# Audit scripts',
    '',
    '<!-- GENERAT de `node scripts/audit-index.js` — nu edita manual. -->',
    '',
    'Rulează toate: `npm run audit` (plus type-check, characterization tests, ast-grep).',
    'Coloane: `strict` = exit 1 la violare; `warn` = doar raportează; `—` = nu rulează acolo.',
    'Origini și detalii: header-ul fiecărui script. Regresie nouă → audit nou (vezi CLAUDE.md).',
    '',
    '| Script | npm run audit | pre-commit | Ce prinde |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

const content = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('scripts/AUDITS.md nu e la zi — rulează: node scripts/audit-index.js');
    process.exit(1);
  }
  console.log('scripts/AUDITS.md la zi');
} else {
  fs.writeFileSync(OUT, content);
  console.log(
    `scripts/AUDITS.md scris (${content.split('\n').filter(l => l.startsWith('| `')).length} scripturi)`
  );
}
