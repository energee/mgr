-- Plain-Postgres Supabase platform shim
--
-- Apply BEFORE the migration chain on a fresh, non-Supabase Postgres
-- (CI's postgres service container, or a local `createdb` instance):
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f bootstrap-plain-postgres.sql
--   for m in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$m"; done
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f seed-roles.sql
--
-- A real Supabase stack already provides everything in sections 1–2 (do not
-- apply this file there; every statement is idempotent, but it has no purpose).
--
-- REQUIRES: the roles anon / authenticated / service_role already exist
-- (CI creates them in the "Create Supabase roles" workflow step).

-- ---------------------------------------------------------------------------
-- 1. auth schema, auth.users, and the JWT-claim helper functions
--
-- auth.uid() mirrors Supabase's implementation: reads the `sub` claim from
-- the `request.jwt.claims` session setting (set per-test by
-- _helpers/role-client.ts) and returns NULL when no claims are set.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Minimal auth.users: migrations only need it as an FK target.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY,
  email              TEXT UNIQUE,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ DEFAULT now(),
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  raw_user_meta_data JSONB DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

-- Realtime publication (00020+ run ALTER PUBLICATION supabase_realtime).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Supabase-default privileges
--
-- Real Supabase grants anon/authenticated/service_role access to `public`
-- objects via default privileges; RLS (not GRANTs) is the row-level gate.
-- Without these, RLS-protected SELECTs raise 42501 "permission denied"
-- instead of returning zero rows, breaking the fail-closed test contract.
-- Must run BEFORE migrations so the default privileges apply to every table
-- the chain creates.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
