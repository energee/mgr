#!/usr/bin/env bash
# Unit tests for the exit-code contract of scripts/check-live-drift.sh (#855).
#
# The 0/1/2/4 contract (exit 4 = unapplied-migrations-only with a clean
# catalog, #812) has three consumers — scripts/db-push.sh, the live-drift
# workflow, and the script itself — and until this test lived only in
# comments. Each case runs the REAL script (copied into a temp fixture tree,
# since it resolves REPO_ROOT from its own location) against a stubbed psql
# that serves canned catalog/version output, and pins the exit code.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/check-live-drift-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  echo "FAIL: $1" >&2
  [ -s "$TMP_ROOT/err" ] && sed 's/^/  stderr: /' "$TMP_ROOT/err" >&2
  exit 1
}

# --- Fixture: minimal repo tree the script can treat as REPO_ROOT ------------
# live-catalog.sql is NOT copied: the psql stub below never opens the -f file.
FIX="$TMP_ROOT/repo"
mkdir -p "$FIX/scripts" "$FIX/supabase/migrations" "$TMP_ROOT/bin"
cp "$REPO_ROOT/scripts/check-live-drift.sh" \
   "$REPO_ROOT/scripts/compare-migration-versions.sh" "$FIX/scripts/"
touch "$FIX/supabase/migrations/00001_first.sql" \
      "$FIX/supabase/migrations/00002_second.sql"

# psql stub: -f <file> is the catalog query, -c is the schema_migrations
# select; anything else is an invocation shape this stub doesn't know and
# must fail LOUDLY, not fall through to the wrong canned output.
cat > "$TMP_ROOT/bin/psql" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  [ "$arg" = "-f" ] && { cat "$PSQL_CATALOG"; exit 0; }
  [ "$arg" = "-c" ] && { cat "$PSQL_VERSIONS"; exit 0; }
done
echo "stub: unexpected psql invocation: $*" >&2
exit 3
EOF
chmod +x "$TMP_ROOT/bin/psql"

SNAPSHOT="$FIX/supabase/live-catalog.snapshot.txt"
CATALOG="$TMP_ROOT/catalog.txt"
VERSIONS="$TMP_ROOT/versions.txt"

# Each case pipes its full live-catalog contents on stdin — no carried-over
# fixture state between cases.
catalog() { LC_ALL=C sort > "$CATALOG"; }

# expect <code> <label>: run the script (env overridable via DB_URL), assert
# its exit code. TMPDIR is pointed into the fixture for the script's own
# mktemp calls (honored on Linux/CI; macOS mktemp ignores it, where the
# script's EXIT trap still cleans up).
expect() {
  local rc=0
  env PATH="$TMP_ROOT/bin:$PATH" TMPDIR="$TMP_ROOT" \
      SUPABASE_DB_URL="${DB_URL-postgresql://stub}" \
      PSQL_CATALOG="$CATALOG" PSQL_VERSIONS="$VERSIONS" \
      GITHUB_STEP_SUMMARY= \
      bash "$FIX/scripts/check-live-drift.sh" >/dev/null 2>"$TMP_ROOT/err" || rc=$?
  [ "$rc" -eq "$1" ] || fail "$2: expected exit $1, got $rc"
}

# 1. Clean: catalog matches snapshot, every committed migration applied.
catalog <<'EOF'
CHECK|orders|orders_status_check|aaaa
FUNC|do_thing()|bbbb
TABLE|orders
EOF
cp "$CATALOG" "$SNAPSHOT"
printf '00001\n00002\n' > "$VERSIONS"
expect 0 "clean run"

# 2. The #812 seam: catalog fully clean but a committed migration is
#    unapplied on live — the normal pre-push state → exit 4, not 1.
printf '00001\n' > "$VERSIONS"
expect 4 "unapplied-migrations-only"

# 3. Same unapplied migration PLUS a live-only catalog addition: any catalog
#    delta keeps the hard exit 1 so the pre-push gate still stops and asks.
catalog <<'EOF'
CHECK|orders|orders_status_check|aaaa
FUNC|do_thing()|bbbb
TABLE|orders
TRIG|orders|new_trigger|cccc
EOF
expect 1 "unapplied + catalog additions"

# 4. Additions only, migrations all applied → WARN, exit 0.
printf '00001\n00002\n' > "$VERSIONS"
expect 0 "additions-only WARN"

# 5. A snapshot line missing on live (dropped/changed object) → exit 1.
catalog <<'EOF'
CHECK|orders|orders_status_check|aaaa
TABLE|orders
EOF
expect 1 "missing expected object"

# 6. Usage errors → exit 2: no SUPABASE_DB_URL; empty live catalog;
#    unsorted snapshot (bad merge).
DB_URL= expect 2 "missing SUPABASE_DB_URL"
: > "$CATALOG"
expect 2 "empty live catalog"
catalog <<'EOF'
TABLE|orders
EOF
printf 'TABLE|orders\nCHECK|out|of|order\n' > "$SNAPSHOT"
expect 2 "unsorted snapshot"

echo "check-live-drift tests passed"
