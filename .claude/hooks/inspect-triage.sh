#!/usr/bin/env bash
# SessionStart hook: surface the scheduled triage routine's latest findings so
# every Claude session starts by inspecting them and brainstorming implementations.
set -u
cd "$(dirname "$0")/../.." || exit 0

DOC="docs/product-vision-and-direction.md"
reviewed="unknown"
risk_rows="?"
if [ -f "$DOC" ]; then
  reviewed=$(sed -n 's/^| Last reviewed | \(.*\) |$/\1/p' "$DOC" | head -1)
  risk_rows=$(grep -c '^| \*\*' "$DOC" 2>/dev/null || echo "?")
fi

# The triage Routine pushes refreshed docs to claude/epic-pasteur* branches;
# an unmerged one means findings newer than the copy on this branch.
branches=$(git branch -r --list '*epic-pasteur*' 2>/dev/null | sed 's/^ *//' | paste -sd ', ' -)

context="SESSION-START TRIAGE INSPECTION (tSearch): Before starting the task, read ${DOC} (last reviewed: ${reviewed:-unknown}; ${risk_rows} risk rows in §4). Unmerged triage branches that may hold fresher findings: ${branches:-none found — consider 'git fetch origin' to check}. Then: (1) brainstorm 2–3 concrete implementations the triage findings suggest, (2) note whether the current task advances or conflicts with any finding, (3) surface anything Critical/High severity (e.g. PII exposure, scoring-correctness bugs) to the user before proceeding."

if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$context" \
    '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
else
  # Fallback: plain stdout is still injected as context for SessionStart hooks.
  printf '%s\n' "$context"
fi
