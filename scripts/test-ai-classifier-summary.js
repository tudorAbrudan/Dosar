#!/usr/bin/env node
/**
 * Test harness pentru clasificatorul AI + generatorul de Rezumat AI.
 *
 * Rulează prompt-urile actuale din codebase împotriva unui text OCR REAL
 * și afișează ce returnează Mistral. Folosit ca să verificăm comportamentul
 * AI înainte de a declara un feature „done" — fără asta, nu știm dacă
 * prompt-urile noastre funcționează în realitate.
 *
 * Utilizare:
 *   node scripts/test-ai-classifier-summary.js
 *
 * Cerințe:
 *   .env conține EXPO_PUBLIC_MISTRAL_API_KEY
 */
const fs = require('fs');
const path = require('path');

// Încarcă .env manual (nu folosim dotenv ca să nu adăugăm dep).
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envMatch = envContent.match(/EXPO_PUBLIC_MISTRAL_API_KEY=(.+)/);
if (!envMatch) {
  console.error('EXPO_PUBLIC_MISTRAL_API_KEY missing in .env');
  process.exit(1);
}
const API_KEY = envMatch[1].trim();

// OCR text extras din PDF-ul user-ului (tudor-contract.pdf, pag 1-2).
// Asta e exact ce a văzut clasificatorul când a încadrat greșit ca „contract".
const OCR_TEXT = `Denumire Furnizor CENTRUL MEDICAL MARASTI
Medic HORIA MIRCEA CRISAN - NEUROLOGIE;
Contract / convenție Nr 240
CAS CAS-CJ
Adresa Cluj-Napoca , AUREL VLAICU , 10
ANEXA 43

SCRISOARE MEDICALĂ*

Catre Dr. MOLDOVEANU LUIZA-MADALINA
Stimate(ă) coleg(ă), vă informăm că ABRUDAN TUDOR-VASILE
născut la data de 01/04/1984, în vârstă de 42 ani, CNP/cod unic de asigurare 1840401125909, a fost consultat în serviciul nostru la data de 19/05/2026 nr. F.O./nr. din Registrul de consultatii 766 ;

Motivele prezentării
Pacient diagnosticat cu afecțiune oncologică NU
Diagnosticul: SIMPTOME SI SEMNE REFERITOARE LA CONSTIENTA, PERCEPTIE SI COMPORTAMENT (873);

Anamneza:
Diagnostic : Microadenom hipofizar stâng non-secretant
Tatal : Dementa de etiologie necunoscuta

Examinări paraclinice :
Analize sange: CRP 7, Hb 13 (limita laboratorului 13.2)

Motivele prezentării :
- cefalee recidivanta difuza
- pacient declara ca in ultimii 5 ani de zile - simte ca uita/isi aminteste greu numele persoanelor cunoscute (context de lucru - la birou 8-12 h)
Examen neurologic :
fara deficite focal neurologice
09.02.2026 Pacientul a realizat 30 din 30 la testul MOCA.

rezumat RM HIPOFIZA NATIV SI CU CONTRAST I..V
Concluzie: microadenom hipofizar stâng

Microadenom hipofizar stâng non-secretant, descoperit incidental. Bilanț hormonal complet în limite normale. Nu necesită tratament medicamentos sau chirurgical. Se recomandă urmărire imagistică RM hipofiză cu contrast la 12 luni și repetarea evaluării hormonale la 12 luni sau la apariția altor simptome
19.05.2026 astenie- fara deficite focal neurologice

Tratament recomandat:
 Reteta:
Recomandari: 1. trimitere RMN cerebral nativ - revine cu CD-ul si cu rezultatul radiologic
2. trimitere psiholog si testare cognitiva (rog efectuarea testului MOCA in loc de MMSE)

data viitoare : completarea analizelor de sange, si EEG

15.05.2026 Se recomandă urmărire imagistică RM hipofiză cu contrast la 12 luni și repetarea evaluării hormonale la 12 luni sau la apariția altor simptome / revine cu bilet de trimitere
19.05.2026 CALCIU EFERVESCENT 1TB PE ZI- 15 ZILE PE LUNA,
- MAGNEROT 2X1TB PE ZI, 15 ZILE PE LUNA, ALTERNATIV CU CALCIU

Data externare: 19/05/2026
Semnătura și parafa medicului    CRISAN HORIA MIRCEA F87400`;

