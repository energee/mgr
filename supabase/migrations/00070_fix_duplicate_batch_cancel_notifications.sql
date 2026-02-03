-- =============================================================================
-- Migration: Fix duplicate batch cancellation notifications
-- =============================================================================
-- The trigger_batch_status_notification() function handles 'cancelled' status,
-- but notify_batch_cancelled() (from 00042) also handles it with proper user
-- exclusion. This causes duplicate notifications when cancelling a batch.
--
-- Fix: Remove 'cancelled' case from trigger_batch_status_notification() since
-- notify_batch_cancelled() handles it better (excludes triggering user).
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_batch_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_priority TEXT := 'normal';
  v_action_url TEXT;
BEGIN
  -- Only trigger on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Build notification based on new status
  v_action_url := '/production/batches/' || NEW.id;

  CASE NEW.status
    WHEN 'fermenting' THEN
      v_title := 'Batch Started Fermenting';
      v_message := NEW.batch_number || ' (' || COALESCE(NEW.name, 'Unnamed') || ') has started fermentation.';
      v_priority := 'normal';
    WHEN 'conditioning' THEN
      v_title := 'Batch Moved to Conditioning';
      v_message := NEW.batch_number || ' is now conditioning.';
      v_priority := 'normal';
    WHEN 'packaging' THEN
      v_title := 'Batch Ready for Packaging';
      v_message := NEW.batch_number || ' (' || COALESCE(NEW.name, 'Unnamed') || ') is ready to be packaged.';
      v_priority := 'high';
    WHEN 'completed' THEN
      v_title := 'Batch Completed';
      v_message := NEW.batch_number || ' has been completed and is ready for sale.';
      v_priority := 'normal';
    -- NOTE: 'cancelled' is handled by notify_batch_cancelled() in migration 00042
    -- which properly excludes the triggering user from notifications
    WHEN 'archived' THEN
      -- archived also handled by notify_batch_cancelled() if needed
      RETURN NEW;
    ELSE
      -- Don't notify for other status changes (including cancelled)
      RETURN NEW;
  END CASE;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    v_title,
    v_message,
    'batch',
    NEW.id,
    v_priority,
    v_action_url,
    jsonb_build_object(
      'batch_number', NEW.batch_number,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_batch_status_notification IS 'Notifies all users of batch status changes. Cancelled/archived status handled by notify_batch_cancelled() to properly exclude triggering user.';
