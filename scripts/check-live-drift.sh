#!/usr/bin/env bash
# scripts/check-live-drift.sh
#
# Two checks against the live database, over the same $SUPABASE_DB_URL
# read-only connection:
#
# 1. Migration chain vs live (#693): compares the numeric version prefixes of
#    supabase/migrations/*.sql against supabase_migrations.schema_migrations
#    on live. A committed-but-unapplied migration FAILs (exit 4 when the
#    catalog is otherwise clean — see #812: this is the normal pre-push state,
#    distinct from real drift so db-push.sh can treat it as informational); a
#    live-only version (applied but not in the chain — usually an in-flight
#    feature branch) WARNs. The catalog diff below cannot catch this class: both the
#    live catalog and the committed snapshot are post-apply artifacts, so a
#    migration that was never pushed leaves both sides agreeing. Comparison
#    logic lives in scripts/compare-migration-versions.sh (unit-testable
#    without a database).
#
# 2. Compares the LIVE database catalog against the committed snapshot in
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
# WARN-level additions are split into two classes so behavior-altering objects
# can't hide in a generic warning:
#   * BEHAVIOR-ALTERING — TRIG| (new triggers), POLICY| (new RLS policies),
#     CHECK| (new CHECK constraints — they silently start rejecting writes,
#     #865) and RLS|<table>|false|* (a new table with row security DISABLED —
#     a security smell in this RLS-heavy schema) get their own loud callout.
#     An RLS flip on an existing table never reaches this path: its old flag
#     line goes missing, which is the FAIL branch above.
#   * Other additions — new functions/tables/RLS-enabled flag lines, listed
#     separately.
# All WARN-level drift is also appended to $GITHUB_STEP_SUMMARY (when set) so
# it is visible on the run page without opening logs.
#
# Why behavior-altering additions stay WARN instead of FAIL: this repo's
# normal flow applies feature-branch migrations to live before the branch
# merges, so a new trigger/policy on live is expected for every in-flight
# migration PR that adds one. FAILing on additions would red-flag each such
# window with no way to distinguish it from a genuinely rogue object; the
# compromise is the labeled callout + step summary above.
#
# SECURITY DEFINER functions cannot be singled out among FUNC| additions:
# the line format carries only name(args) + a body hash, and definer-ness
# lives inside the hashed body. Marking it in the line format would change
# every existing FUNC| line, hard-FAILing the next cron until someone with
# live access re-baselines — so new SECURITY DEFINER functions surface as
# ordinary FUNC| additions.
#
# What it compares (see scripts/live-catalog.sql): every public function
# (name + identity args + body hash), every non-internal trigger (name + table
# + definition hash), every base table, every RLS policy (table + name + cmd +
# permissive + roles + qual/with_check hash), per-table row-security
# flags, and every CHECK constraint (table + name + definition hash, #865 —
# orders.status lost its CHECK on live out-of-band and nothing noticed).
# A body-hash change catches an out-of-band CREATE OR REPLACE (e.g. a
# racy generate_lot_number swapped in), not just adds/drops. A changed object
# appears on both sides of the delta (old line missing, new line added); the
# missing side fails the run.
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
committed_versions="$(mktemp)"
live_versions="$(mktemp)"
trap 'rm -f "$current" "$committed_versions" "$live_versions"' EXIT
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

# An unsorted snapshot (e.g. mangled by a bad merge) makes comm(1) abort
# mid-diff on GNU or silently emit garbage on BSD — check sortedness up front
# with a clear message instead.
if ! LC_ALL=C sort -c "$SNAPSHOT"; then
  echo "ERROR: $SNAPSHOT is not LC_ALL=C sorted (bad merge?). Fix the merge or" >&2
  echo "       regenerate it with: SUPABASE_DB_URL=... $0 --update" >&2
  exit 2
fi

# --- Check 1: migration chain vs live schema_migrations (#693) ---------------
# A committed migration whose version row is absent on live means db push was
# never run for it: the catalog diff below is blind to that (snapshot and live
# both predate the apply), so it is checked explicitly here.
for f in supabase/migrations/*.sql; do
  b="${f##*/}"
  printf '%s\n' "${b%%_*}"
done > "$committed_versions"

if ! psql "$SUPABASE_DB_URL" -tA --no-psqlrc -v ON_ERROR_STOP=1 \
    -c 'select version from supabase_migrations.schema_migrations' \
    > "$live_versions"; then
  echo "ERROR: could not read supabase_migrations.schema_migrations from live." >&2
  exit 2
fi

