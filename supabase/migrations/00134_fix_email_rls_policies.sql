-- Fix overly permissive RLS policies on email_settings and email_notification_log.
--
-- email_settings: UPDATE was open to all authenticated users, allowing any user
-- to change the Supabase project URL (Edge Function endpoint) or app URL
-- (injected into email links). Now restricted to integrations:manage.
--
-- email_notification_log: INSERT/UPDATE were open to all authenticated users.
-- SECURITY DEFINER functions bypass RLS, so these permissive policies were
-- unnecessary and created a hole. Removed and replaced with integrations:manage.
-- SELECT also restricted to integrations:manage since the table contains PII
-- (recipient email addresses).

-- =============================================================================
-- 1. Fix email_settings policies
-- =============================================================================

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read email settings" ON email_settings;
DROP POLICY IF EXISTS "Authenticated users can update email settings" ON email_settings;

-- SELECT: any authenticated user can read (non-sensitive toggle + URLs)
CREATE POLICY email_settings_select
  ON email_settings FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- UPDATE: restricted to integrations:manage (admin only)
CREATE POLICY email_settings_write
  ON email_settings FOR UPDATE
  TO authenticated
  USING (user_has_permission('integrations:manage'))
  WITH CHECK (user_has_permission('integrations:manage'));

-- =============================================================================
-- 2. Fix email_notification_log policies
-- =============================================================================

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read email log" ON email_notification_log;
DROP POLICY IF EXISTS "System can insert email log" ON email_notification_log;
DROP POLICY IF EXISTS "System can update email log" ON email_notification_log;

-- SELECT: restricted to integrations:manage (contains PII — recipient emails)
CREATE POLICY email_notification_log_select
  ON email_notification_log FOR SELECT
  TO authenticated
  USING (user_has_permission('integrations:manage'));

-- INSERT/UPDATE: restricted to integrations:manage for admin review.
-- Note: dispatch_email_notification() is SECURITY DEFINER and bypasses RLS,
-- so these policies only affect direct PostgREST access.
CREATE POLICY email_notification_log_write
  ON email_notification_log FOR ALL
  TO authenticated
  USING (user_has_permission('integrations:manage'))
  WITH CHECK (user_has_permission('integrations:manage'));
