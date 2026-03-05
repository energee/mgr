-- Migration: 00087_user_profiles_delete_policy.sql
-- Purpose: Add DELETE RLS policy for user_profiles
--
-- The user delete feature requires admins to be able to delete inactive user
-- profiles. The service role key bypasses RLS, but adding an explicit policy
-- ensures correctness if the delete ever runs through a non-admin client.

CREATE POLICY user_profiles_delete_admin ON user_profiles
  FOR DELETE
  USING (
    is_admin_rls((SELECT auth.uid()))
    AND status = 'inactive'
  );
