-- =============================================================================
-- Migration: Refresh recipes_with_estimates view (again)
-- =============================================================================
-- Migration 00047 recreated the view, but 00048 added is_template AFTER.
-- PostgreSQL views don't auto-update when underlying tables change.
-- This recreates the view to pick up is_template.
-- =============================================================================

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
          ELSE 0
        END
    ) as weighted_ibu_factor
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
)
SELECT
  r.*,
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
    ELSE NULL
  END as est_og,
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (
        (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
      ) * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
    ELSE NULL
  END as est_fg,
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
  CASE
    WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
    ELSE NULL
  END as est_ibu,
  CASE
    WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1.4922 * POWER(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
    ELSE NULL
  END as est_srm,
  NULL::NUMERIC as est_cogs
FROM recipes r
LEFT JOIN beer_styles bs ON bs.id = r.style_id
LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
LEFT JOIN yeasts y ON y.id = r.yeast_id;

COMMENT ON VIEW recipes_with_estimates IS 'Recipes with calculated OG, FG, ABV, IBU, SRM estimates. Now includes is_template.';
