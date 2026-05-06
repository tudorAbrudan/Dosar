#!/usr/bin/env node
/**
 * update-site.js — Sursă unică de automatizare pentru documentația Dosar.
 *
 * Rulează manual (`node scripts/update-site.js`) sau automat prin hook la
 * modificări în `types/index.ts` / `app.json` / `services/appKnowledge.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE SINCRONIZEAZĂ:
 * ─────────────────────────────────────────────────────────────────────────────
 * docs/index.html:
 *   <!-- DOSAR:DOC_COUNT_START --> / _END               → număr tipuri
 *   <!-- DOSAR:DOC_CHIPS_START --> / _END               → chips tipuri
 *   <!-- DOSAR:FEATURES_START --> / _END                → grid funcționalități
 *
 * docs/support.html:
 *   <!-- DOSAR:FAQ_DOC_TYPES_START --> / _END           → FAQ „ce tipuri suportă?"
 *   <!-- DOSAR:FAQ_EXTRAS_START --> / _END              → FAQ per feature relevantă
 *
 * README.md:
 *   <!-- DOSAR:APP_FEATURES_START --> / _END            → listă funcționalități
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CUM EXTINZI:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Adaugă feature nouă → adaugă intrare în FEATURES mai jos.
 * - Adaugă tip de document → se ia automat din `types/index.ts`.
 *   Dacă vrei emoji diferit de 📄, adaugă-l în EMOJI_MAP.
 * - Vrei un nou marker undeva (ex. în app) → adaugă în `SYNCS` la final.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ─── Constante canonice (sursa unică pentru URL-uri externe) ─────────────────

const APP_STORE_URL = 'https://apps.apple.com/ro/app/dosar-acte-documente/id6760576986';
const APP_STORE_ID = '6760576986';
const SITE_URL = 'https://tudorabrudan.github.io/Dosar';

// ─── 1. EMOJI MAP — actualizat cu TOATE tipurile din types/index.ts ──────────

const EMOJI_MAP = {
  buletin: '🪪',
  pasaport: '✈️',
  permis_auto: '🚗',
  talon: '📋',
  carte_auto: '📝',
  rca: '🛡️',
  casco: '🛡️',
  itp: '🔧',
  vigneta: '🛣️',
  act_proprietate: '🏠',
  cadastru: '📐',
  factura: '🧾',
  impozit_proprietate: '🏛️',
  contract: '📄',
  card: '💳',
  garantie: '🎟️',
  reteta_medicala: '💊',
  analize_medicale: '🩺',
  bon_cumparaturi: '🧾',
  bon_parcare: '🅿️',
  pad: '🔥',
  stingator_incendiu: '🧯',
  abonament: '🔄',
  vaccin_animal: '💉',
  deparazitare: '🐛',
  vizita_vet: '🐾',
  bilet: '🎫',
  certificat_inregistrare: '🏢',
  autorizatie_activitate: '📋',
  act_constitutiv: '📜',
  certificat_tva: '💼',
  asigurare_profesionala: '🛡️',
  diploma: '🎓',
  foaie_matricola: '📑',
  certificat_absolvire: '🏅',
  certificat_curs: '🏆',
  adeverinta_studii: '📄',
  altul: '📁',
  custom: '⭐',
};

const HIGHLIGHTED_TYPES = new Set([
  'buletin',
  'pasaport',
  'permis_auto',
  'talon',
  'rca',
  'casco',
  'itp',
  'vigneta',
]);

// ─── 2. FEATURES — sursă unică pentru site + README + chatbot knowledge ──────
//
// Fiecare feature e descrisă o singură dată; generatorii produc:
//   - card în docs/index.html (features grid)
//   - bullet în README.md
//   - frază în appKnowledge.ts (nu rescriem fișierul direct; doar verificăm
//     acoperirea)
// Câmpul `faq` (opțional) produce intrare în docs/support.html.

const FEATURES = [
  {
    id: 'app-lock',
    icon: '🔐',
    title: 'App Lock – Face ID / PIN',
    desc: 'Documentele sunt protejate cu Face ID, Touch ID sau PIN. Nimeni altcineva nu le poate accesa.',
    readmeBullet: 'Blocare Face ID / Touch ID / PIN',
    chatbot: 'blocare Face ID/PIN',
  },
  {
    id: 'expiry-notifications',
    icon: '⏰',
    title: 'Notificări de expirare',
    desc: 'Alerte locale configurabile — primești notificarea cu X zile înainte să expire orice document.',
    readmeBullet: 'Notificări locale de expirare (configurabile)',
    chatbot: 'notificări expirare',
  },
  {
    id: 'entities',
    icon: '🗂️',
    title: 'Organizat pe entități',
    desc: 'Persoane, Vehicule, Proprietăți, Carduri, Animale, Firme / PFA — fiecare cu documentele lor specifice.',
    readmeBullet: 'Organizat pe Persoane / Vehicule / Proprietăți / Carduri / Animale / Firme',
    chatbot: 'organizare pe entități',
  },
  {
    id: 'backup',
    icon: '☁️',
    title: 'Backup & transfer între dispozitive',
    desc: 'Export complet (.zip cu date + fișiere) în iCloud Drive sau prin AirDrop. Muți totul pe un device nou în câteva secunde.',
    readmeBullet: 'Backup complet în iCloud / Drive și transfer între dispozitive',
    chatbot: 'backup iCloud/Drive',
  },
  {
    id: 'calendar',
    icon: '📅',
    title: 'Remindere în Calendar',
    desc: 'Un singur tap adaugă expirarea documentului direct în calendarul iOS.',
    readmeBullet: 'Export reminder expirare în calendarul nativ',
    chatbot: 'reminder în calendar',
  },
  {
    id: 'document-scanner',
    icon: '📷',
    title: 'Scanner document multi-pagină',
    desc: 'Scanner nativ cu detecție automată a marginilor și corecție de perspectivă. Scanezi mai multe pagini într-o singură sesiune și se atașează toate la același document. Pe iOS folosește același motor ca Apple Notes (VisionKit); pe Android — ML Kit.',
    readmeBullet: 'Scanner nativ multi-pagină cu detecție margini (VisionKit / ML Kit)',
    chatbot: 'scanner nativ multi-pagină cu detecție margini și corecție perspectivă',
  },
  {
    id: 'ocr',
    icon: '🔍',
    title: 'OCR on-device',
    desc: 'După scanare sau atașarea unei poze, app-ul extrage automat textul. Rulează pe device, fără cloud.',
    readmeBullet: 'OCR on-device pentru extragere automată de text',
    chatbot: 'OCR on-device pe pagini scanate sau pozate',
  },
  {
    id: 'vehicle-tracker',
    icon: '🚗',
    title: 'Tracker auto complet',
    desc: 'RCA, ITP, CASCO, Vignetă, Talon, Carte auto — toate la un loc, cu alerte înainte de expirare.',
    readmeBullet: 'Tracker auto (RCA, ITP, CASCO, Vignetă, Talon)',
  },
  {
    id: 'maintenance-reminders',
    icon: '🔧',
    title: 'Remindere mentenanță vehicul',
    desc: 'Schimb ulei, curea distribuție, filtre, revizie — setate pe kilometri și/sau luni. Status automat din km-ul bonurilor de carburant și sincronizare opțională în calendarul iOS.',
    readmeBullet: 'Remindere mentenanță vehicul (km + luni) cu sync calendar',
    chatbot: 'remindere mentenanță vehicul pe km și timp',
  },
  {
    id: 'animals',
    icon: '🐾',
    title: 'Documente animale',
    desc: 'Vaccin, deparazitare, vizite vet — organizate per animal, cu notificări de reînnoire.',
    readmeBullet: 'Documente veterinare per animal (vaccin, deparazitare, vizite)',
  },
  {
    id: 'private-notes',
    icon: '🔒',
    title: 'Notă privată protejată de AI',
    desc: 'Câmp separat per document, destinat datelor sensibile (CVV, PIN, parole). Garantat că nu ajunge niciodată la asistentul AI sau la niciun serviciu extern.',
    readmeBullet: 'Câmp „Notă privată" per document (CVV/PIN/parole) — nu pleacă niciodată la AI',
    chatbot: 'câmp privat separat care nu se trimite niciodată la AI',
    faq: {
      q: 'Cum stochez date sensibile (CVV, PIN, parole)?',
      a: 'Folosește câmpul <strong>„Notă privată"</strong> din ecranul de document (la editare și detaliu). Acest câmp e destinat explicit datelor sensibile: <strong>nu ajunge niciodată la asistentul AI</strong> și nu este trimis la niciun serviciu extern. Este afișat mascat by default; poți dezvălui conținutul cu butonul „Arată". Se păstrează doar local, pe device.',
    },
  },
  {
    id: 'duplicate-detection',
    icon: '🧭',
    title: 'Detecție duplicate',
    desc: 'La adăugare și în detaliu document, app-ul te avertizează dacă ai deja un document cu același fișier sau același tip și entitate. Eviți dublurile fără efort.',
    readmeBullet:
      'Detecție duplicate la adăugare și afișare în detaliu (fișier identic + tip+entitate)',
    chatbot: 'detecție automată de duplicate',
  },
  {
    id: 'multi-vehicle',
    icon: '🚙',
    title: 'Multiple vehicule',
    desc: 'Adaugi orice număr de mașini, fiecare cu dosarul ei (acte, alimentări, mentenanță, statistici).',
    readmeBullet: null,
    chatbot: null,
    faq: {
      q: 'Pot ține evidența mai multor mașini?',
      a: 'Da. Adaugi orice număr de vehicule din <strong>Entități → + Adaugă → Vehicul</strong>. Pentru fiecare ai propriul dosar cu acte (talon, RCA, ITP, vignetă), alimentări, mentenanță programată și statistici de consum. Reminderele de expirare funcționează independent pentru fiecare mașină. <a href="gestiune-auto.html">Detalii complete →</a>',
    },
  },
  {
    id: 'maintenance-faq',
    icon: '🛠️',
    title: 'Reminder mentenanță auto',
    desc: 'Praguri pe km sau luni, status calculat din alimentări, sincronizare opțională în Calendar.',
    readmeBullet: null,
    chatbot: null,
    faq: {
      q: 'Cum funcționează reminderele de mentenanță auto?',
      a: 'Setezi reguli de tipul „schimb ulei la 15.000 km sau 12 luni, ce vine primul". Dosar urmărește kilometrajul (din alimentările pe care le înregistrezi) și te anunță înainte de termen. Predefinit pentru: ulei, filtru ulei, filtru aer, filtru polen, plăcuțe frână, anvelope, baterie, curea distribuție. Poți adăuga propriile reguli oricând.',
    },
  },
  {
    id: 'ai-assistant',
    icon: '🤖',
    title: 'Asistent AI integrat',
    desc: 'Pune întrebări în limbaj natural: „Când expiră buletinul?", „Ce RCA am?". AI-ul știe toate documentele tale și răspunde instant.',
    readmeBullet: 'Asistent AI local-aware (chatbot cu context din documentele tale)',
    chatbot: null, // nu apare în self-description
    highlighted: true,
  },
];

// ─── 3. Extractori din cod ──────────────────────────────────────────────────

function extractDocumentTypes() {
  const typesPath = path.join(ROOT, 'types', 'index.ts');
  const content = fs.readFileSync(typesPath, 'utf8');
  const blockMatch = content.match(/DOCUMENT_TYPE_LABELS[^=]*=\s*\{([^}]+)\}/s);
  if (!blockMatch) throw new Error('Nu am găsit DOCUMENT_TYPE_LABELS în types/index.ts');
  const types = {};
  const lineRe = /^\s*(\w+):\s*'([^']+)'/gm;
  let m;
  while ((m = lineRe.exec(blockMatch[1])) !== null) types[m[1]] = m[2];
  return types;
}

function extractAppVersion() {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  return appJson?.expo?.version ?? null;
}

/**
 * Extrage LOCAL_MODEL_CATALOG din services/localModel.ts.
 * Format întoarcere: array de obiecte { name, description, sizeLabel, qualityStars, minIphoneGen }.
 */
