#!/usr/bin/env node
/**
 * claude-config-audit.js
 *
 * Verifică config-ul Claude Code din `.claude/` + CLAUDE.md: hook-uri care chiar rulează,
 * agenți/skill-uri care chiar se încarcă, referințe care chiar există, catalog de audituri la zi.
 *
 * Origine: review 2026-10-13 — toate hook-urile citeau `file_path`/`command` din rădăcina
 * JSON-ului (Claude Code le trimite în `tool_input`) sau din `$CLAUDE_TOOL_INPUT` (nu există),
 * deci nu rulau niciodată; 14/15 agenți nu aveau frontmatter (nu se încărcau); CLAUDE.md
 * referea rules/comenzi inexistente; 3 worktree-uri de agent erau comise în repo.
 *
 * Verificări:
 *   1. agents/*.md și skills/<x>/SKILL.md au frontmatter cu `name` + `description`
 *   2. folderele `.claude/` au numele exact pe care Claude Code le caută (agents, nu Agents)
 *   3. hook-urile din settings.json: scriptul există, e executabil, citește `tool_input`
 *   4. nicio urmă de `$CLAUDE_TOOL_INPUT` (variabilă inexistentă)
 *   5. căile din CLAUDE.md (`.claude/...`, `rules/*.md`, `scripts/*.js`, skill-uri) există
 *   6. scripturile din `npm run audit` există; `scripts/AUDITS.md` e la zi
 *   7. `.claude/worktrees/` și `.claude/settings.local.json` nu sunt comise
 *
 * Rulare: node scripts/claude-config-audit.js [--strict]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const CLAUDE = path.join(APP, '.claude');
const STRICT = process.argv.includes('--strict');
const issues = [];
const rel = p => path.relative(APP, p);

function frontmatter(file) {
  const s = fs.readFileSync(file, 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

// 1 + 2. agenți / skill-uri / nume de foldere
const entries = fs.existsSync(CLAUDE) ? fs.readdirSync(CLAUDE) : [];
for (const wrong of ['Agents', 'Skills', 'Rules', 'Commands', 'Hooks']) {
  if (entries.includes(wrong)) {
    issues.push(
      `.claude/${wrong}/ — Claude Code caută .claude/${wrong.toLowerCase()}/ (pe Linux/cloud nu se încarcă)`
    );
  }
}
const agentsDir = path.join(CLAUDE, 'agents');
if (entries.includes('agents')) {
  for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(path.join(agentsDir, f));
    if (!fm || !fm.name || !fm.description) {
      issues.push(
        `.claude/agents/${f} — lipsește frontmatter name/description (agentul nu se încarcă)`
      );
    }
  }
}
const skillsDir = path.join(CLAUDE, 'skills');
if (entries.includes('skills')) {
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    const f = path.join(skillsDir, d.name, 'SKILL.md');
    if (!fs.existsSync(f)) {
      issues.push(`.claude/skills/${d.name}/ — lipsește SKILL.md`);
      continue;
    }
    const fm = frontmatter(f);
    if (!fm || !fm.name || !fm.description) {
      issues.push(`.claude/skills/${d.name}/SKILL.md — lipsește frontmatter name/description`);
    }
  }
}

// 3 + 4. hook-uri
const settingsPath = path.join(CLAUDE, 'settings.json');
if (fs.existsSync(settingsPath)) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    issues.push(
      `.claude/settings.json — JSON invalid (${e instanceof Error ? e.message : 'eroare'}); Claude Code ignoră TOT fișierul`
    );
    settings = {};
  }
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    for (const g of groups) {
      for (const h of g.hooks || []) {
        if (h.type !== 'command') continue;
        if (/CLAUDE_TOOL_INPUT/.test(h.command)) {
          issues.push(
            `settings.json ${event}: folosește $CLAUDE_TOOL_INPUT (nu există — input-ul vine pe stdin)`
          );
        }
        const m = h.command.match(/\.claude\/hooks\/([\w.-]+)/);
        if (!m) continue;
        const script = path.join(CLAUDE, 'hooks', m[1]);
        if (!fs.existsSync(script)) {
          issues.push(`settings.json ${event}: ${rel(script)} nu există`);
          continue;
        }
        if (!(fs.statSync(script).mode & 0o111))
          issues.push(`${rel(script)} nu e executabil (chmod +x)`);
        const src = fs.readFileSync(script, 'utf8');
        if (/CLAUDE_TOOL_INPUT/.test(src))
          issues.push(`${rel(script)}: citește $CLAUDE_TOOL_INPUT (nu există)`);
        const readsRoot =
          /\.get\(\s*['"](file_path|command)['"]/.test(src) ||
          /jq[^|\n]*'\.(file_path|command)\b/.test(src);
        if (readsRoot) {
          issues.push(
            `${rel(script)}: citește file_path/command din rădăcina JSON-ului — sunt în .tool_input`
          );
        }
      }
    }
  }
}

// 5. referințe din CLAUDE.md
const claudeMd = [path.join(CLAUDE, 'CLAUDE.md'), path.join(APP, 'CLAUDE.md')].find(p =>
  fs.existsSync(p)
);
if (!claudeMd) {
  issues.push('CLAUDE.md lipsește (nici .claude/CLAUDE.md, nici CLAUDE.md)');
} else {
  const md = fs.readFileSync(claudeMd, 'utf8');
  const refs = new Set();
  for (const m of md.matchAll(/`([^`\s]+)`/g)) {
    const r = m[1];
    if (r.startsWith('../') || r.includes('*') || r.includes('<') || r.startsWith('http')) continue;
    if (
      /^(\.claude\/|rules\/[\w-]+\.md$|agents\/[\w-]+\.md$|skills\/[\w-]+\/?$|scripts\/[\w./-]+$|components\/ui\/\w+\.tsx$)/.test(
        r
      )
    ) {
      refs.add(r.replace(/\/$/, ''));
    }
  }
  for (const r of refs) {
    const candidates = [path.join(APP, r), path.join(CLAUDE, r)];
    if (!candidates.some(c => fs.existsSync(c)))
      issues.push(`${rel(claudeMd)} referă \`${r}\` — nu există`);
  }
}

// 6. audit scripts
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
for (const m of (pkg.scripts.audit || '').matchAll(/node scripts\/([\w.-]+\.js)/g)) {
  if (!fs.existsSync(path.join(APP, 'scripts', m[1])))
    issues.push(`npm run audit referă scripts/${m[1]} — nu există`);
}
try {
  execSync('node scripts/audit-index.js --check', { cwd: APP, stdio: 'pipe' });
} catch {
  issues.push('scripts/AUDITS.md nu e la zi — rulează: node scripts/audit-index.js');
}

// 7. fișiere care nu trebuie comise
try {
  const tracked = execSync('git ls-files .claude/worktrees .claude/settings.local.json', {
    cwd: APP,
    encoding: 'utf8',
  }).trim();
  if (tracked) {
    issues.push(
      `comise în git (trebuie ignorate): ${[...new Set(tracked.split('\n').map(l => l.split('/').slice(0, 3).join('/')))].join(', ')}`
    );
  }
} catch {
  // nu e repo git (ex. export) — sărim verificarea
}

if (issues.length === 0) {
  console.log('claude-config-audit: OK (hooks, agents, skills, referințe CLAUDE.md, AUDITS.md)');
  process.exit(0);
}
console.log(`claude-config-audit: ${issues.length} problemă(e)\n`);
for (const i of issues) console.log(`  ✗ ${i}`);
process.exit(STRICT ? 1 : 0);
