#!/usr/bin/env bash
# PreToolUse (Bash): cere confirmare explicită pentru comenzi distructive, chiar dacă
# allow-list-ul le-ar aproba (ex. `Bash(git:*)`). Dublează regulile `permissions.ask`
# din settings.json — hook-ul prinde și variantele din comenzi compuse / subshell-uri.
#
# Stdin: JSON-ul hook-ului — comanda e în .tool_input.command.
# Output: permissionDecision "ask" + motiv; tăcut altfel.

set -u

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$cmd" ] || exit 0

pattern='rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r|git[[:space:]]+push[^|;&]*(--force|[[:space:]]-f([[:space:]]|$))|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f|git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.|git[[:space:]]+branch[[:space:]]+-D|DROP[[:space:]]+(TABLE|DATABASE)'

if printf '%s' "$cmd" | grep -qiE "$pattern"; then
  jq -n --arg reason "Comandă distructivă detectată — confirmă explicit: $(printf '%s' "$cmd" | head -c 200)" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $reason}}'
fi
exit 0
