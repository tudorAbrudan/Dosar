#!/usr/bin/env bash
# PostToolUse (Edit|Write): prettier + eslint --fix pe fișierul .ts/.tsx editat.
#
# Stdin: JSON-ul hook-ului — calea e în .tool_input.file_path (NU la rădăcina JSON-ului).
# Exit: mereu 0 (formatare, nu blocare). Type-check-ul rulează o dată pe tură, în stop-gate.sh.

set -u

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/*|*/ios/*|*/android/*|*/.worktrees/*) exit 0 ;;
esac
[ -f "$file" ] || exit 0

app="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$app" || exit 0

node_modules/.bin/prettier --write --log-level silent "$file" >/dev/null 2>&1 || true
node_modules/.bin/eslint --fix --quiet "$file" >/dev/null 2>&1 || true
exit 0
