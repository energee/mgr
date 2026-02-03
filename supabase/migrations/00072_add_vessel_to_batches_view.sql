-- =============================================================================
-- Migration: Add current vessel to batches_with_brew_info view
-- =============================================================================
-- Adds current_vessel_id and current_vessel_name to the batches view by
-- looking up which vessel currently contains each batch.

DROP VIEW IF EXISTS batches_with_brew_info;

CREATE VIEW batches_with_brew_info
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
  -- Get total volume from linked brew logs
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS volume_from_brews_bbl,
  -- Count of contributing brews
  (
    SELECT COUNT(*)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS brew_count,
  -- Current vessel (where batch is located)
  (
    SELECT v.id
    FROM vessels v
    WHERE v.current_batch_id = b.id
    LIMIT 1
  ) AS current_vessel_id,
  (
    SELECT v.name
    FROM vessels v
    WHERE v.current_batch_id = b.id
    LIMIT 1
  ) AS current_vessel_name
FROM batches b;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs and current vessel. Use this view when you need brew date, OG, and vessel info without manual joins.';
