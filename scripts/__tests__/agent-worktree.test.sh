#!/usr/bin/env bash

set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")/../.." && pwd -P)/scripts/agent-worktree
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/agent-worktree-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "expected '$2', got '$1'"
}

REPO="$TMP_ROOT/source"
SHARED="$TMP_ROOT/shared"
mkdir -p "$REPO" "$SHARED"
SHARED=$(cd "$SHARED" && pwd -P)
git -C "$REPO" init -b main >/dev/null
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Worktree Test"
printf '# test repository\n' > "$REPO/README.md"
printf '.env.local\n' > "$REPO/.gitignore"
printf '.env.local\n' > "$REPO/.worktreeinclude"
git -C "$REPO" add README.md .gitignore .worktreeinclude
git -C "$REPO" commit -m initial >/dev/null
printf 'TEST_SECRET=local-only\n' > "$REPO/.env.local"

run_manager() {
  AGENT_WORKTREE_ROOT="$SHARED" "$SCRIPT" "$@"
}

cd "$REPO"

alpha=$(run_manager create alpha --base HEAD)
assert_eq "$alpha" "$SHARED/source/alpha"
[[ -d "$alpha" ]] || fail "alpha worktree was not created"
assert_eq "$(git -C "$alpha" branch --show-current)" "agent/alpha"
[[ -f "$alpha/.env.local" ]] || fail ".worktreeinclude file was not copied"
assert_eq "$(run_manager create alpha --base HEAD)" "$alpha"
if run_manager create alpha --base HEAD --branch feat/different >/dev/null 2>&1; then
  fail "existing worktree was reused for a different requested branch"
fi
assert_eq "$(git -C "$alpha" branch --show-current)" "agent/alpha"
assert_eq "$(run_manager path alpha)" "$alpha"
run_manager list | grep -Fq "$alpha" || fail "list did not include alpha"

if run_manager create 'Bad/Name' --base HEAD >/dev/null 2>&1; then
  fail "invalid worktree name was accepted"
fi
if run_manager create protected --base HEAD --branch main >/dev/null 2>&1; then
  fail "protected branch was accepted"
fi

claude=$(printf '{"name":"claude-task"}\n' | run_manager create-from-claude)
assert_eq "$claude" "$SHARED/source/claude-task"

linked=$(cd "$alpha" && AGENT_WORKTREE_ROOT="$SHARED" "$SCRIPT" create from-linked --base HEAD)
assert_eq "$linked" "$SHARED/source/from-linked"
assert_eq "$(git -C "$linked" branch --show-current)" "agent/from-linked"
run_manager remove from-linked

printf 'dirty\n' > "$alpha/dirty.txt"
if run_manager remove alpha >/dev/null 2>&1; then
  fail "dirty worktree was removed without --force"
fi
rm "$alpha/dirty.txt"
run_manager remove alpha
[[ ! -e "$alpha" ]] || fail "clean worktree was not removed"

run_manager doctor | grep -Fq 'OK:' || fail "doctor did not pass for shared worktrees"

git -C "$REPO" worktree add -b agent/rogue "$TMP_ROOT/rogue" HEAD >/dev/null
if run_manager doctor >/dev/null 2>&1; then
  fail "doctor accepted a worktree outside the shared root"
fi
git -C "$REPO" worktree remove "$TMP_ROOT/rogue"

run_manager remove claude-task
run_manager doctor | grep -Fq 'OK:' || fail "doctor did not pass after cleanup"

printf 'OK: agent-worktree tests passed\n'
