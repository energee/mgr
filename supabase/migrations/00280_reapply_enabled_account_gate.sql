-- 00280_reapply_enabled_account_gate.sql
--
-- Re-applies the enabled-account restrictive gate from 00255 to every public
-- RLS table that is missing it.
--
-- Why this is needed: 00255 installed `current_user_enabled` by looping over
-- the public RLS tables that existed *at that moment*. A table created by a
-- later migration — or, as here, by a migration authored on a branch that
-- diverged before 00255 — never receives the gate. Recovering
-- 00271_fulfill_past_orders.sql into the chain surfaced exactly that: its
-- `_backup_fulfill_past_orders` table has RLS enabled but no
-- `current_user_enabled` policy, which the
-- "adds an authenticated restrictive gate to every public RLS table"
-- integration test (src/__tests__/integration/account-status-rls.test.ts)
-- correctly fails on.
--
-- No effective access changes. `_backup_fulfill_past_orders` has RLS enabled
-- and zero permissive policies, so it already denies every non-BYPASSRLS role;
-- a RESTRICTIVE policy only narrows, never grants. This restores the declared
-- invariant rather than closing an open door.
--
-- Fixing this here instead of editing 00271 is deliberate: 00271 is already
-- applied to the live database. Amending an applied migration would leave live
-- without the policy while a fresh replay had it — the same chain-vs-live
-- divergence this branch exists to repair.
--
-- The loop is the one from 00255 verbatim, and is idempotent
-- (DROP POLICY IF EXISTS then CREATE), so tables that already carry the gate
-- are rebuilt identically. Re-sweeping rather than naming the single offending
-- table also catches any other straggler created between 00255 and now.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS current_user_enabled ON %I.%I',
      r.schema_name,
      r.table_name
    );
    EXECUTE format(
      'CREATE POLICY current_user_enabled ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT current_user_is_enabled())) WITH CHECK ((SELECT current_user_is_enabled()))',
      r.schema_name,
      r.table_name
    );
  END LOOP;
END
$$;

-- Verify the invariant now holds; abort the migration if it does not.
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = c.relname
        AND p.policyname = 'current_user_enabled'
        AND p.permissive = 'RESTRICTIVE'
        AND 'authenticated' = ANY(p.roles)
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'enabled-account gate still missing on: %', missing;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
