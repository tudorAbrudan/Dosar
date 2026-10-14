#!/usr/bin/env node
/**
 * medical-ai-guard-audit.js
 *
 * Plasă de siguranță pentru privacy AI (Faza 3, 2026-07-04; strâns 2026-10-13).
 *
 * Flag: orice apel din `app/` sau `components/` la o funcție care trimite
 * conținut de document la AI —
 *   • extractFieldsWithLlm      (extracție câmpuri / vision)
 *   • classifyDocument          (clasificare tip, poate folosi vision)
 *   • sendAiRequestWithImage    (trimitere directă imagine la AI)
 *   • mapOcrWithAi              (completarea automată la atașare)
 *   • mapFuelReceiptWithAi      (bon de carburant)
 *   • mapUtilityInvoiceWithAi   (factură de utilități)
 * — făcut dintr-o funcție care NU apelează ea însăși un gate din
 * `services/aiGuard.ts`:
 *   • ensureAiAnalysisAllowed   (butonul manual „Trimite documentul la AI")
 *   • ensureAutoAiAllowed       (completarea automată)
 *   • getScanAiAccess           (scanări bon / factură)
 *   • filterMedicalCandidatesForAi — acceptat DOAR pentru classifyDocument, care
 *     rulează intenționat înainte ca tipul să fie cunoscut.
 *
 * De ce la nivel de FUNCȚIE (până la 2026-10-13 era la nivel de fișier): în
 * `documente/add.tsx`, guard-ul exista pentru butonul manual, așa că fișierul
 * trecea — iar completarea automată din același fișier (`runAiOcrMapper` →
 * `mapOcrWithAi`) trimitea textul și poza documentelor medicale și a buletinelor
 * în cloud fără niciun gate. Fuel/utilități nu erau scanate deloc.
 *
 * „Funcția" = cea mai apropiată funcție care conține apelul, urcând prin
 * callback-uri anonime (`.map`, `.then`) până la prima funcție cu nume
 * (declarație, `const f = () =>`, metodă). Componenta de top a fișierului NU
 * contează ca gate — altfel orice ecran cu un guard undeva ar trece din nou.
 *
 * Whitelist: fișierele din `services/` NU sunt scanate — `medicalExtractor.ts`
 * are propriul gate (`ai_consent_at` + toggle global), iar `aiOcrMapper.ts` /
 * `ocrLlmExtractor.ts` / `aiClassifier.ts` sunt implementarea internă apelată
 * de ecranele de mai sus.
 *
 * Rulare:
 *   node scripts/medical-ai-guard-audit.js
 *   node scripts/medical-ai-guard-audit.js --strict
 *   node scripts/medical-ai-guard-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

const AI_SEND_FNS = [
  'extractFieldsWithLlm',
  'classifyDocument',
  'sendAiRequestWithImage',
  'mapOcrWithAi',
  'mapFuelReceiptWithAi',
  'mapUtilityInvoiceWithAi',
];

const GUARD_FNS = ['ensureAiAnalysisAllowed', 'ensureAutoAiAllowed', 'getScanAiAccess'];

/** Gate-uri suplimentare acceptate doar pentru anumite funcții. */
const EXTRA_GUARDS = {
  classifyDocument: ['filterMedicalCandidatesForAi'],
};

// Exempții explicite (relative la APP_DIR). Adaugă doar cu motiv inline documentat.
const ALLOWED = new Set([]);

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
    else if ((ent.name.endsWith('.tsx') || ent.name.endsWith('.ts')) && !/\.test\./.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function calleeName(call) {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Funcție cu nume: declarație, metodă, sau expresie atribuită unei variabile/proprietăți. */
function isNamedFunction(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return true;
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent))
  );
}

/** Funcția de top a fișierului (componenta ecranului) — nu contează ca gate. */
function isTopLevelFunction(node) {
  let p = node.parent;
  while (p) {
    if (isFunctionLike(p)) return false;
    p = p.parent;
  }
  return true;
}

function containsCallTo(node, names) {
  let found = false;
  const visit = n => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name && names.includes(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Cea mai apropiată funcție cu nume care conține nodul (urcă prin callback-uri anonime). */
function owningFunction(node) {
  let p = node.parent;
  while (p) {
    if (isFunctionLike(p) && isNamedFunction(p)) return p;
    p = p.parent;
  }
  return null;
}

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind);

  const violations = [];
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const fn = calleeName(node);
      if (fn && AI_SEND_FNS.includes(fn)) {
        const guards = [...GUARD_FNS, ...(EXTRA_GUARDS[fn] ?? [])];
        const owner = owningFunction(node);
        const guarded = !!owner && !isTopLevelFunction(owner) && containsCallTo(owner, guards);
        // O funcție-helper de modul (top-level) care trimite la AI trebuie să-și
        // aibă propriul gate — acolo componenta nu există, deci owner e chiar ea.
        const guardedTopLevelHelper =
          !!owner &&
          isTopLevelFunction(owner) &&
          !/^[A-Z]/.test(functionName(owner)) &&
          containsCallTo(owner, guards);
        if (!guarded && !guardedTopLevelHelper) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          violations.push({
            file: relPath,
            line: line + 1,
            fn,
            owner: owner ? functionName(owner) : '(top-level)',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (parent && parent.name && ts.isIdentifier(parent.name)) return parent.name.text;
  return '(anonim)';
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
    return `✓ Toate call site-urile AI (${AI_SEND_FNS.join(', ')}) din app/ + components/ trec printr-un gate din services/aiGuard.ts în aceeași funcție.`;
  }
  const lines = [
    `✗ ${violations.length} call site AI fără gate (${GUARD_FNS.join(' / ')}) în funcția care trimite:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} — ${v.fn}(...) în ${v.owner}`);
  }
  lines.push('');
  lines.push('Risc: documente medicale / acte de identitate ajung la un AI din cloud fără');
  lines.push('consimțământ. Vezi services/aiGuard.ts.');
  lines.push('');
  lines.push('Fix: în aceeași funcție, apelează gate-ul potrivit înainte de trimitere:');
  lines.push('  buton manual → ensureAiAnalysisAllowed; completare automată →');
  lines.push('  ensureAutoAiAllowed; bon/factură → getScanAiAccess.');
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
