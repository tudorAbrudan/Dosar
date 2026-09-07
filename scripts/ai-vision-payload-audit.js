#!/usr/bin/env node
/**
 * Audit script — flag-uiește imagini citite BRUT de pe disc și trimise la AI
 * vision, în loc să treacă prin `loadPageBase64ForAi` / `compressImageToBase64ForAi`.
 *
 * Origine: optimizarea de cost AI 2026-09-06. `app/(tabs)/documente/add.tsx` și
 * `edit.tsx` citeau fișierul salvat (2048–3072px JPEG) cu `readAsStringAsync`
 * și îl trimiteau ca atare la Pixtral — de 3–5 ori payload-ul și tokenii de
 * imagine necesari, plus secunde de upload pe fiecare pagină.
 *
 * Regula: orice base64 care ajunge într-un apel AI vision trebuie produs de
 * `services/imageProcessing.ts` (direct sau prin `loadPageBase64ForAi`).
 *
 * Euristica: într-un fișier care conține un apel AI vision, caută variabile cu
 * nume de tip `*[iI]mage*Base64` / `*b64*` asignate direct din
 * `readAsStringAsync`. Fișierele care produc ele însele base64-ul comprimat
 * (imageProcessing, pdfOcr) și cele care citesc fișiere pentru alte scopuri
 * (upload cloud, hash, export PDF) sunt în ALLOWED.
 *
 * Excepție punctuală: comentariu `// ai-vision-payload-audit-disable-next-line`.
 *
 * Utilizare:
 *   node scripts/ai-vision-payload-audit.js          # warning-only
 *   node scripts/ai-vision-payload-audit.js --strict # exit 1 la violări
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const SCAN_DIRS = ['services', 'app', 'hooks', 'components'];
const SCAN_EXT = /\.(ts|tsx)$/;

/** Apeluri care duc un base64 de imagine la un provider AI vision. */
const VISION_CALL_RE =
  /\b(sendAiRequestWithImage|extractFieldsWithLlm|classifyDocument|mapOcrWithAi|mapFuelReceiptWithAi|mapUtilityInvoiceWithAi)\s*\(/;

/** Asignare de base64 direct din citirea fișierului. */
const RAW_READ_RE =
  /\b(?:const|let|var)?\s*\w*(?:base64|b64)\w*\s*(?::[^=]+)?=\s*await\s+[\w.]*readAsStringAsync\s*\(/i;

/** `base64: true` la ImagePicker = base64-ul brut al unei poze de 12 MP. */
const PICKER_BASE64_RE = /\bbase64\s*:\s*true\b/;

const DISABLE_MARKER = 'ai-vision-payload-audit-disable-next-line';

/** Fișiere care au voie să citească brut (produc ele compresia, sau nu e AI). */
const ALLOWED = new Set([
  'services/imageProcessing.ts',
  'services/pdfOcr.ts',
  'services/fileHash.ts',
  'services/cloudSync.ts',
  'services/documentPdfExport.ts',
]);

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
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED.has(rel)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (!VISION_CALL_RE.test(content)) continue;
    scanned++;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!RAW_READ_RE.test(lines[i])) continue;
      if (i > 0 && lines[i - 1].includes(DISABLE_MARKER)) continue;
      violations++;
      console.error(
        `✗ ${rel}:${i + 1} — imagine citită brut și trimisă la AI vision:\n    ${lines[i].trim()}\n    → folosește loadPageBase64ForAi(path, docType) din services/pdfOcr.ts`
      );
    }

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (!PICKER_BASE64_RE.test(lines[i])) continue;
      if (i > 0 && lines[i - 1].includes(DISABLE_MARKER)) continue;
      violations++;
      console.error(
        `✗ ${rel}:${i + 1} — ImagePicker cu base64 brut într-un fișier care trimite la AI vision:\n    ${lines[i].trim()}\n    → scoate \`base64: true\` și comprimă din URI (compressImageToBase64ForAi)`
      );
    }
  }
}

if (violations === 0) {
  console.log(
    `[ai-vision-payload-audit] Scanned ${scanned} files with AI vision calls, found 0 violations.`
  );
  process.exit(0);
}
console.error(`\n[ai-vision-payload-audit] ${violations} violare/violări.`);
process.exit(STRICT ? 1 : 0);
