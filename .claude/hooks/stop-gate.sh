#!/usr/bin/env bash
# Stop: poarta „Definition of Done" — rulează o singură dată la final de tură
# (nu după fiecare edit; tsc durează ~8s pe proiect).
#
# Dacă în working tree există modificări .ts/.tsx și type-check-ul sau backup-audit pică,
# blochează oprirea și îi trimite lui Claude erorile, ca să le repare înainte de „gata".
# `stop_hook_active` = true înseamnă că am blocat deja o dată în tura asta → lasă-l să se
# oprească (evită bucla infinită când eroarea nu poate fi reparată automat).

set -u

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0

app="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$app" || exit 0

# Nimic TS modificat față de HEAD (tracked sau untracked) → nimic de verificat.
changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null \
  | grep -E '\.(ts|tsx)$' | grep -vE '^(\.worktrees|\.claude/worktrees)/' | head -1)
[ -n "$changed" ] || exit 0

problems=""
if ! out=$(node_modules/.bin/tsc --noEmit 2>&1); then
  problems+="type-check pică:
$(printf '%s\n' "$out" | head -30)

"
fi
if ! out=$(node scripts/backup-audit.js --strict 2>&1); then
  problems+="backup-audit --strict pică:
$(printf '%s\n' "$out" | tail -20)
"
fi

if [ -n "$problems" ]; then
  jq -n --arg reason "Poarta Definition of Done (stop-gate.sh) a găsit probleme. Repară-le, sau spune explicit userului de ce nu se pot repara acum:

$problems" '{decision: "block", reason: $reason}'
fi
exit 0
