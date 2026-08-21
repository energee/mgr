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

fail() { echo "FAIL: $1" >&2; exit 1; }

# --- Fixture: minimal repo tree the script can treat as REPO_ROOT ------------
FIX="$TMP_ROOT/repo"
mkdir -p "$FIX/scripts" "$FIX/supabase/migrations" "$TMP_ROOT/bin"
cp "$REPO_ROOT/scripts/check-live-drift.sh" \
   "$REPO_ROOT/scripts/compare-migration-versions.sh" \
   "$REPO_ROOT/scripts/live-catalog.sql" "$FIX/scripts/"
touch "$FIX/supabase/migrations/00001_first.sql" \
      "$FIX/supabase/migrations/00002_second.sql"

# psql stub: -f <file> is the catalog query, -c is the schema_migrations
# select. Output is driven by the fixture files the test writes per case.
cat > "$TMP_ROOT/bin/psql" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  [ "$arg" = "-f" ] && { cat "$PSQL_CATALOG"; exit 0; }
done
cat "$PSQL_VERSIONS"
EOF
chmod +x "$TMP_ROOT/bin/psql"

SNAPSHOT="$FIX/supabase/live-catalog.snapshot.txt"
CATALOG="$TMP_ROOT/catalog.txt"
VERSIONS="$TMP_ROOT/versions.txt"

run_drift() { # -> sets rc
  rc=0
  env PATH="$TMP_ROOT/bin:$PATH" TMPDIR="$TMP_ROOT" \
      SUPABASE_DB_URL='postgresql://stub' \
      PSQL_CATALOG="$CATALOG" PSQL_VERSIONS="$VERSIONS" \
      GITHUB_STEP_SUMMARY= \
      bash "$FIX/scripts/check-live-drift.sh" >/dev/null 2>&1 || rc=$?
}

baseline_catalog() {
  LC_ALL=C sort > "$CATALOG" <<'EOF'
CHECK|orders|orders_status_check|aaaa
FUNC|do_thing()|bbbb
TABLE|orders
EOF
}

# 1. Clean: catalog matches snapshot, every committed migration applied → 0.
baseline_catalog
cp "$CATALOG" "$SNAPSHOT"
printf '00001\n00002\n' > "$VERSIONS"
run_drift
[ "$rc" -eq 0 ] || fail "clean run should exit 0, got $rc"

# 2. The #812 seam: catalog fully clean but a committed migration is
#    unapplied on live — the normal pre-push state → exit 4, not 1.
printf '00001\n' > "$VERSIONS"
run_drift
[ "$rc" -eq 4 ] || fail "unapplied-migrations-only should exit 4, got $rc"

# 3. Same unapplied migration PLUS a live-only catalog addition: any catalog
#    delta keeps the hard exit 1 so the pre-push gate still stops and asks.
{ baseline_catalog; echo 'TRIG|orders|new_trigger|cccc' >> "$CATALOG"; }
LC_ALL=C sort -o "$CATALOG" "$CATALOG"
run_drift
[ "$rc" -eq 1 ] || fail "unapplied + catalog additions should exit 1, got $rc"

# 4. Additions only, migrations all applied → WARN, exit 0.
printf '00001\n00002\n' > "$VERSIONS"
run_drift
[ "$rc" -eq 0 ] || fail "additions-only WARN should exit 0, got $rc"

# 5. A snapshot line missing on live (dropped/changed object) → exit 1.
baseline_catalog
grep -v '^FUNC' "$CATALOG" > "$CATALOG.tmp" && mv "$CATALOG.tmp" "$CATALOG"
run_drift
[ "$rc" -eq 1 ] || fail "missing expected object should exit 1, got $rc"

# 6. No SUPABASE_DB_URL → usage error, exit 2.
rc=0
env PATH="$TMP_ROOT/bin:$PATH" TMPDIR="$TMP_ROOT" SUPABASE_DB_URL= \
    bash "$FIX/scripts/check-live-drift.sh" >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] || fail "missing SUPABASE_DB_URL should exit 2, got $rc"

echo "check-live-drift tests passed"
