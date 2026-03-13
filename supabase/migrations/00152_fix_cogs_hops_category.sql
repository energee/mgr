-- Migration: 00152_fix_cogs_hops_category.sql
-- Purpose: Update cogs_by_period function to use 'hop' (singular) instead of
-- 'hops' (plural) for the category pivot, matching the inventory_items.category
-- values corrected in migration 00151.

CREATE OR REPLACE FUNCTION cogs_by_period(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  batch_id UUID,
  batch_number TEXT,
  batch_name TEXT,
  recipe_name TEXT,
  brand_name TEXT,
  brand_id UUID,
  volume_bbl DECIMAL,
  status TEXT,
  created_at TIMESTAMPTZ,
  malt_cost DECIMAL,
  hop_cost DECIMAL,
  yeast_cost DECIMAL,
  adjunct_cost DECIMAL,
  other_cost DECIMAL,
  total_ingredient_cost DECIMAL,
  total_landed_cost DECIMAL,
  cost_per_bbl DECIMAL,
  has_allocation_data BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_allocations AS (
    SELECT
      a.destination_id AS batch_id,
      ii.category,
      SUM(a.quantity * COALESCE(a.unit_cost, il.unit_cost, 0)) AS ingredient_cost,
      SUM(a.quantity * COALESCE(il.landed_cost, 0)) AS landed_cost
    FROM allocations a
    JOIN inventory_lots il ON il.id = a.source_id
    JOIN inventory_items ii ON ii.id = il.inventory_item_id
    WHERE a.destination_type = 'batch'
      AND a.source_type = 'inventory_lot'
      AND a.status IN ('completed', 'planned')
    GROUP BY a.destination_id, ii.category
  ),
  pivoted AS (
    SELECT
      ba.batch_id,
      COALESCE(SUM(CASE WHEN ba.category = 'grain' THEN ba.ingredient_cost END), 0) AS malt_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'hop' THEN ba.ingredient_cost END), 0) AS hop_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'yeast' THEN ba.ingredient_cost END), 0) AS yeast_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'adjunct' THEN ba.ingredient_cost END), 0) AS adjunct_cost,
      COALESCE(SUM(CASE WHEN ba.category NOT IN ('grain', 'hop', 'yeast', 'adjunct') THEN ba.ingredient_cost END), 0) AS other_cost,
      COALESCE(SUM(ba.ingredient_cost), 0) AS total_ingredient_cost,
      COALESCE(SUM(ba.landed_cost), 0) AS total_landed_cost,
      TRUE AS has_allocation_data
    FROM batch_allocations ba
    GROUP BY ba.batch_id
  )
  SELECT
    b.id AS batch_id,
    b.batch_number,
    b.name AS batch_name,
    r.name AS recipe_name,
    br.name AS brand_name,
    r.brand_id,
    b.volume_bbl,
    b.status,
    b.created_at,
    ROUND(COALESCE(p.malt_cost, 0)::numeric, 2) AS malt_cost,
    ROUND(COALESCE(p.hop_cost, 0)::numeric, 2) AS hop_cost,
    ROUND(COALESCE(p.yeast_cost, 0)::numeric, 2) AS yeast_cost,
    ROUND(COALESCE(p.adjunct_cost, 0)::numeric, 2) AS adjunct_cost,
    ROUND(COALESCE(p.other_cost, 0)::numeric, 2) AS other_cost,
    ROUND(COALESCE(p.total_ingredient_cost, 0)::numeric, 2) AS total_ingredient_cost,
    ROUND(COALESCE(p.total_landed_cost, 0)::numeric, 2) AS total_landed_cost,
    CASE
      WHEN COALESCE(b.volume_bbl, 0) > 0
      THEN ROUND((COALESCE(p.total_ingredient_cost, 0) / b.volume_bbl)::numeric, 2)
      ELSE NULL
    END AS cost_per_bbl,
    COALESCE(p.has_allocation_data, FALSE) AS has_allocation_data
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN brands br ON br.id = r.brand_id
  LEFT JOIN pivoted p ON p.batch_id = b.id
  WHERE b.created_at >= p_start_date
    AND b.created_at < (p_end_date + INTERVAL '1 day')
    AND b.status NOT IN ('cancelled', 'archived')
  ORDER BY b.created_at DESC;
END;
$$;

COMMENT ON FUNCTION cogs_by_period(DATE, DATE) IS 'Returns per-batch cost breakdown by ingredient category for batches created within the given date range. Uses allocation data from inventory lots.';
