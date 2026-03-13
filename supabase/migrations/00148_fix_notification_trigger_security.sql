-- Migration: Fix SECURITY DEFINER on packaging notification trigger
--
-- The trigger_packaging_completion_notification function was created in 00145
-- with SECURITY DEFINER, violating the project convention of SECURITY INVOKER.
-- RLS is handled at the table level, so DEFINER is unnecessary here.

CREATE OR REPLACE FUNCTION trigger_packaging_completion_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
-- Use SECURITY INVOKER per project convention. RLS policies on the
-- notifications and packaging_sessions tables handle access control,
-- so there is no need for elevated privileges.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line_count INTEGER;
  v_total_units INTEGER;
  v_brands TEXT;
  v_action_url TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF OLD.status = NEW.status OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Derive summary from session line items instead of stale columns
  SELECT
    COUNT(*),
    COALESCE(SUM(actual_quantity), 0),
    string_agg(DISTINCT b.name, ', ')
  INTO v_line_count, v_total_units, v_brands
  FROM session_line_items sli
  LEFT JOIN brands b ON b.id = sli.brand_id
  WHERE sli.session_id = NEW.id;

  v_action_url := '/production/packaging-sessions/' || NEW.id;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    'Packaging Complete',
    'Packaging session completed: ' ||
      COALESCE(v_brands, 'Unknown') || ' — ' ||
      v_total_units || ' units across ' || v_line_count || ' line items.',
    'packaging_session',
    NEW.id,
    'normal',
    v_action_url,
    jsonb_build_object(
      'brands', v_brands,
      'total_units', v_total_units,
      'line_count', v_line_count
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_packaging_completion_notification IS
  'Notification trigger for packaging session completion. Derives summary from session line items. Uses SECURITY INVOKER per project convention.';
