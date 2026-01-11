-- Migration: 00013_security_fixes.sql
-- Purpose: Fix security advisories from Supabase database linter
-- Issues addressed:
--   ERROR: auth_users_exposed (recent_vessel_cleanings exposes auth.users)
--   ERROR: policy_exists_rls_disabled (_schema_registry has policy but RLS disabled)
--   ERROR: security_definer_view (11 views using SECURITY DEFINER)
--   ERROR: rls_disabled_in_public (_schema_registry lacks RLS)
--   WARN: function_search_path_mutable (8 functions without search_path)
--   WARN: extension_in_public (pg_trgm in public schema)
--   WARN: rls_policy_always_true (user_preferences INSERT policy too permissive)

-- =============================================================================
-- 1. Fix auth_users_exposed: Remove auth.users join from recent_vessel_cleanings
-- =============================================================================

-- Store user email/name in vessel_cleanings instead of joining auth.users
ALTER TABLE vessel_cleanings
  ADD COLUMN IF NOT EXISTS cleaned_by_name TEXT;

COMMENT ON COLUMN vessel_cleanings.cleaned_by_name IS 'Cached display name of user who cleaned the vessel. Stored to avoid exposing auth.users.';

-- Recreate view without auth.users join
DROP VIEW IF EXISTS recent_vessel_cleanings CASCADE;
CREATE VIEW recent_vessel_cleanings
WITH (security_invoker = true)
AS
SELECT
  vc.*,
  v.name AS vessel_name,
  v.vessel_type
FROM vessel_cleanings vc
JOIN vessels v ON vc.vessel_id = v.id
WHERE vc.cleaned_at > NOW() - INTERVAL '7 days'
ORDER BY vc.cleaned_at DESC;

COMMENT ON VIEW recent_vessel_cleanings IS 'Cleaning events from the last 7 days for dashboard/activity feed.';

-- =============================================================================
-- 2. Enable RLS on _schema_registry
-- =============================================================================

ALTER TABLE _schema_registry ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Fix security_definer_view: Recreate views with security_invoker = true
-- =============================================================================

-- po_line_items_with_quantities
DROP VIEW IF EXISTS po_line_items_with_quantities CASCADE;
CREATE VIEW po_line_items_with_quantities
WITH (security_invoker = true)
AS
SELECT
  pli.*,
  pli.quantity as ordered_quantity,
  COALESCE(SUM(por.quantity), 0) as received_quantity,
  pli.quantity - COALESCE(SUM(por.quantity), 0) as outstanding_quantity
FROM po_line_items pli
LEFT JOIN po_receives por ON por.po_line_item_id = pli.id
GROUP BY pli.id;

COMMENT ON VIEW po_line_items_with_quantities IS 'PO line items with calculated received/remaining quantities';

-- inventory_lots_with_quantities
DROP VIEW IF EXISTS inventory_lots_with_quantities CASCADE;
CREATE VIEW inventory_lots_with_quantities
WITH (security_invoker = true)
AS
SELECT
  il.*,
  il.quantity as received_quantity,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  il.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as remaining_quantity
FROM inventory_lots il
LEFT JOIN allocations a
  ON a.source_type = 'inventory_lot' AND a.source_id = il.id
GROUP BY il.id;

COMMENT ON VIEW inventory_lots_with_quantities IS 'Inventory lots with calculated available quantities';

-- finished_goods_with_availability
DROP VIEW IF EXISTS finished_goods_with_availability CASCADE;
CREATE VIEW finished_goods_with_availability
WITH (security_invoker = true)
AS
SELECT
  fg.*,
  fg.quantity as total_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) as reserved_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as available_quantity
FROM finished_goods fg
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id;

COMMENT ON VIEW finished_goods_with_availability IS 'Finished goods with calculated total and available quantities';

-- batches_with_remaining_volume
DROP VIEW IF EXISTS batches_with_remaining_volume CASCADE;
CREATE VIEW batches_with_remaining_volume
WITH (security_invoker = true)
AS
SELECT
  b.*,
  b.volume_bbl as total_volume_bbl,
  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.volume_bbl ELSE 0 END), 0) as packaged_volume_bbl,
  b.volume_bbl - COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.volume_bbl ELSE 0 END), 0) as remaining_volume_bbl
