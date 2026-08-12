#!/usr/bin/env bash
# scripts/compare-migration-versions.sh
#
# Pure comparison core for the live-drift watchdog's committed-vs-applied
# migration check (#693). Takes two files of migration versions (one per
# line; blank lines and duplicates tolerated) and classifies the delta:
#
#   FAIL (exit 1) — a committed version is absent from live: a migration
#                   exists in supabase/migrations/ but was never applied
#                   (the #693/#440 class of gap — both the live catalog and
#                   the committed snapshot are post-apply artifacts, so they
#                   agree and nothing else notices).
#   WARN (exit 0) — live has versions the chain lacks: usually an in-flight
#                   feature branch applied to live before merge. Consistent
#                   with the watchdog's missing=FAIL / additions=WARN
#                   philosophy (see scripts/check-live-drift.sh).
#   exit 2        — usage error.
#
# Deliberately takes plain version lists rather than querying anything, so
# the logic is unit-testable without a database
# (scripts/__tests__/compare-migration-versions.test.sh).
# WARN/FAIL results are also appended to $GITHUB_STEP_SUMMARY when set.
#
# Usage: compare-migration-versions.sh <committed-versions-file> <live-versions-file>
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1" || ! -f "$2" ]]; then
  echo "usage: $0 <committed-versions-file> <live-versions-file>" >&2
  exit 2
fi

committed="$(mktemp)"
live="$(mktemp)"
trap 'rm -f "$committed" "$live"' EXIT
grep -v '^[[:space:]]*$' "$1" | LC_ALL=C sort -u > "$committed" || true
grep -v '^[[:space:]]*$' "$2" | LC_ALL=C sort -u > "$live" || true

# Both files are LC_ALL=C sorted, so comm(1) splits the delta cleanly.
unapplied="$(LC_ALL=C comm -23 "$committed" "$live")"
live_only="$(LC_ALL=C comm -13 "$committed" "$live")"

if [[ -n "$live_only" ]]; then
  echo "::warning::Live database has applied migration versions with no matching file in supabase/migrations/ (usually an in-flight feature branch applied to live before merge)."
  echo ""
  echo "Applied on live but not in the committed chain:"
  printf '%s\n' "$live_only" | sed 's/^/  > /'
  echo ""
fi

if [[ -n "$unapplied" ]]; then
  echo "::error::Committed migrations are NOT applied to the live database: these versions exist in supabase/migrations/ but are missing from supabase_migrations.schema_migrations on live."
  echo ""
  echo "Committed but unapplied:"
  printf '%s\n' "$unapplied" | sed 's/^/  < /'
  echo ""
  echo "An operator with SUPABASE_DB_URL should apply them with scripts/db-push.sh"
  echo "(runs db push --include-all and regenerates the catalog snapshot in the same"
  echo "step), then commit supabase/live-catalog.snapshot.txt."
fi

# Surface non-clean results on the workflow run page, not just in the logs.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" && ( -n "$unapplied" || -n "$live_only" ) ]]; then
  {
    if [[ -n "$unapplied" ]]; then
      echo "## Migration chain: FAIL (committed-but-unapplied migrations)"
      echo ""
      echo '```'
      printf '%s\n' "$unapplied"
      echo '```'
      echo ""
      echo 'Apply with `scripts/db-push.sh` and commit the regenerated snapshot.'
    else
      echo "## Migration chain: WARN (live-only migration versions)"
      echo ""
      echo '```'
      printf '%s\n' "$live_only"
      echo '```'
    fi
    echo ""
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [[ -n "$unapplied" ]]; then
  exit 1
fi

echo "OK: every committed migration version is applied on live."
exit 0
