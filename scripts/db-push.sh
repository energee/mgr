#!/usr/bin/env bash
# scripts/db-push.sh — push migrations to live AND refresh the drift snapshot.
#
# The live-drift watchdog (.github/workflows/live-drift.yml) compares live
# against supabase/live-catalog.snapshot.txt, so every push must be followed
# by a snapshot regeneration or the watchdog warns about the new objects
# forever. This wrapper makes that a single step:
#
#   SUPABASE_DB_URL='postgresql://readonly:***@db.<ref>.supabase.co:5432/postgres' \
#     bash scripts/db-push.sh
#
# Extra arguments are passed through to `supabase db push` (after the always-
# required --include-all). Commit the updated snapshot with the migration.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set. It is needed to regenerate the" >&2
  echo "       snapshot after the push; refusing to push without it so the" >&2
  echo "       two can't get out of sync." >&2
  exit 2
fi

supabase db push --include-all "$@"

bash scripts/check-live-drift.sh --update

echo ""
echo "Done. Commit supabase/live-catalog.snapshot.txt together with the migration."
