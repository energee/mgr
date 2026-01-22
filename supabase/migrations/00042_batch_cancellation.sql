-- Migration: 00042_batch_cancellation.sql
-- Purpose: Implement batch cancellation workflow with proper cleanup
-- Phase: 14.5 Batch Cancellation Workflow

-- =============================================================================
-- 1. Add cancellation tracking fields to batches
-- =============================================================================

ALTER TABLE batches
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS cancellation_notes TEXT;

COMMENT ON COLUMN batches.cancelled_at IS 'Timestamp when batch was cancelled';
COMMENT ON COLUMN batches.cancelled_by IS 'User who cancelled the batch';
COMMENT ON COLUMN batches.cancellation_reason IS 'Reason code for cancellation: quality, equipment, contamination, scheduling, other';
COMMENT ON COLUMN batches.cancellation_notes IS 'Additional notes about cancellation';

-- =============================================================================
-- 2. Create batch cancellation function
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_batch(
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
  -- Get batch details and lock the row
  SELECT b.*, v.id AS vessel_id, v.name AS vessel_name
  INTO v_batch
  FROM batches b
  LEFT JOIN vessels v ON v.current_batch_id = b.id
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  -- Validate batch can be cancelled
  IF v_batch.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel completed batch';
  END IF;

  IF v_batch.status = 'cancelled' THEN
    RAISE EXCEPTION 'Batch is already cancelled';
  END IF;

  -- Validate reason
  IF p_reason NOT IN ('quality', 'equipment', 'contamination', 'scheduling', 'other') THEN
    RAISE EXCEPTION 'Invalid cancellation reason: %. Valid values: quality, equipment, contamination, scheduling, other', p_reason;
  END IF;

  -- 1. Update batch status
  UPDATE batches
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = p_reason,
    cancellation_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 2. Release vessel if assigned
  IF v_batch.vessel_id IS NOT NULL THEN
    -- Create a vessel transfer record for the release
    INSERT INTO vessel_transfers (
      batch_id,
      from_vessel_id,
      to_vessel_id,
      transfer_type,
      volume_bbl,
      notes
    ) VALUES (
      p_batch_id,
      v_batch.vessel_id,
      NULL,  -- No destination vessel
      'dump',
      COALESCE(p_loss_volume_bbl, v_batch.volume_bbl, 0),
      'Batch cancelled: ' || p_reason
    );

    -- Update vessel status to dirty
    UPDATE vessels
    SET
      status = 'dirty',
      current_batch_id = NULL,
      updated_at = NOW()
    WHERE id = v_batch.vessel_id;
  END IF;

  -- 3. Record loss allocation if volume specified
  IF p_loss_volume_bbl IS NOT NULL AND p_loss_volume_bbl > 0 THEN
    INSERT INTO allocations (
      source_type,
      source_id,
      destination_type,
      destination_id,
      quantity,
      volume_bbl,
      status,
      reason_code,
      notes,
      completed_at,
      created_by
    ) VALUES (
      'batch',
      p_batch_id,
      'loss',
      NULL,
      p_loss_volume_bbl,
      p_loss_volume_bbl,
      'completed',
      CASE p_reason
        WHEN 'quality' THEN 'sample_quality'
        WHEN 'contamination' THEN 'contamination'
        WHEN 'equipment' THEN 'breakage'
        ELSE 'spillage'
      END,
      'Batch cancelled: ' || COALESCE(p_notes, p_reason),
      NOW(),
      auth.uid()
    )
    RETURNING id INTO v_allocation_id;
  END IF;

  -- 4. Cancel any pending allocations FROM this batch
  UPDATE allocations
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    notes = COALESCE(notes || ' | ', '') || 'Cancelled due to batch cancellation'
  WHERE source_type = 'batch'
    AND source_id = p_batch_id
    AND status IN ('planned', 'pending_approval');

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'batch_number', v_batch.batch_number,
    'previous_status', v_batch.status,
    'reason', p_reason,
    'loss_volume_bbl', p_loss_volume_bbl,
    'vessel_released', v_batch.vessel_name,
    'loss_allocation_id', v_allocation_id
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION cancel_batch IS 'Cancels a batch with proper cleanup: releases vessel, records loss, cancels pending allocations';

-- =============================================================================
-- 3. Update batches_with_brew_info view to include cancellation info
-- =============================================================================

-- Drop existing view
DROP VIEW IF EXISTS batches_with_brew_info CASCADE;

-- Recreate with cancellation fields
CREATE OR REPLACE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
SELECT
  b.*,
  -- Brew log info (may have multiple, take the most recent)
  bl.brew_date,
  bl.actual_og,
  bl.brewer,
  bl.brew_log_id,
  -- Cancellation display
  CASE b.cancellation_reason
    WHEN 'quality' THEN 'Quality Issue'
    WHEN 'equipment' THEN 'Equipment Failure'
    WHEN 'contamination' THEN 'Contamination'
    WHEN 'scheduling' THEN 'Scheduling Change'
    WHEN 'other' THEN 'Other'
  END AS cancellation_reason_display,
  -- User who cancelled (from profiles)
  up.display_name AS cancelled_by_name
FROM batches b
LEFT JOIN LATERAL (
  SELECT
    bl.brew_date,
    bl.actual_og,
    bl.brewer,
    bl.id AS brew_log_id
  FROM brew_logs bl
  JOIN brew_log_batches blb ON blb.brew_log_id = bl.id
  WHERE blb.batch_id = b.id
  ORDER BY bl.brew_date DESC NULLS LAST
  LIMIT 1
) bl ON true
LEFT JOIN user_profiles up ON up.id = b.cancelled_by;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with linked brew log data (brew_date, actual_og, brewer) and cancellation info';

-- =============================================================================
-- 4. Create notification trigger for batch cancellation
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_batch_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trigger when status changes to cancelled
  IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status != 'cancelled') THEN
    -- Create notification for production managers
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      priority,
      action_url,
      metadata
    )
    SELECT
      up.id,
      'batch',
      'Batch Cancelled',
      'Batch ' || NEW.batch_number || ' (' || NEW.name || ') was cancelled: ' ||
        COALESCE(NEW.cancellation_reason, 'No reason specified'),
      'batch',
      NEW.id,
      'high',
      '/production/batches/' || NEW.id,
      jsonb_build_object(
        'batch_number', NEW.batch_number,
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

-- Create trigger
DROP TRIGGER IF EXISTS on_batch_cancelled ON batches;
CREATE TRIGGER on_batch_cancelled
  AFTER UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION notify_batch_cancelled();

-- =============================================================================
-- 5. Schema Registry Entry
-- =============================================================================

-- Update batches entry to include cancellation fields
UPDATE _schema_registry
SET
  key_fields = key_fields || '["cancelled_at", "cancellation_reason"]'::jsonb,
  ai_context = '"Production batch entity with full lifecycle: planned → fermenting → conditioning → packaging → completed. Can be cancelled from any non-completed state. Cancellation records loss in allocations and releases vessel."'::jsonb
WHERE table_name = 'batches';
