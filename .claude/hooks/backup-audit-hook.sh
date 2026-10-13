#!/usr/bin/env bash
# PostToolUse (Edit|Write): rulează auditul de backup când e editat un fișier care
# influențează backup-ul. Tăcut dacă e sincron; altfel injectează raportul în contextul
# lui Claude (additionalContext), ca să-l repare în aceeași tură.
#
# Stdin: JSON-ul hook-ului — calea e în .tool_input.file_path.
# Exit: mereu 0 (avertisment, nu blocare — blocarea o face stop-gate.sh la final de tură).

set -u

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)

case "$file" in
  *services/db.ts|*services/backup.ts|*services/cloudSync.ts|\
  *services/entities.ts|*services/documents.ts|*services/fuel.ts|\
  *services/maintenance.ts) ;;
  *) exit 0 ;;
esac

app="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$app" || exit 0

report=$(node scripts/backup-audit.js 2>/dev/null || true)
if echo "$report" | grep -q 'DESINCRONIZAT'; then
  msg="BACKUP DESINCRONIZAT după editarea $(basename "$file") — repară înainte de final (vezi agentul backup-guardian):
$(echo "$report" | head -40)"
  jq -n --arg ctx "$msg" \
    '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
fi
exit 0
