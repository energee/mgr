-- NOTE: This file is a byte-identical duplicate of
-- 00130_tighten_keg_owner_deposits_rls.sql (rebase artifact). Both are kept
-- on disk because they have already been applied to existing databases;
-- rewriting either would diverge applied-migration history. Running this
-- migration after 00130 is idempotent because all CREATE POLICY statements
-- are preceded by DROP POLICY IF EXISTS.
--
-- Tighten overly permissive RLS policies on keg_owner_deposits.
--
-- Previously, keg_owner_deposits had either WITH CHECK (true) policies (from 00079)
-- or a broad FOR ALL policy (from 00092). This migration replaces them with
-- granular, permission-based policies:
--   - SELECT: any user with inventory:read
--   - INSERT/UPDATE/DELETE: require inventory:write permission

-- Drop all existing policies on keg_owner_deposits (covers both old and new names)
DROP POLICY IF EXISTS "Authenticated users can view keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can insert keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can update keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can delete keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_owner_deposits_select ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_owner_deposits_write ON keg_owner_deposits;
-- PR #322: the granular names below were missing from this drop list, so the
-- header's idempotence claim did not hold and re-running (00137 after 00130)
-- failed on "already exists".
DROP POLICY IF EXISTS keg_owner_deposits_insert ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_owner_deposits_update ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_owner_deposits_delete ON keg_owner_deposits;

-- Ensure RLS is enabled
ALTER TABLE keg_owner_deposits ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user with inventory:read permission
CREATE POLICY keg_owner_deposits_select
  ON keg_owner_deposits
  FOR SELECT
  USING (user_has_permission('inventory:read'));

-- INSERT: require inventory:write permission
CREATE POLICY keg_owner_deposits_insert
  ON keg_owner_deposits
  FOR INSERT
  WITH CHECK (user_has_permission('inventory:write'));

-- UPDATE: require inventory:write permission
CREATE POLICY keg_owner_deposits_update
  ON keg_owner_deposits
  FOR UPDATE
  USING (user_has_permission('inventory:write'))
  WITH CHECK (user_has_permission('inventory:write'));

-- DELETE: require inventory:write permission
CREATE POLICY keg_owner_deposits_delete
  ON keg_owner_deposits
  FOR DELETE
  USING (user_has_permission('inventory:write'));