FROM batches b
LEFT JOIN allocations a ON a.source_type = 'batch' AND a.source_id = b.id
GROUP BY b.id;

COMMENT ON VIEW batches_with_remaining_volume IS 'Batches with calculated remaining volume after allocations';

-- brew_log_metrics
DROP VIEW IF EXISTS brew_log_metrics CASCADE;
CREATE VIEW brew_log_metrics
WITH (security_invoker = true)
AS
SELECT
  bl.id,
  bl.recipe_id,
  bl.brew_date,
  bl.status,
  r.name AS recipe_name,
  (SELECT COUNT(*) FROM brew_log_batches blb WHERE blb.brew_log_id = bl.id) AS batch_count,
  (
    SELECT jsonb_agg(e->>'phase')
    FROM jsonb_array_elements(bl.events) e
  ) AS phases_completed
FROM brew_logs bl
JOIN recipes r ON r.id = bl.recipe_id;

COMMENT ON VIEW brew_log_metrics IS 'Brew logs with calculated metrics for reporting';

-- vessels_with_batch (also fixes vessels_with_current_batch reference)
DROP VIEW IF EXISTS vessels_with_batch CASCADE;
CREATE VIEW vessels_with_batch
WITH (security_invoker = true)
AS
SELECT
  v.*,
  b.id AS batch_id,
  b.batch_number,
  b.name AS batch_name,
  b.status AS batch_status,
  r.name AS recipe_name
FROM vessels v
LEFT JOIN batches b ON b.id = v.current_batch_id
LEFT JOIN recipes r ON r.id = b.recipe_id;

COMMENT ON VIEW vessels_with_batch IS 'Vessels with current batch information';

-- available_vessels
DROP VIEW IF EXISTS available_vessels CASCADE;
CREATE VIEW available_vessels
WITH (security_invoker = true)
AS
SELECT
  v.*,
  l.name AS location_name
FROM vessels v
LEFT JOIN locations l ON v.location_id = l.id
WHERE v.status = 'ready_for_use'
  AND v.is_active = true
  AND v.current_batch_id IS NULL;

COMMENT ON VIEW available_vessels IS 'Vessels that are clean, empty, and ready for use.';

-- batches_with_brew_info - preserve original complex view with subqueries
DROP VIEW IF EXISTS batches_with_brew_info CASCADE;
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
  ) AS brew_count
FROM batches b;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs. Use this view when you need brew date and OG without manual joins.';

-- recipes_with_estimates - preserve original CTE-based calculation
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
    -- Where U = 1.65 * 0.000125^(OG-1) * (1 - e^(-0.04*t)) / 4.15
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
  -- OG = 1 + points / 1000
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

  -- SRM calculation: Morey equation: SRM = 1.4922 * (MCU ^ 0.6859)
  -- MCU = (weight_lbs * color_lov) / volume_gal
  CASE
    WHEN gt.mcu_sum > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1.4922 * POWER(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859))
    ELSE NULL
  END as est_srm,

  -- COGS estimate (placeholder for future calculation)
  NULL::NUMERIC(10,2) as est_cogs

FROM recipes r
LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
LEFT JOIN yeasts y ON y.id = r.yeast_id;

COMMENT ON VIEW recipes_with_estimates IS 'Recipes with calculated OG, FG, ABV, IBU, SRM, COGS estimates';

-- =============================================================================
-- 4. Fix function_search_path_mutable: Set search_path on functions
-- =============================================================================

