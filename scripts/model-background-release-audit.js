#!/usr/bin/env node
/**
 * model-background-release-audit.js
 *
 * Garantează că modelul LLM local (context llama.rn, câțiva GB rezidenți în RAM)
 * este eliberat când app-ul intră în background. Fără asta, iOS omoară procesul
 * cu jetsam cât timp e în fundal → „app-ul se închide instant când îl readuc în
 * prim-plan, dar la a doua deschidere merge".
 *
 * Verifică două invariante:
 *
 *   1. `services/localModel.ts` ține un context llama rezident (`LlamaContext`)
 *      ȘI exportă `releaseModelForBackground`.
 *   2. `app/_layout.tsx` leagă `releaseModelForBackground` de o tranziție
 *      `AppState` în `'background'`.
 *
 * Dacă cineva șterge wiring-ul (sau mută contextul fără să-l elibereze pe
 * background), audit-ul pică și regresia e prinsă înainte de release.
 *
 * Origine: regresia „aplicația se închide instant la revenire din fundal"
 * (2026-06-30) — model llama rezident, niciodată eliberat pe AppState.
 *
 * Rulare:
 *   node scripts/model-background-release-audit.js
 *   node scripts/model-background-release-audit.js --strict
 *   node scripts/model-background-release-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const MODEL_FILE = 'services/localModel.ts';
const LAYOUT_FILE = 'app/_layout.tsx';

function read(rel) {
  try {
    return fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
  } catch {
    return null;
  }
}

function audit() {
  const violations = [];

  const model = read(MODEL_FILE);
  if (model === null) {
    violations.push({ file: MODEL_FILE, problem: 'fișier inexistent' });
  } else {
    const holdsResidentContext = /LlamaContext/.test(model) && /initLlama/.test(model);
    const exportsRelease = /export\s+async\s+function\s+releaseModelForBackground/.test(model);
    if (holdsResidentContext && !exportsRelease) {
      violations.push({
        file: MODEL_FILE,
        problem:
          'ține un context llama rezident dar nu exportă `releaseModelForBackground` ' +
          '(modelul nu se eliberează niciodată → jetsam pe background)',
      });
    }
  }

  const layout = read(LAYOUT_FILE);
  if (layout === null) {
    violations.push({ file: LAYOUT_FILE, problem: 'fișier inexistent' });
  } else {
    const callsRelease = /releaseModelForBackground\s*\(/.test(layout);
    const wiredToBackground = /AppState/.test(layout) && /['"]background['"]/.test(layout);
    if (!callsRelease || !wiredToBackground) {
      violations.push({
        file: LAYOUT_FILE,
        problem:
          'nu leagă `releaseModelForBackground()` de tranziția `AppState` → ' +
          "'background' (modelul AI rămâne în RAM în fundal → crash la revenire)",
      });
    }
  }

  return violations;
}

function format(v) {
  if (v.length === 0) return '✓ Model AI local eliberat pe background (wiring prezent).';
  const lines = [`✗ ${v.length} problemă(e) la eliberarea modelului pe background:`, ''];
  for (const x of v) lines.push(`  ${x.file} — ${x.problem}`);
  lines.push('');
  lines.push('Fix: services/localModel.ts → export `releaseModelForBackground()`;');
  lines.push("     app/_layout.tsx → AppState 'change' → if 'background' release.");
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

module.exports = { audit, format };
