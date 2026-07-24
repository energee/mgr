#!/usr/bin/env bash
# scripts/check-progress-drift.sh — Stop hook helper.
#
# Emits a JSON systemMessage if code changed in this session but no
# docs/progress/YYYY-MM-DD-*.md entry was added. PROGRESS.md itself is
# generated on main (AGENTS.md hard constraint 18) and must never be
# edited on a branch — sessions record progress by ADDING one file under
# docs/progress/. Wired in via .claude/settings.json.
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

# Include work already committed on this branch (vs upstream, falling back to
# origin/main). Without this, a session that commits all of its work before
# the Stop hook fires would bypass the check entirely.
BASE="$(git merge-base HEAD '@{upstream}' 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || true)"
COMMITTED=""
if [ -n "$BASE" ]; then
  COMMITTED="$(git diff --name-only "$BASE" HEAD 2>/dev/null | grep -v '^supabase/.temp/' || true)"
fi

ALL_CHANGES="$(printf '%s\n%s\n%s\n%s\n' "$DIRTY" "$STAGED" "$UNTRACKED" "$COMMITTED" | sort -u | sed '/^$/d')"

[ -z "$ALL_CHANGES" ] && exit 0

# Pass when the session's changes include a docs/progress/ entry file
# (constraint 18: add docs/progress/YYYY-MM-DD-slug.md; never touch
# PROGRESS.md on a branch — CI regenerates it on main).
if echo "$ALL_CHANGES" | grep -qE '^docs/progress/[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.md$'; then
  exit 0
fi

# Code changed but no progress entry was added. Count meaningful files.
COUNT=$(echo "$ALL_CHANGES" | grep -cE '\.(ts|tsx|js|jsx|sql|md|json|sh)$' || true)
[ "$COUNT" -lt 1 ] && exit 0

# Emit a system message back to the user.
printf '{"systemMessage": "Reminder: %d files changed this session but no docs/progress/ entry was added. Add docs/progress/YYYY-MM-DD-slug.md (one - **date (title).** bullet) before /clear or push. Do NOT edit PROGRESS.md on a branch — it is generated on main (AGENTS.md hard constraint 18)."}\n' "$COUNT"