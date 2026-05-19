#!/usr/bin/env node
/**
 * backup-audit.js
 *
 * Auditor automat pentru sincronizarea backup-ului local + cloud.
 *
 * Verifică, pentru fiecare tabel utilizator declarat în `services/db.ts`,
 * că apare în toate cele patru locații critice:
 *   1. cloudSync.ts → buildManifestPayload (cloud upload)
 *   2. backup.ts → exportBackup (ZIP local)
 *   3. backup.ts → applyManifestBody (restore comun)
 *   4. backup.ts → wipeUserData (cleanup pre-restore)
 *
 * Verifică în plus, pentru fiecare coloană fișier (*_uri, *_path, *photo*),
 * că apare în `cloudSync.ts:collectFileNamesFromPayload`.
 *
 * Rulare:
 *   node scripts/backup-audit.js              # raport text
 *   node scripts/backup-audit.js --json       # raport JSON
 *   node scripts/backup-audit.js --strict     # exit 1 dacă există discrepanțe
 *
 * Folosit de:
 *   - hook PostToolUse când se editează `services/db.ts`
 *   - agent `backup-guardian` (manual sau automat)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const FILES = {
  db: path.join(APP_DIR, 'services/db.ts'),
  cloud: path.join(APP_DIR, 'services/cloudSync.ts'),
  backup: path.join(APP_DIR, 'services/backup.ts'),
};

// Tabele excluse intenționat din backup.
// Modifică aici DOAR cu motiv documentat.
const EXCLUDED_TABLES = new Set([
  'cloud_state', // device-specific state (device_id, hash-uri locale)
  'pending_uploads', // coadă tranzitorie; restore-ul o golește
  'cloud_pending_deletes', // coadă tranzitorie pentru ștergeri staggered cloud (file_path + counter)
  'chat_threads', // istoricul chatbot - ephemeral, NU se păstrează (privacy)
  'chat_messages', // idem
  'document_entities', // junction table reconstruită automat din docs.createDocument
  'fuel_records_v2', // tabel temporar de migrare
  // Medical — FTS virtual reconstruită la restore din summaries + ocr_text:
  'medical_fts',
  // Medical — TEMPORAR exclus până la F7 (Tasks 27-28) când backup.ts/cloudSync.ts
  // primesc collectorii pentru tabelele medicale. ATUNCI: șterge cele 6 linii de aici
  // și mută `medical_record → 'medicalRecords'` etc. în TABLE_TO_MANIFEST_FIELD.
  'medical_record',
  'medical_observations',
  'medical_chat_threads',
  'medical_chat_messages',
  'medical_document_summaries',
  'medical_shares',
]);

// Mapping table snake_case → manifest field camelCase pentru tabele care
// nu urmează convenția implicită. Restul sunt tratate cu snake → camel.
const TABLE_TO_MANIFEST_FIELD = {
  custom_document_types: 'customTypes',
  fuel_records: 'fuelRecords',
  vehicle_maintenance_tasks: 'maintenanceTasks',
  document_pages: 'documentPages',
  entity_order: 'entityOrder',
};

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function manifestFieldFor(table) {
  return TABLE_TO_MANIFEST_FIELD[table] ?? snakeToCamel(table);
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new Error(`Nu pot citi ${p}: ${e.message}`);
  }
}

/**
 * Extrage CREATE TABLE-urile din db.ts împreună cu coloanele lor.
 * Returns: [{ table, columns: [{ name, type }] }]
 */
function parseSchema(dbSource) {
  const tables = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)\s*\(([^;]*?)\)\s*;/gi;
  let m;
  while ((m = re.exec(dbSource)) !== null) {
    const table = m[1];
    const body = m[2];
    const columns = [];
    for (const rawLine of body.split(',')) {
      const line = rawLine.trim();
      if (!line) continue;
      // skip constraint clauses (PRIMARY KEY (a,b), FOREIGN KEY ..., UNIQUE (...))
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const colMatch = line.match(/^([a-z_][a-z_0-9]*)\s+([A-Z]+)/i);
      if (!colMatch) continue;
      columns.push({ name: colMatch[1], type: colMatch[2].toUpperCase() });
    }
    tables.push({ table, columns });
  }
  return tables;
}

