#!/usr/bin/env node
/**
 * Knowledge audit — verifică sincronizarea între cod și `services/appKnowledge.ts`
 * (sursa de adevăr pentru chatbot-ul global).
 *
 * Manifestul ENTRIES enumeră services/ și ecranele cunoscute, cu keywords
 * care trebuie să apară în appKnowledge.ts. Eșuează în 2 cazuri:
 *
 *   1. Există un service/ecran nou care nu e în manifest. Decide:
 *      - feature user-visible → adaugă cu `required: true` + keywords (apoi
 *        update-ează appKnowledge.ts să descrie feature-ul).
 *      - helper intern → adaugă cu `required: false`.
 *
 *   2. Există un entry `required: true` ale cărui keywords nu apar în
 *      appKnowledge.ts. Înseamnă că feature-ul a fost adăugat/renumit fără
 *      să update-ezi descrierea pentru chatbot.
 *
 * Usage:
 *   node scripts/knowledge-audit.js           # report only, exit 0
 *   node scripts/knowledge-audit.js --strict  # exit 1 dacă există issue-uri
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_KNOWLEDGE = path.join(ROOT, 'services/appKnowledge.ts');
const SERVICES_DIR = path.join(ROOT, 'services');
const TABS_DIR = path.join(ROOT, 'app/(tabs)');

const ENTRIES = {
  services: {
    aiClassifier: { required: true, keywords: ['clasificare', 'tip document'] },
    aiOcrMapper: { required: true, keywords: ['OCR', 'AI'] },
    aiProvider: { required: true, keywords: ['Asistent AI', 'provider'] },
    appKnowledge: { required: false },
    backup: { required: true, keywords: ['backup', 'export'] },
    calendar: { required: true, keywords: ['calendar', 'expirare'] },
    chatbot: { required: true, keywords: ['chatbot', 'Întreabă'] },
    cloudSync: { required: true, keywords: ['iCloud', 'cloud'] },
    customTypes: { required: true, keywords: ['tip personalizat', 'custom'] },
    documentScanner: { required: true, keywords: ['scanare', 'cameră'] },
    documents: { required: true, keywords: ['document', 'adaugă'] },
    entities: { required: true, keywords: ['entități', 'entitate'] },
    expiry: { required: true, keywords: ['expir'] },
    fuel: { required: true, keywords: ['carburant', 'consum'] },
    localModel: { required: true, keywords: ['model local', 'on-device'] },
    maintenance: { required: true, keywords: ['mentenanță', 'revizie'] },
    notifications: { required: true, keywords: ['notificări'] },
    ocr: { required: true, keywords: ['OCR'] },
    ocrConsent: { required: true, keywords: ['OCR'] },
    ocrLlmExtractor: { required: true, keywords: ['OCR', 'AI'] },
    orphans: { required: true, keywords: ['sugestii', 'completare'] },
    pdfOcr: { required: true, keywords: ['PDF', 'OCR'] },
    settings: { required: true, keywords: ['setări'] },
    updateCheck: { required: true, keywords: ['update', 'actualizare'] },
    vehicleStatus: { required: true, keywords: ['vehicul'] },

    aiTypeRegistry: { required: false },
    chatThreads: { required: false },
    cloudCrypto: { required: false },
    cloudStorage: { required: false },
    crashReporter: { required: false },
    db: { required: false },
    entityOrder: { required: false },
    events: { required: false },
    fileHash: { required: false },
    fileUtils: { required: false },
    imageProcessing: { required: false },
    maintenancePresets: { required: false },
    manifestHash: { required: false },
    ocrExtractors: { required: false },
    ocrLayout: { required: false },
    pdfExtractor: { required: false },
    reviewPrompt: { required: false },
  },
  screens: {
    index: { required: true, keywords: ['Acasă', 'Home'] },
    chat: { required: true, keywords: ['chatbot'] },
    expirari: { required: true, keywords: ['expir'] },
    setari: { required: true, keywords: ['setări'] },
    'documente/index': { required: true, keywords: ['documente'] },
    'documente/add': { required: true, keywords: ['adaugă', 'document'] },
    'documente/edit': { required: true, keywords: ['editare', 'document'] },
    'documente/[id]': { required: true, keywords: ['detaliu', 'detalii'] },
    'entitati/index': { required: true, keywords: ['entități'] },
    'entitati/add': { required: true, keywords: ['adaugă', 'entitate'] },
    'entitati/[id]': { required: true, keywords: ['detaliul entit', 'detalii entit'] },
    'entitati/fuel': { required: true, keywords: ['carburant'] },
    'entitati/fuel-stats': { required: true, keywords: ['statistici', 'carburant'] },
    'entitati/wizard-masina': { required: true, keywords: ['mașină', 'wizard'] },
    'entitati/wizard-proprietate': { required: true, keywords: ['proprietate'] },

    _layout: { required: false },
    'documente/_layout': { required: false },
    'entitati/_layout': { required: false },
    shared: { required: false },
  },
};

function listServiceModules() {
  const out = [];
  for (const f of fs.readdirSync(SERVICES_DIR)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
    out.push(f.replace(/\.ts$/, ''));
  }
  return out.sort();
}

function listScreenIds() {
  const ids = [];
  function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith('_')) continue;
        const newPrefix = prefix ? `${prefix}/${ent.name}` : ent.name;
        walk(full, newPrefix);
      } else if (ent.isFile() && ent.name.endsWith('.tsx')) {
        const base = ent.name.replace(/\.tsx$/, '');
        ids.push(prefix ? `${prefix}/${base}` : base);
      }
    }
  }
  walk(TABS_DIR, '');
  return ids.sort();
}

function loadKnowledge() {
  return fs.readFileSync(APP_KNOWLEDGE, 'utf8').toLowerCase();
}

function checkEntry(text, entry) {
  if (!entry.required) return { ok: true };
  const kws = entry.keywords ?? [];
  if (kws.length === 0) return { ok: false, reason: 'lipsesc keywords în manifest' };
  const present = kws.filter(k => text.includes(k.toLowerCase()));
  if (present.length === 0) {
    return {
      ok: false,
      reason: `niciun keyword găsit în appKnowledge.ts: [${kws.join(', ')}]`,
    };
  }
  return { ok: true };
}

function audit() {
  const text = loadKnowledge();
  const issues = { unknownServices: [], unknownScreens: [], missingDocs: [] };

  const actualServices = listServiceModules();
  const manifestServices = new Set(Object.keys(ENTRIES.services));
  for (const s of actualServices) {
    if (!manifestServices.has(s)) issues.unknownServices.push(s);
  }
  for (const [name, entry] of Object.entries(ENTRIES.services)) {
    if (!actualServices.includes(name)) continue;
    const r = checkEntry(text, entry);
    if (!r.ok) issues.missingDocs.push({ kind: 'service', name, reason: r.reason });
  }

  const actualScreens = listScreenIds();
  const manifestScreens = new Set(Object.keys(ENTRIES.screens));
  for (const s of actualScreens) {
    if (!manifestScreens.has(s)) issues.unknownScreens.push(s);
  }
  for (const [name, entry] of Object.entries(ENTRIES.screens)) {
    if (!actualScreens.includes(name)) continue;
    const r = checkEntry(text, entry);
    if (!r.ok) issues.missingDocs.push({ kind: 'screen', name, reason: r.reason });
  }

  return issues;
}

function main() {
  const strict = process.argv.slice(2).includes('--strict');
  const issues = audit();

  const total =
    issues.unknownServices.length + issues.unknownScreens.length + issues.missingDocs.length;

  if (total === 0) {
    console.log('✓ Knowledge audit OK — toate features sunt înregistrate și documentate.');
    return;
  }

  console.log('▸ Knowledge audit — discrepanțe detectate:\n');

  if (issues.unknownServices.length > 0) {
    console.log(`Services NEÎNREGISTRATE în manifest (${issues.unknownServices.length}):`);
    for (const s of issues.unknownServices) {
      console.log(`  - services/${s}.ts`);
    }
    console.log(
      '  → Adaugă fiecare în ENTRIES.services din scripts/knowledge-audit.js:'
    );
    console.log("    { required: true, keywords: ['...'] }  // dacă user-visible");
    console.log("    { required: false }                     // dacă internal");
    console.log('');
  }

  if (issues.unknownScreens.length > 0) {
    console.log(`Ecrane NEÎNREGISTRATE în manifest (${issues.unknownScreens.length}):`);
    for (const s of issues.unknownScreens) {
      console.log(`  - app/(tabs)/${s}.tsx`);
    }
    console.log('  → Adaugă fiecare în ENTRIES.screens din scripts/knowledge-audit.js.\n');
  }

  if (issues.missingDocs.length > 0) {
    console.log(`Features fără documentație în appKnowledge.ts (${issues.missingDocs.length}):`);
    for (const m of issues.missingDocs) {
      console.log(`  - [${m.kind}] ${m.name} — ${m.reason}`);
    }
    console.log(
      '  → Update-ează services/appKnowledge.ts să descrie feature-ul (chatbot trebuie să-l știe).\n'
    );
  }

  if (strict) process.exit(1);
}

main();
