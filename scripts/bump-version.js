#!/usr/bin/env node
/**
 * bump-version.js
 *
 * Bump de versiune Dosar în TOATE locurile din care Xcode / App Store citesc versiunea:
 *   1. app.json                         — expo.version + expo.ios.buildNumber (sursa committed)
 *   2. package.json                     — version
 *   3. ios/Dosar/Info.plist             — CFBundleShortVersionString + CFBundleVersion (LITERALE!)
 *   4. ios/Dosar.xcodeproj/project.pbxproj — MARKETING_VERSION + CURRENT_PROJECT_VERSION
 *      (×4: app + ShareExtension × Debug/Release; extension-ul ia versiunea de aici)
 *
 * Origine: 2026-07-27 — bump doar în app.json/pbxproj, archive-ul din Xcode arăta tot versiunea
 * veche (Info.plist ține valori literale) și app-ul + extension-ul ajungeau nesincronizate.
 * `ios/` e gitignored: dacă lipsește (CI, clone nou) se sar pașii 3–4 — `expo prebuild` îi
 * regenerează din app.json.
 *
 * Rulare:
 *   node scripts/bump-version.js patch|minor|major   # build number +1
 *   node scripts/bump-version.js 3.16.0              # versiune explicită, build +1
 *   node scripts/bump-version.js 3.16.0 --build 85   # build explicit
 *   node scripts/bump-version.js patch --dry-run     # doar afișează
 *   node scripts/bump-version.js --check             # exit 1 dacă cele 4 locuri nu coincid
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const FILES = {
  appJson: path.join(APP, 'app.json'),
  pkg: path.join(APP, 'package.json'),
  plist: path.join(APP, 'ios/Dosar/Info.plist'),
  pbxproj: path.join(APP, 'ios/Dosar.xcodeproj/project.pbxproj'),
};

const PLIST_VERSION = /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/;
const PLIST_BUILD = /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/;
const PBX_VERSION = /(MARKETING_VERSION = )([^;]+)(;)/g;
const PBX_BUILD = /(CURRENT_PROJECT_VERSION = )([^;]+)(;)/g;

function readState() {
  const app = JSON.parse(fs.readFileSync(FILES.appJson, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(FILES.pkg, 'utf8'));
  const state = {
    'app.json': { version: app.expo.version, build: String(app.expo.ios.buildNumber) },
    'package.json': { version: pkg.version, build: null },
  };
  if (fs.existsSync(FILES.plist)) {
    const s = fs.readFileSync(FILES.plist, 'utf8');
    state['ios/Dosar/Info.plist'] = {
      version: (s.match(PLIST_VERSION) || [])[2],
      build: (s.match(PLIST_BUILD) || [])[2],
    };
  }
  if (fs.existsSync(FILES.pbxproj)) {
    const s = fs.readFileSync(FILES.pbxproj, 'utf8');
    const versions = [...new Set([...s.matchAll(PBX_VERSION)].map(m => m[2].trim()))];
    const builds = [...new Set([...s.matchAll(PBX_BUILD)].map(m => m[2].trim()))];
    state['project.pbxproj'] = { version: versions.join(' | '), build: builds.join(' | ') };
  }
  return state;
}

function check() {
  const state = readState();
  const ref = state['app.json'];
  const bad = Object.entries(state).filter(
    ([, v]) => v.version !== ref.version || (v.build !== null && v.build !== ref.build)
  );
  for (const [file, v] of Object.entries(state)) {
    const mark = bad.some(([f]) => f === file) ? '✗' : '✓';
    console.log(
      `  ${mark} ${file.padEnd(22)} ${v.version}${v.build !== null ? ` (${v.build})` : ''}`
    );
  }
  if (!fs.existsSync(FILES.plist))
    console.log('  · ios/ lipsește — verific doar app.json ↔ package.json');
  if (bad.length) {
    console.error(
      `\nversiune DESINCRONIZATĂ — rulează: node scripts/bump-version.js ${ref.version} --build ${ref.build}`
    );
    return 1;
  }
  console.log('\nversiune sincronizată');
  return 0;
}

function nextVersion(current, arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [maj, min, pat] = current.split('.').map(Number);
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Argument invalid: „${arg}" (patch|minor|major|x.y.z)`);
}

function bump(arg, buildArg, dryRun) {
  const app = JSON.parse(fs.readFileSync(FILES.appJson, 'utf8'));
  const version = nextVersion(app.expo.version, arg);
  const build = buildArg
    ? String(buildArg)
    : String((parseInt(app.expo.ios.buildNumber, 10) || 0) + 1);
  console.log(
    `${app.expo.version} (${app.expo.ios.buildNumber}) → ${version} (${build})${dryRun ? '  [dry-run]' : ''}`
  );
  if (dryRun) return 0;

  app.expo.version = version;
  app.expo.ios.buildNumber = build;
  fs.writeFileSync(FILES.appJson, JSON.stringify(app, null, 2) + '\n');

  const pkgRaw = fs.readFileSync(FILES.pkg, 'utf8');
  fs.writeFileSync(FILES.pkg, pkgRaw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));

  if (fs.existsSync(FILES.plist)) {
    const s = fs.readFileSync(FILES.plist, 'utf8');
    fs.writeFileSync(
      FILES.plist,
      s.replace(PLIST_VERSION, `$1${version}$3`).replace(PLIST_BUILD, `$1${build}$3`)
    );
  }
  if (fs.existsSync(FILES.pbxproj)) {
    const s = fs.readFileSync(FILES.pbxproj, 'utf8');
    fs.writeFileSync(
      FILES.pbxproj,
      s.replace(PBX_VERSION, `$1${version}$3`).replace(PBX_BUILD, `$1${build}$3`)
    );
  }
  return check();
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) return check();
  const target = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--build');
  if (!target) {
    console.error(
      'Folosire: node scripts/bump-version.js patch|minor|major|x.y.z [--build N] [--dry-run] | --check'
    );
    return 2;
  }
  const bi = args.indexOf('--build');
  return bump(target, bi >= 0 ? args[bi + 1] : null, args.includes('--dry-run'));
}

try {
  process.exit(main());
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Eroare necunoscută');
  process.exit(2);
}
