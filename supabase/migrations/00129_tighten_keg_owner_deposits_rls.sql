-- =============================================================================
-- Migration: Tighten keg_owner_deposits RLS policies
-- =============================================================================
-- The original policies from 00079_keg_owners.sql used `WITH CHECK (true)`,
-- allowing any authenticated user to INSERT, UPDATE, or DELETE deposit records.
-- Migration 00092 replaced those with permission-based policies, but this
-- migration ensures the correct state by explicitly dropping any remaining
-- overly permissive policies and recreating them with proper role-based checks.
--
-- keg_owner_deposits is a financial configuration table (deposit amounts per
-- keg owner per keg type). Write access is restricted to users with the
-- 'inventory:write' permission (admin, production_manager roles).
-- Read access requires 'inventory:read' permission.

-- =============================================================================
-- 1. Drop any existing policies (both legacy permissive and current)
-- =============================================================================
-- Drop legacy permissive policies from 00079 (if still present)
DROP POLICY IF EXISTS "Authenticated users can view keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can insert keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can update keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can delete keg owner deposits" ON keg_owner_deposits;

-- Drop permission-based policies from 00092 (to recreate with explicit operations)
DROP POLICY IF EXISTS keg_owner_deposits_select ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_owner_deposits_write ON keg_owner_deposits;

-- =============================================================================
-- 2. Ensure RLS is enabled
-- =============================================================================
ALTER TABLE keg_owner_deposits ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Create tightened policies with explicit per-operation controls
-- =============================================================================

-- SELECT: All users with inventory:read permission can view deposit amounts
-- (admin, production_manager, brewer, sales, viewer)
CREATE POLICY keg_owner_deposits_select
  ON keg_owner_deposits
  FOR SELECT
  USING (user_has_permission('inventory:read'));

-- INSERT: Only users with inventory:write permission can create deposit records
-- (admin, production_manager)
CREATE POLICY keg_owner_deposits_insert
  ON keg_owner_deposits
  FOR INSERT
  WITH CHECK (user_has_permission('inventory:write'));

-- UPDATE: Only users with inventory:write permission can modify deposit amounts
-- (admin, production_manager)
CREATE POLICY keg_owner_deposits_update
  ON keg_owner_deposits
  FOR UPDATE
  USING (user_has_permission('inventory:write'))
  WITH CHECK (user_has_permission('inventory:write'));

-- DELETE: Only users with inventory:write permission can remove deposit records
-- (admin, production_manager)
CREATE POLICY keg_owner_deposits_delete
  ON keg_owner_deposits
  FOR DELETE
  USING (user_has_permission('inventory:write'));

-- =============================================================================
-- 4. Reload PostgREST schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
