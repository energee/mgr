-- =============================================================================
-- Migration: 00054_fix_ingredient_demand_batch_count
--
-- Fix batch_count calculation in ingredient demand functions to count
-- distinct batch_ids instead of distinct planned_start_dates.
-- =============================================================================

-- =============================================================================
-- FIX CALCULATE INGREDIENT DEMAND FUNCTION
-- =============================================================================

DROP FUNCTION IF EXISTS calculate_ingredient_demand(INTEGER, BOOLEAN, BOOLEAN);
CREATE OR REPLACE FUNCTION calculate_ingredient_demand(
  p_horizon_weeks INTEGER DEFAULT 8,
  p_include_planned BOOLEAN DEFAULT true,
  p_include_fermenting BOOLEAN DEFAULT true
)
RETURNS TABLE (
  catalog_type TEXT,
  catalog_id UUID,
  catalog_name TEXT,
  total_required DECIMAL(12,4),
  unit TEXT,
  earliest_required_by DATE,
  batch_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_statuses AS (
    SELECT UNNEST(
      ARRAY[]::TEXT[] ||
      CASE WHEN p_include_planned THEN ARRAY['planned'] ELSE ARRAY[]::TEXT[] END ||
      CASE WHEN p_include_fermenting THEN ARRAY['fermenting'] ELSE ARRAY[]::TEXT[] END
    ) as status
  ),
  eligible_batches AS (
    SELECT
      b.id as batch_id,
      b.recipe_id,
      b.volume_bbl,
      b.planned_start_date,
      r.batch_size_bbl as recipe_batch_size
    FROM batches b
    JOIN recipes r ON r.id = b.recipe_id
    CROSS JOIN batch_statuses bs
    WHERE b.status = bs.status
      AND b.recipe_id IS NOT NULL
      AND b.planned_start_date IS NOT NULL
      AND b.planned_start_date <= (CURRENT_DATE + (p_horizon_weeks * 7))
  ),
  scaled_ingredients AS (
    SELECT
      rin.catalog_type,
      rin.catalog_id,
      rin.catalog_name,
      rin.unit,
      eb.batch_id,
      eb.planned_start_date,
      -- Scale ingredient quantity by batch volume / recipe batch size
      rin.quantity * COALESCE(eb.volume_bbl / NULLIF(eb.recipe_batch_size, 0), 1) as scaled_quantity
    FROM recipe_ingredients_normalized rin
    JOIN eligible_batches eb ON eb.recipe_id = rin.recipe_id
  )
  SELECT
    si.catalog_type,
    si.catalog_id,
    si.catalog_name,
    SUM(si.scaled_quantity)::DECIMAL(12,4) as total_required,
    si.unit,
    MIN(si.planned_start_date)::DATE as earliest_required_by,
    COUNT(DISTINCT si.batch_id)::INTEGER as batch_count
  FROM scaled_ingredients si
  GROUP BY si.catalog_type, si.catalog_id, si.catalog_name, si.unit
  ORDER BY si.catalog_type, total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_demand IS 'Calculates total ingredient demand from planned/fermenting batches within horizon, scaling by batch volume.';
