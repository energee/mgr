-- =============================================================================
-- Migration 00093: View Correlated Subquery Fixes
-- =============================================================================
-- Rewrites two views that use per-row correlated subqueries:
-- 1. batches_with_brew_info: 6 correlated subqueries -> 2 CTEs + LEFT JOINs
-- 2. batch_additions_with_costs: 4 scalar subqueries -> 4 LEFT JOINs
-- =============================================================================

-- =============================================================================
-- 1. Rewrite batches_with_brew_info
-- =============================================================================
-- Old: 6 correlated subqueries per batch row (brew_date, actual_og,
-- volume_from_brews_bbl, brew_count, current_vessel_id, current_vessel_name).
-- New: Pre-aggregate brew stats in a CTE, scan vessels once, LEFT JOIN both.

DROP VIEW IF EXISTS batches_with_brew_info CASCADE;

CREATE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
WITH brew_stats AS (
  SELECT
    blb.batch_id,
    MIN(bl.brew_date) AS brew_date,
    COALESCE(SUM(blb.volume_bbl), 0) AS volume_from_brews_bbl,
    COUNT(*)::bigint AS brew_count,
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
    END AS actual_og
  FROM brew_log_batches blb
  JOIN brew_logs bl ON bl.id = blb.brew_log_id
  GROUP BY blb.batch_id
),
current_vessels AS (
  SELECT DISTINCT ON (v.current_batch_id)
    v.current_batch_id AS batch_id,
    v.id AS current_vessel_id,
    v.name AS current_vessel_name
  FROM vessels v
  WHERE v.current_batch_id IS NOT NULL
)
SELECT
  b.*,
  bs.brew_date,
  bs.actual_og,
  COALESCE(bs.volume_from_brews_bbl, 0) AS volume_from_brews_bbl,
  COALESCE(bs.brew_count, 0) AS brew_count,
  cv.current_vessel_id,
  cv.current_vessel_name
FROM batches b
LEFT JOIN brew_stats bs ON bs.batch_id = b.id
LEFT JOIN current_vessels cv ON cv.batch_id = b.id;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs and current vessel. Use this view when you need brew date, OG, and vessel info without manual joins.';

-- =============================================================================
-- 2. Rewrite batch_additions_with_costs
-- =============================================================================
-- Old: 4 scalar subqueries per row (one per catalog table).
-- New: 4 LEFT JOINs with filtered conditions. The planner uses index-only
-- primary key lookups and avoids repeated subquery execution.

DROP VIEW IF EXISTS batch_additions_with_costs CASCADE;

CREATE VIEW batch_additions_with_costs
WITH (security_invoker = true)
AS
SELECT
  ba.id,
  ba.batch_id,
  ba.addition_type,
  ba.catalog_id,
  ba.catalog_table,
  ba.name,
  ba.amount,
  ba.unit,
  ba.timing,
  ba.days,
  ba.date_added,
  ba.notes,
  ba.created_at,
  ROUND((COALESCE(
    CASE ba.catalog_table
      WHEN 'hops' THEN convert_to_lbs(ba.amount, ba.unit) * h.cost_per_lb
      WHEN 'adjuncts' THEN convert_to_lbs(ba.amount, ba.unit) * a.cost_per_lb
      WHEN 'fruits' THEN convert_to_lbs(ba.amount, ba.unit) * f.cost_per_lb
      WHEN 'spices' THEN ba.amount * s.cost_per_unit
      ELSE 0
    END, 0
  ))::numeric, 2) AS estimated_cost
FROM batch_additions ba
LEFT JOIN hops h ON ba.catalog_table = 'hops' AND h.id = ba.catalog_id
LEFT JOIN adjuncts a ON ba.catalog_table = 'adjuncts' AND a.id = ba.catalog_id
LEFT JOIN fruits f ON ba.catalog_table = 'fruits' AND f.id = ba.catalog_id
LEFT JOIN spices s ON ba.catalog_table = 'spices' AND s.id = ba.catalog_id;

-- =============================================================================
-- 3. Notify PostgREST to reload schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