function extractLocalModels() {
  const filePath = path.join(ROOT, 'services', 'localModel.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  const blockMatch = content.match(/LOCAL_MODEL_CATALOG[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!blockMatch) throw new Error('Nu am găsit LOCAL_MODEL_CATALOG în services/localModel.ts');
  const block = blockMatch[1];
  const entries = block.split(/\n\s*\{/).slice(1);
  const models = [];
  for (const raw of entries) {
    const get = key => {
      const m = raw.match(new RegExp(`${key}:\\s*'([^']+)'|${key}:\\s*"([^"]+)"`));
      return m ? m[1] || m[2] : null;
    };
    const getNum = key => {
      const m = raw.match(new RegExp(`${key}:\\s*(\\d+)`));
      return m ? parseInt(m[1], 10) : null;
    };
    // description poate fi multi-line cu concatenare implicită; prinde primul string după "description:"
    const descMatch = raw.match(/description:\s*\n?\s*'([^']+(?:'\s*\+\s*'[^']+)*)'/m);
    const descriptionRaw = descMatch ? descMatch[1].replace(/'\s*\+\s*'/g, '') : '';
    models.push({
      name: get('name'),
      description: descriptionRaw,
      sizeLabel: get('sizeLabel'),
      qualityStars: getNum('qualityStars'),
      minIphoneGen: getNum('minIphoneGen'),
    });
  }
  return models.filter(m => m.name);
}

// ─── 4. Generatori HTML/MD ──────────────────────────────────────────────────

function generateChipsHtml(types) {
  const lines = [];
  for (const [key, label] of Object.entries(types)) {
    if (key === 'altul') continue;
    const emoji = EMOJI_MAP[key] || '📄';
    const cls = HIGHLIGHTED_TYPES.has(key) ? 'chip hl reveal' : 'chip reveal';
    const text = key === 'custom' ? 'Tip personalizat' : label;
    lines.push(`    <span class="${cls}">${emoji} ${text}</span>`);
  }
  return lines.join('\n');
}

function generateFaqDocTypesHtml(types) {
  const standard = Object.entries(types)
    .filter(([k]) => k !== 'custom' && k !== 'altul')
    .map(([, label]) => label);
  return `    <div class="faq-item">
      <button class="faq-q" onclick="toggle(this)">
        Ce tipuri de documente suportă aplicația?
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">
        Aplicația vine cu ${standard.length} tipuri predefinite: ${standard.join(', ')}.<br/><br/>
        Pentru orice document care nu se încadrează, poți folosi tipul <strong>„Altele"</strong> sau crea un <strong>tip personalizat</strong> (Acte → Adaugă document → Tip → derulează jos → „Tip personalizat").
      </div>
    </div>`;
}

function generateFeaturesGridHtml() {
  const delays = ['d1', 'd2', 'd3', 'd4', 'd5'];
  const lines = ['  <div class="features-grid">'];
  FEATURES.forEach((f, i) => {
    const delay = delays[i % delays.length];
    if (f.highlighted) {
      lines.push(
        `    <div class="feat-card reveal ${delay}" style="border-color: rgba(158,181,103,0.4); background: rgba(158,181,103,0.05);">`,
        `      <div class="feat-icon" style="background: rgba(158,181,103,0.2);">${f.icon}</div>`,
        `      <div class="feat-title" style="color: var(--primary-dark);">${f.title}</div>`,
        `      <div class="feat-desc">${f.desc}</div>`,
        `    </div>`
      );
    } else {
      lines.push(
        `    <div class="feat-card reveal ${delay}">`,
        `      <div class="feat-icon">${f.icon}</div>`,
        `      <div class="feat-title">${f.title}</div>`,
        `      <div class="feat-desc">${f.desc}</div>`,
        `    </div>`
      );
    }
  });
  lines.push('  </div>');
  return lines.join('\n');
}

function generateFaqExtrasHtml() {
  const extras = FEATURES.filter(f => f.faq);
  if (extras.length === 0) return '';
  return extras
    .map(
      f => `    <div class="faq-item">
      <button class="faq-q" onclick="toggle(this)">
        ${f.faq.q}
        <span class="faq-arrow">▼</span>
      </button>
      <div class="faq-a">
        ${f.faq.a}
      </div>
    </div>`
    )
    .join('\n\n');
}

function generateReadmeFeatures() {
  const bullets = FEATURES.filter(f => f.readmeBullet).map(f => `- ${f.readmeBullet}`);
  return bullets.join('\n');
}

function generateLocalModelsTableHtml(models) {
  const rows = models
    .map((m, i) => {
      const stars = '★'.repeat(m.qualityStars) + '☆'.repeat(5 - m.qualityStars);
      const isLast = i === models.length - 1;
      const cellBorder = isLast ? '' : ' border-bottom: 1px solid #f0f0f0;';
      const shortDesc = m.description.length > 80 ? m.description.slice(0, 77) + '...' : m.description;
      return `          <tr>
            <td style="padding: 12px 16px;${cellBorder}">
              <strong>${m.name}</strong><br>
              <span style="color: #888; font-size: 12px;">${shortDesc}</span>
            </td>
            <td style="padding: 12px 16px;${cellBorder} color: #9EB567;">${stars}</td>
            <td style="padding: 12px 16px;${cellBorder} color: #555;">${m.sizeLabel}</td>
            <td style="padding: 12px 16px;${cellBorder} color: #555;">iPhone ${m.minIphoneGen}+</td>
          </tr>`;
    })
    .join('\n');
  return `      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f8f8f8;">
            <th style="text-align: left; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; color: #1a1a1a; font-weight: 600;">Model</th>
            <th style="text-align: left; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; color: #1a1a1a; font-weight: 600;">Calitate</th>
            <th style="text-align: left; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; color: #1a1a1a; font-weight: 600;">Dimensiune</th>
            <th style="text-align: left; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; color: #1a1a1a; font-weight: 600;">Telefon minim</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

/**
 * Sincronizează URL-ul App Store oriunde apare în HTML — orice slug vechi
 * (portofel-acte etc.) se rescrie la canonical.
 */
function syncAppStoreUrlInText(text) {
  return text.replace(
    /https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[a-z0-9-]+\/id6760576986/g,
    APP_STORE_URL
  );
}

// ─── 5. Utilitare markeri ───────────────────────────────────────────────────

function replaceMarker(text, markerName, newContent, commentStyle = 'html') {
  const start =
    commentStyle === 'html'
      ? `<!-- DOSAR:${markerName}_START -->`
      : `<!-- DOSAR:${markerName}_START -->`;
  const end =
    commentStyle === 'html'
      ? `<!-- DOSAR:${markerName}_END -->`
      : `<!-- DOSAR:${markerName}_END -->`;
  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    console.warn(`  [SKIP] Marker ${markerName} nu există`);
    return { text, replaced: false };
  }
  const updated =
    text.slice(0, startIdx + start.length) + '\n' + newContent + '\n  ' + text.slice(endIdx);
  return { text: updated, replaced: true };
}

function updateFile(relPath, updates, options = {}) {
  const abs = path.join(ROOT, relPath);
  let content = fs.readFileSync(abs, 'utf8');
  let anyReplaced = false;
  for (const { marker, value } of updates) {
    const r = replaceMarker(content, marker, value);
    if (r.replaced) anyReplaced = true;
    content = r.text;
  }
  if (options.syncAppStoreUrl) {
    const before = content;
    content = syncAppStoreUrlInText(content);
    if (before !== content) {
      anyReplaced = true;
      console.log(`  [URL] App Store URL canonicalizat în ${relPath}`);
    }
  }
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  [${anyReplaced ? 'OK' : '·'}] ${relPath}`);
}

// ─── 6. Main ────────────────────────────────────────────────────────────────

function main() {
  console.log('[update-site] Sincronizare documentație ...');

  const types = extractDocumentTypes();
  const version = extractAppVersion();
  const localModels = extractLocalModels();
  const standardCount = Object.keys(types).filter(k => k !== 'custom' && k !== 'altul').length;

  console.log(
    `  Tipuri: ${Object.keys(types).length} total, ${standardCount} standard · modele locale: ${localModels.length} · versiune: ${version ?? '?'}`
  );

  // ── docs/index.html ───────────────────────────────────────────────────
  updateFile(
    'docs/index.html',
    [
      { marker: 'DOC_COUNT', value: `${standardCount}+` },
      {
        marker: 'DOC_CHIPS',
        value: `  <div class="chips-wrap">\n${generateChipsHtml(types)}\n  </div>`,
      },
      { marker: 'FEATURES', value: generateFeaturesGridHtml() },
      { marker: 'LOCAL_MODELS', value: generateLocalModelsTableHtml(localModels) },
    ],
    { syncAppStoreUrl: true }
  );

  // ── docs/support.html ─────────────────────────────────────────────────
  updateFile(
    'docs/support.html',
    [
      { marker: 'FAQ_DOC_TYPES', value: generateFaqDocTypesHtml(types) },
      { marker: 'FAQ_EXTRAS', value: generateFaqExtrasHtml() },
    ],
    { syncAppStoreUrl: true }
  );

  // ── docs/gestiune-auto.html ───────────────────────────────────────────
  if (fs.existsSync(path.join(ROOT, 'docs/gestiune-auto.html'))) {
    updateFile('docs/gestiune-auto.html', [], { syncAppStoreUrl: true });
  }

  // ── README.md ─────────────────────────────────────────────────────────
  updateFile('README.md', [{ marker: 'APP_FEATURES', value: generateReadmeFeatures() }]);

  console.log('[update-site] Done.');
}

main();
