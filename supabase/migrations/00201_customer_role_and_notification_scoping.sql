-- Migration: customer_role_and_notification_scoping
-- Audit fixes C1 + H9 (docs/audits/2026-07-06-feature-audit.md, backlog items 1-3).
--
-- C1: 00097 rewrote create_user_profile() and lost the customer-email->role
--     linking from 00089/00095, so invited portal customers were created with
--     roles=['viewer'] — a STAFF role that passes every staff read policy
--     (orders, customers, recipes, pricing). Restore the customer-role
--     assignment (email match only; the customer_portal_users junction insert
--     from 00095 is NOT restored here because that table was dropped
--     out-of-band on live — the invite API route owns the linking) and
--     backfill existing mis-roled portal users.
--
-- H9: notify_all_users() iterated ALL auth.users, so portal customers
--     received staff broadcast notifications whose title/message embed other
--     customers' names and order numbers. Scope recipients to active,
--     non-customer user_profiles. Redefining the shared function fixes every
--     broadcast caller (order/batch/packaging/inventory triggers) at once.
--
-- Role/permission map note (audit C1 follow-through): 'customer' is already a
-- valid role (validate_user_roles, 00097) and get_roles_for_permission()
-- never includes it, so a customer-role user holds an EMPTY staff permission
-- set — user_has_permission() returns false for every staff policy. The
-- customer-scoped policies (00092/00095, preserved by 00197) key on
-- auth.uid() via the customer_portal_users junction, not on the role string,
-- so no permission-map change is needed here.

-- =============================================================================
-- SECTION 1: create_user_profile() — assign 'customer' role on email match
-- =============================================================================
-- Based on the 00097 definition (the newest; 00095's version was superseded).
-- Precedence: customer match wins over first-user-admin so a fresh replay
-- against a database that already has customer records can never hand the
-- admin bootstrap to a customer email. On a truly empty database the
-- customers table is empty, so the first real user still becomes admin.
-- ON CONFLICT upsert semantics are preserved: an existing profile keeps its
-- roles untouched (only email/display_name/updated_at refresh).
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roles TEXT[] := ARRAY['viewer'];
  v_is_first BOOLEAN := false;
  v_is_customer BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM customers c
    WHERE lower(c.email) = lower(NEW.email)
      AND COALESCE(c.is_active, true)
  ) INTO v_is_customer;

  SELECT NOT EXISTS (SELECT 1 FROM user_profiles) INTO v_is_first;

  IF v_is_customer THEN v_roles := ARRAY['customer'];
  ELSIF v_is_first THEN v_roles := ARRAY['admin'];
  END IF;

  INSERT INTO user_profiles (id, email, display_name, roles, status, created_at)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_roles, 'active', now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(user_profiles.display_name, EXCLUDED.display_name),
    updated_at = now();
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION create_user_profile IS
  'Auth-user trigger: creates/refreshes the user_profiles row. Roles: ''customer'' when the email case-insensitively matches an active customers.email, else ''admin'' for the very first profile, else ''viewer''. Existing profiles keep their roles (upsert only refreshes email/display_name).';

-- =============================================================================
-- SECTION 2: Backfill mis-roled portal users (viewer -> customer)
-- =============================================================================
-- Only exact roles=['viewer'] rows are touched: that is the default the buggy
-- trigger assigned, so staff users (admin/brewer/etc, or multi-role) whose
-- email happens to match a customer record are never downgraded.
UPDATE user_profiles SET
  roles = ARRAY['customer'],
  updated_at = now()
WHERE roles = ARRAY['viewer']
  AND lower(email) IN (SELECT lower(email) FROM customers WHERE email IS NOT NULL);

-- =============================================================================
-- SECTION 3: notify_all_users() — staff-only broadcast recipients
-- =============================================================================
-- Based on the newest definition (00191 live capture, which layered email
-- dispatch + Slack on top of 00022/00090). Only the recipient loop changes:
-- active, non-customer user_profiles instead of all auth.users.
CREATE OR REPLACE FUNCTION public.notify_all_users(p_type text, p_title text, p_message text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'normal'::text, p_action_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_count INTEGER := 0;
  v_slack RECORD;
  v_log_id UUID;
BEGIN
  -- Staff only (audit H9): broadcast payloads embed customer names and order
  -- numbers, so portal customers must never be recipients.
  FOR v_user IN
    SELECT id FROM user_profiles
    WHERE status = 'active' AND NOT ('customer' = ANY(roles))
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
      RAISE WARNING 'Email dispatch failed for user %: %', v_user.id, SQLERRM;
    END;

    v_count := v_count + 1;
  END LOOP;

  SELECT is_enabled, internal_secret, app_url
    INTO v_slack
    FROM slack_settings
    LIMIT 1;

  IF v_slack.is_enabled THEN
    INSERT INTO slack_notification_log (notification_type, title, message, priority, action_url, metadata, status)
    VALUES (p_type, p_title, p_message, p_priority, p_action_url, p_metadata, 'pending')
    RETURNING id INTO v_log_id;

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
      UPDATE slack_notification_log
        SET status = 'skipped', error_message = 'app_url not configured in slack_settings'
        WHERE id = v_log_id;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION notify_all_users IS
  'Creates a notification for all ACTIVE STAFF users (excludes customer-role portal users — payloads may embed other customers'' data) and optionally dispatches email + Slack. Used for broadcast notifications.';

-- Reload PostgREST schema cache so the API picks up the refreshed definitions.
NOTIFY pgrst, 'reload schema';
