-- =============================================================================
-- Fix analyze_batch_performance() fermentation readings
-- =============================================================================
-- Migration 00167 redefined analyze_batch_performance() (to repair batch_number
-- column references) and stubbed its fermentation block with literals:
--   'readings_count', 0  /  'latest_reading', NULL
-- The AI batch-analysis tool (analyzeBatch) therefore always reported zero
-- fermentation readings, even though measurements are stored as batch_logs rows
-- with log_type = 'measurement' (data JSONB = {reading_type, value, unit,
-- timestamp, notes?}, written by the readings page).
--
-- This migration repoints the fermentation block at the real batch_logs
-- measurement rows. Everything else in the function is unchanged from 00167.
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
      'readings_count', (
        SELECT count(*)
        FROM batch_logs blog
        WHERE blog.batch_id = b.id
          AND blog.log_type = 'measurement'
      ),
      'latest_reading', (
        SELECT blog.data || jsonb_build_object('recorded_at', blog.created_at)
        FROM batch_logs blog
        WHERE blog.batch_id = b.id
          AND blog.log_type = 'measurement'
        ORDER BY blog.created_at DESC
        LIMIT 1
      )
    )
  ) INTO v_result
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE b.id = p_batch_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Batch not found'));
END;
$$;
