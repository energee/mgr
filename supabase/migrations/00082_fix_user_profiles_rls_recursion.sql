-- Migration: 00082_fix_user_profiles_rls_recursion.sql
-- Purpose: Fix infinite recursion in user_profiles RLS policies
--
-- The UPDATE and INSERT policies on user_profiles contain
-- `EXISTS (SELECT 1 FROM user_profiles WHERE ...)` which causes
-- PostgreSQL to detect infinite recursion when evaluating RLS.
--
-- Fix: Create a SECURITY DEFINER helper that bypasses RLS for the
-- admin check, then rewrite the self-referencing policies to use it.

-- =============================================================================
-- 1. Create RLS-safe admin check (SECURITY DEFINER bypasses RLS)
-- =============================================================================

CREATE OR REPLACE FUNCTION is_admin_rls(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_user_id AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION is_admin_rls(UUID) IS
  'SECURITY DEFINER admin check for use inside RLS policies on user_profiles. Bypasses RLS to avoid infinite recursion.';

-- =============================================================================
-- 2. Recreate user_profiles UPDATE policy using the helper
-- =============================================================================

DROP POLICY IF EXISTS user_profiles_update ON user_profiles;
CREATE POLICY user_profiles_update ON user_profiles
  FOR UPDATE
  USING (
    (SELECT auth.uid()) = id
    OR is_admin_rls((SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    OR is_admin_rls((SELECT auth.uid()))
  );

-- =============================================================================
-- 3. Recreate user_profiles INSERT policy using the helper
-- =============================================================================

DROP POLICY IF EXISTS user_profiles_insert_admin ON user_profiles;
CREATE POLICY user_profiles_insert_admin ON user_profiles
  FOR INSERT
  WITH CHECK (
    is_admin_rls((SELECT auth.uid()))
  );
