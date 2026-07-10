#!/usr/bin/env bash
# scripts/check-live-drift.sh
#
# Compares the LIVE database catalog against the committed snapshot in
# supabase/live-catalog.snapshot.txt and classifies the delta:
#
#   FAIL (exit 1)  — a snapshot line is missing on live: an expected object
#                    was dropped or edited out-of-band (the C2/C3 class of
#                    bug: enforcement functions/triggers removed while the
#                    migration rows still read as applied, so db push is a
#                    clean no-op and nothing else notices).
#   WARN (exit 0)  — live has lines the snapshot lacks, and nothing expected
#                    is missing: usually an in-flight feature branch applied
#                    to live before merge, or a merged migration whose
#                    snapshot update was not committed.
#
# What it compares (see scripts/live-catalog.sql): every public function
# (name + identity args + body hash), every non-internal trigger (name + table
# + definition hash), and every base table. A body-hash change catches an
# out-of-band CREATE OR REPLACE (e.g. a racy generate_lot_number swapped in),
# not just adds/drops. A changed object appears on both sides of the delta
# (old line missing, new line added); the missing side fails the run.
#
# The snapshot is the expected live state. When a migration intentionally
# changes the catalog, regenerate it AFTER applying the migration to live —
# scripts/db-push.sh does both in one step — or manually:
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

# Both files are LC_ALL=C sorted, so comm(1) splits the delta cleanly.
missing="$(LC_ALL=C comm -23 "$SNAPSHOT" "$current")"
added="$(LC_ALL=C comm -13 "$SNAPSHOT" "$current")"

if [[ -z "$missing" && -z "$added" ]]; then
  echo "OK: live database catalog matches supabase/live-catalog.snapshot.txt."
  exit 0
fi

if [[ -n "$missing" ]]; then
  echo "::error::Live database has DRIFTED from supabase/live-catalog.snapshot.txt: expected objects are missing or changed on live (C2/C3 class)."
  echo ""
  echo "Expected (in snapshot) but missing/changed on live:"
  echo "$missing" | sed 's/^/  < /'
  if [[ -n "$added" ]]; then
    echo ""
    echo "Live-only lines (new versions of changed objects, or unrelated additions):"
    echo "$added" | sed 's/^/  > /'
  fi
  echo ""
  echo "If this is a legitimate change, apply the migration to live and regenerate"
  echo "the snapshot (scripts/db-push.sh does both), then commit"
  echo "supabase/live-catalog.snapshot.txt. Otherwise: restore the object on live."
  exit 1
fi

echo "::warning::Live database has objects not in supabase/live-catalog.snapshot.txt (additions only — nothing expected is missing)."
echo ""
echo "$added" | sed 's/^/  > /'
echo ""
echo "Usually an in-flight feature branch applied to live before merge (fine), or"
echo "a merged migration whose snapshot update was never committed — if so run:"
echo "  SUPABASE_DB_URL=... bash scripts/check-live-drift.sh --update"
echo "and commit supabase/live-catalog.snapshot.txt."
exit 0
