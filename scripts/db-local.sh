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
#     something other than empty tables. Applied STRICTLY (#581): a seed that no
#     longer matches the schema fails the whole run. Set MGR_SKIP_DEMO_SEED=1 to
#     skip it if you need a working database before you can repair it.
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
# A leftover hosted URL also 404s /api/auth/dev-login (issue #679).
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

# Demo data is applied STRICTLY (issue #581). This used to tolerate failure with
# a warning, which is exactly how supabase/seed.sql rotted unnoticed against
# schema changes (batches.batch_number -> batch_code, inventory_items.supplier
# dropped, package_types superseded by containers/selling_formats). A seed that
# no longer matches the schema must break the bootstrap loudly and immediately.
#
# Note the ordering: migrations and the RLS role fixtures are already applied by
# this point, so even when this step fails the database is still usable for
# `bun run test:integration` and `make dev` — only demo data is missing. That is
# what makes strictness affordable, and it is why the escape hatch below exists:
# rot must break the build, but it must never be able to block a bootstrap.
if [ "${MGR_SKIP_DEMO_SEED:-0}" = "1" ]; then
  echo "==> Skipping demo data (MGR_SKIP_DEMO_SEED=1)"
else
  echo "==> Seeding demo data"
  if ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql; then
    cat >&2 <<'ERRMSG'

ERROR: supabase/seed.sql failed — see the psql error above for the exact
       statement. Migrations and the RLS role fixtures DID apply, so the
       database already works for `bun run test:integration` and `make dev`;
       only the demo data is missing.

       Fix supabase/seed.sql against the migration chain in
       supabase/migrations/ (the chain is the source of truth for a local
       reset), then re-run `make db-local`.

       To get unblocked right now without repairing it, re-run with
       MGR_SKIP_DEMO_SEED=1 — but file the breakage, do not leave it.
ERRMSG
    exit 1
  fi
fi

cat <<EOF

Local database ready.

  Integration suite:  DATABASE_URL='$DB_URL' bun run test:integration
  Dev server:         make dev

NEXT: point .env.local at THIS stack — the URL as well as the keys. Run
\`supabase status\` and copy the printed "API URL", "anon key" and
"service_role key" over NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then restart the
dev server. .env.example ships a hosted URL, so a leftover hosted value is the
easy mistake. A credential that does not belong to the instance in the URL is
rejected upstream of Postgres ("Unregistered API key", "Invalid API key") with
no Postgres error code, so it does not look like a database problem. A leftover
hosted URL also makes /api/auth/dev-login 404 (it needs a loopback URL unless
DEV_LOGIN_ALLOW_REMOTE_DB=1 — issue #679). See docs/agents/gotchas.md.
EOF