# 0 = clean/WARN, 1 = committed-but-unapplied migrations exist. The catalog
# diff still runs either way; a migration failure is folded into the final
# exit code so both verdicts appear in one run. When the catalog itself is
# clean, unapplied migrations exit 4 rather than 1 (#812): that state is the
# expected precondition of every push, not drift, and db-push.sh must be able
# to tell the two apart without demanding --rebaseline-drift.
migrations_rc=0
bash scripts/compare-migration-versions.sh "$committed_versions" "$live_versions" \
  || migrations_rc=$?
# >1 (usage error) shouldn't occur here — this call always passes two files
# this script just created — but propagate it rather than swallowing it.
if (( migrations_rc > 1 )); then
  exit "$migrations_rc"
fi

# --- Check 2: live catalog vs committed snapshot ------------------------------
# Both files are LC_ALL=C sorted, so comm(1) splits the delta cleanly.
missing="$(LC_ALL=C comm -23 "$SNAPSHOT" "$current")"
added="$(LC_ALL=C comm -13 "$SNAPSHOT" "$current")"

if [[ -z "$missing" && -z "$added" ]]; then
  echo "OK: live database catalog matches supabase/live-catalog.snapshot.txt."
  # 1 -> 4 ONLY here, where the catalog is fully clean: unapplied-migrations-
  # only, the normal pre-push state (#812, see header). Any catalog delta —
  # including additions-only WARN — keeps exit 1 below so the pre-push gate
  # still stops and asks.
  if (( migrations_rc == 1 )); then exit 4; fi
  exit "$migrations_rc"
fi

if [[ -n "$missing" ]]; then
  echo "::error::Live database has DRIFTED from supabase/live-catalog.snapshot.txt: expected objects are missing or changed on live (C2/C3 class)."
  echo ""
  echo "Expected (in snapshot) but missing/changed on live:"
  printf '%s\n' "$missing" | sed 's/^/  < /'
  if [[ -n "$added" ]]; then
    echo ""
    echo "Live-only lines (new versions of changed objects, or unrelated additions):"
    printf '%s\n' "$added" | sed 's/^/  > /'
  fi
  echo ""
  echo "If this is a legitimate change, apply the migration to live and regenerate"
  echo "the snapshot (scripts/db-push.sh does both), then commit"
  echo "supabase/live-catalog.snapshot.txt. Otherwise: restore the object on live."
  exit 1
fi

# Additions only (WARN). Split behavior-altering classes out so they can't
# hide in a generic warning nobody reads: triggers, policies, and new tables
# whose row security is disabled (RLS|<table>|false|*).
hot_re='^(TRIG|POLICY|CHECK)\||^RLS\|[^|]*\|false\|'
hot="$(printf '%s\n' "$added" | grep -E "$hot_re" || true)"
benign="$(printf '%s\n' "$added" | grep -vE "$hot_re" || true)"

if [[ -n "$hot" ]]; then
  echo "::warning::BEHAVIOR-ALTERING live-only additions: new triggers / RLS policies / CHECK constraints / RLS-disabled tables exist on live that the snapshot does not expect. Verify each maps to an in-flight migration."
  echo ""
  echo "Behavior-altering additions (TRIG/POLICY/CHECK/RLS-disabled):"
  printf '%s\n' "$hot" | sed 's/^/  > /'
  echo ""
fi

if [[ -n "$benign" ]]; then
  echo "::warning::Live database has objects not in supabase/live-catalog.snapshot.txt (additions only — nothing expected is missing)."
  echo ""
  printf '%s\n' "$benign" | sed 's/^/  > /'
  echo ""
fi

echo "Usually an in-flight feature branch applied to live before merge (fine), or"
echo "a merged migration whose snapshot update was never committed — if so run:"
echo "  SUPABASE_DB_URL=... bash scripts/check-live-drift.sh --update"
echo "and commit supabase/live-catalog.snapshot.txt."

# Surface WARN-level drift on the workflow run page, not just in the logs.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Live-drift: WARN (additions only — nothing expected is missing)"
    if [[ -n "$hot" ]]; then
      echo ""
      echo "### Behavior-altering additions (triggers / RLS policies / CHECK constraints / RLS-disabled tables)"
      echo ""
      echo '```'
      printf '%s\n' "$hot"
      echo '```'
    fi
    if [[ -n "$benign" ]]; then
      echo ""
      echo "### Other additions (functions / tables / RLS-enabled flag lines)"
      echo ""
      echo '```'
      printf '%s\n' "$benign"
      echo '```'
    fi
    echo ""
    echo "If these are merged changes whose snapshot update was never committed, run"
    echo '`scripts/db-push.sh` (or `check-live-drift.sh --update`) and commit the snapshot.'
  } >> "$GITHUB_STEP_SUMMARY"
fi

# Catalog additions alone are WARN, but a committed-but-unapplied migration
# found by check 1 still fails the run.
exit "$migrations_rc"