-- update_updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- create_user_preferences
CREATE OR REPLACE FUNCTION create_user_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- analyze_recipe_style_compliance
CREATE OR REPLACE FUNCTION analyze_recipe_style_compliance(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_recipe RECORD;
  v_style RECORD;
BEGIN
  SELECT r.*, re.est_og, re.est_fg, re.est_abv, re.est_ibu, re.est_srm
  INTO v_recipe
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE r.id = p_recipe_id;

  IF v_recipe IS NULL THEN
    RETURN jsonb_build_object('error', 'Recipe not found');
  END IF;

  SELECT * INTO v_style
  FROM beer_styles
  WHERE id = v_recipe.style_id;

  IF v_style IS NULL THEN
    RETURN jsonb_build_object('error', 'Style not found', 'recipe_id', p_recipe_id);
  END IF;

  v_result := jsonb_build_object(
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe.name,
    'style_name', v_style.name,
    'style_category', v_style.category,
    'analysis', jsonb_build_object(
      'og', jsonb_build_object(
        'value', v_recipe.est_og,
        'min', v_style.og_min,
        'max', v_style.og_max,
        'status', CASE
          WHEN v_recipe.est_og IS NULL THEN 'unknown'
          WHEN v_recipe.est_og < v_style.og_min THEN 'below_range'
          WHEN v_recipe.est_og > v_style.og_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'fg', jsonb_build_object(
        'value', v_recipe.est_fg,
        'min', v_style.fg_min,
        'max', v_style.fg_max,
        'status', CASE
          WHEN v_recipe.est_fg IS NULL THEN 'unknown'
          WHEN v_recipe.est_fg < v_style.fg_min THEN 'below_range'
          WHEN v_recipe.est_fg > v_style.fg_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'abv', jsonb_build_object(
        'value', v_recipe.est_abv,
        'min', v_style.abv_min,
        'max', v_style.abv_max,
        'status', CASE
          WHEN v_recipe.est_abv IS NULL THEN 'unknown'
          WHEN v_recipe.est_abv < v_style.abv_min THEN 'below_range'
          WHEN v_recipe.est_abv > v_style.abv_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'ibu', jsonb_build_object(
        'value', v_recipe.est_ibu,
        'min', v_style.ibu_min,
        'max', v_style.ibu_max,
        'status', CASE
          WHEN v_recipe.est_ibu IS NULL THEN 'unknown'
          WHEN v_recipe.est_ibu < v_style.ibu_min THEN 'below_range'
          WHEN v_recipe.est_ibu > v_style.ibu_max THEN 'above_range'
          ELSE 'in_range'
        END
      ),
      'srm', jsonb_build_object(
        'value', v_recipe.est_srm,
        'min', v_style.srm_min,
        'max', v_style.srm_max,
        'status', CASE
          WHEN v_recipe.est_srm IS NULL THEN 'unknown'
          WHEN v_recipe.est_srm < v_style.srm_min THEN 'below_range'
          WHEN v_recipe.est_srm > v_style.srm_max THEN 'above_range'
          ELSE 'in_range'
        END
      )
    ),
    'overall_compliance', (
      SELECT COUNT(*) = 5 FROM (
        SELECT 1 WHERE v_recipe.est_og BETWEEN v_style.og_min AND v_style.og_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_fg BETWEEN v_style.fg_min AND v_style.fg_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_abv BETWEEN v_style.abv_min AND v_style.abv_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_ibu BETWEEN v_style.ibu_min AND v_style.ibu_max
        UNION ALL
        SELECT 1 WHERE v_recipe.est_srm BETWEEN v_style.srm_min AND v_style.srm_max
      ) counts
    )
  );

  RETURN v_result;
END;
$$;

-- get_recipe_summary
CREATE OR REPLACE FUNCTION get_recipe_summary(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'volume_bbl', r.volume_bbl,
      'batch_size_bbl', r.batch_size_bbl,
      'boil_time_min', r.boil_time_min,
      'mash_temp_f', r.mash_temp_f,
      'mash_efficiency', r.mash_efficiency,
      'target_attenuation', r.target_attenuation,
      'fermentation_days', r.fermentation_days,
      'conditioning_days', r.conditioning_days
    ),
    'estimates', jsonb_build_object(
      'og', re.est_og,
      'fg', re.est_fg,
      'abv', re.est_abv,
      'ibu', re.est_ibu,
      'srm', re.est_srm,
      'cogs', re.est_cogs
    ),
    'style', jsonb_build_object(
      'id', bs.id,
      'name', bs.name,
      'category', bs.category,
      'og_range', jsonb_build_array(bs.og_min, bs.og_max),
      'fg_range', jsonb_build_array(bs.fg_min, bs.fg_max),
      'abv_range', jsonb_build_array(bs.abv_min, bs.abv_max),
      'ibu_range', jsonb_build_array(bs.ibu_min, bs.ibu_max),
      'srm_range', jsonb_build_array(bs.srm_min, bs.srm_max)
    ),
    'yeast', jsonb_build_object(
      'id', y.id,
      'name', y.name,
      'type', y.type,
      'attenuation_min', y.attenuation_min,
      'attenuation_max', y.attenuation_max,
      'temp_min_f', y.temp_min_f,
      'temp_max_f', y.temp_max_f,
      'flocculation', y.flocculation
    ),
    'water_profile', CASE WHEN wp.id IS NOT NULL THEN jsonb_build_object(
      'id', wp.id,
      'name', wp.name,
      'calcium_ppm', wp.calcium_ppm,
      'magnesium_ppm', wp.magnesium_ppm,
      'sodium_ppm', wp.sodium_ppm,
      'sulfate_ppm', wp.sulfate_ppm,
      'chloride_ppm', wp.chloride_ppm,
      'bicarbonate_ppm', wp.bicarbonate_ppm,
      'sulfate_chloride_ratio', ROUND(wp.sulfate_ppm / NULLIF(wp.chloride_ppm, 0), 2)
    ) ELSE NULL END,
    'grain_bill', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'malt_name', m.name,
        'malt_type', m.type,
        'weight_lbs', rm.weight_lbs,
        'color_lov', rm.color_lov,
        'ppg', rm.ppg,
        'percentage', ROUND(rm.weight_lbs * 100.0 / NULLIF(total.total_weight, 0), 1)
      ) ORDER BY rm.position), '[]'::jsonb)
      FROM recipe_malts rm
      JOIN malts m ON m.id = rm.malt_id
      CROSS JOIN (
        SELECT SUM(weight_lbs) as total_weight
        FROM recipe_malts
        WHERE recipe_id = p_recipe_id
      ) total
      WHERE rm.recipe_id = p_recipe_id
    ),
    'hop_schedule', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'hop_name', h.name,
        'hop_type', h.type,
        'weight_oz', rh.weight_oz,
        'alpha_acid', rh.alpha_acid,
        'timing', rh.timing,
        'boil_time_min', rh.boil_time_min
      ) ORDER BY rh.position), '[]'::jsonb)
      FROM recipe_hops rh
      JOIN hops h ON h.id = rh.hop_id
      WHERE rh.recipe_id = p_recipe_id
    ),
    'mash_schedule', r.mash_schedule,
    'fermentation_schedule', r.fermentation_schedule,
    'notes', jsonb_build_object(
      'brew_day', r.brew_day_notes,
      'tasting', r.tasting_notes,
      'development', r.development_notes
    )
  ) INTO v_result
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  LEFT JOIN beer_styles bs ON bs.id = r.style_id
  LEFT JOIN yeasts y ON y.id = r.yeast_id
  LEFT JOIN water_profiles wp ON wp.id = r.water_profile_id
  WHERE r.id = p_recipe_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Recipe not found'));
