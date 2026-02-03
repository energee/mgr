-- Fix archive_batch function: FOR UPDATE cannot be applied to nullable side of outer join
-- Solution: Use FOR UPDATE OF b to only lock the batches table

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
  FOR UPDATE OF b;  -- Only lock the batches table

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
      current_batch_id = NULL,
      status = 'dirty',
      updated_at = NOW()
    WHERE id = v_batch.vessel_id;
  END IF;

  -- 3. Cancel any pending allocations for this batch
  FOR v_allocation_id IN
    SELECT id FROM allocations
    WHERE batch_id = p_batch_id
    AND status = 'pending'
  LOOP
    UPDATE allocations
    SET
      status = 'cancelled',
      notes = COALESCE(notes, '') || ' [Auto-cancelled: batch archived]',
      updated_at = NOW()
    WHERE id = v_allocation_id;
  END LOOP;

  -- 4. Record loss if provided
  IF p_loss_volume_bbl IS NOT NULL AND p_loss_volume_bbl > 0 THEN
    INSERT INTO batch_losses (
      batch_id,
      loss_type,
      volume_bbl,
      reason,
      notes,
      recorded_at,
      recorded_by
    ) VALUES (
      p_batch_id,
      'archive',
      p_loss_volume_bbl,
      p_reason,
      p_notes,
      NOW(),
      auth.uid()
    );
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'archived',
    'vessel_released', v_batch.vessel_name
  );

  RETURN v_result;
END;
$$;
