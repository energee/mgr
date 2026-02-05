-- Add batch_count to recipes_with_estimates view.
-- Counts batches per recipe via a CTE, appended as the last column.

CREATE OR REPLACE VIEW recipes_with_estimates
WITH (security_invoker = true)
AS
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
            CASE rh.timing
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
                ELSE 0::numeric
            END) AS weighted_ibu_factor
    FROM recipe_hops rh
        JOIN hops h ON h.id = rh.hop_id
    GROUP BY rh.recipe_id
), batch_counts AS (
    SELECT recipe_id, count(*)::int AS batch_count
    FROM batches
    WHERE recipe_id IS NOT NULL
    GROUP BY recipe_id
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
    r.use_default_additions,
    r.is_template,
    r.status,
    bs.name AS style_name,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
        ELSE NULL::numeric
    END AS est_og,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
        ELSE NULL::numeric
    END AS est_fg,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25, 1)
        ELSE NULL::numeric
    END AS est_abv,
    CASE
        WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
        ELSE NULL::numeric
    END AS est_ibu,
    CASE
        WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1.4922 * power(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
        ELSE NULL::numeric
    END AS est_srm,
    NULL::numeric AS est_cogs,
    COALESCE(bc.batch_count, 0) AS batch_count
FROM recipes r
    LEFT JOIN beer_styles bs ON bs.id = r.style_id
    LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
    LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
    LEFT JOIN yeasts y ON y.id = r.yeast_id
    LEFT JOIN batch_counts bc ON bc.recipe_id = r.id;