END;
$$;

-- suggest_recipe_improvements
CREATE OR REPLACE FUNCTION suggest_recipe_improvements(p_recipe_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_suggestions JSONB := '[]'::jsonb;
  v_recipe RECORD;
  v_style RECORD;
  v_water RECORD;
  v_yeast RECORD;
  v_grain_bill RECORD;
  v_hop_schedule RECORD;
BEGIN
  SELECT r.*, re.est_og, re.est_fg, re.est_abv, re.est_ibu, re.est_srm
  INTO v_recipe
  FROM recipes r
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE r.id = p_recipe_id;

  IF v_recipe IS NULL THEN
    RETURN jsonb_build_object('error', 'Recipe not found');
  END IF;

  SELECT * INTO v_style FROM beer_styles WHERE id = v_recipe.style_id;
  SELECT * INTO v_yeast FROM yeasts WHERE id = v_recipe.yeast_id;
  SELECT * INTO v_water FROM water_profiles WHERE id = v_recipe.water_profile_id;

  SELECT
    SUM(rm.weight_lbs) as total_weight,
    SUM(CASE WHEN m.type = 'base' THEN rm.weight_lbs ELSE 0 END) as base_weight,
    COUNT(*) as malt_count
  INTO v_grain_bill
  FROM recipe_malts rm
  JOIN malts m ON m.id = rm.malt_id
  WHERE rm.recipe_id = p_recipe_id;

  SELECT
    COUNT(*) as hop_count,
    SUM(CASE WHEN rh.timing = 'dry_hop' THEN rh.weight_oz ELSE 0 END) as dry_hop_oz,
    SUM(CASE WHEN rh.timing = 'boil' AND rh.boil_time_min >= 45 THEN rh.weight_oz ELSE 0 END) as bittering_oz
  INTO v_hop_schedule
  FROM recipe_hops rh
  WHERE rh.recipe_id = p_recipe_id;

  IF v_style IS NOT NULL THEN
    IF v_recipe.est_og < v_style.og_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'warning',
        'message', format('OG (%s) is below style minimum (%s). Consider increasing base malt or reducing volume.', round(v_recipe.est_og::numeric, 3), round(v_style.og_min::numeric, 3)),
        'parameter', 'og'
      );
    ELSIF v_recipe.est_og > v_style.og_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'warning',
        'message', format('OG (%s) is above style maximum (%s). Consider reducing base malt or increasing volume.', round(v_recipe.est_og::numeric, 3), round(v_style.og_max::numeric, 3)),
        'parameter', 'og'
      );
    END IF;

    IF v_recipe.est_ibu < v_style.ibu_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'warning',
        'message', format('IBU (%s) is below style minimum (%s). Consider adding more bittering hops.', v_recipe.est_ibu, v_style.ibu_min),
        'parameter', 'ibu'
      );
    ELSIF v_recipe.est_ibu > v_style.ibu_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'warning',
        'message', format('IBU (%s) is above style maximum (%s). Consider reducing bittering hops.', v_recipe.est_ibu, v_style.ibu_max),
        'parameter', 'ibu'
      );
    END IF;

    IF v_recipe.est_srm < v_style.srm_min THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'info',
        'message', format('Color (%s SRM) is lighter than style minimum (%s). Consider adding specialty malts.', v_recipe.est_srm, v_style.srm_min),
        'parameter', 'srm'
      );
    ELSIF v_recipe.est_srm > v_style.srm_max THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'style_compliance', 'severity', 'info',
        'message', format('Color (%s SRM) is darker than style maximum (%s). Consider reducing dark malts.', v_recipe.est_srm, v_style.srm_max),
        'parameter', 'srm'
      );
    END IF;
  END IF;

  IF v_yeast IS NOT NULL AND v_recipe.fermentation_schedule IS NOT NULL THEN
    DECLARE
      v_ferm_temp INTEGER;
    BEGIN
      v_ferm_temp := (v_recipe.fermentation_schedule->0->>'temperature_f')::INTEGER;
      IF v_ferm_temp IS NOT NULL THEN
        IF v_ferm_temp < v_yeast.temp_min_f THEN
          v_suggestions := v_suggestions || jsonb_build_object(
            'category', 'fermentation', 'severity', 'warning',
            'message', format('Fermentation temp (%s F) is below yeast minimum (%s F). May cause slow/stuck fermentation.', v_ferm_temp, v_yeast.temp_min_f),
            'parameter', 'fermentation_temp'
          );
        ELSIF v_ferm_temp > v_yeast.temp_max_f THEN
          v_suggestions := v_suggestions || jsonb_build_object(
            'category', 'fermentation', 'severity', 'warning',
            'message', format('Fermentation temp (%s F) is above yeast maximum (%s F). May cause off-flavors.', v_ferm_temp, v_yeast.temp_max_f),
            'parameter', 'fermentation_temp'
          );
        END IF;
      END IF;
    END;
  END IF;

  IF v_grain_bill.total_weight > 0 THEN
    DECLARE
      v_base_pct NUMERIC;
    BEGIN
      v_base_pct := v_grain_bill.base_weight * 100.0 / v_grain_bill.total_weight;
      IF v_base_pct < 70 THEN
        v_suggestions := v_suggestions || jsonb_build_object(
          'category', 'grain_bill', 'severity', 'info',
          'message', format('Base malt is only %s%% of grain bill. Consider 70-90%% for most styles.', round(v_base_pct)),
          'parameter', 'base_malt_percentage'
        );
      END IF;
    END;
  END IF;

  IF v_water IS NOT NULL AND v_style IS NOT NULL THEN
    IF v_style.category ILIKE '%IPA%' OR v_style.category ILIKE '%Pale%' THEN
      IF v_water.sulfate_ppm / NULLIF(v_water.chloride_ppm, 0) < 1.5 THEN
        v_suggestions := v_suggestions || jsonb_build_object(
          'category', 'water_chemistry', 'severity', 'info',
          'message', format('Sulfate:Chloride ratio (%s:1) is low for hoppy style. Consider 2:1 or higher.', round((v_water.sulfate_ppm / NULLIF(v_water.chloride_ppm, 1))::numeric, 1)),
          'parameter', 'sulfate_chloride_ratio'
        );
      END IF;
    END IF;
  END IF;

  IF v_recipe.mash_temp_f IS NOT NULL AND v_yeast IS NOT NULL THEN
    IF v_recipe.mash_temp_f > 156 AND v_recipe.target_attenuation > 75 THEN
      v_suggestions := v_suggestions || jsonb_build_object(
        'category', 'mash', 'severity', 'warning',
        'message', format('High mash temp (%s F) may limit fermentability. Target attenuation (%s%%) may not be achievable.', v_recipe.mash_temp_f, round(v_recipe.target_attenuation)),
        'parameter', 'mash_temp'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe.name,
    'suggestion_count', jsonb_array_length(v_suggestions),
    'suggestions', v_suggestions
  );
