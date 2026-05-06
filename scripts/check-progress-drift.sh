#!/usr/bin/env bash
# scripts/check-progress-drift.sh — Stop hook helper.
#
# Emits a JSON systemMessage if code changed in this session but
# PROGRESS.md was not updated. Wired in via .claude/settings.json.
#
# Output is JSON on stdout, consumed by Claude Code's hook runtime.
# See: docs/agents/observability.md, AGENTS.md "Landing the Plane".

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" || exit 0

# Files modified vs HEAD, excluding incidental supabase CLI version stamps.
DIRTY="$(git diff --name-only HEAD 2>/dev/null | grep -v '^supabase/.temp/' || true)"

# Also include staged + untracked (the user may have staged but not committed).
STAGED="$(git diff --cached --name-only 2>/dev/null || true)"
UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

ALL_CHANGES="$(printf '%s\n%s\n%s\n' "$DIRTY" "$STAGED" "$UNTRACKED" | sort -u | sed '/^$/d')"

[ -z "$ALL_CHANGES" ] && exit 0

# Was PROGRESS.md among them?
if echo "$ALL_CHANGES" | grep -qx 'PROGRESS\.md'; then
  exit 0
fi

# Code changed but PROGRESS.md didn't. Count meaningful files.
COUNT=$(echo "$ALL_CHANGES" | grep -cE '\.(ts|tsx|js|jsx|sql|md|json|sh)$' || true)
[ "$COUNT" -lt 1 ] && exit 0

# Emit a system message back to the user.
printf '{"systemMessage": "Reminder: %d files changed but PROGRESS.md was not updated. Update it before /clear or push to keep cross-session continuity (AGENTS.md → Landing the Plane)."}\n' "$COUNT"
