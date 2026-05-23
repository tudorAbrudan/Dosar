#!/usr/bin/env node
/**
 * worktree-age-audit.js
 *
 * Listează `git worktree`-uri mai vechi de 14 zile (ultimul commit pe HEAD).
 *
 * Vezi CLAUDE.md §"Worktrees pentru experimente":
 *   Niciun worktree nu rămâne mai mult de 2 săptămâni nemerged.
 *
 * Rulare:
 *   node scripts/worktree-age-audit.js
 *   node scripts/worktree-age-audit.js --strict
 *   node scripts/worktree-age-audit.js --json
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const MAX_AGE_DAYS = 14;

function listWorktrees() {
  let out;
  try {
    out = execSync('git worktree list --porcelain', { cwd: APP_DIR, encoding: 'utf8' });
  } catch {
    return [];
  }
  const blocks = out.split('\n\n').filter(b => b.trim());
  return blocks
    .map(b => {
      const lines = b.split('\n');
      const wt = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length);
      const branch =
        lines.find(l => l.startsWith('branch '))?.slice('branch '.length) ?? '(detached)';
      return { path: wt, branch };
    })
    .filter(w => w.path);
}

function lastCommitTimestamp(worktreePath) {
  try {
    const ts = execSync('git log -1 --format=%ct HEAD', {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim();
    return Number(ts) * 1000;
  } catch {
    return null;
  }
}

function audit() {
  const worktrees = listWorktrees();
  const now = Date.now();
  const stale = [];
  // Repo root (folderul rădăcină al git tree-ului) NU intră în audit — e main worktree.
  let mainRoot;
  try {
    mainRoot = execSync('git rev-parse --show-toplevel', { cwd: APP_DIR, encoding: 'utf8' }).trim();
  } catch {
    mainRoot = APP_DIR;
  }
  for (const w of worktrees) {
    if (w.path === mainRoot) continue;
    const ts = lastCommitTimestamp(w.path);
    if (ts === null) continue;
    const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_AGE_DAYS) stale.push({ ...w, ageDays: Math.floor(ageDays) });
  }
  return stale;
}

function format(stale) {
  if (stale.length === 0) return `✓ Niciun worktree mai vechi de ${MAX_AGE_DAYS} zile.`;
  const lines = [`✗ ${stale.length} worktree(uri) stale:`, ''];
  for (const w of stale) {
    lines.push(`  ${w.ageDays}z  ${w.branch.padEnd(40)} ${w.path}`);
  }
  lines.push('');
  lines.push('Fix: cherry-pick/merge în main, apoi `git worktree remove <path>`.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const stale = audit();
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify(stale, null, 2) + '\n');
  } else {
    process.stdout.write(format(stale) + '\n');
  }
  if (args.has('--strict') && stale.length > 0) process.exit(1);
}

module.exports = { audit, format, MAX_AGE_DAYS };