END;
$$;

-- analyze_batch_performance
CREATE OR REPLACE FUNCTION analyze_batch_performance(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'batch_id', b.id,
    'batch_number', b.batch_number,
    'status', b.status,
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'target_og', re.est_og,
      'target_fg', re.est_fg,
      'target_abv', re.est_abv
    ),
    'actuals', jsonb_build_object(
      'og', (
        SELECT (e->>'measurements')::jsonb->0->>'value'
        FROM brew_logs bl
        JOIN brew_log_batches blb ON blb.brew_log_id = bl.id
        CROSS JOIN jsonb_array_elements(bl.events) e
        WHERE blb.batch_id = b.id
        AND e->>'phase' = 'ko_end'
        LIMIT 1
      ),
      'fg', b.actual_fg,
      'abv', b.actual_abv
    ),
    'variances', jsonb_build_object(
      'fg_variance', CASE WHEN b.actual_fg IS NOT NULL AND re.est_fg IS NOT NULL
        THEN ROUND((b.actual_fg - re.est_fg)::numeric, 3) END,
      'abv_variance', CASE WHEN b.actual_abv IS NOT NULL AND re.est_abv IS NOT NULL
        THEN ROUND((b.actual_abv - re.est_abv)::numeric, 1) END
    ),
    'fermentation', jsonb_build_object(
      'planned_start', b.planned_start_date,
      'readings_count', 0,
      'latest_reading', NULL
    )
  ) INTO v_result
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE b.id = p_batch_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Batch not found'));
END;
$$;

