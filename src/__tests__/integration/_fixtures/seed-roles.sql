-- Integration test role fixtures
--
-- Seeds one auth.users row per role tier and the corresponding user_profiles
-- rows. All UUIDs and passwords are deterministic so the role-client helper
-- can sign in without storing secrets.
--
-- Apply AFTER all migrations on a fresh test DB:
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f seed-roles.sql
--
-- On plain (non-Supabase) Postgres, `bootstrap-plain-postgres.sql` must have
-- been applied BEFORE the migrations — it provides auth.users, auth.uid(),
-- and the Supabase-default grants this file and the chain depend on.
--
-- IMPORTANT: This file is for CI/test use only. Never run against production.

-- ---------------------------------------------------------------------------
-- Deterministic test user UUIDs
-- ---------------------------------------------------------------------------
-- viewer             : 00000000-0000-0000-0000-000000000001
-- inventory_manager  : 00000000-0000-0000-0000-000000000002
-- production_manager : 00000000-0000-0000-0000-000000000003
-- admin              : 00000000-0000-0000-0000-000000000004
-- no_roles           : 00000000-0000-0000-0000-000000000005
-- no_profile         : 00000000-0000-0000-0000-000000000006
--
-- Password for all seeded users: "test-password-123!"
-- (bcrypt hash below generated with cost factor 10)

-- ---------------------------------------------------------------------------
-- Insert auth.users rows
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'viewer@test.local',
    -- bcrypt("test-password-123!", 10)
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test Viewer"}'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'inventory-manager@test.local',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test Inventory Manager"}'
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'production-manager@test.local',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test Production Manager"}'
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'admin@test.local',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test Admin"}'
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'no-roles@test.local',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test No Roles"}'
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    'no-profile@test.local',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    now(),
    '{"display_name": "Test No Profile"}'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Insert user_profiles rows
-- NOTE: no_profile (000...006) intentionally gets NO user_profiles row.
--       The migration constraint validate_user_roles() requires roles array
--       to contain only known role strings. We bypass the check for the
--       no_roles user by inserting directly and overriding the constraint
--       via a temporary disable, or by using a valid-but-empty-ish approach.
--
--       The validate_user_roles() function returns false for empty arrays,
--       so we insert with roles = '{}' and disable the check temporarily.
-- ---------------------------------------------------------------------------

-- Temporarily disable the roles check so we can seed the no_roles user
ALTER TABLE user_profiles DISABLE TRIGGER ALL;

INSERT INTO user_profiles (id, email, display_name, roles, status, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'viewer@test.local',
    'Test Viewer',
    ARRAY['viewer'],
    'active',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'inventory-manager@test.local',
    'Test Inventory Manager',
    -- inventory_manager is not a valid role string in the enum; use the closest
    -- valid role that has inventory:write permission (production_manager).
    -- The SeededRole type in role-client.ts maps 'inventory_manager' -> this user.
    ARRAY['production_manager'],
    'active',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'production-manager@test.local',
    'Test Production Manager',
    ARRAY['production_manager'],
    'active',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'admin@test.local',
    'Test Admin',
    ARRAY['admin'],
    'active',
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  roles = EXCLUDED.roles,
  status = EXCLUDED.status;

-- Insert no_roles user with empty array — bypasses constraint via direct insert
-- (constraint is a CHECK, not a trigger, so DISABLE TRIGGER does not help here;
--  use a workaround: set NOT VALID, seed, then re-validate)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS chk_user_roles;

INSERT INTO user_profiles (id, email, display_name, roles, status, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000005',
    'no-roles@test.local',
    'Test No Roles',
    ARRAY[]::TEXT[],
    'active',
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  roles = EXCLUDED.roles;

-- Restore the constraint (NOT VALID so it doesn't re-check existing rows)
ALTER TABLE user_profiles ADD CONSTRAINT chk_user_roles
  CHECK (validate_user_roles(roles)) NOT VALID;

ALTER TABLE user_profiles ENABLE TRIGGER ALL;

-- no_profile user (000...006) deliberately has NO user_profiles row.
-- This tests the fail-closed behavior for race conditions (auth user exists,
-- profile row missing — should be denied access to all domain tables).
