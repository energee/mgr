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
#
# Guard rails around the snapshot refresh (which would otherwise silently
# re-baseline ANY pre-existing live drift into the new "expected" state):
#
#   * BEFORE pushing, the live-drift check runs in report mode and its output
#     is shown. Pre-existing drift does NOT block the push (you may well be
#     pushing the fix), but a connection/config failure (exit 2) aborts —
#     the post-push refresh would fail the same way, leaving the push applied
#     with a stale snapshot.
#   * AFTER the refresh, every line present in the old snapshot but absent
#     from the new one is printed as a loud REMOVED warning. A removal means
#     an object vanished from (or changed on) live; verify each one maps to
#     an intentional change in the migration just pushed.
#   * A --dry-run pass-through skips the snapshot refresh entirely — a dry
#     run must not rewrite the committed snapshot.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SNAPSHOT="supabase/live-catalog.snapshot.txt"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set. It is needed to regenerate the" >&2
  echo "       snapshot after the push; refusing to push without it so the" >&2
  echo "       two can't get out of sync." >&2
  exit 2
fi

dry_run=0
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    dry_run=1
  fi
done

if [[ $dry_run -eq 1 ]]; then
  echo "=== Pre-push live-drift check (DRY RUN: the snapshot will NOT be refreshed) ==="
else
  echo "=== Pre-push live-drift check (surfacing pre-existing drift before it is re-baselined) ==="
fi
precheck_rc=0
bash scripts/check-live-drift.sh || precheck_rc=$?
# Exit 1 is the only "drift confirmed" code; anything else (2 = config/
# connection error, 3 = psql query failure, ...) means the check never ran.
if [[ $precheck_rc -ne 0 && $precheck_rc -ne 1 ]]; then
  echo "" >&2
  echo "ERROR: the pre-push drift check could not run (see above). Refusing to" >&2
  echo "       push: the post-push snapshot refresh would fail the same way," >&2
  echo "       leaving the push applied but the snapshot stale." >&2
  exit 2
elif [[ $precheck_rc -eq 1 ]]; then
  echo ""
  echo "!!! Live is ALREADY drifted from the committed snapshot (details above)."
  echo "!!! The push continues, but the snapshot refresh will RE-BASELINE that"
  echo "!!! drift — anything dropped out-of-band becomes the new expected state."
  echo "!!! Review the REMOVED-lines warning printed after the refresh."
  echo ""
fi

supabase db push --include-all "$@"

if [[ $dry_run -eq 1 ]]; then
  echo ""
  echo "Dry run: skipping snapshot refresh ($SNAPSHOT left untouched)."
  exit 0
fi

# Keep the pre-refresh snapshot so removals can be diffed and reported.
old_snapshot="$(mktemp)"
trap 'rm -f "$old_snapshot"' EXIT
if [[ -f "$SNAPSHOT" ]]; then
  cp "$SNAPSHOT" "$old_snapshot"
else
  : > "$old_snapshot"
fi

bash scripts/check-live-drift.sh --update

# Removals = lines in the old snapshot that the fresh one no longer has:
# an object was dropped on live, or changed (its hash line moved). Make them
# impossible to miss — once committed, the watchdog treats them as expected.
removed="$(LC_ALL=C comm -23 "$old_snapshot" "$SNAPSHOT")"
if [[ -n "$removed" ]]; then
  echo ""
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "!!! SNAPSHOT LINES REMOVED by this refresh — these objects were in the"
  echo "!!! previous snapshot and are no longer on live (dropped or changed):"
  echo "!!!"
  printf '%s\n' "$removed" | sed 's/^/!!!   - /'
  echo "!!!"
  echo "!!! A removal is expected ONLY if the migration just pushed drops or"
  echo "!!! replaces that object (CREATE OR REPLACE changes its hash line)."
  echo "!!! Anything you cannot map to this migration was lost out-of-band and"
  echo "!!! has now been re-baselined as expected — restore it on live and"
  echo "!!! re-run this script, or it stays invisible to the drift watchdog."
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
fi

echo ""
echo "Done. Commit supabase/live-catalog.snapshot.txt together with the migration."