// ── Re-construim catalogul EXACT cum face buildClassifierCatalog ──────────────
// Catalog redus la candidații relevanți pentru context (full list e ~40 tipuri).
const CANDIDATES_CATALOG = `- "contract" — Contract civil. Contract civil sau comercial (chirie, prestări servicii, vânzare etc.). Document de sine stătător cu părți, clauze și semnături — NU este un alt document care doar conține un număr de contract administrativ în antet. Cuvinte cheie: contract, chirie, închiriere, prestări servicii, vânzare-cumpărare. Semne distinctive: Titlul „CONTRACT" sau „CONVENȚIE" ca antet central al documentului (nu doar număr de înregistrare în colț); Părți contractante listate cu nume complet + CNP/CUI (Locatar/Locator, Cumpărător/Vânzător, Prestator/Beneficiar); Articole sau clauze numerotate (Art. 1, Art. 2, ...) sau secțiuni „Obiectul contractului", „Durata", „Prețul"; Termen/durată + valoare/preț precizate explicit; Semnături + ștampile ale părților la final; NEGATIV: dacă singura mențiune „Contract / convenție Nr X" apare doar ca număr administrativ în antet (lângă „CAS", „CNAS", denumire furnizor de servicii medicale), iar documentul are conținut medical (diagnostic, recomandări, scrisoare către alt medic), NU este contract — verifică tipurile medicale (scrisoare_medicala, bilet_externare, fisa_consultatie).
- "scrisoare_medicala" — Scrisoare medicală. Scrisoare medicală narativă de la un medic specialist către medicul de familie sau pacient. Conține diagnostic, recomandări, plan terapeutic. NU expiră. Cuvinte cheie: scrisoare medicală, recomandare medicală, aviz medical, opinie specialist. Semne distinctive: Titlul „SCRISOARE MEDICALĂ" central, ca antet principal al documentului (chiar dacă mai sus apare un număr de contract servicii „Contract/convenție Nr X" către CAS/CNAS — acela e doar referință administrativă); Antet cabinet medical/spital + numele medicului specialist + specialitatea (Neurologie/Cardiologie/etc.); Adresare „Către Dr. [Nume]" sau „Stimate(ă) coleg(ă)" la începutul corpului; Text narativ structurat (Diagnostic / Anamneza / Examinări paraclinice / Recomandări / Tratament); Numele pacientului + data consultației + CNP/cod asigurat; Semnătură + parafă medic la final.
- "bilet_externare" — Bilet de externare. Bilet de externare emis la finalul unei internări în spital. Conține diagnostic, evoluție pe parcursul spitalizării, tratament la externare. NU expiră. Cuvinte cheie: bilet de externare, externare, bilet ieșire spital, epicriză. Semne distinctive: Titlul „BILET DE EXTERNARE" sau „EPICRIZĂ" ca antet principal; Antet spital + numele secției; Datele internării și externării; Secțiuni „Diagnostic la internare/externare", „Anamneza", „Evoluție", „Recomandări"; Numărul foii de observație.
- "fisa_consultatie" — Fișă consultație. Fișă emisă de medic la finalul unei consultații în ambulator/cabinet. Cuvinte cheie: fișă consultație, consultație medicală, consult medical, raport consultație. Semne distinctive: Antet clinică/spital + cuvântul „FIȘĂ DE CONSULTAȚIE" / „FIȘA DE CONSULTAȚIE"; Tabel cu date pacient; Secțiuni: „Antecedente", „Examen clinic", „Diagnostic", „Recomandări"; Numele și parafa medicului consultant + data consultației.
- "altul" — Alt tip de document. Tip generic, fără semne distinctive specifice. Cuvinte cheie: altul.`;

const CLASSIFIER_SYSTEM =
  'Ești un expert în clasificarea documentelor românești. Returnezi EXCLUSIV JSON valid cu tipul și confidence-ul.';

