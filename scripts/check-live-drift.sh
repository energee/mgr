#!/usr/bin/env bash
# scripts/check-live-drift.sh
#
# Fails (exit 1) if the LIVE database catalog has drifted from the committed
# snapshot in supabase/live-catalog.snapshot.txt. Catches the C2/C3 class of
# bug: enforcement functions/triggers dropped out-of-band on live while the
# migration rows still read as applied (db push is a no-op), so nothing else
# notices.
#
# What it compares (see scripts/live-catalog.sql): every public function
# (name + identity args + body hash), every non-internal trigger (name + table
# + definition hash), and every base table. A body-hash change catches an
# out-of-band CREATE OR REPLACE (e.g. a racy generate_lot_number swapped in),
# not just adds/drops.
#
# The snapshot is the expected live state. When a migration intentionally
# changes the catalog, regenerate it AFTER applying the migration to live:
#
#     SUPABASE_DB_URL='postgresql://readonly:***@db.<ref>.supabase.co:5432/postgres' \
#       bash scripts/check-live-drift.sh --update
#
# and commit the updated snapshot in the same PR.
#
# Requires: psql (postgresql-client). Read-only: issues SELECTs against
# pg_catalog only. $SUPABASE_DB_URL should point at a read-only role.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SNAPSHOT="supabase/live-catalog.snapshot.txt"
QUERY="scripts/live-catalog.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not installed (apt-get install -y postgresql-client)." >&2
  exit 2
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set. Provide a read-only connection string" >&2
  echo "       to the live database (CI: the SUPABASE_DB_URL repository secret)." >&2
  exit 2
fi

# Dump the current live catalog. ORDER BY in the SQL is C-collation; the extra
# LC_ALL=C sort is a belt-and-suspenders no-op that guarantees byte-stable order
# on any runner.
current="$(mktemp)"
trap 'rm -f "$current"' EXIT
psql "$SUPABASE_DB_URL" -tA --no-psqlrc -v ON_ERROR_STOP=1 -f "$QUERY" \
  | LC_ALL=C sort > "$current"

if [[ ! -s "$current" ]]; then
  echo "ERROR: live catalog query returned no rows — check the connection/credentials." >&2
  exit 2
fi

if [[ "${1:-}" == "--update" ]]; then
  cp "$current" "$SNAPSHOT"
  echo "Updated $SNAPSHOT ($(wc -l < "$SNAPSHOT" | tr -d ' ') objects)."
  exit 0
fi

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "ERROR: $SNAPSHOT missing. Generate it with: $0 --update" >&2
  exit 2
fi

# diff exits 1 on differences. '<' lines are in the snapshot but not live
# (dropped/changed on live = drift); '>' lines are on live but not the snapshot
# (added out-of-band, or a migration whose snapshot update was not committed).
if diff_out="$(LC_ALL=C diff "$SNAPSHOT" "$current")"; then
  echo "OK: live database catalog matches supabase/live-catalog.snapshot.txt."
  exit 0
fi

echo "::error::Live database has DRIFTED from the migration chain (supabase/live-catalog.snapshot.txt)."
echo ""
echo "  '<' = expected (in snapshot) but MISSING/CHANGED on live  -> likely an out-of-band drop/edit (C2/C3 class)"
echo "  '>' = present on live but NOT in the snapshot            -> a migration landed without regenerating the snapshot"
echo ""
echo "$diff_out"
echo ""
echo "If this drift is from a legitimate migration, regenerate the snapshot after"
echo "applying it to live:  SUPABASE_DB_URL=... bash scripts/check-live-drift.sh --update"
echo "and commit supabase/live-catalog.snapshot.txt in the same PR."
exit 1
