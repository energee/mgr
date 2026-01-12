-- MGR Recipe COGS (Cost of Goods Sold) Migration
--
-- Adds COGS calculation for recipes based on ingredient costs.
-- Creates a view that includes cost breakdown by ingredient category.
--
-- Design Note: This view provides detailed cost breakdown by ingredient type.
-- The recipes_with_estimates view has est_cogs as a placeholder (NULL). This
-- separate view is intentional - recipes_with_estimates focuses on brewing
-- metrics (OG, FG, ABV, IBU, SRM) while this view focuses on cost analysis.
-- Use recipes_with_cogs when detailed cost breakdown is needed.

-- =============================================================================
-- Add cost column to yeasts if missing
-- =============================================================================

ALTER TABLE yeasts ADD COLUMN IF NOT EXISTS cost_per_unit DECIMAL(8,4);

COMMENT ON COLUMN yeasts.cost_per_unit IS 'Cost per yeast pack or vial';

-- =============================================================================
-- Create COGS View
-- =============================================================================

-- Drop if exists to allow re-running
DROP VIEW IF EXISTS recipes_with_cogs;

CREATE VIEW recipes_with_cogs
WITH (security_invoker = true)
AS
WITH malt_costs AS (
  SELECT
    rm.recipe_id,
    SUM(rm.weight_lbs * COALESCE(m.cost_per_lb, 0)) as malt_cost,
    SUM(rm.weight_lbs) as total_grain_lbs
  FROM recipe_malts rm
  JOIN malts m ON m.id = rm.malt_id
  GROUP BY rm.recipe_id
),
hop_costs AS (
  SELECT
    rh.recipe_id,
    -- Convert oz to lbs for cost calculation (hops.cost_per_lb)
    SUM((rh.weight_oz / 16.0) * COALESCE(h.cost_per_lb, 0)) as hop_cost,
    SUM(rh.weight_oz) as total_hop_oz
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
),
adjunct_costs AS (
  SELECT
    ra.recipe_id,
    SUM(ra.amount_lbs * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_adjuncts ra
  JOIN adjuncts a ON a.id = ra.adjunct_id
  GROUP BY ra.recipe_id
),
addition_costs AS (
  -- Note: cost_per_unit should be entered per the additive's typical_unit.
  -- This calculation assumes the recipe amount matches that unit.
  -- Example: If additive cost is per gram, recipe amounts should be in grams.
  SELECT
    ra.recipe_id,
    SUM(ra.amount * COALESCE(ad.cost_per_unit, 0)) as addition_cost
  FROM recipe_additions ra
  JOIN additives ad ON ad.id = ra.additive_id
  GROUP BY ra.recipe_id
),
recipe_totals AS (
  SELECT
    r.id,
    r.name,
    r.brand_id,
    r.volume_bbl,
    r.batch_size_bbl,
    COALESCE(mc.malt_cost, 0) as malt_cost,
    COALESCE(hc.hop_cost, 0) as hop_cost,
    COALESCE(y.cost_per_unit, 0) as yeast_cost,
    COALESCE(ac.adjunct_cost, 0) as adjunct_cost,
    COALESCE(adc.addition_cost, 0) as addition_cost,
    COALESCE(mc.total_grain_lbs, 0) as total_grain_lbs,
    COALESCE(hc.total_hop_oz, 0) as total_hop_oz
  FROM recipes r
  LEFT JOIN malt_costs mc ON mc.recipe_id = r.id
  LEFT JOIN hop_costs hc ON hc.recipe_id = r.id
  LEFT JOIN yeasts y ON y.id = r.yeast_id
  LEFT JOIN adjunct_costs ac ON ac.recipe_id = r.id
  LEFT JOIN addition_costs adc ON adc.recipe_id = r.id
)
SELECT
  id,
  name,
  brand_id,
  volume_bbl,
  batch_size_bbl,
  ROUND(malt_cost::numeric, 2) as malt_cost,
  ROUND(hop_cost::numeric, 2) as hop_cost,
  ROUND(yeast_cost::numeric, 2) as yeast_cost,
  ROUND(adjunct_cost::numeric, 2) as adjunct_cost,
  ROUND(addition_cost::numeric, 2) as addition_cost,
  ROUND((malt_cost + hop_cost + yeast_cost + adjunct_cost + addition_cost)::numeric, 2) as total_cogs,
  CASE
    WHEN COALESCE(batch_size_bbl, volume_bbl, 0) > 0 THEN
      ROUND((malt_cost + hop_cost + yeast_cost + adjunct_cost + addition_cost)
        / COALESCE(batch_size_bbl, volume_bbl)::numeric, 2)
    ELSE NULL
  END as cogs_per_bbl,
  ROUND(total_grain_lbs::numeric, 1) as total_grain_lbs,
  ROUND(total_hop_oz::numeric, 1) as total_hop_oz
FROM recipe_totals;

COMMENT ON VIEW recipes_with_cogs IS 'Recipe cost breakdown by ingredient category';

-- =============================================================================
-- Update Schema Registry
-- Add schema registry entry for the COGS view to document it for AI context
-- =============================================================================

INSERT INTO _schema_registry (
  table_name,
  description,
  domain,
  key_fields
) VALUES (
  'recipes_with_cogs',
  'Recipe cost breakdown by ingredient category with total COGS and per-BBL calculations',
  'production',
  '["total_cogs", "cogs_per_bbl", "malt_cost", "hop_cost", "yeast_cost", "adjunct_cost", "addition_cost"]'::jsonb
);
