#!/usr/bin/env node
/**
 * cropper-flow-audit.js
 *
 * Invariant: orice ecran care lasă utilizatorul să aleagă o imagine din Galerie
 * sau Din Fișiere trebuie să o treacă prin ecranul /cropper (`cropImage` din
 * `services/cropperBridge.ts`) înainte de a o salva ca pagină de document.
 *
 * Origine regresie (2026-07-29, raportată de user): „la un document curent când
 * adaug poză nouă din galerie, nu apare să dau crop la margini; când fac
 * document nou și adaug pagini, apare". Pasul de ajustare a marginilor exista
 * doar în `app/(tabs)/documente/add.tsx`; `edit.tsx` și `[id].tsx` chemau direct
 * salvarea. Trei copii ale aceluiași flux, două rămase în urmă.
 *
 * Ce NU e flag-at: scanner-ul nativ (`scanDocumentPages`) — VisionKit face deja
 * detecția marginilor și permite ajustarea lor în UI-ul propriu, deci a doua
 * trecere prin cropper ar fi redundantă.
 *
 * Rulare:
 *   node scripts/cropper-flow-audit.js
 *   node scripts/cropper-flow-audit.js --strict
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

/** Fișiere care aleg imagini pentru ALT scop decât o pagină de document. */
const ALLOWED = new Set([
  // Bon de carburant: poza e trimisă direct la OCR/AI pentru cifre, nu devine
  // pagină de document scanat — decuparea marginilor n-are ce ajusta.
  'app/(tabs)/entitati/fuel.tsx',
  // Poza de profil a vehiculului — nu e document, se afișează ca hero image.
  'app/(tabs)/entitati/[id].tsx',
  // Scanare factură utilități: poza e citită de OCR/AI ca să completeze câmpurile
  // furnizorului (cod client, POD) și e aruncată — nu se salvează ca pagină.
  'components/PropertyProvidersSection.tsx',
]);

/** Surse de imagine care TREBUIE să treacă prin cropper. */
const IMAGE_PICKERS = [
  { re: /launchImageLibraryAsync\s*\(/g, label: 'ImagePicker.launchImageLibraryAsync' },
  {
    re: /getDocumentAsync\s*\(\s*\{[^}]*type:\s*['"]image\/\*['"]/gs,
    label: "DocumentPicker type:'image/*'",
  },
];

/**
 * Fereastra (în caractere) după apelul picker-ului în care trebuie să apară
 * predarea către cropper. Ține-o strânsă: dacă e prea largă, un al doilea
 * handler corect din același `Alert.alert` ar masca unul rupt.
 */
const HANDOFF_WINDOW = 350;

/**
 * Predarea către cropper — fie direct `cropImage(...)`, fie un wrapper local
 * (`cropAndAddPage`, `cropAndProcessImage`). Verificarea e pe VECINĂTATEA
 * apelului, nu pe tot fișierul: altfel un fișier cu o cale corectă și una ruptă
 * ar trece, ceea ce e exact regresia din 2026-07-29.
 */
const CROPPER_HANDOFF = /\bcrop[A-Za-z]*\s*\(/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const strict = process.argv.includes('--strict');
  const violations = [];

  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(APP_DIR, dir))) {
      const rel = path.relative(APP_DIR, file);
      if (ALLOWED.has(rel)) continue;

      const src = fs.readFileSync(file, 'utf8');
      const sources = [];

      for (const picker of IMAGE_PICKERS) {
        picker.re.lastIndex = 0;
        let m;
        while ((m = picker.re.exec(src)) !== null) {
          const window = src.slice(m.index, m.index + HANDOFF_WINDOW);
          if (CROPPER_HANDOFF.test(window)) continue;
          const line = src.slice(0, m.index).split('\n').length;
          sources.push(`${picker.label} (linia ${line})`);
        }
      }

      if (sources.length === 0) continue;
      violations.push({ file: rel, sources });
    }
  }

  if (violations.length === 0) {
    console.log('✓ Toate sursele de imagine trec prin cropper.');
    process.exit(0);
  }

  console.log(`✗ ${violations.length} fișier(e) aleg imagini fără a trece prin /cropper:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}`);
    for (const s of v.sources) console.log(`    ${s}`);
  }
  console.log(
    '\nFix: trece URI-ul prin `cropImage(uri)` din services/cropperBridge.ts\n' +
      'înainte de salvare. Dacă imaginea NU devine pagină de document\n' +
      '(ex. poză de profil, bon trimis direct la OCR), adaugă fișierul în ALLOWED\n' +
      'din scripts/cropper-flow-audit.js, cu motivul.'
  );
  process.exit(strict ? 1 : 0);
}

main();
