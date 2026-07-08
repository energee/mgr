-- 00218_recipe_ibu_tinseth.sql
-- Audit fix M1 + M2 (backlog #18): make the recipes_with_estimates IBU formula
-- match the recipe editor (single source of truth = gravity-adjusted Tinseth).
--
-- M1: the SQL view used a coarse stepped boil-time lookup (0.27/0.24/.../0.02)
--     with NO gravity term, while the editor sidebar
--     (src/components/domain/recipe/recipe-editor/recipe-estimate-calc.ts)
--     used gravity-adjusted Tinseth. The two IBU estimates diverged for the
--     same recipe. Decided: Tinseth is canonical (it is the modern standard and
--     what the TS code already implements) — port TS -> SQL.
-- M2: first-wort hopping was a flat 0.10 in SQL but ~0.23 in TS (a full 60-min
--     boil addition), the ~2.3x gap. The Tinseth port fixes this too.
--
-- The utilization math is isolated in hop_utilization_factor() so it can be
-- unit-tested for parity against the TS getHopUtilizationFactor
-- (recipe-estimate-calc.test.ts). The view's hop_ibu CTE now feeds the helper
-- the same preliminary OG the sidebar derives from the grain bill (grain points
-- x efficiency, or 1.050 when there is no grain). Only the hop_ibu CTE changes;
-- the rest of the view is reproduced byte-for-byte from 00191 (the current
-- definition on live). Views hold no data — safe to replace; the helper was
-- verified against live in a self-rolling-back DO block before push.

-- -----------------------------------------------------------------------------
-- 1. hop_utilization_factor helper (SQL mirror of getHopUtilizationFactor)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hop_utilization_factor(p_timing text, p_boil_time_min numeric, p_gravity numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gravity numeric := COALESCE(p_gravity, 1.050);
  v_bt numeric;
  v_bigness numeric;
  v_boil_factor numeric;
BEGIN
  -- Gravity-adjusted Tinseth, mirroring getHopUtilizationFactor in
  -- src/components/domain/recipe/recipe-editor/recipe-estimate-calc.ts:
  --   bigness    = 1.65 * 0.000125^(gravity - 1)
  --   boilFactor = (1 - e^(-0.04 * boil_time)) / 4.15
  -- first_wort is treated as a full 60-min boil addition; whirlpool/mash use
  -- fixed factors; everything else (dry_hop, post-ferment) adds no bitterness.
  IF p_timing = 'boil' THEN
    v_bt := COALESCE(p_boil_time_min, 60);
    IF v_bt <= 0 THEN RETURN 0; END IF;
    v_bigness := 1.65 * power(0.000125, v_gravity - 1);
    v_boil_factor := (1 - exp(-0.04 * v_bt)) / 4.15;
    RETURN v_bigness * v_boil_factor;
  ELSIF p_timing = 'first_wort' THEN
    v_bigness := 1.65 * power(0.000125, v_gravity - 1);
    v_boil_factor := (1 - exp(-0.04 * 60)) / 4.15;
    RETURN v_bigness * v_boil_factor;
  ELSIF p_timing = 'whirlpool' THEN
    RETURN 0.05;
  ELSIF p_timing = 'mash' THEN
    RETURN 0.08;
  ELSE
    RETURN 0;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.hop_utilization_factor(text, numeric, numeric) IS
  'Gravity-adjusted Tinseth hop utilization factor. SQL mirror of getHopUtilizationFactor (src/components/domain/recipe/recipe-editor/recipe-estimate-calc.ts) so the recipes_with_estimates IBU estimate matches the recipe editor sidebar (audit M1/M2). first_wort = full 60-min boil; whirlpool 0.05; mash 0.08; dry_hop 0.';

-- -----------------------------------------------------------------------------
-- 2. recipes_with_estimates — hop_ibu CTE now uses gravity-adjusted Tinseth via
--    hop_utilization_factor. Reproduced from 00191 with only that CTE changed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.recipes_with_estimates
WITH (security_invoker = true) AS
 WITH grain_totals AS (
         SELECT rm.recipe_id,
            sum(rm.weight_lbs) AS total_grain_lbs,
            sum(rm.weight_lbs * COALESCE(rm.ppg::numeric, m.potential_ppg, 36::numeric)) AS total_points,
            sum(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2::numeric)) AS mcu_sum
           FROM recipe_malts rm
             JOIN malts m ON m.id = rm.malt_id
          GROUP BY rm.recipe_id
        ), hop_ibu AS (
         SELECT rh.recipe_id,
            sum(rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10::numeric) *
                hop_utilization_factor(rh.timing, rh.boil_time_min,
                    CASE
                        WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN 1::numeric + gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric
                        ELSE 1.050::numeric
                    END)) AS weighted_ibu_factor
           FROM recipe_hops rh
             JOIN hops h ON h.id = rh.hop_id
             JOIN recipes r ON r.id = rh.recipe_id
             LEFT JOIN grain_totals gt ON gt.recipe_id = rh.recipe_id
          GROUP BY rh.recipe_id
        ), batch_counts AS (
         SELECT batches.recipe_id,
            count(*)::integer AS batch_count
           FROM batches
          WHERE batches.recipe_id IS NOT NULL
          GROUP BY batches.recipe_id
        )
 SELECT r.id,
    r.name,
    r.style,
    r.description,
    r.target_og,
    r.target_fg,
    r.target_abv,
    r.target_ibu,
    r.target_srm,
    r.batch_size_gallons,
    r.boil_time_min,
    r.mash_temp_f,
    r.ingredients,
    r.instructions,
    r.notes,
    r.is_active,
    r.created_at,
    r.updated_at,
    r.brand_id,
    r.style_id,
    r.yeast_id,
    r.water_profile_id,
    r.created_by,
    r.volume_bbl,
    r.batch_size_bbl,
    r.preboil_volume_bbl,
    r.target_ko_volume_bbl,
    r.mash_water_volume_gal,
    r.sparge_water_volume_gal,
    r.fermentation_days,
    r.conditioning_days,
    r.whirlpool_time_min,
    r.whirlpool_temp_f,
    r.whirlpool_rest_min,
    r.target_mash_ph,
    r.mash_efficiency,
    r.water_to_grain_ratio,
    r.target_ko_temp_f,
    r.target_attenuation,
    r.target_pitching_rate,
    r.yeast_nutrient_amount_g,
    r.mash_schedule,
    r.fermentation_schedule,
    r.brew_day_notes,
    r.tasting_notes,
    r.development_notes,
    r.target_water_profile_id,
    r.is_template,
    r.status,
    bs.name AS style_name,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1::numeric + gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric, 3)
            ELSE NULL::numeric
        END AS est_og,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1::numeric + gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric * (1::numeric - COALESCE(r.target_attenuation, y.attenuation_typical, 75::numeric) / 100::numeric), 3)
            ELSE NULL::numeric
        END AS est_fg,
        CASE
            WHEN gt.total_grain_lbs > 0::numeric AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(gt.total_points * COALESCE(r.mash_efficiency, 75::numeric) / 100::numeric / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric) / 1000::numeric * COALESCE(r.target_attenuation, y.attenuation_typical, 75::numeric) / 100::numeric * 131.25, 1)
            ELSE NULL::numeric
        END AS est_abv,
        CASE
            WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric))
            ELSE NULL::numeric
        END AS est_ibu,
        CASE
            WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) > 0::numeric THEN round(1.4922 * power(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1::numeric) * 31::numeric), 0.6859), 1)
            ELSE NULL::numeric
        END AS est_srm,
    NULL::numeric AS est_cogs,
    COALESCE(bc.batch_count, 0) AS batch_count,
    r.pricing_tier_id
   FROM recipes r
     LEFT JOIN beer_styles bs ON bs.id = r.style_id
     LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
     LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
     LEFT JOIN yeasts y ON y.id = r.yeast_id
     LEFT JOIN batch_counts bc ON bc.recipe_id = r.id;
