-- Refresh views to pick up new columns and fix missing spice costs.
-- batches_with_brew_info needs to re-expand b.* to include recipe_variant_id (added in 00083).
-- recipe_variants_with_costs needs to include spice costs (missed in 00084).
-- Must also recreate dependent view: batches_with_blend_info.

-- =============================================================================
-- 1. Drop dependent views in correct order
-- =============================================================================

DROP VIEW IF EXISTS batches_with_blend_info;
DROP VIEW IF EXISTS batches_with_brew_info;

-- =============================================================================
-- 2. Recreate batches_with_brew_info to pick up recipe_variant_id
-- =============================================================================

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

-- =============================================================================
-- 3. Recreate dependent view: batches_with_blend_info (from 00063, updated in 00065/00076)
-- =============================================================================

CREATE VIEW batches_with_blend_info
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

-- =============================================================================
-- 4. Recreate recipe_variants_with_costs to include spice costs
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
    SUM(rva.amount * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_variant_adjuncts rva
  JOIN adjuncts a ON a.id = rva.adjunct_id
  GROUP BY rva.recipe_variant_id
),
variant_fruit_costs AS (
  SELECT
    rvf.recipe_variant_id,
    SUM(rvf.amount * COALESCE(f.cost_per_lb, 0)) as fruit_cost
  FROM recipe_variant_fruits rvf
  JOIN fruits f ON f.id = rvf.fruit_id
  GROUP BY rvf.recipe_variant_id
),
variant_spice_costs AS (
  SELECT
    rvs.recipe_variant_id,
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

COMMENT ON VIEW recipe_variants_with_costs IS 'Recipe variants with hot-side and cold-side cost projections (including spice costs)';
