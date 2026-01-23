-- Migration: 00052_batch_archived_state.sql
-- Purpose: Add 'archived' state for in-progress batches terminated with loss
--
-- Semantic distinction:
-- - 'cancelled': For planned batches that never started (no product loss)
-- - 'archived': For in-progress batches that were terminated (with product loss)

-- =============================================================================
-- 1. Add 'archived' to enum_values for batch_status
-- =============================================================================

-- Add archived state
INSERT INTO enum_values (enum_type, value, label, description, color, sort_order, is_default, metadata)
VALUES
  ('batch_status', 'archived', 'Archived', 'Batch was terminated during production (with loss)', 'error', 65, FALSE, '{"next_states": []}'::jsonb)
ON CONFLICT (enum_type, value) DO NOTHING;

-- Update transitions for existing states:
-- planned can only go to cancelled (not archived - no loss to record)
-- fermenting/conditioning/packaging can only go to archived (not cancelled - has loss)
UPDATE enum_values
SET metadata = '{"next_states": ["fermenting"]}'::jsonb
WHERE enum_type = 'batch_status' AND value = 'planned';

UPDATE enum_values
SET metadata = '{"next_states": ["conditioning"]}'::jsonb
WHERE enum_type = 'batch_status' AND value = 'fermenting';

UPDATE enum_values
SET metadata = '{"next_states": ["packaging"]}'::jsonb
WHERE enum_type = 'batch_status' AND value = 'conditioning';

UPDATE enum_values
SET metadata = '{"next_states": ["completed"]}'::jsonb
WHERE enum_type = 'batch_status' AND value = 'packaging';

-- Update cancelled to use 'muted' color (less severe, just means "didn't happen")
UPDATE enum_values
SET color = 'muted', description = 'Planned batch was cancelled before starting'
WHERE enum_type = 'batch_status' AND value = 'cancelled';

-- =============================================================================
-- 2. Add archived tracking fields to batches (if not exists)
-- =============================================================================

ALTER TABLE batches
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS archive_reason TEXT,
ADD COLUMN IF NOT EXISTS archive_notes TEXT;

COMMENT ON COLUMN batches.archived_at IS 'Timestamp when in-progress batch was archived';
COMMENT ON COLUMN batches.archived_by IS 'User who archived the batch';
COMMENT ON COLUMN batches.archive_reason IS 'Reason code for archiving: quality, equipment, contamination, scheduling, other';
COMMENT ON COLUMN batches.archive_notes IS 'Additional notes about archiving';

-- =============================================================================
-- 3. Create archive_batch function for in-progress batches
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

  -- 3. Record loss allocation (required for archived batches)
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

COMMENT ON FUNCTION archive_batch IS 'Archives an in-progress batch with proper cleanup: releases vessel, records loss, cancels pending allocations. Use for batches in fermenting/conditioning/packaging state.';

-- =============================================================================
-- 4. Update cancel_batch to only work for planned batches
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
  v_result JSONB;
BEGIN
  -- Get batch details and lock the row
  SELECT b.*
  INTO v_batch
  FROM batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  -- Validate batch can be cancelled (must be planned)
  IF v_batch.status != 'planned' THEN
    RAISE EXCEPTION 'Cannot cancel batch in status "%". Cancel is for planned batches only. Use archive for in-progress batches (fermenting, conditioning, packaging).', v_batch.status;
  END IF;

  -- Validate reason (optional for planned batches, simpler reasons)
  IF p_reason IS NOT NULL AND p_reason NOT IN ('scheduling', 'recipe_change', 'capacity', 'other') THEN
    RAISE EXCEPTION 'Invalid cancellation reason: %. Valid values: scheduling, recipe_change, capacity, other', p_reason;
  END IF;

  -- 1. Update batch status
  UPDATE batches
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = COALESCE(p_reason, 'scheduling'),
    cancellation_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 2. Cancel any pending allocations TO this batch (e.g., ingredient reservations)
  UPDATE allocations
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    notes = COALESCE(notes || ' | ', '') || 'Cancelled due to batch cancellation'
  WHERE destination_type = 'batch'
    AND destination_id = p_batch_id
    AND status IN ('planned', 'pending_approval');

  -- Build result (no vessel release or loss for planned batches)
  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'batch_number', v_batch.batch_number,
    'previous_status', v_batch.status,
    'reason', COALESCE(p_reason, 'scheduling')
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION cancel_batch IS 'Cancels a planned batch. Use for batches that never started (planned status only). For in-progress batches, use archive_batch instead.';

-- =============================================================================
-- 5. Update batches_with_brew_info view to include archive info
-- =============================================================================

DROP VIEW IF EXISTS batches_with_brew_info CASCADE;

