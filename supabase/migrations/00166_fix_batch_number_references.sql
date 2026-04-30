-- Fix stale batch_number references after rename to batch_code (migration 00155)
--
-- Functions created before 00155 still reference the old column name.
-- PL/pgSQL resolves record fields at runtime, so these fail when called.

-- =============================================================================
-- 1. Fix archive_batch (from 00069)
-- =============================================================================

CREATE OR REPLACE FUNCTION archive_batch(
  p_batch_id UUID,
  p_reason TEXT,
  p_loss_volume_bbl DECIMAL DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_allocation_id UUID;
  v_result JSONB;
BEGIN
  SELECT b.*, v.id AS vessel_id, v.name AS vessel_name
  INTO v_batch
  FROM batches b
  LEFT JOIN vessels v ON v.current_batch_id = b.id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  IF v_batch.status NOT IN ('fermenting', 'conditioning', 'packaging') THEN
    RAISE EXCEPTION 'Cannot archive batch in status "%". Archive is for in-progress batches (fermenting, conditioning, packaging). Use cancel for planned batches.', v_batch.status;
  END IF;

  IF p_reason NOT IN ('quality', 'equipment', 'contamination', 'scheduling', 'other') THEN
    RAISE EXCEPTION 'Invalid archive reason: %. Valid values: quality, equipment, contamination, scheduling, other', p_reason;
  END IF;

  UPDATE batches
  SET
    status = 'archived',
    archived_at = NOW(),
    archived_by = auth.uid(),
    archive_reason = p_reason,
    archive_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_batch_id;

  IF v_batch.vessel_id IS NOT NULL THEN
    UPDATE vessels
    SET
      status = 'dirty',
      current_batch_id = NULL,
      updated_at = NOW()
    WHERE id = v_batch.vessel_id;
  END IF;

  IF p_loss_volume_bbl IS NOT NULL AND p_loss_volume_bbl > 0 THEN
    INSERT INTO allocations (
      source_type, source_id, destination_type, destination_id,
      quantity, volume_bbl, status, reason_code, notes, completed_at, created_by
    ) VALUES (
      'batch', p_batch_id, 'loss', NULL,
      p_loss_volume_bbl, p_loss_volume_bbl, 'completed',
      CASE p_reason
        WHEN 'quality' THEN 'sample_quality'
        WHEN 'contamination' THEN 'contamination'
        WHEN 'equipment' THEN 'breakage'
        ELSE 'spillage'
      END,
      'Batch archived: ' || COALESCE(p_notes, p_reason),
      NOW(), auth.uid()
    )
    RETURNING id INTO v_allocation_id;
  END IF;

  UPDATE allocations
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    notes = COALESCE(notes || ' | ', '') || 'Cancelled due to batch archive'
  WHERE source_type = 'batch'
    AND source_id = p_batch_id
    AND status IN ('planned', 'pending_approval');

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'batch_code', v_batch.batch_code,
    'previous_status', v_batch.status,
    'reason', p_reason,
    'loss_volume_bbl', p_loss_volume_bbl,
    'vessel_released', v_batch.vessel_name,
    'loss_allocation_id', v_allocation_id
  );

  RETURN v_result;
END;
$$;

-- =============================================================================
-- 2. Fix cancel_batch (from 00042)
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_batch(
  p_batch_id UUID,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
BEGIN
  SELECT * INTO v_batch
  FROM batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  IF v_batch.status != 'planned' THEN
    RAISE EXCEPTION 'Can only cancel planned batches. Current status: "%". Use archive for in-progress batches.', v_batch.status;
  END IF;

  UPDATE batches
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = p_reason,
    notes = CASE
      WHEN p_notes IS NOT NULL THEN COALESCE(notes || E'\n', '') || p_notes
      ELSE notes
    END,
    updated_at = NOW()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'batch_code', v_batch.batch_code,
    'previous_status', v_batch.status,
    'reason', p_reason
  );
END;
$$;

-- =============================================================================
-- 3. Fix trigger_batch_status_notification (from 00070)
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
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_action_url := '/production/batches/' || NEW.id;

  CASE NEW.status
    WHEN 'fermenting' THEN
      v_title := 'Batch Started Fermenting';
      v_message := NEW.batch_code || ' (' || COALESCE(NEW.name, 'Unnamed') || ') has started fermentation.';
    WHEN 'conditioning' THEN
      v_title := 'Batch Moved to Conditioning';
      v_message := NEW.batch_code || ' is now conditioning.';
    WHEN 'packaging' THEN
      v_title := 'Batch Ready for Packaging';
      v_message := NEW.batch_code || ' (' || COALESCE(NEW.name, 'Unnamed') || ') is ready to be packaged.';
      v_priority := 'high';
    WHEN 'completed' THEN
      v_title := 'Batch Completed';
      v_message := NEW.batch_code || ' has been completed and is ready for sale.';
    WHEN 'archived' THEN
      RETURN NEW;
    ELSE
      RETURN NEW;
  END CASE;

  PERFORM notify_all_users(
    'batch_status',
    v_title,
    v_message,
    'batch',
    NEW.id,
    v_priority,
    v_action_url,
    jsonb_build_object(
      'batch_code', NEW.batch_code,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 4. Fix notify_batch_cancelled (from 00042)
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_batch_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status != 'cancelled') THEN
    INSERT INTO notifications (
      user_id, type, title, message, entity_type, entity_id,
      priority, action_url, metadata
    )
    SELECT
      up.id,
      'batch',
      'Batch Cancelled',
      'Batch ' || NEW.batch_code || ' (' || NEW.name || ') was cancelled: ' ||
        COALESCE(NEW.cancellation_reason, 'No reason specified'),
      'batch',
      NEW.id,
      'high',
      '/production/batches/' || NEW.id,
      jsonb_build_object(
        'batch_code', NEW.batch_code,
        'reason', NEW.cancellation_reason,
        'previous_status', OLD.status
      )
    FROM user_profiles up
    WHERE up.role IN ('admin', 'production_manager')
      AND up.status = 'active'
      AND up.id != COALESCE(NEW.cancelled_by, '00000000-0000-0000-0000-000000000000');
  END IF;

  RETURN NEW;
END;
$$;

-- Done
SELECT 'Fixed batch_number → batch_code references in 4 functions' AS message;