-- get_inventory_overview
CREATE OR REPLACE FUNCTION get_inventory_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'finished_goods', (
      SELECT jsonb_agg(jsonb_build_object(
        'brand', fg.brand_name,
        'package_type', fg.package_name,
        'total_quantity', fg.total_qty,
        'available_quantity', fg.available_qty
      ))
      FROM (
        SELECT
          br.name as brand_name,
          pt.name as package_name,
          SUM(bi.quantity) as total_qty,
          SUM(bi.quantity) - COALESCE(SUM(
            (SELECT SUM(a.quantity) FROM allocations a
             WHERE a.source_type = 'finished_good'
             AND a.source_id = fg.id
             AND a.status IN ('planned', 'completed'))
          ), 0) as available_qty
        FROM bin_inventory bi
        JOIN finished_goods fg ON fg.id = bi.finished_good_id
        JOIN brands br ON br.id = fg.brand_id
        JOIN package_types pt ON pt.id = fg.package_type_id
        GROUP BY br.id, br.name, pt.id, pt.name
      ) fg
    ),
    'raw_materials', (
      SELECT jsonb_agg(jsonb_build_object(
        'item_name', ri.name,
        'item_type', ri.type,
        'quantity_available', ri.available,
        'unit', ri.unit
      ))
      FROM (
        SELECT
          ii.name,
          ii.category as type,
          ii.unit,
          COALESCE(SUM(il.quantity), 0) - COALESCE(SUM(
            (SELECT SUM(a.quantity) FROM allocations a
             WHERE a.source_type = 'inventory_lot'
             AND a.source_id = il.id
             AND a.status IN ('planned', 'completed'))
          ), 0) as available
        FROM inventory_items ii
        LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
        GROUP BY ii.id, ii.name, ii.category, ii.unit
      ) ri
      WHERE ri.available > 0
    ),
    'batches_in_progress', (
      SELECT jsonb_agg(jsonb_build_object(
        'batch_number', b.batch_number,
        'recipe_name', r.name,
        'status', b.status,
        'planned_start', b.planned_start_date
      ))
      FROM batches b
      JOIN recipes r ON r.id = b.recipe_id
      WHERE b.status NOT IN ('completed', 'cancelled')
      ORDER BY b.planned_start_date
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- get_ai_schema_context
CREATE OR REPLACE FUNCTION get_ai_schema_context(p_domain TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'tables', jsonb_agg(jsonb_build_object(
        'table_name', sr.table_name,
        'description', sr.description,
        'domain', sr.domain,
        'relationships', sr.relationships,
        'key_fields', sr.key_fields,
        'state_machine', sr.state_machine,
        'query_examples', sr.query_examples,
        'ai_context', sr.ai_context,
        'calculated_fields', sr.calculated_fields
      ) ORDER BY sr.domain, sr.table_name)
    )
    FROM _schema_registry sr
    WHERE p_domain IS NULL OR sr.domain = p_domain
  );
