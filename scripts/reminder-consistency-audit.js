#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOC_FILE = path.join(__dirname, '..', 'services/documents.ts');

function audit() {
  if (!fs.existsSync(DOC_FILE)) return [];
  const source = fs.readFileSync(DOC_FILE, 'utf8');
  const violations = [];

  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([\s\S]*?\)\s*[\s\S]*?\{([\s\S]*?)(?=\n(?:export\s+)?(?:async\s+)?function|\nexport\s|\Z)/g;
  let m;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    const body = m[2];
    const touchesExpiry = /expiry_date/.test(body);
    const callsSync = /(syncDocumentExpiryReminder|removeDocumentExpiryReminder|deleteRemindersByDocument)\s*\(/.test(body);
    const isWrite = /(INSERT\s+INTO\s+documents|UPDATE\s+documents|DELETE\s+FROM\s+documents)/i.test(body);

    if (touchesExpiry && isWrite && !callsSync) {
      violations.push({ fn: name });
    }
  }
  return violations;
}

function format(v) {
  if (v.length === 0) return '✓ reminder-consistency: OK';
  let out = `⚠ reminder-consistency: ${v.length} funcții posibil ne-sincronizate:\n`;
  for (const x of v) out += `  - ${x.fn}\n`;
  return out;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const v = audit();
  process.stdout.write(format(v) + '\n');
  if (args.has('--strict') && v.length > 0) process.exit(1);
}

module.exports = { audit };
