-- =============================================================================
-- Migration: In-App Notifications System
-- =============================================================================
-- Creates notification infrastructure for real-time alerts and updates.
-- Supports various notification types, read/unread status, and realtime updates.
-- =============================================================================

-- =============================================================================
-- 1. Notifications Table
-- =============================================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- Recipient user
  type TEXT NOT NULL,  -- 'batch_status', 'inventory_low', 'order_received', etc.
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,  -- Optional: 'batch', 'order', 'inventory_item'
  entity_id UUID,  -- Optional: ID of related entity
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  read_at TIMESTAMPTZ,  -- NULL if unread
  dismissed_at TIMESTAMPTZ,  -- NULL if not dismissed
  action_url TEXT,  -- Optional: URL to navigate to
  metadata JSONB DEFAULT '{}',  -- Additional context
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at TIMESTAMPTZ  -- Optional: auto-cleanup old notifications
);

COMMENT ON TABLE notifications IS 'In-app notifications for users. Supports realtime updates via Supabase Realtime.';
COMMENT ON COLUMN notifications.type IS 'Notification category: batch_status, inventory_low, order_received, system, etc.';
COMMENT ON COLUMN notifications.priority IS 'Notification importance: low, normal, high, urgent';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was read (NULL if unread)';
COMMENT ON COLUMN notifications.dismissed_at IS 'Timestamp when notification was dismissed';
COMMENT ON COLUMN notifications.action_url IS 'URL to navigate to when notification is clicked';

-- Indexes for common queries
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- 2. Notification Preferences Table
-- =============================================================================

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  -- Per-type preferences (enable/disable)
  batch_status_enabled BOOLEAN DEFAULT true,
  inventory_low_enabled BOOLEAN DEFAULT true,
  order_received_enabled BOOLEAN DEFAULT true,
  system_enabled BOOLEAN DEFAULT true,
  -- Delivery preferences
  in_app_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,
  email_digest_frequency TEXT DEFAULT 'never' CHECK (email_digest_frequency IN ('never', 'daily', 'weekly')),
  -- Quiet hours (don't send notifications during these times)
  quiet_hours_enabled BOOLEAN DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE notification_preferences IS 'User notification preferences for controlling what notifications they receive.';

-- =============================================================================
-- 3. Notification Types Reference
-- =============================================================================

-- Common notification types:
-- batch_status: Batch moved to new status (fermenting, packaging, completed)
-- inventory_low: Inventory item below reorder point
-- inventory_expiring: Lot approaching expiration date
-- order_received: New customer order received
-- order_status: Order status changed
-- po_confirmed: Purchase order confirmed by supplier
-- po_received: Items received against PO
-- system: System announcements and updates

-- =============================================================================
-- 4. Helper Functions
-- =============================================================================

-- Create a notification for a user
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal',
  p_action_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id UUID;
  v_prefs notification_preferences%ROWTYPE;
BEGIN
  -- Check user preferences
  SELECT * INTO v_prefs
  FROM notification_preferences
  WHERE user_id = p_user_id;

  -- If no preferences, create default
  IF NOT FOUND THEN
    INSERT INTO notification_preferences (user_id) VALUES (p_user_id)
    RETURNING * INTO v_prefs;
  END IF;

  -- Check if this notification type is enabled
  IF (p_type = 'batch_status' AND NOT v_prefs.batch_status_enabled) OR
     (p_type = 'inventory_low' AND NOT v_prefs.inventory_low_enabled) OR
     (p_type = 'order_received' AND NOT v_prefs.order_received_enabled) OR
     (p_type = 'system' AND NOT v_prefs.system_enabled) THEN
    RETURN NULL;
  END IF;

  -- Check in-app notifications enabled
  IF NOT v_prefs.in_app_enabled THEN
    RETURN NULL;
  END IF;

  -- Create the notification
  INSERT INTO notifications (
    user_id, type, title, message, entity_type, entity_id, priority, action_url, metadata
  ) VALUES (
    p_user_id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_priority, p_action_url, p_metadata
  ) RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

COMMENT ON FUNCTION create_notification IS 'Creates a notification for a user, respecting their preferences.';

-- Mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET read_at = now()
  WHERE id = p_notification_id
    AND user_id = (SELECT auth.uid())
    AND read_at IS NULL;
END;
$$;

-- Mark all notifications as read for a user
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE notifications
  SET read_at = now()
  WHERE user_id = (SELECT auth.uid())
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Dismiss a notification
CREATE OR REPLACE FUNCTION dismiss_notification(p_notification_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET dismissed_at = now()
  WHERE id = p_notification_id
    AND user_id = (SELECT auth.uid());
END;
$$;

-- Clean up old/expired notifications
CREATE OR REPLACE FUNCTION cleanup_old_notifications(p_days_old INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM notifications
  WHERE (expires_at IS NOT NULL AND expires_at < now())
     OR (created_at < now() - (p_days_old || ' days')::interval AND read_at IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =============================================================================
-- 5. Views
-- =============================================================================

-- Unread notifications for current user
CREATE VIEW my_unread_notifications
WITH (security_invoker = true)
AS
SELECT
  id,
  type,
  title,
  message,
  entity_type,
  entity_id,
  priority,
  action_url,
  metadata,
  created_at
FROM notifications
WHERE user_id = (SELECT auth.uid())
  AND read_at IS NULL
  AND dismissed_at IS NULL
ORDER BY
  CASE priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    WHEN 'low' THEN 4
  END,
  created_at DESC;

COMMENT ON VIEW my_unread_notifications IS 'Unread notifications for the current user, ordered by priority and date.';

-- All notifications for current user (with pagination support)
CREATE VIEW my_notifications
WITH (security_invoker = true)
AS
SELECT
  id,
  type,
  title,
  message,
  entity_type,
  entity_id,
  priority,
  action_url,
  metadata,
  read_at IS NOT NULL as is_read,
  created_at
FROM notifications
WHERE user_id = (SELECT auth.uid())
  AND dismissed_at IS NULL
ORDER BY created_at DESC;

COMMENT ON VIEW my_notifications IS 'All non-dismissed notifications for the current user.';

-- =============================================================================
-- 6. RLS Policies
-- =============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- Users can only update their own notifications (mark read, dismiss)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

-- System can insert notifications (via SECURITY DEFINER function)
CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (true);

-- Users can delete their own notifications
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Users can manage their own preferences
CREATE POLICY preferences_all ON notification_preferences
  FOR ALL USING (user_id = (SELECT auth.uid()));

-- =============================================================================
-- 7. Enable Realtime
-- =============================================================================

-- Enable realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- =============================================================================
-- 8. Schema Registry Entry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples)
VALUES
('notifications', 'In-app notifications for users with realtime support.', 'system',
 '["belongs_to: users"]',
 '["user_id", "type", "title", "priority", "read_at", "created_at"]',
 NULL,
 '["Get my unread notifications", "Mark notification as read", "Get notifications for today"]'),
('notification_preferences', 'User preferences for notification delivery.', 'system',
 '["belongs_to: users"]',
 '["user_id", "in_app_enabled", "email_enabled"]',
 NULL,
 '["Get my notification preferences", "Update email digest frequency"]')
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
