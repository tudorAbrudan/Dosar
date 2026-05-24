#!/usr/bin/env node
/**
 * Audit script — verifică că regex-ul rapid `detectDocumentType` din
 * `services/ocr.ts` și prompt-ul AI clasificator din `services/aiClassifier.ts`
 * / `services/aiTypeRegistry.ts` returnează același tip pentru fixture-urile
 * din `__tests__/fixtures/ocr/`.
 *
 * Spec: `docs/AI_FEATURE_CHECKLIST.md` §1 — heuristic + AI nu trebuie să
 * divergă. Lecție 2026-05-24: regex-ul prindea „Contract" din antet și
 * clasifica greșit ca tip contract — AI ar fi clasificat corect ca scrisoare
 * medicală, dar nu se mai apela.
 *
 * Acest audit rulează DOAR partea regex (nu cere apel AI). Pentru run-ul
 * complet cu apel AI vezi `scripts/test-ai-prompts.js`.
 *
 * Verifică:
 *   1. Pentru fiecare fixture cu `expected_type` în `_expected.json`,
 *      `detectDocumentType(text)` returnează `expected_type` sau `null`
 *      (acceptabil să nu detecteze — AI va prelua) DAR NU un tip DIFERIT.
 *
 * Utilizare:
 *   node scripts/classifier-divergence-audit.js          # warning-only
 *   node scripts/classifier-divergence-audit.js --strict # exit 1 la divergență
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const FIXTURES_DIR = path.join(ROOT, '__tests__', 'fixtures', 'ocr');
const EXPECTED_PATH = path.join(FIXTURES_DIR, '_expected.json');

// Extrage funcția detectDocumentType din services/ocr.ts.
// În loc să copiem regex-urile (sursă unică de adevăr), executăm fișierul.
// Dar serviciile importă tipuri TypeScript — folosim o copie locală sync.
//
// ALTERNATIV (TODO faza 2): parsează AST-ul services/ocr.ts și extrage
// expresia returnată din detectDocumentType, pentru a evita drift-ul.
function detectDocumentType(text) {
  const t = text.toLowerCase();
  if (/scrisoare medical[aă]/.test(t)) return 'scrisoare_medicala';
  if (/bilet de externare|bilet externare|epicriz[aă]/.test(t)) return 'bilet_externare';
  if (/bilet de trimitere|bilet trimitere/.test(t)) return 'bilet_trimitere';
  if (/fi[sș][aă] de consulta[tț]ie|fi[sș][aă] consulta[tț]ie/.test(t)) return 'fisa_consultatie';
  if (/re[tț]et[aă] medical[aă]|prescrip[tț]ie medical[aă]|rp\/?\s*medicament/.test(t))
    return 'reteta_medicala';
  if (
    /(rmn|ct|computer tomograf|tomografie|ecografie|ecografic|radiografie|mamografie|scintigrafie)/.test(
      t
    )
  ) {
    if (/concluzie|descriere|radiolog|imagistic[aă]/.test(t)) return 'imagistica';
  }
  if (
    /(hemoleucogram[aă]|biochimie|hemoglobin[aă]|glicemie|lipidogram[aă]|tsh|t3|t4|colesterol|transaminaze|ureea|creatinin[aă])/.test(
      t
    )
  ) {
    if (
      /valori? de referin[tț][aă]|interval (de )?referin[tț][aă]|limit[aă] (laboratorului|normal[aă])/.test(
        t
      )
    )
      return 'analize_medicale';
  }
  if (/asigurare.*obligatorie|r\.c\.a\.|asigurare rca|\brca\b/.test(t)) return 'rca';
  if (/\bcasco\b/.test(t)) return 'casco';
  if (
    /(^|\n)\s*contract\s+(de\s+)?(prest[aă]ri serv|[îi]nchiriere|chirie|v[âa]nzare|cump[aă]rare|servicii|munc[aă]|colaborare|comodat|mandat|consign[aă]) /.test(
      t
    )
  )
    return 'contract';
  return null;
}

// Verifică că copia locală e sincronizată cu services/ocr.ts.
// Heuristic: caută regex-urile cheie în source și raportează dacă au dispărut.
function verifySync() {
  const ocrPath = path.join(ROOT, 'services', 'ocr.ts');
  if (!fs.existsSync(ocrPath)) {
    console.warn('⚠️  services/ocr.ts not found');
    return false;
  }
  const src = fs.readFileSync(ocrPath, 'utf8');
  const keyMarkers = [
    /scrisoare medical/,
    /bilet de externare|epicriz/,
    /scrisoare_medicala/,
    /bilet_externare/,
  ];
  for (const re of keyMarkers) {
    if (!re.test(src)) {
      console.error(
        `❌ services/ocr.ts pare să fi pierdut marker-ul ${re} — copia locală din audit poate fi out-of-sync.`
      );
      return false;
    }
  }
  return true;
}

if (!verifySync()) {
  console.error(
    '\n⚠️  Audit poate da false negatives. Verifică services/ocr.ts manual și actualizează detectDocumentType de mai sus.'
  );
}

if (!fs.existsSync(EXPECTED_PATH)) {
  console.warn(`⚠️  ${EXPECTED_PATH} missing — niciun fixture de verificat.`);
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
let violations = 0;
let checked = 0;

for (const [name, spec] of Object.entries(expected)) {
  const txtPath = path.join(FIXTURES_DIR, `${name}.txt`);
  if (!fs.existsSync(txtPath)) {
    console.warn(`⚠️  Fixture file missing: ${txtPath}`);
    continue;
  }
  const ocrText = fs.readFileSync(txtPath, 'utf8');
  const detected = detectDocumentType(ocrText);
  checked++;

  if (detected === null) {
    console.log(`ℹ️  ${name}: regex nu detectează (null) — AI va prelua. OK.`);
    continue;
  }
  if (detected === spec.expected_type) {
    console.log(`✅ ${name}: regex → ${detected} (match expected)`);
    continue;
  }
  console.error(
    `❌ ${name}: DIVERGENȚĂ — regex returnează '${detected}' dar AI/expected e '${spec.expected_type}'`
  );
  console.error(
    `   Asta e exact bug-ul care a cauzat regresia 2026-05-24. Fix regex-ul sau actualizează fixture-ul.`
  );
  violations++;
}

console.log(`\n[classifier-divergence-audit] Checked ${checked} fixtures, ${violations} divergences.`);
if (violations > 0 && STRICT) {
  process.exit(1);
}
process.exit(0);
