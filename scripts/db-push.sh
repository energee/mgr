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
# re-baseline ANY pre-existing live drift into the new "expected" state).
# Both gates FAIL CLOSED:
#
#   * BEFORE pushing, the live-drift check runs in report mode. Confirmed
#     pre-existing catalog drift (exit 1) ABORTS the push unless the explicit
#     --rebaseline-drift flag is passed (the flag is consumed here, not
#     forwarded to supabase). Committed-but-unapplied migrations with a clean
#     catalog (exit 4) are informational — that is the precondition of every
#     push, not drift (#812). A connection/config failure (exit 2/3) always
#     aborts — the post-push refresh would fail the same way, leaving the
#     push applied with a stale snapshot.
#   * AFTER the refresh, every line present in the old snapshot but absent
#     from the new one means an object vanished from (or changed on) live.
#     When such REMOVED lines exist, the refreshed snapshot is only KEPT
#     after an interactive y/N confirmation (or MGR_DB_PUSH_ACK=1 for
#     non-interactive use); otherwise the previous snapshot is restored, so
#     the live-drift watchdog keeps flagging the loss instead of silently
#     treating it as expected.
#   * A --dry-run pass-through skips the snapshot refresh entirely — a dry
#     run must not rewrite the committed snapshot.
#
# No shell test harness exists for this script; the gate logic below is kept
# deliberately linear (flag parse -> precheck gate -> push -> refresh ->
# removal gate) so each branch is auditable at a glance.
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
rebaseline_drift=0
push_args=()
for arg in "$@"; do
  case "$arg" in
    --rebaseline-drift)
      # Consumed here: authorizes pushing over confirmed pre-existing drift.
      # Never forwarded — supabase db push does not know this flag.
      rebaseline_drift=1
      ;;
    *)
      if [[ "$arg" == "--dry-run" ]]; then
        dry_run=1
      fi
      push_args+=("$arg")
      ;;
  esac
done

if [[ $dry_run -eq 1 ]]; then
  echo "=== Pre-push live-drift check (DRY RUN: the snapshot will NOT be refreshed) ==="
else
  echo "=== Pre-push live-drift check (surfacing pre-existing drift before it is re-baselined) ==="
fi
precheck_rc=0
bash scripts/check-live-drift.sh || precheck_rc=$?
# Exit 1 = catalog drift confirmed. Exit 4 = committed-but-unapplied
# migrations with a clean catalog — the normal state before every push, and
# exactly what the push resolves, so it is informational here (#812).
# Anything else (2 = config/connection error, 3 = psql query failure, ...)
# means the check never ran.
if [[ $precheck_rc -eq 4 ]]; then
  echo ""
  echo "Unapplied committed migrations found (see above) and the live catalog"
  echo "matches the snapshot — no drift. Continuing: this push applies them."
  precheck_rc=0
fi
if [[ $precheck_rc -ne 0 && $precheck_rc -ne 1 ]]; then
  echo "" >&2
  echo "ERROR: the pre-push drift check could not run (see above). Refusing to" >&2
  echo "       push: the post-push snapshot refresh would fail the same way," >&2
  echo "       leaving the push applied but the snapshot stale." >&2
  exit 2
elif [[ $precheck_rc -eq 1 ]]; then
  if [[ $rebaseline_drift -ne 1 ]]; then
    echo "" >&2
    echo "ERROR: live is ALREADY drifted from the committed snapshot (details" >&2
    echo "       above). Refusing to push: the post-push snapshot refresh would" >&2
    echo "       RE-BASELINE that drift — anything dropped out-of-band would" >&2
    echo "       become the new expected state without review." >&2
    echo "" >&2
    echo "       Investigate the drift first. To push anyway and re-baseline" >&2
    echo "       deliberately, re-run with the explicit flag:" >&2
    echo "         bash scripts/db-push.sh --rebaseline-drift" >&2
    exit 1
  fi
  echo ""
  echo "!!! Live is ALREADY drifted from the committed snapshot (details above)."
  echo "!!! --rebaseline-drift passed: the push continues, and the snapshot"
  echo "!!! refresh will RE-BASELINE that drift. You will be asked to confirm"
  echo "!!! any REMOVED lines before the refreshed snapshot is kept."
  echo ""
fi

supabase db push --include-all "${push_args[@]+"${push_args[@]}"}"

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
# an object was dropped on live, or changed (its hash line moved). This is
# an approval gate, not a banner: unless the removals are explicitly
# acknowledged (interactive y/N, or MGR_DB_PUSH_ACK=1 for non-interactive
# runs), the previous snapshot is RESTORED so the drift watchdog keeps
# flagging the loss instead of treating it as the new expected state.
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
  echo "!!! Anything you cannot map to this migration was lost out-of-band."
  echo "!!! Keeping the refreshed snapshot re-baselines these removals as the"
  echo "!!! new expected state — the drift watchdog will stop reporting them."
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"

  ack=0
  if [[ "${MGR_DB_PUSH_ACK:-}" == "1" ]]; then
    echo "MGR_DB_PUSH_ACK=1: removals acknowledged non-interactively."
    ack=1
  elif [[ -t 0 ]]; then
    read -r -p "Keep the refreshed snapshot (re-baseline the removals above)? [y/N] " reply
    if [[ "$reply" == "y" || "$reply" == "Y" ]]; then
      ack=1
    fi
  else
    echo "" >&2
    echo "Non-interactive run without MGR_DB_PUSH_ACK=1 — cannot confirm." >&2
  fi

  if [[ $ack -ne 1 ]]; then
    cp "$old_snapshot" "$SNAPSHOT"
    echo "" >&2
    echo "ERROR: snapshot refresh NOT kept — $SNAPSHOT restored to its previous" >&2
    echo "       contents, so the drift watchdog keeps flagging these objects." >&2
    echo "       The push itself HAS been applied. Verify each removal maps to" >&2
    echo "       the migration just pushed (restore anything lost out-of-band)," >&2
    echo "       then re-run this script — or re-run with MGR_DB_PUSH_ACK=1 to" >&2
    echo "       accept the removals non-interactively." >&2
    exit 1
  fi
fi

echo ""
echo "Done. Commit supabase/live-catalog.snapshot.txt together with the migration."