CREATE OR REPLACE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
SELECT
  b.*,
  -- Get brew date from linked brew log (use earliest if multiple)
  (
    SELECT MIN(bl.brew_date)
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS brew_date,
  -- Get OG from linked brew log (weighted average if multiple)
  (
    SELECT
      CASE
        WHEN SUM(blb.volume_bbl) > 0 THEN
          SUM(
            blb.volume_bbl * (
              SELECT (m->>'value')::DECIMAL(4,1)
              FROM jsonb_array_elements(bl.events) e,
                   jsonb_array_elements(e->'measurements') m
              WHERE e->>'phase' IN ('ko_end', 'boil_end')
                AND m->>'metric' = 'gravity_plato'
              LIMIT 1
            )
          ) / SUM(blb.volume_bbl)
        ELSE NULL
      END
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS actual_og,
  -- Get brewer name from linked brew log
  (
    SELECT brewer_up.display_name
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    LEFT JOIN user_profiles brewer_up ON brewer_up.id = bl.brewer_id
    WHERE blb.batch_id = b.id
    ORDER BY bl.brew_date DESC NULLS LAST
    LIMIT 1
  ) AS brewer,
  -- Get brew log id for linking
  (
    SELECT bl.id
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
    ORDER BY bl.brew_date DESC NULLS LAST
    LIMIT 1
  ) AS brew_log_id,
  -- Cancellation display
  CASE b.cancellation_reason
    WHEN 'scheduling' THEN 'Schedule Change'
    WHEN 'recipe_change' THEN 'Recipe Change'
    WHEN 'capacity' THEN 'Capacity Issue'
    WHEN 'other' THEN 'Other'
  END AS cancellation_reason_display,
  -- Archive display
  CASE b.archive_reason
    WHEN 'quality' THEN 'Quality Issue'
    WHEN 'equipment' THEN 'Equipment Failure'
    WHEN 'contamination' THEN 'Contamination'
    WHEN 'scheduling' THEN 'Scheduling Change'
    WHEN 'other' THEN 'Other'
  END AS archive_reason_display,
  -- User who cancelled/archived
  cancel_up.display_name AS cancelled_by_name,
  archive_up.display_name AS archived_by_name
FROM batches b
LEFT JOIN user_profiles cancel_up ON cancel_up.id = b.cancelled_by
LEFT JOIN user_profiles archive_up ON archive_up.id = b.archived_by;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs and termination info (cancellation for planned, archive for in-progress)';

-- =============================================================================
-- 6. Update notification trigger for batch termination
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_batch_terminated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_reason TEXT;
BEGIN
  -- Determine action type
  IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status != 'cancelled') THEN
    v_action := 'cancelled';
    v_reason := NEW.cancellation_reason;
  ELSIF NEW.status = 'archived' AND (OLD.status IS NULL OR OLD.status != 'archived') THEN
    v_action := 'archived';
    v_reason := NEW.archive_reason;
  ELSE
    RETURN NEW;
  END IF;

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
    'Batch ' || INITCAP(v_action),
    'Batch ' || NEW.batch_number || ' (' || NEW.name || ') was ' || v_action || ': ' ||
      COALESCE(v_reason, 'No reason specified'),
    'batch',
    NEW.id,
    CASE WHEN v_action = 'archived' THEN 'high' ELSE 'medium' END,
    '/production/batches/' || NEW.id,
    jsonb_build_object(
      'batch_number', NEW.batch_number,
      'action', v_action,
      'reason', v_reason,
      'previous_status', OLD.status
    )
  FROM user_profiles up
  WHERE up.role IN ('admin', 'production_manager')
    AND up.status = 'active'
    AND up.id != COALESCE(
      CASE WHEN v_action = 'cancelled' THEN NEW.cancelled_by ELSE NEW.archived_by END,
      '00000000-0000-0000-0000-000000000000'
    );

  RETURN NEW;
END;
$$;

-- Drop old trigger and create new one
DROP TRIGGER IF EXISTS on_batch_cancelled ON batches;
DROP TRIGGER IF EXISTS on_batch_terminated ON batches;

CREATE TRIGGER on_batch_terminated
  AFTER UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION notify_batch_terminated();

-- =============================================================================
-- 7. Schema Registry Update
-- =============================================================================

UPDATE _schema_registry
SET
  key_fields = key_fields || '["archived_at", "archive_reason"]'::jsonb,
  ai_context = '"Production batch entity with full lifecycle: planned → fermenting → conditioning → packaging → completed. Planned batches can be cancelled (no loss). In-progress batches can be archived (with loss recording). Termination releases vessel and cancels pending allocations."'::jsonb
WHERE table_name = 'batches';
