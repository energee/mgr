#!/usr/bin/env bash
# scripts/db-local.sh — zero-to-running local database.
#
# Boots local Supabase, replays every migration, then loads BOTH fixture sets
# an agent needs to actually exercise the app:
#
#   * src/__tests__/integration/_fixtures/seed-roles.sql — the role-tier users
#     the RLS integration suite authenticates as. Without these,
#     `bun run test:integration` fails with a confusing "no seeded user" error.
#   * supabase/seed.sql — demo recipes/batches/orders so the dev server shows
#     something other than empty tables.
#
# Existing targets each do part of this and none do all of it:
#   make db-dry-run  — replays migrations, then throws the database away
#                      (--no-seed); it is a gate, not a dev environment.
#   make db-seed     — demo data only, assumes a database already exists.
#
# DESTRUCTIVE: `supabase db reset` drops the local database. It never touches
# the live project — the reset is scoped to the local stack by --local.
#
# Closing message reminds you to point `.env.local` at THIS stack — the API URL
# as well as the keys, since `.env.example` ships a hosted URL and a leftover
# hosted value is the easy mistake. A credential that does not belong to the
# instance in the URL is rejected upstream of Postgres, with no Postgres error
# code, so it does not look like a database problem (docs/agents/gotchas.md).
#
# Requires: supabase CLI, a Docker-compatible runtime, psql.
#
# Usage: bash scripts/db-local.sh
#        make db-local    (preferred)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for tool in supabase psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool not installed (brew install supabase/tap/supabase libpq)" >&2
    exit 1
  fi
done

echo "==> Booting local supabase (vector excluded; see migration-dry-run.sh)"
supabase start --exclude vector

echo "==> Resetting local database and replaying every migration"
supabase db reset --local --no-seed

# `supabase status -o env` emits shell assignments; DB_URL is the local
# superuser connection string.
DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
if [ -z "$DB_URL" ]; then
  echo "ERROR: could not read DB_URL from \`supabase status -o env\`" >&2
  exit 1
fi

# seed-roles.sql does `ALTER TABLE user_profiles DISABLE TRIGGER ALL`, which
# covers system (FK) triggers and therefore requires a superuser. Local
# Supabase's `postgres` role is not one — CI gets away with it because its
# plain-Postgres service user is. Connect as supabase_admin for the fixtures
# only; everything downstream uses the normal role.
ADMIN_URL="${DB_URL/:\/\/postgres:/://supabase_admin:}"

echo "==> Seeding RLS role fixtures"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -f src/__tests__/integration/_fixtures/seed-roles.sql

# Demo data is best-effort: supabase/seed.sql has rotted against the current
# schema (batches.batch_number -> batch_code, inventory_items.supplier removed,
# and likely more — see issue #581). The role fixtures above are what the
# integration suite actually needs, so a stale demo seed must not fail the
# whole bootstrap. Remove this tolerance once the seed is repaired.
echo "==> Seeding demo data (best-effort)"
if ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql; then
  DEMO_SEED_PARTIAL=1
  echo "WARNING: supabase/seed.sql stopped early — demo data is partial (issue #581)." >&2
fi

cat <<EOF

Local database ready${DEMO_SEED_PARTIAL:+ (demo data partial — issue #581)}.

  Integration suite:  DATABASE_URL='$DB_URL' bun run test:integration
  Dev server:         make dev

NEXT: point .env.local at THIS stack — the URL as well as the keys. Run
\`supabase status\` and copy the printed "API URL", "anon key" and
"service_role key" over NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then restart the
dev server. .env.example ships a hosted URL, so a leftover hosted value is the
easy mistake. A credential that does not belong to the instance in the URL is
rejected upstream of Postgres ("Unregistered API key", "Invalid API key") with
no Postgres error code, so it does not look like a database problem. See
docs/agents/gotchas.md.
EOF
