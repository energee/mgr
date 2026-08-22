#!/usr/bin/env bash
# Unit tests for scripts/check-migration-numbers.sh: the exit-code contract
# `make check-db` and CI depend on. A guard that cannot fail is not a guard,
# and one that reports success over an empty directory is worse than none.
set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")/../.." && pwd -P)/scripts/check-migration-numbers.sh
TMP=$(mktemp -d "${TMPDIR:-/tmp}/migration-numbers-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

rc() { bash "$SCRIPT" "$1" >/dev/null 2>&1 && echo 0 || echo $?; }

mkdir -p "$TMP/unique" "$TMP/dupes" "$TMP/empty"
touch "$TMP/unique/00001_a.sql" "$TMP/unique/00002_b.sql"
touch "$TMP/dupes/00297_a.sql" "$TMP/dupes/00297_b.sql"

[ "$(rc "$TMP/unique")" = 0 ] || fail "unique prefixes should exit 0"
[ "$(rc "$TMP/dupes")" = 1 ] || fail "duplicate prefixes should exit 1"
[ "$(rc "$TMP/empty")" = 1 ] || fail "an empty directory should exit 1, not report clean"

# The real tree must pass — this is the check CI actually runs.
[ "$(rc "$(cd "$(dirname "$0")/../.." && pwd -P)/supabase/migrations")" = 0 ] \
  || fail "supabase/migrations/ has duplicate version prefixes"

echo "OK: check-migration-numbers tests passed"
