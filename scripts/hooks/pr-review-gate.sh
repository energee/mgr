#!/usr/bin/env bash
# scripts/hooks/pr-review-gate.sh — the pre-PR review gate (#786), called from
# .claude/settings.json as a PreToolUse (mode `check`) / PostToolUse (mode
# `consume`) Bash hook. Reads the Claude Code hook JSON on stdin.
#
#   check    deny `gh pr create` until <git-dir>/pr-review-ok exists
#   consume  remove the sentinel after a `gh pr create` runs (one-shot per PR)
#
# Fixes the three #786 failure modes of the previous inline hook:
#   1. The sentinel git-dir is resolved from the hook payload's `cwd` — the
#      checkout the command actually runs in — so a worktree agent's documented
#      `touch $(git rev-parse --git-dir)/pr-review-ok` works verbatim, and one
#      agent's sentinel cannot satisfy a different worktree's gate.
#   2. The deny message states the touch must be its own command.
#   3. Heredoc bodies are stripped before matching, so a PR-creation command
#      quoted as data (issue comments, doc edits, echo) no longer trips it.
set -euo pipefail

mode="${1:?usage: pr-review-gate.sh check|consume}"

# CI runs (claude.yml etc.) are exempt, as before. Drain stdin so the
# payload writer never sees SIGPIPE.
if [[ "$mode" == "check" && -n "${GITHUB_ACTIONS:-}" ]]; then
  cat > /dev/null
  exit 0
fi

input="$(cat)"

# Fast path: this hook fires on EVERY Bash tool call (pre and post). A cheap
# builtin glob over the raw payload bails before spawning jq/awk/sed/grep for
# the vast majority of commands; a false positive here only means the full
# parse below runs.
case "$input" in
  *gh*pr*create*) ;;
  *) exit 0 ;;
esac

# One jq call for both fields: first line is cwd, the rest is the command.
parsed="$(jq -r '(.cwd // ""), (.tool_input.command // "")' <<<"$input")"
cwd="${parsed%%$'\n'*}"
cmd="${parsed#*$'\n'}"

# Drop heredoc bodies: everything between `<<TERM` (any quoting, optional -)
# and the line that is exactly TERM is data, not a command to gate on.
stripped="$(awk '
  skip { if ($0 == term) skip = 0; next }
  {
    print
    if (match($0, /<<-?[ \t]*['\''"]?[A-Za-z_][A-Za-z0-9_]*/)) {
      term = substr($0, RSTART, RLENGTH)
      sub(/^<<-?[ \t]*['\''"]?/, "", term)
      skip = 1
    }
  }
' <<<"$cmd")"

# Then drop single/double-quoted spans (per line): `echo "gh pr create"` is
# data too. A real invocation survives — its own tokens are never quoted.
stripped="$(sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g' <<<"$stripped")"

grep -qE '(^|[;&|] *)gh +pr +create' <<<"$stripped" || exit 0

# Git dir of the checkout the command runs in. Falls back to the hook's own
# cwd; fails open (like the previous inline hook) when neither is a repo.
gitdir="$( (cd "${cwd:-.}" 2>/dev/null && git rev-parse --absolute-git-dir 2>/dev/null) || true )"
[[ -n "$gitdir" ]] || gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
[[ -n "$gitdir" ]] || exit 0

if [[ "$mode" == "consume" ]]; then
  rm -f "$gitdir/pr-review-ok"
  exit 0
fi

if [[ ! -f "$gitdir/pr-review-ok" ]]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Pre-PR gate: run /simplify and /code-review on this branch first, then run: touch $(git rev-parse --git-dir)/pr-review-ok — as its OWN Bash command, from the checkout the PR is opened from (a worktree resolves to its own git-dir and that is the one this gate checks). The gate inspects the whole command string BEFORE any of it runs, so `touch ... && gh pr create` is always denied. Then retry gh pr create as a separate command."}}'
fi
exit 0
