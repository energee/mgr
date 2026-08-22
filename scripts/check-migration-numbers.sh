#!/usr/bin/env bash
# scripts/check-migration-numbers.sh — Reject duplicate migration version prefixes.
#
# Two migrations sharing an `NNNNN_` prefix are valid SQL and pass every other
# DB check, but they break `supabase db reset`: the CLI keys
# supabase_migrations.schema_migrations on the prefix alone, so the second
# INSERT violates schema_migrations_pkey. db-lint.yml's `psql -1` replay loop
# is structurally blind to this — it never writes that table — so before this
# check the only thing that caught it was a Docker-backed CLI boot in CI.
#
# It has bitten three times: 00260 (#545), 00297 and 00298 (#920).
#
# SCOPE — read this before trusting it. It sees ONE tree. Two in-flight PRs
# each adding their own 00297 both pass, because neither tree contains the
# other's file; the collision only exists once both are merged. This catches
# it on any branch that holds both — i.e. as soon as the second PR is brought
# up to date with main, and locally in `make check` rather than minutes later
# in CI. Preventing the race outright needs branches required to be up to date
# before merge (a strict required-status-check rule or a merge queue), which
# this repository does not currently enforce.
#
# Usage: bash scripts/check-migration-numbers.sh [migrations-dir]
set -euo pipefail

DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/migrations}"

# Fail loudly on an empty match rather than reporting "no duplicates" after
# checking nothing — this guard is the only pre-push defense for the class.
shopt -s nullglob
files=("$DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "ERROR: no migrations found in ${DIR} — refusing to report a clean result over an empty file list." >&2
  exit 1
fi

dupes=$(printf '%s\n' "${files[@]##*/}" | sed 's/_.*//' | sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "ERROR: duplicate migration version prefixes:" >&2
  printf '  %s\n' $dupes >&2
  echo "  Each file in supabase/migrations/ must have a unique NNNNN_ prefix." >&2
  echo "  Renumber the newer file to (highest existing + 1) and update any references to it." >&2
  exit 1
fi

echo "OK: all ${#files[@]} migrations have unique version prefixes"
