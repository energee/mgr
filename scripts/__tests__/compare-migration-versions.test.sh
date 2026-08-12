#!/usr/bin/env bash
# Unit tests for scripts/compare-migration-versions.sh — the DB-free
# comparison core of the live-drift watchdog's committed-vs-applied
# migration check (#693). Run via `make check-agent-config` or directly.

set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")/../.." && pwd -P)/scripts/compare-migration-versions.sh
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/compare-migrations-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "expected '$2', got '$1'"
}

run_compare() {
  # Args: committed-lines live-lines. Prints output; returns script's exit code.
  local committed="$TMP_ROOT/committed" live="$TMP_ROOT/live"
  printf '%s' "$1" > "$committed"
  printf '%s' "$2" > "$live"
  bash "$SCRIPT" "$committed" "$live"
}

# 1. Identical version lists: clean pass.
out=$(run_compare $'00001\n00002\n00282\n' $'00001\n00002\n00282\n') \
  || fail "identical lists should exit 0"
printf '%s' "$out" | grep -q '^OK:' || fail "clean run should print OK"

# 2. Committed-but-unapplied version: FAIL (exit 1) listing the version.
rc=0
out=$(run_compare $'00001\n00282\n' $'00001\n') || rc=$?
assert_eq "$rc" "1"
printf '%s' "$out" | grep -q '::error::' || fail "unapplied should emit ::error::"
printf '%s' "$out" | grep -q '00282' || fail "unapplied output should list 00282"
printf '%s' "$out" | grep -q 'db-push.sh' || fail "unapplied output should point at scripts/db-push.sh"

# 3. Live-only version (applied but not in the chain): WARN, exit 0.
out=$(run_compare $'00001\n' $'00001\n00299\n') \
  || fail "live-only versions should WARN, not fail"
printf '%s' "$out" | grep -q '::warning::' || fail "live-only should emit ::warning::"
printf '%s' "$out" | grep -q '00299' || fail "live-only output should list 00299"

# 4. Both classes at once: exit 1, both versions reported.
rc=0
out=$(run_compare $'00001\n00282\n' $'00001\n00299\n') || rc=$?
assert_eq "$rc" "1"
printf '%s' "$out" | grep -q '00282' || fail "mixed output should list unapplied 00282"
printf '%s' "$out" | grep -q '00299' || fail "mixed output should list live-only 00299"

# 5. Blank lines and duplicates are tolerated on both sides.
out=$(run_compare $'00001\n\n00001\n00002\n' $'00002\n00001\n\n') \
  || fail "blank lines/duplicates should not affect the verdict"
printf '%s' "$out" | grep -q '^OK:' || fail "dedup/blank run should print OK"

# 6. Timestamp-style versions (e.g. 20260416162155_remote_applied.sql) compare too.
rc=0
out=$(run_compare $'00001\n20260416162155\n' $'00001\n') || rc=$?
assert_eq "$rc" "1"
printf '%s' "$out" | grep -q '20260416162155' || fail "timestamp version should be listed"

# 7. FAIL results land in GITHUB_STEP_SUMMARY when set.
summary="$TMP_ROOT/summary.md"
: > "$summary"
printf '%s' $'00001\n00282\n' > "$TMP_ROOT/committed"
printf '%s' $'00001\n' > "$TMP_ROOT/live"
rc=0
GITHUB_STEP_SUMMARY="$summary" bash "$SCRIPT" "$TMP_ROOT/committed" "$TMP_ROOT/live" \
  >/dev/null || rc=$?
assert_eq "$rc" "1"
grep -q '00282' "$summary" || fail "step summary should list the unapplied version"

# 8. Usage errors exit 2.
rc=0
bash "$SCRIPT" "$TMP_ROOT/committed" >/dev/null 2>&1 || rc=$?
assert_eq "$rc" "2"
rc=0
bash "$SCRIPT" "$TMP_ROOT/committed" "$TMP_ROOT/does-not-exist" >/dev/null 2>&1 || rc=$?
assert_eq "$rc" "2"

echo "compare-migration-versions tests passed"
