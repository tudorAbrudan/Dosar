#!/usr/bin/env node
/**
 * Test harness pentru prompt-urile AI medicale.
 *
 * Rulează prompt-urile actuale din codebase împotriva fixture-urilor OCR
 * reale din `__tests__/fixtures/ocr/` și verifică automat că rezultatul
 * AI match-uiește așteptările din `_expected.json`.
 *
 * Acest script e plasa de siguranță pentru regula 1 din
 * `docs/AI_FEATURE_CHECKLIST.md`: niciun feature AI nu se declară `done`
 * fără ca acest harness să returneze ✅ pe fixture-urile relevante.
 *
 * Cerințe:
 *   .env conține EXPO_PUBLIC_MISTRAL_API_KEY (chei built-in folosită
 *   pentru extracție).
 *
 * Utilizare:
 *   node scripts/test-ai-prompts.js                # rulează toate
 *   node scripts/test-ai-prompts.js <fixture-name> # un singur fixture
 *   node scripts/test-ai-prompts.js --strict       # exit 1 la primul fail
 *
 * NOTĂ: scriptul face apeluri REALE către Mistral (consumă din cota
 * zilnică). Pentru runs frecvente, configurează propria cheie sau
 * cache-uiește răspunsurile (TODO faza 2).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, '__tests__', 'fixtures', 'ocr');
const EXPECTED_PATH = path.join(FIXTURES_DIR, '_expected.json');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const STRICT = process.argv.includes('--strict');
const SINGLE_FIXTURE = args[0] ?? null;

// ── .env loader (fără dep externă) ────────────────────────────────────────────
const envPath = path.resolve(ROOT, '.env');
let API_KEY = '';
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const m = envContent.match(/EXPO_PUBLIC_MISTRAL_API_KEY=(.+)/);
  if (m) API_KEY = m[1].trim();
} catch {
  // pass
}
if (!API_KEY) {
  console.error('❌ EXPO_PUBLIC_MISTRAL_API_KEY missing in .env');
  process.exit(2);
}

// ── Schema/regex copies din services/ocr.ts (detectDocumentType) ──────────────
// IMPORTANT: dacă schimbi `detectDocumentType` în services/ocr.ts, actualizează
// aici. Audit `scripts/classifier-divergence-audit.js` semnalează divergența.
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

// ── Catalog clasificator (subset pentru testare) ─────────────────────────────
const CATALOG = `- "contract" — Contract civil. Document de sine stătător cu părți, clauze și semnături. Semne distinctive: Titlul „CONTRACT" central; părți contractante cu CNP/CUI; articole/clauze numerotate; NEGATIV: „Contract/convenție Nr X" lângă CAS/CNAS pe documente medicale NU este contract — verifică tipurile medicale.
- "scrisoare_medicala" — Scrisoare medicală narativă. Semne distinctive: Titlul „SCRISOARE MEDICALĂ" central; antet cabinet medical + medic specialist; adresare „Către Dr."; text narativ Diagnostic/Anamneza/Recomandări; semnătură + parafă.
- "bilet_externare" — Bilet de externare spital. Semne: titlul „BILET DE EXTERNARE"/„EPICRIZĂ"; antet spital + secție; date internare/externare; secțiuni Diagnostic la internare/externare.
- "fisa_consultatie" — Fișă consultație ambulator. Semne: titlul „FIȘĂ DE CONSULTAȚIE"; date pacient; secțiuni Antecedente/Examen clinic/Diagnostic/Recomandări.
- "bilet_trimitere" — Bilet trimitere CNAS. Semne: titlul „BILET DE TRIMITERE"; serie+număr regim special; cod ICD-10; specialitate/investigație recomandată.
- "imagistica" — Rezultat imagistic. Semne: cuvinte „RMN/CT/Ecografie/Radiografie"; antet centru imagistică; secțiunea „Descriere/Concluzie" semnată de radiolog.
- "analize_medicale" — Analize laborator. Semne: lista de valori cu unități + interval referință; antet laborator.
- "altul" — Alt tip generic.`;

const CLASSIFIER_SYSTEM =
  'Ești un expert în clasificarea documentelor românești. Returnezi EXCLUSIV JSON valid cu tipul și confidence-ul.';

function buildClassifierPrompt(ocrText) {
  const truncated = ocrText.slice(0, 2500);
  return `Identifică tipul acestui document românesc dintr-o listă de tipuri candidate.

Tipuri candidate (folosește EXACT id-ul, în ghilimele):
${CATALOG}

Text OCR (referință secundară):
---
${truncated}
---

Returnează DOAR JSON valid, fără text suplimentar:
{
  "type": "<id_tip>",
  "confidence": 0.0–1.0,
  "top3": [
    { "type": "<id_tip>", "confidence": 0.0–1.0 }
  ],
  "reasoning": "1–2 propoziții cu motivul"
}

Reguli:
- "type" trebuie să fie EXACT unul din id-urile listate mai sus
- confidence reflectă cât de sigur ești
- top3 conține cei mai probabili 3 candidați
- PRIORITATE TITLU vs MENȚIUNI ADMINISTRATIVE: titlul documentului (antet central) are PRIORITATE absolută față de keyword-uri răzlețe (ex „Contract / convenție Nr X" lângă „CAS"/„CNAS" e referință administrativă, NU înseamnă tip „contract").`;
}

// ── AI summary prompt (copie din services/medicalAiSummary.ts) ────────────────
const AI_SUMMARY_SYSTEM = `Generator rezumat document medical pentru cititor non-medic +
extractor recomandări cu termen.

REGULI STRICTE:
- NU interpretezi clinic. NU spui „risc crescut", „grav", „atenție",
  „periculos", „normal e OK", etc.
- Folosește DOAR informație EXPLICITĂ din document.
- Pentru valori out-of-range: formulare neutră „peste limita superioară X"
  sau „sub limita inferioară X".
- Pentru recomandări: copiezi sau aproape-copiezi textul medicului.

Format OUTPUT — JSON strict:

{
  "summary_md": "<markdown text>",
  "actionable_items": [
    { "label": "<text recomandare>", "suggested_date_iso": "YYYY-MM-DD" | null }
  ]
}

Format summary_md (markdown ușor, max 200 cuvinte):
**Rezumat:** 1-2 fraze obiective.
**Recomandări:** (doar dacă există) - bullet
**Valori în afara intervalului:** (doar dacă există) - ex: LDL: 145 mg/dL — peste limita superioară 130

Reguli actionable_items:
- Include un item DOAR dacă recomandarea are termen explicit ÎN TEXT.
- suggested_date_iso = calculat relativ la observed_at al documentului.
- label = text aproape verbatim, max 80 caractere.`;

function buildSummaryUserMsg(ocrText, documentDate) {
  return [
    documentDate ? `Data documentului (observed_at): ${documentDate}` : '',
    '',
    'Conținut document (OCR):',
    ocrText.slice(0, 8000),
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Apel Mistral ──────────────────────────────────────────────────────────────
async function callMistral(systemPrompt, userPrompt, maxTokens = 1000) {
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Mistral API ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function parseJsonFallback(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fence ? fence[1].trim() : null;
    const m = (candidate ?? raw).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// ── Runner per fixture ───────────────────────────────────────────────────────
async function runFixture(name, ocrText, expected) {
  const failures = [];
  console.log(`\n━━━ ${name} ━━━`);
  console.log(`Description: ${expected.description}`);

  // Step 1: detectDocumentType (heuristic, fără AI)
  const detected = detectDocumentType(ocrText);
  if (detected === expected.expected_type) {
    console.log(`  ✅ detectDocumentType → ${detected}`);
  } else {
    failures.push(
      `detectDocumentType returned '${detected}' — expected '${expected.expected_type}'`
    );
    console.log(`  ❌ detectDocumentType → ${detected} (expected ${expected.expected_type})`);
  }

  // Step 2: AI classifier
  console.log(`  ⏳ Apel Mistral clasificator…`);
  let classifierResp;
  try {
    classifierResp = await callMistral(CLASSIFIER_SYSTEM, buildClassifierPrompt(ocrText), 400);
  } catch (e) {
    failures.push(`AI classifier API call failed: ${e.message}`);
    console.log(`  ❌ AI classifier API error: ${e.message}`);
    return failures;
  }
  const cls = parseJsonFallback(classifierResp);
  if (!cls) {
    failures.push('AI classifier returned non-JSON');
    console.log(`  ❌ AI classifier returned non-JSON:\n${classifierResp.slice(0, 200)}`);
  } else if (cls.type !== expected.expected_type) {
    failures.push(
      `AI classifier returned '${cls.type}' — expected '${expected.expected_type}'`
    );
    console.log(`  ❌ AI classifier → ${cls.type} (expected ${expected.expected_type})`);
  } else {
    console.log(`  ✅ AI classifier → ${cls.type} (confidence ${cls.confidence})`);
  }

  // Step 3: AI summary
  console.log(`  ⏳ Apel Mistral summary…`);
  let summaryResp;
  try {
    summaryResp = await callMistral(
      AI_SUMMARY_SYSTEM,
      buildSummaryUserMsg(ocrText, expected.document_date),
      1000
    );
  } catch (e) {
    failures.push(`AI summary API call failed: ${e.message}`);
    console.log(`  ❌ AI summary API error: ${e.message}`);
    return failures;
  }
  const summary = parseJsonFallback(summaryResp);
  if (!summary) {
    failures.push('AI summary returned non-JSON');
    console.log(`  ❌ AI summary returned non-JSON:\n${summaryResp.slice(0, 200)}`);
    return failures;
  }

  // Verify summary_md must contain
  for (const needle of expected.expected_summary_must_contain ?? []) {
    if (!(summary.summary_md || '').includes(needle)) {
      failures.push(`AI summary missing required substring: '${needle}'`);
      console.log(`  ❌ summary_md missing '${needle}'`);
    } else {
      console.log(`  ✅ summary_md contains '${needle}'`);
    }
  }

  // Verify summary_md must NOT contain
  for (const needle of expected.expected_summary_must_not_contain ?? []) {
    if ((summary.summary_md || '').toLowerCase().includes(needle.toLowerCase())) {
      failures.push(`AI summary contains forbidden substring: '${needle}'`);
      console.log(`  ❌ summary_md contains forbidden '${needle}'`);
    } else {
      console.log(`  ✅ summary_md does NOT contain '${needle}'`);
    }
  }

  // Actionable items count
  const itemCount = Array.isArray(summary.actionable_items)
    ? summary.actionable_items.length
    : 0;
  if (itemCount < (expected.expected_min_actionable_items ?? 0)) {
    failures.push(
      `actionable_items count ${itemCount} < expected min ${expected.expected_min_actionable_items}`
    );
    console.log(
      `  ❌ actionable_items ${itemCount} < expected ${expected.expected_min_actionable_items}`
    );
  } else {
    console.log(`  ✅ actionable_items ${itemCount} (≥ ${expected.expected_min_actionable_items ?? 0})`);
  }

  return failures;
}

async function main() {
  if (!fs.existsSync(EXPECTED_PATH)) {
    console.error(`❌ Missing ${EXPECTED_PATH}`);
    process.exit(2);
  }
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

  const fixtureNames = Object.keys(expected);
  const toRun = SINGLE_FIXTURE
    ? fixtureNames.filter(n => n === SINGLE_FIXTURE)
    : fixtureNames;

  if (toRun.length === 0) {
    console.error(`❌ No fixtures to run (filter: ${SINGLE_FIXTURE ?? 'all'})`);
    process.exit(2);
  }

  let totalFailures = 0;
  for (const name of toRun) {
    const txtPath = path.join(FIXTURES_DIR, `${name}.txt`);
    if (!fs.existsSync(txtPath)) {
      console.error(`⚠️  Fixture file missing: ${txtPath}`);
      totalFailures++;
      continue;
    }
    const ocrText = fs.readFileSync(txtPath, 'utf8');
    const failures = await runFixture(name, ocrText, expected[name]);
    totalFailures += failures.length;
    if (STRICT && failures.length > 0) {
      console.error(`\n❌ STRICT mode — first failures: ${failures.length}`);
      process.exit(1);
    }
  }

  console.log(`\n━━━ Total ━━━`);
  if (totalFailures === 0) {
    console.log(`✅ Toate fixture-urile au trecut.`);
    process.exit(0);
  } else {
    console.log(`❌ ${totalFailures} failures across ${toRun.length} fixtures.`);
    process.exit(STRICT ? 1 : 0);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
