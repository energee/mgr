-- =============================================================================
-- Migration: Email Notification Dispatch
-- =============================================================================
-- Adds email notification delivery alongside existing in-app and Slack
-- notifications. Uses pg_net (already enabled in 00088) for async HTTP calls
-- from notify_all_users() to the send-email Supabase Edge Function.
--
-- Architecture:
--   1. email_settings (singleton) — stores Supabase project URL + toggle
--   2. email_notification_log — audit log of email delivery attempts
--   3. dispatch_email_notification() — per-user email dispatch helper
--   4. notify_all_users() — extended to call dispatch_email_notification()
--
-- The send-email Edge Function handles Resend API integration. This migration
-- handles the database-side wiring: checking preferences, building the payload,
-- and firing the async HTTP request via pg_net.
-- =============================================================================

-- =============================================================================
-- 1. Email Settings Table (singleton)
-- =============================================================================

CREATE TABLE email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  supabase_project_url TEXT,  -- e.g. "https://xyz.supabase.co"
  app_url TEXT,  -- e.g. "https://mybrewery.com" for template links
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE email_settings IS 'Singleton configuration for email notification delivery via Resend.';
COMMENT ON COLUMN email_settings.is_enabled IS 'Master toggle for email notification dispatch.';
COMMENT ON COLUMN email_settings.supabase_project_url IS 'Supabase project URL used to call the send-email Edge Function.';
COMMENT ON COLUMN email_settings.app_url IS 'Application URL for links in email templates (e.g. "View Batch" button).';

-- Ensure only one row
CREATE UNIQUE INDEX email_settings_singleton ON email_settings ((true));

-- Seed with disabled defaults
INSERT INTO email_settings (is_enabled) VALUES (false);

-- RLS
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read email settings"
  ON email_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update email settings"
  ON email_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Updated at trigger
CREATE TRIGGER update_email_settings_updated_at
  BEFORE UPDATE ON email_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. Email Notification Log Table
-- =============================================================================

CREATE TABLE email_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE email_notification_log IS 'Audit log of email notification delivery attempts.';
COMMENT ON COLUMN email_notification_log.status IS 'Delivery status: pending (dispatched), sent, failed, skipped (user pref disabled).';

CREATE INDEX idx_email_notification_log_status ON email_notification_log (status);
CREATE INDEX idx_email_notification_log_user ON email_notification_log (user_id);
CREATE INDEX idx_email_notification_log_created ON email_notification_log (created_at DESC);

-- RLS
ALTER TABLE email_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read email log"
  ON email_notification_log FOR SELECT
  TO authenticated
  USING (true);

