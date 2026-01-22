-- =============================================================================
-- Migration: Refresh recipes_with_estimates view
-- =============================================================================
--
-- The is_template column was added to recipes table in 00018, but the
-- recipes_with_estimates view was created in 00014 before that column existed.
-- PostgreSQL views don't automatically pick up new columns from underlying tables.
--
-- This migration recreates the view to include is_template in r.*.
-- =============================================================================

-- Recreate the view (same definition as 00014, but now r.* includes is_template)
DROP VIEW IF EXISTS recipes_with_estimates CASCADE;

CREATE VIEW recipes_with_estimates
WITH (security_invoker = true)
AS
WITH grain_totals AS (
  SELECT
    rm.recipe_id,
    SUM(rm.weight_lbs) as total_grain_lbs,
    SUM(rm.weight_lbs * COALESCE(rm.ppg, m.potential_ppg, 36)) as total_points,
    SUM(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2)) as mcu_sum
  FROM recipe_malts rm
  JOIN malts m ON m.id = rm.malt_id
  GROUP BY rm.recipe_id
),
hop_ibu AS (
  SELECT
    rh.recipe_id,
    -- Tinseth formula: IBU = (W * AA% * U * 74.89) / V
    -- Simplified: use typical utilization by timing
    SUM(
      rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10)
      * CASE rh.timing
          WHEN 'boil' THEN
            CASE
              WHEN COALESCE(rh.boil_time_min, 60) >= 60 THEN 0.27
              WHEN COALESCE(rh.boil_time_min, 60) >= 45 THEN 0.24
              WHEN COALESCE(rh.boil_time_min, 60) >= 30 THEN 0.20
              WHEN COALESCE(rh.boil_time_min, 60) >= 15 THEN 0.14
              WHEN COALESCE(rh.boil_time_min, 60) >= 10 THEN 0.10
              WHEN COALESCE(rh.boil_time_min, 60) >= 5 THEN 0.05
              ELSE 0.02
            END
          WHEN 'first_wort' THEN 0.10
          WHEN 'whirlpool' THEN 0.05
          WHEN 'mash' THEN 0.08
          ELSE 0  -- dry_hop contributes no IBU
        END
    ) as weighted_ibu_factor
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
)
SELECT
  r.*,
  -- OG calculation: Points = (grain_lbs * PPG * efficiency) / volume_gal
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
    ELSE NULL
  END as est_og,
  -- FG calculation: FG = 1 + (OG - 1) * (1 - attenuation)
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (
        (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
      ) * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
    ELSE NULL
  END as est_fg,
  -- ABV calculation: (OG - FG) * 131.25
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(
        (
          (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
          / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
        ) * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25
      , 1)
    ELSE NULL
  END as est_abv,
  -- IBU calculation: weighted_ibu_factor * 74.89 / volume_gal
  CASE
    WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
    ELSE NULL
  END as est_ibu,
  -- SRM calculation: MCU / volume * 1.4922 ^ 0.6859 (Morey formula)
  CASE
    WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1.4922 * POWER(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
    ELSE NULL
  END as est_srm,
  -- COGS estimate (placeholder - would need ingredient costs)
  NULL::NUMERIC as est_cogs
FROM recipes r
LEFT JOIN beer_styles bs ON bs.id = r.style_id
LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
LEFT JOIN yeasts y ON y.id = r.yeast_id;

COMMENT ON VIEW recipes_with_estimates IS 'Recipes with calculated OG, FG, ABV, IBU, SRM, COGS estimates. Includes is_template field.';