function buildClassifierPrompt(ocrText) {
  const truncated = ocrText.slice(0, 2500);
  return `Identifică tipul acestui document românesc dintr-o listă de tipuri candidate.

Tipuri candidate (folosește EXACT id-ul, în ghilimele):
${CANDIDATES_CATALOG}

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
- "type" trebuie să fie EXACT unul din id-urile listate mai sus (ex. "pad", "rca", "asigurare_personala")
- confidence reflectă cât de sigur ești că documentul e de acel tip
- top3 conține cei mai probabili 3 candidați în ordine descrescătoare a confidence-ului
- Dacă nu ești deloc sigur, folosește "altul" cu confidence mic
- PRIORITATE TITLU vs MENȚIUNI ADMINISTRATIVE: titlul documentului (apare ca antet central, ex „SCRISOARE MEDICALĂ", „CONTRACT", „BILET DE EXTERNARE", „FACTURĂ", „FIȘĂ DE CONSULTAȚIE") are PRIORITATE absolută față de keyword-uri răzlețe din antet care sunt doar referințe administrative (ex „Contract / convenție Nr X" lângă „CAS"/„CNAS" e un număr de contract servicii medicale, NU înseamnă că documentul e tip „contract"). Dacă apar amândouă, alege tipul indicat de titlul central + conținutul documentului (părți/clauze pentru contract real vs diagnostic/recomandări pentru scrisoare medicală).`;
}

// ── AI summary prompt (copiat din services/medicalAiSummary.ts) ───────────────
const AI_SUMMARY_SYSTEM = `Generator rezumat document medical pentru cititor non-medic +
extractor recomandări cu termen.

REGULI STRICTE:
- NU interpretezi clinic. NU spui „risc crescut", „grav", „atenție",
  „periculos", „normal e OK", etc.
- Folosește DOAR informație EXPLICITĂ din document.
- Pentru valori out-of-range: formulare neutră „peste limita superioară X"
  sau „sub limita inferioară X". NU explica de ce e relevant.
- Pentru recomandări: copiezi sau aproape-copiezi textul medicului.
  NU rezumi, NU prioritizezi.

Format OUTPUT — JSON strict, fără markdown wrapping, fără text înainte/după:

{
  "summary_md": "<markdown text, vezi formatul de mai jos>",
  "actionable_items": [
    { "label": "<text recomandare>", "suggested_date_iso": "YYYY-MM-DD" | null }
  ]
}

Format summary_md (markdown ușor, max 200 cuvinte):

**Rezumat:** 1-2 fraze descriere obiectivă a tipului documentului.

**Recomandări:** (doar dacă există în document)
- bullet 1 (text aproape verbatim)
- bullet 2

**Valori în afara intervalului:** (doar dacă există)
- LDL: 145 mg/dL — peste limita superioară 130
- TSH: 0.3 mU/L — sub limita inferioară 0.4

Dacă nu sunt recomandări sau valori out-of-range → omiți secțiunile.
Dacă documentul nu are niciun conținut relevant → "summary_md": "".

Reguli actionable_items:
- Include un item DOAR dacă recomandarea are termen explicit ÎN TEXT.
- suggested_date_iso = calculat relativ la observed_at al documentului.
- Fără termen → NU include (rămâne doar în summary_md).
- label = text aproape verbatim, max 80 caractere.
- actionable_items poate fi [].`;

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

// ── Re-construim detectDocumentType din services/ocr.ts ──────────────────────
// Copie exactă a logicii — sincronizare manuală necesară.
function detectDocumentType(text) {
  const t = text.toLowerCase();
  if (/scrisoare medical[aă]/.test(t)) return 'scrisoare_medicala';
  if (/bilet de externare|bilet externare|epicriz[aă]/.test(t)) return 'bilet_externare';
  if (/bilet de trimitere|bilet trimitere/.test(t)) return 'bilet_trimitere';
  if (/fi[sș][aă] de consulta[tț]ie|fi[sș][aă] consulta[tț]ie/.test(t)) return 'fisa_consultatie';
  if (/re[tț]et[aă] medical[aă]|prescrip[tț]ie medical[aă]|rp\/?\s*medicament/.test(t)) return 'reteta_medicala';
  if (/(rmn|ct|computer tomograf|tomografie|ecografie|ecografic|radiografie|mamografie|scintigrafie)/.test(t)) {
    if (/concluzie|descriere|radiolog|imagistic[aă]/.test(t)) return 'imagistica';
  }
  if (/(hemoleucogram[aă]|biochimie|hemoglobin[aă]|glicemie|lipidogram[aă]|tsh|t3|t4|colesterol|transaminaze|ureea|creatinin[aă])/.test(t)) {
    if (/valori? de referin[tț][aă]|interval (de )?referin[tț][aă]|limit[aă] (laboratorului|normal[aă])/.test(t)) return 'analize_medicale';
  }
  if (/asigurare.*obligatorie|r\.c\.a\.|asigurare rca|\brca\b/.test(t)) return 'rca';
  if (/\bcasco\b/.test(t)) return 'casco';
  if (/(^|\n)\s*contract\s+(de\s+)?(prest[aă]ri serv|[îi]nchiriere|chirie|v[âa]nzare|cump[aă]rare|servicii|munc[aă]|colaborare|comodat|mandat|consign[aă]) /.test(t)) return 'contract';
  return null;
}

