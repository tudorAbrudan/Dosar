#!/usr/bin/env node
/**
 * Audit script — flag-uiește pattern-ul `catch (e) { console.warn(...) }` în
 * jurul apelurilor AI (sendAiRequest, sendAiRequestWithImage, callMistral
 * etc.) fără surfacing vizibil (Alert/Toast/inline UI).
 *
 * Regulă din `docs/AI_FEATURE_CHECKLIST.md` §2: niciun eșec AI nu trebuie
 * înghițit silent. Userul trebuie să vadă motivul.
 *
 * Acest audit e euristic — caută:
 *   1. Apeluri sendAiRequest / sendAiRequestWithImage într-un try
 *   2. Catch-ul corespunzător care conține DOAR console.warn / console.log /
 *      console.error fără Alert.alert, throw sau emit pe event bus
 *
 * False positives posibile: codul wrap-uie catch-ul cu logică defensivă care
 * NU folosește Alert (ex: returnează un fallback dintr-un cache). În aceste
 * cazuri adaugă comentariu `// silent-ai-catch-ok: <motiv>` lângă catch.
 *
 * Utilizare:
 *   node scripts/silent-ai-catch-audit.js          # warning-only
 *   node scripts/silent-ai-catch-audit.js --strict # exit 1 la violări
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const SCAN_DIRS = ['services', 'app', 'hooks', 'components'];
const SCAN_EXT = /\.(ts|tsx)$/;
const AI_CALL_RE = /\b(sendAiRequest|sendAiRequestWithImage|callMistral|generateAiSummary|classifyDocument|extractFromDocument|mapOcrWithAi|extractFieldsWithLlm)\s*\(/;
const SILENT_OK_MARKER = 'silent-ai-catch-ok';

function listFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      result.push(...listFiles(full));
    } else if (SCAN_EXT.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

let violations = 0;
let scanned = 0;

for (const dir of SCAN_DIRS) {
  for (const file of listFiles(path.join(ROOT, dir))) {
    scanned++;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Detectează blocuri try { ... } catch (...) { ... }. Cautare simplă:
    // pentru fiecare apariție AI_CALL, urcăm înapoi pentru `try {` și
    // coborâm pentru `} catch (...) { ... }`.
    for (let i = 0; i < lines.length; i++) {
      if (!AI_CALL_RE.test(lines[i])) continue;

      // Caut „try {" în ultimele 5 linii.
      let tryLine = -1;
      for (let j = i; j >= Math.max(0, i - 5); j--) {
        if (/\btry\s*\{/.test(lines[j])) {
          tryLine = j;
          break;
        }
      }
      if (tryLine < 0) continue;

      // Caut „catch" în următoarele 50 de linii.
      let catchLine = -1;
      let depth = 0;
      let inTry = false;
      for (let j = tryLine; j < Math.min(lines.length, tryLine + 80); j++) {
        const ln = lines[j];
        for (const ch of ln) {
          if (ch === '{') {
            depth++;
            inTry = true;
          } else if (ch === '}') {
            depth--;
            if (inTry && depth === 0) {
              // Verifică ce urmează după } — catch?
              const after = lines[j].slice(lines[j].indexOf('}')) + (lines[j + 1] ?? '');
              if (/\}\s*catch\s*\(/.test(after) || /\}\s*catch\s*\{/.test(after)) {
                catchLine = j;
              }
              break;
            }
          }
        }
        if (catchLine >= 0) break;
      }
      if (catchLine < 0) continue;

      // Extrage corpul catch.
      let catchStart = -1;
      let catchEnd = -1;
      let d = 0;
      for (let j = catchLine; j < Math.min(lines.length, catchLine + 60); j++) {
        const ln = lines[j];
        for (let k = 0; k < ln.length; k++) {
          const ch = ln[k];
          if (ch === '{') {
            if (catchStart < 0) catchStart = j;
            d++;
          } else if (ch === '}') {
            d--;
            if (catchStart >= 0 && d === 0) {
              catchEnd = j;
              break;
            }
          }
        }
        if (catchEnd >= 0) break;
      }
      if (catchStart < 0 || catchEnd < 0) continue;

      const catchBody = lines.slice(catchStart, catchEnd + 1).join('\n');

      // Skip dacă există marker explicit „silent-ai-catch-ok: <motiv>".
      if (catchBody.includes(SILENT_OK_MARKER)) continue;

      const hasConsoleOnly =
        /console\.(warn|error|log|info)/.test(catchBody) &&
        !/Alert\.alert|Toast\.show|setError|throw |emit\(/.test(catchBody);

      if (hasConsoleOnly) {
        const rel = path.relative(ROOT, file);
        console.error(
          `❌ ${rel}:${i + 1} — catch silent (console.warn/error doar) după apel AI`
        );
        console.error(
          `   Context: ${lines[i].trim().slice(0, 100)}`
        );
        console.error(
          `   Fix: surfacing vizibil (Alert.alert / setState pentru UI / throw) SAU adaugă // ${SILENT_OK_MARKER}: <motiv> dacă e intenționat.`
        );
        violations++;
      }
    }
  }
}

console.log(`\n[silent-ai-catch-audit] Scanned ${scanned} files, found ${violations} violations.`);
if (violations > 0) {
  process.exit(STRICT ? 1 : 0);
}
process.exit(0);
