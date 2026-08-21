#!/usr/bin/env bash
# Unit tests for scripts/hooks/pr-review-gate.sh (#786): worktree-local
# sentinel resolution, heredoc immunity, and one-shot consumption.
set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")/../.." && pwd -P)/scripts/hooks/pr-review-gate.sh
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/pr-review-gate-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

payload() { # $1=cwd $2=command
  jq -n --arg cwd "$1" --arg cmd "$2" '{cwd: $cwd, tool_input: {command: $cmd}}'
}

run_gate() { # $1=mode $2=cwd $3=command -> stdout
  payload "$2" "$3" | env -u GITHUB_ACTIONS bash "$SCRIPT" "$1"
}

# --- Fixture: a repo with one linked worktree --------------------------------
REPO="$TMP_ROOT/repo"
git init -q "$REPO"
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m initial
git -C "$REPO" worktree add -q "$TMP_ROOT/wt" -b wt-branch

MAIN_GITDIR="$REPO/.git"
WT_GITDIR="$(git -C "$TMP_ROOT/wt" rev-parse --absolute-git-dir)"

# 1. No sentinel → deny.
out=$(run_gate check "$REPO" "gh pr create --title x")
grep -q '"permissionDecision":"deny"' <<<"$out" || fail "expected deny without sentinel"

# 2. Sentinel in the cwd's git-dir → allow.
touch "$MAIN_GITDIR/pr-review-ok"
out=$(run_gate check "$REPO" "gh pr create --title x")
[ -z "$out" ] || fail "expected allow with main sentinel from main cwd"

# 3. Main sentinel must NOT satisfy a worktree's gate.
out=$(run_gate check "$TMP_ROOT/wt" "gh pr create --title x")
grep -q '"permissionDecision":"deny"' <<<"$out" || fail "main sentinel satisfied worktree gate"

# 4. Worktree sentinel (documented command, run in the worktree) satisfies it.
( cd "$TMP_ROOT/wt" && touch "$(git rev-parse --git-dir)/pr-review-ok" )
out=$(run_gate check "$TMP_ROOT/wt" "gh pr create --title x")
[ -z "$out" ] || fail "worktree sentinel did not satisfy its own gate"

# 5. `gh pr create` inside a heredoc body is data, not a gated command.
rm -f "$MAIN_GITDIR/pr-review-ok" "$WT_GITDIR/pr-review-ok"
heredoc_cmd=$(printf '%s\n' \
  'gh issue comment 1 --body "$(cat <<'"'"'EOF'"'"'' \
  'To open a PR run:' \
  'gh pr create --fill' \
  'EOF' \
  ')"')
out=$(run_gate check "$REPO" "$heredoc_cmd")
[ -z "$out" ] || fail "heredoc-quoted gh pr create tripped the gate"

# 6. Unrelated commands pass through.
out=$(run_gate check "$REPO" "git status")
[ -z "$out" ] || fail "unrelated command tripped the gate"

# 6b. The phrase inside a quoted string is data, not a gated command.
out=$(run_gate check "$REPO" 'echo "how to: gh pr create --fill"')
[ -z "$out" ] || fail "quoted gh pr create tripped the gate"

# 7. A real `gh pr create` after a heredoc still gates.
gated_cmd=$(printf '%s\n' "$heredoc_cmd" 'gh pr create --fill')
out=$(run_gate check "$REPO" "$gated_cmd")
grep -q '"permissionDecision":"deny"' <<<"$out" || fail "post-heredoc gh pr create not gated"

# 8. Consume removes the sentinel of the invoking checkout only.
touch "$MAIN_GITDIR/pr-review-ok" "$WT_GITDIR/pr-review-ok"
run_gate consume "$TMP_ROOT/wt" "gh pr create --fill" >/dev/null
[ ! -f "$WT_GITDIR/pr-review-ok" ] || fail "consume left the worktree sentinel"
[ -f "$MAIN_GITDIR/pr-review-ok" ] || fail "consume removed the wrong sentinel"

# 9. GITHUB_ACTIONS exempts the check.
out=$(payload "$REPO" "gh pr create" | GITHUB_ACTIONS=true bash "$SCRIPT" check)
[ -z "$out" ] || fail "CI run was not exempt"

echo "pr-review-gate tests passed"
