#!/usr/bin/env node
/**
 * medical-ai-guard-audit.js
 *
 * Plasă de siguranță pentru privacy AI (Faza 3, 2026-07-04).
 *
 * Flag: orice fișier din `app/` sau `components/` care apelează una dintre
 * funcțiile care trimit conținut de document la AI —
 *   • extractFieldsWithLlm   (extracție câmpuri / vision)
 *   • classifyDocument       (clasificare tip, poate folosi vision)
 *   • sendAiRequestWithImage  (trimitere directă imagine la AI)
 * — DAR nu apelează guard-ul central `ensureAiAnalysisAllowed` în același fișier.
 *
 * Guard-ul (services/aiGuard.ts) blochează trimiterea documentelor medicale la
 * un provider remote fără consimțământ (medical_record.ai_consent_at) și cere
 * consimțământ per-tip pentru tipurile personale sensibile. Un ecran nou care
 * apelează AI-ul de extracție fără guard = regresia „flux AI generic trimite
 * documente medicale fără consimțământ" (review 2026-07).
 *
 * Verificarea e la nivel de FIȘIER (prezența guard-ului), nu strict pe ordinea
 * liniilor: `classifyDocument` rulează intenționat ÎNAINTE ca tipul să fie
 * cunoscut (protejat prin `filterMedicalCandidatesForAi`), iar guard-ul propriu-zis
 * rulează înainte de extracție. Ce contează pentru plasa de siguranță e că
 * fișierul consideră explicit guard-ul.
 *
 * Whitelist (exempții documentate):
 *   - Fișierele din `services/` NU sunt scanate: `medicalExtractor.ts` are
 *     propriul gate `ai_consent_at` (:398), iar `aiOcrMapper.ts` /
 *     `ocrLlmExtractor.ts` / `aiClassifier.ts` sunt implementarea internă care
 *     primește date deja verificate de apelanții din `app/`.
 *
 * Rulare:
 *   node scripts/medical-ai-guard-audit.js
 *   node scripts/medical-ai-guard-audit.js --strict
 *   node scripts/medical-ai-guard-audit.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

// Funcțiile care trimit conținut de document la AI (call site, nu import).
const AI_SEND_FNS = ['extractFieldsWithLlm', 'classifyDocument', 'sendAiRequestWithImage'];

// Guard-ul central care trebuie să existe în fișier.
const GUARD_FN = 'ensureAiAnalysisAllowed';

// Exempții explicite (relative la APP_DIR). Gol deocamdată — fișierele services/
// nu sunt scanate (vezi header). Adaugă aici doar cu motiv inline documentat.
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

/** Match `fnName(` ca APEL (exclude importuri `import { fnName }`). */
function callRegex(fnName) {
  return new RegExp(`\\b${fnName}\\s*\\(`);
}

function auditSource(relPath, source) {
  if (ALLOWED.has(relPath)) return [];
  const lines = source.split('\n');

  const hasGuard = lines.some(l => callRegex(GUARD_FN).test(l));

  const violations = [];
  for (const fn of AI_SEND_FNS) {
    const re = callRegex(fn);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Sări liniile de import — nu sunt call site-uri.
      if (/^\s*import\b/.test(line)) continue;
      if (!re.test(line)) continue;
      if (hasGuard) continue; // fișierul consideră guard-ul → ok
      violations.push({ file: relPath, line: i + 1, fn });
    }
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
    return `✓ Toate call site-urile AI (${AI_SEND_FNS.join(', ')}) din app/ + components/ trec prin ${GUARD_FN}.`;
  }
  const lines = [
    `✗ ${violations.length} call site AI fără guard-ul central „${GUARD_FN}" în fișier:`,
    '',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} — ${v.fn}(...)`);
  }
  lines.push('');
  lines.push('Risc: documentele medicale pot ajunge la un provider AI remote fără');
  lines.push('consimțământ (medical_record.ai_consent_at). Vezi services/aiGuard.ts.');
  lines.push('');
  lines.push('Fix: apelează ensureAiAnalysisAllowed({ docType, entityLinks }) înainte de');
  lines.push('extracție și tratează rezultatul {allowed, reason}. Vezi add.tsx/edit.tsx.');
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
