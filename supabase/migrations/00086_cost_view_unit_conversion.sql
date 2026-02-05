-- Fix unit conversion in cost views.
-- Previously, adjunct/fruit/spice costs assumed amount was always in lbs (cost_per_lb)
-- or the matching unit (cost_per_unit). This adds proper unit conversion.

-- =============================================================================
-- 1. Helper function: convert an amount + unit to pounds
-- =============================================================================

CREATE OR REPLACE FUNCTION convert_to_lbs(p_amount DECIMAL, p_unit TEXT)
RETURNS DECIMAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_amount * CASE LOWER(p_unit)
    WHEN 'lbs' THEN 1.0
    WHEN 'lb'  THEN 1.0
    WHEN 'oz'  THEN 1.0 / 16.0
    WHEN 'g'   THEN 1.0 / 453.592
    WHEN 'kg'  THEN 2.20462
    ELSE 1.0  -- assume lbs if unknown
  END;
$$;

COMMENT ON FUNCTION convert_to_lbs IS 'Convert a weight amount from any common unit to pounds. Used by cost views.';

-- =============================================================================
-- 2. Recreate recipe_variants_with_costs with unit conversion
-- =============================================================================

DROP VIEW IF EXISTS recipe_variants_with_costs;

CREATE VIEW recipe_variants_with_costs
WITH (security_invoker = true)
AS
WITH variant_hop_costs AS (
  SELECT
    rvh.recipe_variant_id,
    SUM((rvh.weight_oz / 16.0) * COALESCE(h.cost_per_lb, 0)) as hop_cost
  FROM recipe_variant_hops rvh
  JOIN hops h ON h.id = rvh.hop_id
  GROUP BY rvh.recipe_variant_id
),
variant_adjunct_costs AS (
  SELECT
    rva.recipe_variant_id,
    SUM(convert_to_lbs(rva.amount, rva.unit) * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_variant_adjuncts rva
  JOIN adjuncts a ON a.id = rva.adjunct_id
  GROUP BY rva.recipe_variant_id
),
variant_fruit_costs AS (
  SELECT
    rvf.recipe_variant_id,
    SUM(convert_to_lbs(rvf.amount, rvf.unit) * COALESCE(f.cost_per_lb, 0)) as fruit_cost
  FROM recipe_variant_fruits rvf
  JOIN fruits f ON f.id = rvf.fruit_id
  GROUP BY rvf.recipe_variant_id
),
variant_spice_costs AS (
  SELECT
    rvs.recipe_variant_id,
    -- Spices use cost_per_unit, so amount * cost is direct (no weight conversion needed)
    SUM(rvs.amount * COALESCE(s.cost_per_unit, 0)) as spice_cost
  FROM recipe_variant_spices rvs
  JOIN spices s ON s.id = rvs.spice_id
  GROUP BY rvs.recipe_variant_id
),
hot_side AS (
  SELECT
    rc.id as recipe_id,
    rc.volume_bbl,
    rc.batch_size_bbl,
    rc.total_cogs as hot_side_cost,
    CASE
      WHEN COALESCE(rc.batch_size_bbl, rc.volume_bbl, 0) > 0
      THEN rc.total_cogs / COALESCE(rc.batch_size_bbl, rc.volume_bbl)
      ELSE 0
    END as hot_side_cost_per_bbl
  FROM recipes_with_cogs rc
)
SELECT
  rv.id,
  rv.recipe_id,
  rv.name,
  rv.description,
  rv.position,
  rv.planned_volume_bbl,
  rv.created_at,
  rv.updated_at,
  ROUND(COALESCE(hs.hot_side_cost_per_bbl, 0)::numeric, 2) as hot_side_cost_per_bbl,
  ROUND((COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0) + COALESCE(vsc.spice_cost, 0))::numeric, 2) as variant_addition_cost,
  ROUND((
    COALESCE(hs.hot_side_cost_per_bbl, 0) * COALESCE(rv.planned_volume_bbl, 0)
    + COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0) + COALESCE(vsc.spice_cost, 0)
  )::numeric, 2) as est_total_cost,
  CASE
    WHEN COALESCE(rv.planned_volume_bbl, 0) > 0
    THEN ROUND((
      COALESCE(hs.hot_side_cost_per_bbl, 0)
      + (COALESCE(vhc.hop_cost, 0) + COALESCE(vac.adjunct_cost, 0) + COALESCE(vfc.fruit_cost, 0) + COALESCE(vsc.spice_cost, 0))
        / rv.planned_volume_bbl
    )::numeric, 2)
    ELSE NULL
  END as est_cost_per_bbl
FROM recipe_variants rv
LEFT JOIN hot_side hs ON hs.recipe_id = rv.recipe_id
LEFT JOIN variant_hop_costs vhc ON vhc.recipe_variant_id = rv.id
LEFT JOIN variant_adjunct_costs vac ON vac.recipe_variant_id = rv.id
LEFT JOIN variant_fruit_costs vfc ON vfc.recipe_variant_id = rv.id
LEFT JOIN variant_spice_costs vsc ON vsc.recipe_variant_id = rv.id;

COMMENT ON VIEW recipe_variants_with_costs IS 'Recipe variants with hot-side and cold-side cost projections with unit conversion';

-- =============================================================================
-- 3. Recreate batch_additions_with_costs with unit conversion
-- =============================================================================

DROP VIEW IF EXISTS batch_additions_with_costs;

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
      -- Hops: amount is typically oz, cost is per lb
      WHEN 'hops' THEN convert_to_lbs(ba.amount, ba.unit)
        * (SELECT cost_per_lb FROM hops WHERE id = ba.catalog_id)
      -- Adjuncts: convert amount to lbs, multiply by cost_per_lb
      WHEN 'adjuncts' THEN convert_to_lbs(ba.amount, ba.unit)
        * (SELECT cost_per_lb FROM adjuncts WHERE id = ba.catalog_id)
      -- Fruits: convert amount to lbs, multiply by cost_per_lb
      WHEN 'fruits' THEN convert_to_lbs(ba.amount, ba.unit)
        * (SELECT cost_per_lb FROM fruits WHERE id = ba.catalog_id)
      -- Spices: amount * cost_per_unit (no weight conversion)
      WHEN 'spices' THEN ba.amount
        * (SELECT cost_per_unit FROM spices WHERE id = ba.catalog_id)
      ELSE 0
    END, 0
  ))::numeric, 2) as estimated_cost
FROM batch_additions ba;

COMMENT ON VIEW batch_additions_with_costs IS 'Batch additions with estimated costs from catalog prices, with unit conversion';
