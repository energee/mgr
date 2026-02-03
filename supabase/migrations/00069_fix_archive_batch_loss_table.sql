-- Fix archive_batch function: Use allocations table for loss recording (not batch_losses)
-- Also fixes the FOR UPDATE issue from previous migration

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
  -- Get batch details and lock only the batch row (not the vessel)
  SELECT b.*, v.id AS vessel_id, v.name AS vessel_name
  INTO v_batch
  FROM batches b
  LEFT JOIN vessels v ON v.current_batch_id = b.id
  WHERE b.id = p_batch_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  -- Validate batch can be archived (must be in progress)
  IF v_batch.status NOT IN ('fermenting', 'conditioning', 'packaging') THEN
    RAISE EXCEPTION 'Cannot archive batch in status "%". Archive is for in-progress batches (fermenting, conditioning, packaging). Use cancel for planned batches.', v_batch.status;
  END IF;

  -- Validate reason
  IF p_reason NOT IN ('quality', 'equipment', 'contamination', 'scheduling', 'other') THEN
    RAISE EXCEPTION 'Invalid archive reason: %. Valid values: quality, equipment, contamination, scheduling, other', p_reason;
  END IF;

  -- 1. Update batch status
  UPDATE batches
  SET
    status = 'archived',
    archived_at = NOW(),
    archived_by = auth.uid(),
    archive_reason = p_reason,
    archive_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 2. Release vessel if assigned
  IF v_batch.vessel_id IS NOT NULL THEN
    UPDATE vessels
    SET
      status = 'dirty',
      current_batch_id = NULL,
      updated_at = NOW()
    WHERE id = v_batch.vessel_id;
  END IF;

  -- 3. Record loss allocation (using allocations table, not batch_losses)
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
      'Batch archived: ' || COALESCE(p_notes, p_reason),
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
    notes = COALESCE(notes || ' | ', '') || 'Cancelled due to batch archive'
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
