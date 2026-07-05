-- =============================================================================
-- Migration: Slack Integration
-- =============================================================================
-- Adds Slack notification delivery alongside existing in-app notifications.
-- Uses pg_net for async HTTP calls from notify_all_users() to an API route
-- that formats and sends Slack messages.
-- =============================================================================

-- =============================================================================
-- 1. Enable pg_net extension for async HTTP
-- =============================================================================

-- Tolerate environments without the Supabase-bundled pg_net (plain-Postgres
-- CI / local replays — see PR #322). net.http_post is only referenced inside
-- plpgsql bodies, so nothing below needs the extension at creation time.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net unavailable (non-Supabase environment); Slack delivery disabled: %', SQLERRM;
END $$;

-- =============================================================================
-- 2. Slack Settings Table (singleton)
-- =============================================================================

CREATE TABLE slack_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url TEXT,
  default_channel TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  channel_overrides JSONB NOT NULL DEFAULT '{}',
  internal_secret TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  app_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE slack_settings IS 'Singleton table for Slack integration configuration';
COMMENT ON COLUMN slack_settings.webhook_url IS 'Slack Incoming Webhook URL';
COMMENT ON COLUMN slack_settings.default_channel IS 'Default Slack channel (overrides webhook default)';
COMMENT ON COLUMN slack_settings.is_enabled IS 'Master toggle for Slack notifications';
COMMENT ON COLUMN slack_settings.channel_overrides IS 'Per notification-type channel routing, e.g. {"batch_status": "#production"}';
COMMENT ON COLUMN slack_settings.internal_secret IS 'Auto-generated secret for pg_net → API route authentication';
COMMENT ON COLUMN slack_settings.app_url IS 'App URL for pg_net callbacks, auto-set from Vercel/request headers';

-- Ensure only one row
CREATE UNIQUE INDEX slack_settings_singleton ON slack_settings ((true));

-- Seed with disabled defaults
INSERT INTO slack_settings (is_enabled) VALUES (false);

-- RLS
ALTER TABLE slack_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read slack settings"
  ON slack_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update slack settings"
  ON slack_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 3. Slack Notification Log Table
-- =============================================================================

CREATE TABLE slack_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  action_url TEXT,
  metadata JSONB DEFAULT '{}',
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE slack_notification_log IS 'Audit log of Slack notification delivery attempts';

CREATE INDEX idx_slack_notification_log_status ON slack_notification_log (status);
CREATE INDEX idx_slack_notification_log_created ON slack_notification_log (created_at DESC);

-- RLS
ALTER TABLE slack_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read slack log"
  ON slack_notification_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can insert slack log"
  ON slack_notification_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update slack log"
  ON slack_notification_log FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 4. Schema Registry Entries
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('slack_settings', 'Singleton configuration for Slack webhook integration', 'system', '[]'::jsonb),
  ('slack_notification_log', 'Audit log of Slack notification delivery attempts', 'system', '[]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain;

-- =============================================================================
-- 5. Modify notify_all_users() to also fire Slack notification
-- =============================================================================

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
    -- check-auth-users-leak: skip server-side admin broadcast (SECURITY DEFINER, IDs only, not via PostgREST)
    SELECT DISTINCT id FROM auth.users
  LOOP
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
    v_count := v_count + 1;
  END LOOP;

  -- Slack delivery (fire-and-forget via pg_net)
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

COMMENT ON FUNCTION notify_all_users IS 'Creates a notification for all users and optionally sends to Slack. Used for broadcast notifications.';