-- Insert/update policies for SECURITY DEFINER functions
CREATE POLICY "System can insert email log"
  ON email_notification_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update email log"
  ON email_notification_log FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 3. Schema Registry Entries
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('email_settings', 'Singleton configuration for email notification delivery via Resend', 'system', '[]'::jsonb),
  ('email_notification_log', 'Audit log of email notification delivery attempts', 'system', '["belongs_to: user_profiles"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain;

-- =============================================================================
-- 4. Email Dispatch Helper Function
-- =============================================================================
-- Called per-user from notify_all_users(). Checks the user's email_enabled
-- preference, looks up their email from user_profiles, and fires an async
-- HTTP POST to the send-email Edge Function via pg_net.

CREATE OR REPLACE FUNCTION dispatch_email_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_priority TEXT,
  p_action_url TEXT,
  p_metadata JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_settings RECORD;
  v_prefs RECORD;
  v_user_email TEXT;
  v_log_id UUID;
  v_edge_fn_url TEXT;
  v_service_role_key TEXT;
  v_email_subject TEXT;
  v_email_html TEXT;
  v_email_text TEXT;
  v_app_url TEXT;
BEGIN
  -- 1. Check if email delivery is globally enabled
  SELECT is_enabled, supabase_project_url, app_url
    INTO v_email_settings
    FROM email_settings
    LIMIT 1;

  IF NOT FOUND OR NOT v_email_settings.is_enabled THEN
    RETURN;
  END IF;

  IF v_email_settings.supabase_project_url IS NULL OR v_email_settings.supabase_project_url = '' THEN
    RETURN;
  END IF;

  -- 2. Check user's email preference
  SELECT email_enabled
    INTO v_prefs
    FROM notification_preferences
    WHERE user_id = p_user_id;

  -- If no preferences row, default is email_enabled = false
  IF NOT FOUND OR NOT v_prefs.email_enabled THEN
    RETURN;
  END IF;

  -- 3. Get user email from user_profiles (never join auth.users directly)
  SELECT email INTO v_user_email
    FROM user_profiles
    WHERE id = p_user_id AND status = 'active';

  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN;
  END IF;

  -- 4. Build email subject (simple version — the Edge Function receives
  --    structured data; rich HTML templates are handled client-side or
  --    in a future enhancement to the Edge Function).
  v_email_subject := p_title;
  v_app_url := COALESCE(v_email_settings.app_url, '');

  -- Build a simple HTML email body. The send-email Edge Function accepts
  -- subject + html + text, so we construct them here for now.
  v_email_html := '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">'
    || '<h2 style="color:#111827;">' || p_title || '</h2>'
    || CASE WHEN p_message IS NOT NULL
         THEN '<p style="color:#374151;line-height:1.6;">' || p_message || '</p>'
         ELSE ''
       END
    || CASE WHEN p_action_url IS NOT NULL AND v_app_url != ''
         THEN '<p style="margin-top:16px;"><a href="' || v_app_url || p_action_url
              || '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;'
              || 'text-decoration:none;border-radius:6px;">View Details</a></p>'
         ELSE ''
       END
    || '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />'
    || '<p style="color:#6b7280;font-size:12px;">'
    || 'You received this because email notifications are enabled. '
    || CASE WHEN v_app_url != ''
         THEN '<a href="' || v_app_url || '/settings/notifications">Manage preferences</a>'
         ELSE 'Manage preferences in your account settings.'
       END
    || '</p></div>';

  v_email_text := p_title || E'\n\n'
    || COALESCE(p_message, '') || E'\n\n'
    || CASE WHEN p_action_url IS NOT NULL AND v_app_url != ''
         THEN 'View: ' || v_app_url || p_action_url || E'\n\n'
         ELSE ''
       END
    || '---' || E'\n'
    || 'Manage notification preferences: '
    || CASE WHEN v_app_url != ''
         THEN v_app_url || '/settings/notifications'
         ELSE 'your account settings'
       END;

  -- 5. Create log entry
  INSERT INTO email_notification_log (user_id, notification_type, recipient_email, subject, status)
  VALUES (p_user_id, p_type, v_user_email, v_email_subject, 'pending')
  RETURNING id INTO v_log_id;

  -- 6. Build Edge Function URL
  v_edge_fn_url := v_email_settings.supabase_project_url || '/functions/v1/send-email';

  -- 7. Get service role key for Edge Function auth.
  --    The key is stored in vault or passed via app.settings.
  --    For pg_net calls we use the service_role key from Supabase vault.
  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
    -- Fallback: try to read from vault if available
    BEGIN
      SELECT decrypted_secret INTO v_service_role_key
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      -- vault not available, mark as skipped
      UPDATE email_notification_log
        SET status = 'skipped', error_message = 'No service_role_key available for Edge Function auth'
        WHERE id = v_log_id;
      RETURN;
    END;

    IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
      UPDATE email_notification_log
        SET status = 'skipped', error_message = 'service_role_key not found in vault or app.settings'
        WHERE id = v_log_id;
      RETURN;
    END IF;
  END IF;

  -- 8. Fire async HTTP POST via pg_net
  PERFORM net.http_post(
    url := v_edge_fn_url,
    body := jsonb_build_object(
      'to', v_user_email,
      'subject', v_email_subject,
      'html', v_email_html,
      'text', v_email_text
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    )
  );

  -- Note: pg_net is fire-and-forget. We cannot update the log to 'sent'
  -- here because the HTTP call is async. A future enhancement could add
  -- a webhook callback or pg_net response polling to update status.

END;
$$;

COMMENT ON FUNCTION dispatch_email_notification IS 'Dispatches an email notification for a single user via the send-email Edge Function. Checks user preferences and email_settings before sending.';

-- =============================================================================
-- 5. Extend notify_all_users() to include email dispatch
-- =============================================================================
-- This replaces the version from 00088 (Slack integration) to also dispatch
-- email notifications per user.

CREATE OR REPLACE FUNCTION notify_all_users(
  p_type TEXT,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_action_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_count INTEGER := 0;
  v_slack RECORD;
  v_log_id UUID;
BEGIN
  -- Get all users who have logged in (have a session/are active)
  FOR v_user IN
    SELECT DISTINCT id FROM auth.users
  LOOP
    -- In-app notification
    PERFORM create_notification(
      v_user.id,
      p_type,
      p_title,
      p_message,
      p_entity_type,
      p_entity_id,
      p_priority,
      p_action_url,
      p_metadata
    );

    -- Email notification (fire-and-forget, checks preferences internally)
    BEGIN
      PERFORM dispatch_email_notification(
        v_user.id,
        p_type,
        p_title,
        p_message,
        p_priority,
        p_action_url,
        p_metadata
      );
    EXCEPTION WHEN OTHERS THEN
      -- Don't let email failures block in-app notifications
      RAISE WARNING 'Email dispatch failed for user %: %', v_user.id, SQLERRM;
    END;

    v_count := v_count + 1;
  END LOOP;

  -- Slack delivery (fire-and-forget via pg_net) — preserved from 00088
  SELECT is_enabled, internal_secret, app_url
    INTO v_slack
    FROM slack_settings
    LIMIT 1;

  IF v_slack.is_enabled THEN
    -- Create log entry
    INSERT INTO slack_notification_log (notification_type, title, message, priority, action_url, metadata, status)
    VALUES (p_type, p_title, p_message, p_priority, p_action_url, p_metadata, 'pending')
    RETURNING id INTO v_log_id;

    -- Fire async HTTP POST to the API route
    IF v_slack.app_url IS NOT NULL AND v_slack.app_url != '' THEN
      PERFORM net.http_post(
        url := v_slack.app_url || '/api/slack/send',
        body := jsonb_build_object(
          'log_id', v_log_id,
          'type', p_type,
          'title', p_title,
          'message', p_message,
          'priority', p_priority,
          'action_url', p_action_url,
          'metadata', p_metadata
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Slack-Secret', v_slack.internal_secret
        )
      );
    ELSE
      -- No app URL configured; mark as skipped
      UPDATE slack_notification_log
        SET status = 'skipped', error_message = 'app_url not configured in slack_settings'
        WHERE id = v_log_id;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION notify_all_users IS 'Creates a notification for all users, optionally sends to Slack, and dispatches email notifications. Used for broadcast notifications.';