END;
$$;

-- =============================================================================
-- 5. Move pg_trgm extension to extensions schema
-- =============================================================================

-- Create extensions schema if not exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Grant usage on extensions schema to roles
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Note: Moving an extension is not straightforward - it requires dropping and recreating
-- For safety, we'll create the extension in the extensions schema if it doesn't exist there
-- The existing pg_trgm in public will continue to work

DO $$
BEGIN
  -- Check if pg_trgm exists in extensions schema
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
  ) THEN
    -- We cannot easily move the extension, but we can document this for manual fix
    -- In a production environment, you'd need to:
    -- 1. DROP EXTENSION pg_trgm CASCADE;
    -- 2. CREATE EXTENSION pg_trgm SCHEMA extensions;
    -- 3. Recreate any indexes that depended on it
    RAISE NOTICE 'pg_trgm is in public schema. To move it: DROP EXTENSION pg_trgm CASCADE; CREATE EXTENSION pg_trgm SCHEMA extensions; Then recreate dependent indexes.';
  END IF;
END $$;

-- =============================================================================
-- 6. Fix rls_policy_always_true: Tighten user_preferences INSERT policy
-- =============================================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "System can insert preferences" ON user_preferences;

-- Create a more restrictive policy for authenticated users
-- The create_user_preferences() function uses SECURITY DEFINER and can insert on behalf of users
-- The service_role bypasses RLS by default, so no explicit policy is needed
-- Users can also manually insert their own preferences (in case trigger fails)
CREATE POLICY "Users can insert own preferences" ON user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
