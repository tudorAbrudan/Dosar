#!/usr/bin/env node
/**
 * Audit — verifică că toate apelurile `createEventAsync` / `updateEventAsync`
 * din `services/calendar.ts` includ câmpurile obligatorii pentru consistență
 * (regulă din `docs/AI_FEATURE_CHECKLIST.md` §5):
 *
 *   - timeZone: 'Europe/Bucharest'  (altfel evenimentul ajunge în UTC)
 *   - url:      acte:///documente/${documentId}  sau undefined explicit
 *   - alarms:  obligatoriu (event fără reminder nu folosește la nimic)
 *   - notes conține  https://tudorabrudan.github.io/Dosar  (link site app)
 *
 * Lecție 2026-05-24: am introdus un al 3-lea wrapper pentru calendar
 * (addMedicalRecommendationCalendarEvent) și inițial omiteam timeZone +
 * url. Acest audit blochează drift-ul similar pe viitor.
 *
 * Utilizare:
 *   node scripts/calendar-event-consistency-audit.js          # warning-only
 *   node scripts/calendar-event-consistency-audit.js --strict # exit 1
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const CALENDAR_FILE = path.join(ROOT, 'services', 'calendar.ts');

if (!fs.existsSync(CALENDAR_FILE)) {
  console.warn('⚠️  services/calendar.ts missing — nothing to audit.');
  process.exit(0);
}

const src = fs.readFileSync(CALENDAR_FILE, 'utf8');
const lines = src.split('\n');

const REQUIRED_FIELDS = [
  { name: 'timeZone', re: /timeZone\s*:\s*['"]Europe\/Bucharest['"]/ },
  { name: 'url', re: /\burl\s*:/ },
  { name: 'alarms', re: /\balarms\s*:/ },
];
const SITE_LINK_RE = /tudorabrudan\.github\.io\/Dosar/;

let violations = 0;

// Caut blocuri ce încep cu .createEventAsync( sau .updateEventAsync(
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  if (!/\.(createEventAsync|updateEventAsync)\s*\(/.test(ln)) continue;

  const fn = ln.match(/\.(createEventAsync|updateEventAsync)/)[1];
  // Extrage corpul obiectului — caut paranteza deschisă a obiectului literal,
  // apoi închiderea matching.
  let start = -1;
  for (let j = i; j < Math.min(lines.length, i + 30); j++) {
    if (/\{\s*$/.test(lines[j]) || /,\s*\{\s*$/.test(lines[j])) {
      start = j;
      break;
    }
  }
  if (start < 0) continue;

  let end = -1;
  let depth = 0;
  let started = false;
  for (let j = start; j < Math.min(lines.length, start + 60); j++) {
    for (const ch of lines[j]) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end >= 0) break;
  }
  if (end < 0) continue;

  const block = lines.slice(start, end + 1).join('\n');

  for (const field of REQUIRED_FIELDS) {
    if (!field.re.test(block)) {
      console.error(
        `❌ services/calendar.ts:${i + 1} — ${fn} lipsește câmpul '${field.name}'.`
      );
      console.error(`   Spec: docs/AI_FEATURE_CHECKLIST.md §5 (calendar consistency).`);
      violations++;
    }
  }

  // Site link — verific în ±120 linii în jurul apelului. Larg pentru că
  // notes-ul poate fi construit de un helper plasat oriunde în fișier
  // (ex: buildMaintenanceNotes). Accept URL literal sau SITE_URL.
  const contextStart = Math.max(0, i - 120);
  const contextEnd = Math.min(lines.length, i + 30);
  const ctx = lines.slice(contextStart, contextEnd).join('\n');
  const hasSiteLink = SITE_LINK_RE.test(ctx) || /\bSITE_URL\b/.test(ctx);
  if (!hasSiteLink) {
    console.error(
      `❌ services/calendar.ts:${i + 1} — ${fn} notes nu pare să conțină link spre tudorabrudan.github.io/Dosar (nici literal, nici SITE_URL)`
    );
    console.error(`   Spec: docs/AI_FEATURE_CHECKLIST.md §5 — site link obligatoriu.`);
    violations++;
  }
}

console.log(
  `\n[calendar-event-consistency-audit] Found ${violations} violations in services/calendar.ts.`
);
if (violations > 0) process.exit(STRICT ? 1 : 0);
process.exit(0);
