-- =============================================================================
-- Migration: 00065_view_joins_brand_package_style
-- =============================================================================
-- Adds human-readable name columns to views that previously only had FK UUIDs:
--   1. finished_goods_with_availability: adds brand_name, package_type_name
--   2. recipes_with_estimates: adds style_name
-- =============================================================================

-- =============================================================================
-- 1. FINISHED GOODS WITH AVAILABILITY - add brand_name, package_type_name
-- =============================================================================
-- Must DROP CASCADE because dependent views reference this view,
-- then recreate the dependent views.

DROP VIEW IF EXISTS finished_goods_supply_by_product CASCADE;
DROP VIEW IF EXISTS finished_goods_with_availability CASCADE;

CREATE VIEW finished_goods_with_availability
WITH (security_invoker = true)
AS
SELECT
  fg.*,
  b.name AS brand_name,
  pt.name AS package_type_name,
  fg.quantity AS total_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) AS allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) AS reserved_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) AS available_quantity
FROM finished_goods fg
LEFT JOIN brands b ON b.id = fg.brand_id
LEFT JOIN package_types pt ON pt.id = fg.package_type_id
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id, b.name, pt.name;

COMMENT ON VIEW finished_goods_with_availability IS 'Finished goods with brand name, package type name, and calculated availability quantities';

-- Recreate dependent view: finished_goods_supply_by_product (from 00051)
CREATE VIEW finished_goods_supply_by_product
WITH (security_invoker = true)
AS
SELECT
  fg.brand_id,
  fg.package_type_id,
  SUM(fg.quantity)::integer AS total_quantity,
  SUM(fga.available_quantity)::integer AS available_quantity,
  SUM(fga.allocated_quantity)::integer AS allocated_quantity,
  SUM(fga.reserved_quantity)::integer AS reserved_quantity
FROM finished_goods fg
JOIN finished_goods_with_availability fga ON fga.id = fg.id
WHERE fg.brand_id IS NOT NULL AND fg.package_type_id IS NOT NULL
GROUP BY fg.brand_id, fg.package_type_id;

COMMENT ON VIEW finished_goods_supply_by_product IS 'Aggregated finished goods inventory by brand and package type. Shows total, available, allocated, and reserved quantities.';

-- =============================================================================
-- 2. RECIPES WITH ESTIMATES - add style_name
-- =============================================================================
-- The view already JOINs beer_styles but doesn't select the name.
-- Must DROP CASCADE because dependent views reference this view.

DROP VIEW IF EXISTS batches_with_blend_info CASCADE;
DROP VIEW IF EXISTS recipes_with_estimates CASCADE;

CREATE VIEW recipes_with_estimates
WITH (security_invoker = true)
AS
WITH grain_totals AS (
  SELECT
    rm.recipe_id,
    SUM(rm.weight_lbs) AS total_grain_lbs,
    SUM(rm.weight_lbs * COALESCE(rm.ppg, m.potential_ppg, 36)) AS total_points,
    SUM(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2)) AS mcu_sum
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
    ) AS weighted_ibu_factor
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
)
SELECT
  r.*,
  bs.name AS style_name,
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
    ELSE NULL
  END AS est_og,
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (
        (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
      ) * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
    ELSE NULL
  END AS est_fg,
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(
        (
          (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
          / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
        ) * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25
      , 1)
    ELSE NULL
  END AS est_abv,
  CASE
    WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
    ELSE NULL
  END AS est_ibu,
  CASE
    WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1.4922 * POWER(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
    ELSE NULL
  END AS est_srm,
  NULL::NUMERIC AS est_cogs
FROM recipes r
LEFT JOIN beer_styles bs ON bs.id = r.style_id
LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
LEFT JOIN yeasts y ON y.id = r.yeast_id;

COMMENT ON VIEW recipes_with_estimates IS 'Recipes with style name and calculated OG, FG, ABV, IBU, SRM estimates.';

-- Recreate dependent view: batches_with_blend_info (from 00063)
CREATE OR REPLACE VIEW batches_with_blend_info
WITH (security_invoker = true)
AS
WITH blended_away AS (
  SELECT
    bb.source_batch_id AS batch_id,
    COALESCE(SUM(bb.volume_bbl), 0) AS volume_blended_away_bbl
  FROM batch_blends bb
  GROUP BY bb.source_batch_id
),
blended_in AS (
  SELECT
    bb.blend_batch_id AS batch_id,
    COUNT(*) AS blend_source_count,
    SUM(bb.volume_bbl) AS blended_volume_in_bbl,
    ROUND(
      SUM(src.actual_og * bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL), 0),
      3
    ) AS blended_og,
    ROUND(
      SUM(src.actual_fg * bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL), 0),
      3
    ) AS blended_fg,
    ROUND(
      SUM(src.actual_abv * bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL), 0),
      1
    ) AS blended_abv,
    ROUND(
      SUM(rwe.est_ibu * bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL), 0)
    ) AS blended_ibu,
    ROUND(
      SUM(rwe.est_srm * bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL), 0),
      1
    ) AS blended_srm,
    ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS blend_source_recipes
  FROM batch_blends bb
  JOIN batches_with_brew_info src ON src.id = bb.source_batch_id
  LEFT JOIN recipes r ON r.id = src.recipe_id
  LEFT JOIN recipes_with_estimates rwe ON rwe.id = src.recipe_id
  GROUP BY bb.blend_batch_id
)
SELECT
  b.id,
  COALESCE(ba.volume_blended_away_bbl, 0) AS volume_blended_away_bbl,
  b.volume_bbl - COALESCE(ba.volume_blended_away_bbl, 0) AS available_volume_bbl,
  COALESCE(bi.blend_source_count, 0) AS blend_source_count,
  COALESCE(bi.blended_volume_in_bbl, 0) AS blended_volume_in_bbl,
  bi.blended_og,
  bi.blended_fg,
  bi.blended_abv,
  bi.blended_ibu,
  bi.blended_srm,
  bi.blend_source_recipes
FROM batches b
LEFT JOIN blended_away ba ON ba.batch_id = b.id
LEFT JOIN blended_in bi ON bi.batch_id = b.id;

COMMENT ON VIEW batches_with_blend_info IS 'Per-batch blend data: volume blended away, available volume, and weighted estimates from source batches blended in.';
