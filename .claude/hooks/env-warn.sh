#!/usr/bin/env bash
# PreToolUse (Edit|Write): avertizează la editarea fișierelor .env (repo-ul e PUBLIC).
#
# Stdin: JSON-ul hook-ului — calea e în .tool_input.file_path.

set -u

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$(basename "$file")" in
  .env|.env.*)
    jq -n '{systemMessage: "Editezi un fișier .env — repo-ul Dosar e PUBLIC; nu comite chei. Cheile AI stau în ai-proxy/, nu în EXPO_PUBLIC_*."}'
    ;;
esac
exit 0
