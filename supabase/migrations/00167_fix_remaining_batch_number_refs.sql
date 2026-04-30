-- Fix remaining stale batch_number references after rename to batch_code (00155).
-- Earlier migration 00161 created a new cancel_batch overload instead of replacing
-- the 4-arg version because signatures differed. Also fixes notify_batch_terminated
-- (client calls fail with "record 'new' has no field 'batch_number'") and
-- analyze_batch_performance. Expands batch state machine to allow completion from
-- fermenting/conditioning (for imported batches that were never packaged here).

-- =============================================================================
-- 1. cancel_batch — drop both overloads, recreate with 4-arg signature
-- =============================================================================
DROP FUNCTION IF EXISTS cancel_batch(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS cancel_batch(UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION cancel_batch(
  p_batch_id UUID,
  p_reason TEXT,
  p_loss_volume_bbl NUMERIC DEFAULT NULL,
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
    RAISE EXCEPTION 'Cannot cancel batch in status "%". Cancel is for planned batches only. Use archive for in-progress batches.', v_batch.status;
  END IF;

  IF p_reason IS NOT NULL AND p_reason NOT IN ('scheduling', 'recipe_change', 'capacity', 'other') THEN
    RAISE EXCEPTION 'Invalid cancellation reason: %. Valid values: scheduling, recipe_change, capacity, other', p_reason;
  END IF;

  UPDATE batches
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = auth.uid(),
    cancellation_reason = COALESCE(p_reason, 'scheduling'),
    cancellation_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_batch_id;

  UPDATE allocations
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    notes = COALESCE(notes || ' | ', '') || 'Cancelled due to batch cancellation'
  WHERE destination_type = 'batch'
    AND destination_id = p_batch_id
    AND status IN ('planned', 'pending_approval');

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'batch_code', v_batch.batch_code,
    'previous_status', v_batch.status,
    'reason', COALESCE(p_reason, 'scheduling')
  );
END;
$$;

-- =============================================================================
-- 2. notify_batch_terminated — AFTER UPDATE trigger; fails archive path
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
  IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status != 'cancelled') THEN
    v_action := 'cancelled';
    v_reason := NEW.cancellation_reason;
  ELSIF NEW.status = 'archived' AND (OLD.status IS NULL OR OLD.status != 'archived') THEN
    v_action := 'archived';
    v_reason := NEW.archive_reason;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, entity_type, entity_id,
    priority, action_url, metadata
  )
  SELECT
    up.id,
    'batch',
    'Batch ' || INITCAP(v_action),
    'Batch ' || NEW.batch_code || ' (' || NEW.name || ') was ' || v_action || ': ' ||
      COALESCE(v_reason, 'No reason specified'),
    'batch',
    NEW.id,
    CASE WHEN v_action = 'archived' THEN 'high' ELSE 'medium' END,
    '/production/batches/' || NEW.id,
    jsonb_build_object(
      'batch_code', NEW.batch_code,
      'action', v_action,
      'reason', v_reason,
      'previous_status', OLD.status
    )
  FROM user_profiles up
  WHERE up.roles && ARRAY['admin', 'production_manager']
    AND up.status = 'active'
    AND up.id != COALESCE(
      CASE WHEN v_action = 'cancelled' THEN NEW.cancelled_by ELSE NEW.archived_by END,
      '00000000-0000-0000-0000-000000000000'
    );

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. analyze_batch_performance — AI helper function, fails when called
-- =============================================================================
CREATE OR REPLACE FUNCTION analyze_batch_performance(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'batch_id', b.id,
    'batch_code', b.batch_code,
    'status', b.status,
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'target_og', re.est_og,
      'target_fg', re.est_fg,
      'target_abv', re.est_abv
    ),
    'actuals', jsonb_build_object(
      'og', (
        SELECT (e->>'measurements')::jsonb->0->>'value'
        FROM brew_logs bl
        JOIN brew_log_batches blb ON blb.brew_log_id = bl.id
        CROSS JOIN jsonb_array_elements(bl.events) e
        WHERE blb.batch_id = b.id
        AND e->>'phase' = 'ko_end'
        LIMIT 1
      ),
      'fg', b.actual_fg,
      'abv', b.actual_abv
    ),
    'variances', jsonb_build_object(
      'fg_variance', CASE WHEN b.actual_fg IS NOT NULL AND re.est_fg IS NOT NULL
        THEN ROUND((b.actual_fg - re.est_fg)::numeric, 3) END,
      'abv_variance', CASE WHEN b.actual_abv IS NOT NULL AND re.est_abv IS NOT NULL
        THEN ROUND((b.actual_abv - re.est_abv)::numeric, 1) END
    ),
    'fermentation', jsonb_build_object(
      'planned_start', b.planned_start_date,
      'readings_count', 0,
      'latest_reading', NULL
    )
  ) INTO v_result
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE b.id = p_batch_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Batch not found'));
END;
$$;

-- =============================================================================
-- 4. Batch state machine — allow complete from fermenting/conditioning
-- =============================================================================
CREATE OR REPLACE FUNCTION get_state_transitions(p_table_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_table_name
    WHEN 'batches' THEN '{
      "planned":      ["fermenting", "cancelled"],
      "fermenting":   ["conditioning", "completed", "archived"],
      "conditioning": ["packaging", "completed", "archived"],
      "packaging":    ["completed", "archived"],
      "completed":    [],
      "cancelled":    [],
      "archived":     []
    }'::JSONB

    WHEN 'orders' THEN '{
      "draft":       ["confirmed"],
      "confirmed":   ["scheduled", "fulfilled", "cancelled"],
      "scheduled":   ["fulfilled", "cancelled"],
      "fulfilled":   [],
      "cancelled":   []
    }'::JSONB

    WHEN 'packaging_sessions' THEN '{
      "planned":     ["in_progress", "cancelled"],
      "in_progress": ["completed", "cancelled"],
      "completed":   ["revised"],
      "revised":     [],
      "cancelled":   []
    }'::JSONB

    WHEN 'purchase_orders' THEN '{
      "draft":       ["submitted"],
      "submitted":   ["confirmed", "cancelled"],
      "confirmed":   ["partial", "received", "cancelled"],
      "partial":     ["received", "cancelled"],
      "received":    [],
      "cancelled":   []
    }'::JSONB

    WHEN 'deliveries' THEN '{
      "planned":     ["loaded", "cancelled"],
      "loaded":      ["in_transit", "cancelled"],
      "in_transit":  ["delivered"],
      "delivered":   [],
      "cancelled":   []
    }'::JSONB

    ELSE NULL
  END;
END;
$$;
