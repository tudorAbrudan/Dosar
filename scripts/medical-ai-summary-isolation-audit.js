#!/usr/bin/env node
/**
 * medical-ai-summary-isolation-audit.js
 *
 * Audit script — verifică că `ai_summary` și `pending_reminders_json` NU apar
 * în fișierele care construiesc context pentru chat-ul medical sau FTS.
 *
 * Spec: docs/superpowers/specs/2026-05-24-medical-ai-summary-design.md §8.
 *
 * Rulare:
 *   node scripts/medical-ai-summary-isolation-audit.js
 *   node scripts/medical-ai-summary-isolation-audit.js --strict
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const FORBIDDEN_IN = [
  'services/medicalFts.ts',
  'services/medicalChat.ts',
  'services/medicalQueryAnalysis.ts',
];

const FORBIDDEN_FIELDS = ['ai_summary', 'pending_reminders_json'];

let violations = 0;

for (const rel of FORBIDDEN_IN) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`[isolation-audit] skip missing file: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(abs, 'utf8');
  for (const field of FORBIDDEN_FIELDS) {
    const regex = new RegExp(`\\b${field}\\b`);
    if (regex.test(content)) {
      console.error(
        `✗ ${rel} contains '${field}' — must NOT leak into chat/FTS (spec §8)`,
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} violations found.`);
  process.exit(STRICT ? 1 : 0);
}

console.log('✓ medical-ai-summary isolation audit clean.');
process.exit(0);
