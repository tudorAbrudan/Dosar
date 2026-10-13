---
date: 2026-10-13
tags: [claude-code, hooks, tooling, regression]
trigger: când scrii sau modifici un hook în .claude/settings.json sau .claude/hooks/
---

# Hook-urile Claude Code citesc `tool_input`, nu rădăcina JSON-ului

**Problemă:** Luni de zile niciun hook nu a rulat efectiv: guard-ul de comenzi distructive, `tsc` după edit, avertismentul `.env` și backup-audit-hook. Scripturile citeau `d.get('command')` / `d.get('file_path')` din rădăcina JSON-ului sau `$CLAUDE_TOOL_INPUT` (variabilă care nu există) → mereu șir gol → `exit 0`. Guard-ul făcea în plus `exit 1`, care oricum nu blochează. Combinat cu `Bash(git:*)` în allow-list, `git reset --hard` nu avea nicio plasă.

**Cauză:** hook-urile au fost scrise după presupuneri despre formatul input-ului și nu au fost testate niciodată cu un payload real. Faptul că „nu se plângeau" arăta ca succes.

**Regulă:**
- Input-ul vine pe **stdin**: `{"tool_name": …, "tool_input": {"command"|"file_path": …}}` → `jq -r '.tool_input.file_path // empty'`.
- Pentru blocare: PreToolUse → JSON `hookSpecificOutput.permissionDecision` (`ask`/`deny`); Stop → `{"decision":"block","reason":…}`; `exit 1` NU blochează.
- Folosește `$CLAUDE_PROJECT_DIR`, nu căi absolute.
- Orice hook nou se testează cu pipe: `echo '{"tool_name":"Edit","tool_input":{"file_path":"<fișier real>"}}' | .claude/hooks/x.sh` — cazul pozitiv ȘI cel negativ.

**Aplicabil:** plasa automată e `scripts/claude-config-audit.js --strict` (în `npm run audit` + pre-commit): flag-uiește `$CLAUDE_TOOL_INPUT`, citiri din rădăcina JSON-ului, scripturi lipsă/neexecutabile, agenți fără frontmatter, referințe moarte în CLAUDE.md.
