#!/usr/bin/env bash
# scripts/migration-dry-run.sh — Verify migrations apply cleanly from scratch.
#
# Boots a fresh Supabase local instance, applies every migration in
# supabase/migrations/ in order, and exits non-zero on first failure.
# Used to catch drift between historical migrations and current intent
# (e.g., a migration that referenced a column later renamed elsewhere).
#
# Requires: supabase CLI, Docker.
#
# Usage: bash scripts/migration-dry-run.sh
#        make db-dry-run    (preferred)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not installed. brew install supabase/tap/supabase" >&2
  exit 1
fi

echo "==> Stopping any running local supabase instance"
supabase stop --no-backup 2>/dev/null || true

echo "==> Booting fresh local supabase"
supabase start

echo "==> Resetting database (drops and replays every migration)"
# `supabase db reset` drops the local DB and reapplies migrations + seed.
# This is the dry run: if anything is malformed or out-of-order, this fails.
supabase db reset --no-seed

echo
echo "==> Migration dry-run complete: every file in supabase/migrations/ applied cleanly."
echo "    Local DB is now at the latest schema. Stop with: supabase stop"