/** Returnează corpul funcției numite din sursă, sau null dacă nu o găsește.
 *  Caută definiția (`function NAME(...)` sau `async function NAME(...)`),
 *  nu apelurile. */
function extractFunctionBody(source, fnName) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*[<(]`);
  const m = re.exec(source);
  if (!m) return null;
  const openIdx = source.indexOf('{', m.index + m[0].length);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** True dacă tabelul apare în Promise.all-ul din funcție (fie direct, fie via fetch). */
function tableInBuilder(body, table) {
  if (!body) return false;
  const field = manifestFieldFor(table);
  // căutăm fie field-ul în destructurare/return, fie numele tabelului literal
  const patterns = [new RegExp(`\\b${field}\\b`), new RegExp(`\\b${table}\\b`)];
  return patterns.some(p => p.test(body));
}

/** True dacă body-ul apply-ului iterează `payload.<field>`. */
function tableInApply(body, table) {
  if (!body) return false;
  const field = manifestFieldFor(table);
  const re = new RegExp(`payload\\.${field}\\b`);
  return re.test(body);
}

/** True dacă wipeUserData are DELETE FROM <table>. */
function tableInWipe(body, table) {
  if (!body) return false;
  return new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, 'i').test(body);
}

/** Detectează coloane fișier pe disc (path/uri). */
function isFilePathColumn(col) {
  const n = col.name.toLowerCase();
  return /(_uri|_path|photo)$/.test(n) || /^(photo_uri|file_path|file_uri)$/.test(n);
}

/** True dacă collectFileNamesFromPayload citește acest câmp. */
function fileColumnInCollector(body, table, column) {
  if (!body) return false;
  const field = manifestFieldFor(table);
  // Caută construcție gen `for (const v of asArray(payload.vehicles))` urmată de `v.photo_uri`
  const blockRe = new RegExp(`payload\\.${field}\\b[\\s\\S]{0,400}?\\b${column}\\b`);
  return blockRe.test(body);
}

/** True dacă există migrare backfill pentru această coloană în pending_uploads. */
function hasBackfillMigration(dbSource, table, column) {
  const re = new RegExp(
    `INSERT\\s+OR\\s+IGNORE\\s+INTO\\s+pending_uploads[\\s\\S]{0,300}?SELECT\\s+${column}[\\s\\S]{0,200}?FROM\\s+${table}\\b`,
    'i'
  );
  return re.test(dbSource);
}

function audit() {
  const db = readFileSafe(FILES.db);
  const cloud = readFileSafe(FILES.cloud);
  const backup = readFileSafe(FILES.backup);

  const buildBody = extractFunctionBody(cloud, 'buildManifestPayload');
  const collectorBody = extractFunctionBody(cloud, 'collectFileNamesFromPayload');
  const exportBody = extractFunctionBody(backup, 'exportBackup');
  const applyBody = extractFunctionBody(backup, 'applyManifestBody');
  const wipeBody = extractFunctionBody(backup, 'wipeUserData');

  if (!buildBody) throw new Error('Nu găsesc buildManifestPayload în cloudSync.ts');
  if (!collectorBody) throw new Error('Nu găsesc collectFileNamesFromPayload în cloudSync.ts');
  if (!exportBody) throw new Error('Nu găsesc exportBackup în backup.ts');
  if (!applyBody) throw new Error('Nu găsesc applyManifestBody în backup.ts');
  if (!wipeBody) throw new Error('Nu găsesc wipeUserData în backup.ts');

  const schema = parseSchema(db);
  const tableReports = [];
  const fileReports = [];

  for (const { table, columns } of schema) {
    if (EXCLUDED_TABLES.has(table)) continue;

    const presence = {
      buildManifestPayload: tableInBuilder(buildBody, table),
      exportBackup: tableInBuilder(exportBody, table),
      applyManifestBody: tableInApply(applyBody, table),
      wipeUserData: tableInWipe(wipeBody, table),
    };
    const missing = Object.entries(presence)
      .filter(([, ok]) => !ok)
      .map(([loc]) => loc);

    tableReports.push({ table, manifestField: manifestFieldFor(table), presence, missing });

    for (const col of columns) {
      if (!isFilePathColumn(col)) continue;
      const inCollector = fileColumnInCollector(collectorBody, table, col.name);
      const hasBackfill = hasBackfillMigration(db, table, col.name);
      fileReports.push({
        table,
        column: col.name,
        inCollector,
        hasBackfill,
      });
    }
  }

  return { tableReports, fileReports };
}

function formatReport({ tableReports, fileReports }) {
  const lines = [];
  const desync =
    tableReports.some(r => r.missing.length > 0) ||
    fileReports.some(f => !f.inCollector || !f.hasBackfill);

  lines.push(`STARE BACKUP: ${desync ? 'DESINCRONIZAT' : 'OK'}`);
  lines.push('');
  lines.push('Tabele utilizator (db.ts → manifest):');
  for (const r of tableReports) {
    if (r.missing.length === 0) {
      lines.push(`  - ${r.table.padEnd(28)} ✓ în toate locațiile (manifest: ${r.manifestField})`);
    } else {
      lines.push(`  - ${r.table.padEnd(28)} ✗ lipsă în [${r.missing.join(', ')}]`);
    }
  }

  lines.push('');
  lines.push('Coloane fișier pe disc:');
  if (fileReports.length === 0) {
    lines.push('  (nicio coloană fișier detectată)');
  } else {
    for (const f of fileReports) {
      const collector = f.inCollector ? '✓ collector' : '✗ collector';
      const backfill = f.hasBackfill ? '✓ backfill' : '✗ backfill';
      lines.push(`  - ${f.table}.${f.column.padEnd(20)} ${collector}  ${backfill}`);
    }
  }

  if (desync) {
    lines.push('');
    lines.push('Acțiuni propuse:');
    for (const r of tableReports) {
      if (r.missing.includes('buildManifestPayload')) {
        lines.push(
          `  • Adaugă fetch pentru \`${r.table}\` în Promise.all din cloudSync.ts:buildManifestPayload`
        );
        lines.push(`    și include \`${r.manifestField}\` în interface ManifestPayload + return.`);
      }
      if (r.missing.includes('exportBackup')) {
        lines.push(
          `  • Adaugă fetch pentru \`${r.table}\` în Promise.all din backup.ts:exportBackup`
        );
        lines.push(
          `    și include \`${r.manifestField}\` în obiectul manifest. Bump version dacă e schimbare incompatibilă.`
        );
      }
      if (r.missing.includes('applyManifestBody')) {
        lines.push(
          `  • Adaugă bucla \`for (const x of (payload.${r.manifestField} as AnyRecord[]) ?? [])\``
        );
        lines.push(
          `    în backup.ts:applyManifestBody (înainte de \`documents\`), cu remap ID + dedupe key.`
        );
      }
      if (r.missing.includes('wipeUserData')) {
        lines.push(
          `  • Adaugă \`DELETE FROM ${r.table};\` în backup.ts:wipeUserData (în ordinea corectă FK).`
        );
      }
    }
    for (const f of fileReports) {
      if (!f.inCollector) {
        lines.push(
          `  • Adaugă citirea \`${f.table}.${f.column}\` în cloudSync.ts:collectFileNamesFromPayload`
        );
        lines.push(`    (ca să fie descărcat la cloud restore).`);
      }
      if (!f.hasBackfill) {
        lines.push(`  • Adaugă migrare backfill în db.ts pentru \`${f.table}.${f.column}\`:`);
        lines.push(
          `      INSERT OR IGNORE INTO pending_uploads (file_path, attempt_count, created_at)`
        );
        lines.push(`        SELECT ${f.column}, 0, CAST(strftime('%s','now') AS INTEGER) * 1000`);
        lines.push(`        FROM ${f.table} WHERE ${f.column} IS NOT NULL AND ${f.column} != '';`);
      }
    }
  }

  return { text: lines.join('\n'), desync };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');

  let result;
  try {
    result = audit();
  } catch (e) {
    process.stderr.write(`backup-audit eroare: ${e.message}\n`);
    process.exit(2);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const { text } = formatReport(result);
    process.stdout.write(text + '\n');
  }

  if (strict) {
    const { desync } = formatReport(result);
    if (desync) process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { audit, formatReport, parseSchema, EXCLUDED_TABLES, TABLE_TO_MANIFEST_FIELD };