async function main() {
  console.log('=== TEST 0: Detector heuristic (detectDocumentType) ===');
  const detectedType = detectDocumentType(OCR_TEXT);
  console.log('Detected type:', detectedType);
  console.log(
    detectedType === 'scrisoare_medicala' ? '✅ CORECT' : `❌ GREȘIT — ar trebui scrisoare_medicala (a returnat: ${detectedType})`
  );
  console.log('');

  console.log('=== TEST 1: Clasificator AI ===');
  console.log('Input OCR (first 200 chars):', OCR_TEXT.slice(0, 200), '...');
  console.log('\nApelez Mistral...\n');

  const classifierPrompt = buildClassifierPrompt(OCR_TEXT);
  const classifierResp = await callMistral(CLASSIFIER_SYSTEM, classifierPrompt, 400);
  console.log('Răspuns brut clasificator:');
  console.log('---');
  console.log(classifierResp);
  console.log('---\n');

  // Parse
  const match = classifierResp.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      console.log('PARSED type:', parsed.type);
      console.log('PARSED confidence:', parsed.confidence);
      console.log('PARSED reasoning:', parsed.reasoning);
      console.log(
        parsed.type === 'scrisoare_medicala' ? '✅ CORECT' : `❌ GREȘIT — ar trebui scrisoare_medicala`
      );
    } catch (e) {
      console.log('❌ JSON parse failed:', e.message);
    }
  } else {
    console.log('❌ Nu s-a găsit JSON în răspuns');
  }

  console.log('\n=== TEST 2: AI Summary ===');
  console.log('Apelez Mistral cu prompt summary...\n');

  const summaryUser = buildSummaryUserMsg(OCR_TEXT, '2026-05-19');
  const summaryResp = await callMistral(AI_SUMMARY_SYSTEM, summaryUser, 1000);
  console.log('Răspuns brut summary:');
  console.log('---');
  console.log(summaryResp);
  console.log('---\n');

  // Parse
  let parsed;
  try {
    parsed = JSON.parse(summaryResp);
  } catch {
    const m = summaryResp.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (e) {
        console.log('❌ JSON parse failed (fallback):', e.message);
        return;
      }
    } else {
      console.log('❌ Nu s-a găsit JSON');
      return;
    }
  }

  console.log('PARSED summary_md:');
  console.log(parsed.summary_md ?? '(empty)');
  console.log('\nPARSED actionable_items:');
  console.log(JSON.stringify(parsed.actionable_items, null, 2));

  // Word guard check
  const FORBIDDEN_PHRASES = [
    'risc crescut', 'risc moderat', 'risc scăzut', 'risc cardiovascular',
    'foarte grav', 'extrem de', 'e periculos', 'pune în pericol',
    'situație gravă', 'normal pentru', 'e normal', 'e bun', 'e rău',
    'fără probleme', 'totul e ok', 'nu e nimic',
  ];
  const lower = (parsed.summary_md || '').toLowerCase();
  const triggeredGuard = FORBIDDEN_PHRASES.filter(p => lower.includes(p));
  if (triggeredGuard.length > 0) {
    console.log('\n❌ WORD GUARD ar trebui sa arunce summary — found:', triggeredGuard);
  } else {
    console.log('\n✅ WORD GUARD nu se declanșează — summary trece');
  }

  if (parsed.actionable_items && parsed.actionable_items.length > 0) {
    console.log(
      `\n✅ MODAL CALENDAR s-ar deschide cu ${parsed.actionable_items.length} item(s)`
    );
  } else {
    console.log('\n⚠️  Niciun actionable_item — modal calendar NU s-ar deschide');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
