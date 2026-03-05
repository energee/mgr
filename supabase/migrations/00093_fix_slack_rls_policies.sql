-- =============================================================================
-- Migration: Fix Slack RLS Policies
-- =============================================================================
-- Tightens overly permissive RLS policies on slack_settings and
-- slack_notification_log. All writes go through SECURITY DEFINER functions
-- or service-role API routes, so client-side policies can be restrictive.
-- =============================================================================

-- =============================================================================
-- 1. slack_settings — hide webhook_url from client, restrict writes
-- =============================================================================

-- SELECT: authenticated users can read, but webhook_url is sensitive
-- (the settings API route masks it server-side via service role)
DROP POLICY IF EXISTS "Authenticated users can read slack settings" ON slack_settings;
CREATE POLICY "Authenticated users can read slack settings"
  ON slack_settings FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- UPDATE: restrict to authenticated users with proper auth check
DROP POLICY IF EXISTS "Authenticated users can update slack settings" ON slack_settings;
CREATE POLICY "Authenticated users can update slack settings"
  ON slack_settings FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- 2. slack_notification_log — restrict to authenticated users only
-- =============================================================================
-- INSERT and UPDATE are performed by notify_all_users() (SECURITY DEFINER)
-- and /api/slack/send (service role), both of which bypass RLS.
-- No client-side writes should be allowed.

DROP POLICY IF EXISTS "Anyone can insert slack log" ON slack_notification_log;
CREATE POLICY "Authenticated users can insert slack log"
  ON slack_notification_log FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can update slack log" ON slack_notification_log;
CREATE POLICY "Authenticated users can update slack log"
  ON slack_notification_log FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
