-- Migration: 00297_drop_dead_columns.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, M1):
-- drop dead columns — every one ref-counted to zero in src/ and in migration
-- function bodies, and live-NULL-checked against the production DB on
-- 2026-08-21 (read-only). MongoDB sync (src/integrations/mongodb/sync.ts +
-- transformers.ts) was verified to write NONE of these fields.
--
-- Guard style follows 00294: every destructive statement is preceded by an
-- in-migration guard that RAISEs EXCEPTION ("export before dropping") if data
-- exists, and every check is column-existence-aware (information_schema /
-- IF EXISTS) because chain and live have drifted:
--   - yeast_pitches.{batch_id, pitched_at, cell_count_billion} are CHAIN-ONLY
--     (live dropped them out-of-band); guarded anyway for replay safety.
--   - recipes.boil_time_minutes (00001) needs no drop at all: 00011 RENAMED
--     it to boil_time_min, so it exists nowhere under the old name — and
--     boil_time_min itself is ALIVE (recipe editor, MongoDB sync) and is NOT
--     touched here.
--   - recipes.{ingredients, instructions} are DATA-BEARING on live (153/153
--     rows non-NULL); their guard WILL fire on live until the operator
--     exports and NULLs them (instructions in the RAISE message).
--   - recipe_yeasts.pitch_rate is 141/141 non-NULL on live but every value
--     equals the column DEFAULT 0.75 (00016) — default noise, not data. Its
--     guard fires only on a value <> 0.75.
--
-- Dropped columns (all verified 0 meaningful non-NULL rows on live except as
-- noted above):
--   yeast_pitches:  batch_id, pitched_at, cell_count_billion,
--                   current_viability      (superseded by yeast_pitch_events, 00158)
--   recipes:        ingredients, instructions (legacy JSONB),
--                   batch_size_gallons, style (TEXT next to style_id)
--   order_items:    package_id             (vestigial schema-v1; FK already
--                                           removed with packages in 00294)
--   hops:           hsi, myrcene_percent, humulene_percent,
--                   caryophyllene_percent, farnesene_percent, substitutes
--   malts:          max_percentage
--   sugars:         fermentability
--   fruits:         sugar_content
--   spices:         cost_per_unit
--   additives:      cost_per_unit          (yeasts.cost_per_unit is ALIVE —
--                                           recipes_with_cogs yeast_cost)
--   recipe_yeasts:  pitch_rate, fermentation_temp_f
--
-- Dependent views (dropped before the column drops, recreated after, each
-- with security_invoker = true; definitions cross-checked against the live
-- pg_get_viewdef output captured 2026-08-21):
--   - recipes_with_estimates (00218)  — loses style/batch_size_gallons/
--     ingredients/instructions passthroughs; est_* columns unchanged.
--   - batches_with_blend_info (00294) — does not touch dropped columns, but
--     selects FROM recipes_with_estimates, so it must be dropped/recreated
--     around it (recreated verbatim from 00294).
--   - recipes_with_cogs (00021)       — addition_cost was SUM(amount *
--     additives.cost_per_unit); all cost_per_unit are NULL on live, so the
--     COALESCE always yielded 0. The column is removed outright — ref-count 0
--     in src/ and in migration function bodies (get_sales_projection reads
--     only total_cogs).
--   - batch_additions_with_costs (00101) — same reasoning for the spices
--     branch (amount * spices.cost_per_unit ≡ NULL → COALESCE 0).
--   - order_items_with_details (00190) — loses the package_id passthrough.
--   - yeast_pitches_with_remaining (00191) — loses the current_viability
--     passthrough (estimated_viability, the computed replacement, stays).
--   - yeast_pitches_with_details (00035) — CHAIN-ONLY leftover (live dropped
--     it out-of-band with yeast_pitches.batch_id); replaced by
--     yeast_pitches_with_remaining in 00158 and read by nothing. Dropped for
--     good, together with its _schema_registry row.
--
-- Functions audited: get_recipe_summary / analyze_recipe_style_compliance /
-- suggest_recipe_improvements (latest defs in 00014) and every other function
-- joining these views only read surviving columns (est_*), so no function is
-- recreated here.
--
-- supabase/seed.sql stops inserting recipes.style / batch_size_gallons in the
-- same commit (seed runs after migrations; leaving them would break
-- `make db-local`, as happened with 00294/packages).
--
-- src/types/supabase.ts is generated from the live DB and will be regenerated
-- after live-apply (scripts/db-push.sh); leftover types are harmless meanwhile.

-- =============================================================================
-- 0. Guards
-- =============================================================================
-- One loop over (table, column, meaningful-data predicate, custom message).
-- predicate NULL → "column IS NOT NULL"; msg NULL → the generic "export
-- before dropping" message. Each check is skipped when the column is already
-- gone (live drift).
DO $$
DECLARE
  _g RECORD;
  _has_data BOOLEAN;
BEGIN
  FOR _g IN
    SELECT * FROM (VALUES
      ('yeast_pitches', 'batch_id',           NULL, NULL),
      ('yeast_pitches', 'pitched_at',         NULL, NULL),
      ('yeast_pitches', 'cell_count_billion', NULL, NULL),
      ('yeast_pitches', 'current_viability',  NULL, NULL),
      -- recipes.ingredients / instructions are data-bearing on live; these
      -- rows are EXPECTED to fire there until the operator archives the
      -- legacy JSONB (runbook in the message). Fresh replays pass (empty).
      ('recipes', 'ingredients',  NULL,
       'recipes.ingredients still holds legacy JSONB data — export it first '
       '(e.g. \copy (SELECT id, name, ingredients, instructions FROM recipes '
       'WHERE ingredients IS NOT NULL OR instructions IS NOT NULL) TO recipes_legacy_jsonb.csv CSV HEADER), '
       'archive the file, then UPDATE recipes SET ingredients = NULL, instructions = NULL '
       'and re-run this migration (schema audit 2026-08-21, M1)'),
      ('recipes', 'instructions', NULL,
       'recipes.instructions still holds legacy JSONB data — export it first '
       '(e.g. \copy (SELECT id, name, ingredients, instructions FROM recipes '
       'WHERE ingredients IS NOT NULL OR instructions IS NOT NULL) TO recipes_legacy_jsonb.csv CSV HEADER), '
       'archive the file, then UPDATE recipes SET ingredients = NULL, instructions = NULL '
       'and re-run this migration (schema audit 2026-08-21, M1)'),
      ('recipes', 'batch_size_gallons', NULL, NULL),
      ('recipes', 'style',              NULL, NULL),
      ('order_items', 'package_id',     NULL, NULL),
      ('hops', 'hsi',                   NULL, NULL),
      ('hops', 'myrcene_percent',       NULL, NULL),
      ('hops', 'humulene_percent',      NULL, NULL),
      ('hops', 'caryophyllene_percent', NULL, NULL),
      ('hops', 'farnesene_percent',     NULL, NULL),
      ('hops', 'substitutes',           NULL, NULL),
      ('malts', 'max_percentage',       NULL, NULL),
      ('sugars', 'fermentability',      NULL, NULL),
      ('fruits', 'sugar_content',       NULL, NULL),
      ('spices', 'cost_per_unit',       NULL, NULL),
      ('additives', 'cost_per_unit',    NULL, NULL),
      -- 0.75 is the literal column DEFAULT from 00016: on live every row
      -- carries it (default noise, not data), so only a different value is
      -- meaningful.
      ('recipe_yeasts', 'pitch_rate',
       'pitch_rate IS NOT NULL AND pitch_rate <> 0.75',
       'recipe_yeasts.pitch_rate has values other than the 0.75 default — export before dropping (schema audit 2026-08-21, M1)'),
      ('recipe_yeasts', 'fermentation_temp_f', NULL, NULL)
    ) AS t(tbl, col, predicate, msg)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = _g.tbl
        AND column_name = _g.col
    ) THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %s LIMIT 1)',
        _g.tbl, COALESCE(_g.predicate, format('%I IS NOT NULL', _g.col))
      ) INTO STRICT _has_data;
      IF _has_data THEN
        RAISE EXCEPTION USING MESSAGE = COALESCE(
          _g.msg,
          format('%s.%s has non-NULL values — export before dropping (schema audit 2026-08-21, M1)',
                 _g.tbl, _g.col));
      END IF;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 1. Drop dependent views
-- =============================================================================
-- batches_with_blend_info selects FROM recipes_with_estimates, so it goes
-- first. No CASCADE anywhere: an unexpected dependent must fail loudly.
DROP VIEW IF EXISTS batches_with_blend_info;
DROP VIEW IF EXISTS recipes_with_estimates;
DROP VIEW IF EXISTS recipes_with_cogs;
DROP VIEW IF EXISTS batch_additions_with_costs;
DROP VIEW IF EXISTS order_items_with_details;
DROP VIEW IF EXISTS yeast_pitches_with_remaining;
-- Chain-only leftover (see header) — dropped permanently, not recreated.
DROP VIEW IF EXISTS yeast_pitches_with_details;

-- =============================================================================
-- 2. Column drops
-- =============================================================================
ALTER TABLE yeast_pitches
  DROP COLUMN IF EXISTS batch_id,
  DROP COLUMN IF EXISTS pitched_at,
  DROP COLUMN IF EXISTS cell_count_billion,
  DROP COLUMN IF EXISTS current_viability;

ALTER TABLE recipes
  DROP COLUMN IF EXISTS ingredients,
  DROP COLUMN IF EXISTS instructions,
  DROP COLUMN IF EXISTS batch_size_gallons,
  DROP COLUMN IF EXISTS style;

ALTER TABLE order_items
  DROP COLUMN IF EXISTS package_id;

ALTER TABLE hops
  DROP COLUMN IF EXISTS hsi,
  DROP COLUMN IF EXISTS myrcene_percent,
  DROP COLUMN IF EXISTS humulene_percent,
  DROP COLUMN IF EXISTS caryophyllene_percent,
  DROP COLUMN IF EXISTS farnesene_percent,
  DROP COLUMN IF EXISTS substitutes;

ALTER TABLE malts
  DROP COLUMN IF EXISTS max_percentage;

ALTER TABLE sugars
  DROP COLUMN IF EXISTS fermentability;

ALTER TABLE fruits
  DROP COLUMN IF EXISTS sugar_content;

ALTER TABLE spices
  DROP COLUMN IF EXISTS cost_per_unit;

ALTER TABLE additives
  DROP COLUMN IF EXISTS cost_per_unit;

ALTER TABLE recipe_yeasts
  DROP COLUMN IF EXISTS pitch_rate,
  DROP COLUMN IF EXISTS fermentation_temp_f;

-- =============================================================================
-- 3. Recreate views (minus the dropped columns)
-- =============================================================================

-- ---- recipes_with_estimates (from 00218, minus style / batch_size_gallons /
-- ---- ingredients / instructions) --------------------------------------------
CREATE VIEW public.recipes_with_estimates
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
    r.description,
    r.target_og,
    r.target_fg,
    r.target_abv,
    r.target_ibu,
    r.target_srm,
    r.boil_time_min,
    r.mash_temp_f,
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

COMMENT ON VIEW recipes_with_estimates IS
  'Recipes with style name and calculated OG, FG, ABV, IBU (gravity-adjusted Tinseth), SRM estimates. Legacy passthroughs (style TEXT, batch_size_gallons, ingredients/instructions JSONB) removed in 00297.';

-- ---- batches_with_blend_info (verbatim from 00294) --------------------------
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

-- ---- recipes_with_cogs (from 00021, minus addition_cost) --------------------
-- additives.cost_per_unit was NULL on every live row, so the old
-- SUM(ra.amount * COALESCE(ad.cost_per_unit, 0)) always produced 0. The
-- column has no consumers (src/ ref-count 0; get_sales_projection reads only
-- total_cogs), so it is removed rather than kept as a constant.
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
    SUM((rh.weight_oz / 16.0) * COALESCE(h.cost_per_lb, 0)) as hop_cost,
    SUM(rh.weight_oz) as total_hop_oz
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
),
adjunct_costs AS (
  SELECT
    ra.recipe_id,
    SUM(ra.weight_lbs * COALESCE(a.cost_per_lb, 0)) as adjunct_cost
  FROM recipe_adjuncts ra
  JOIN adjuncts a ON a.id = ra.adjunct_id
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
    COALESCE(mc.total_grain_lbs, 0) as total_grain_lbs,
    COALESCE(hc.total_hop_oz, 0) as total_hop_oz
  FROM recipes r
  LEFT JOIN malt_costs mc ON mc.recipe_id = r.id
  LEFT JOIN hop_costs hc ON hc.recipe_id = r.id
  LEFT JOIN yeasts y ON y.id = r.yeast_id
  LEFT JOIN adjunct_costs ac ON ac.recipe_id = r.id
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
  ROUND((malt_cost + hop_cost + yeast_cost + adjunct_cost)::numeric, 2) as total_cogs,
  CASE
    WHEN COALESCE(batch_size_bbl, volume_bbl, 0) > 0 THEN
      ROUND((malt_cost + hop_cost + yeast_cost + adjunct_cost)
        / COALESCE(batch_size_bbl, volume_bbl)::numeric, 2)
    ELSE NULL
  END as cogs_per_bbl,
  ROUND(total_grain_lbs::numeric, 1) as total_grain_lbs,
  ROUND(total_hop_oz::numeric, 1) as total_hop_oz
FROM recipe_totals;

COMMENT ON VIEW recipes_with_cogs IS 'Recipe cost breakdown by ingredient category. addition_cost removed in 00297 (additives.cost_per_unit dropped — was never populated and had no consumers).';

-- ---- batch_additions_with_costs (from 00101, minus the spices cost branch) --
-- spices.cost_per_unit was NULL on every live row, so the spices branch
-- always produced NULL → COALESCE 0; behavior is unchanged.
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
      WHEN 'hops' THEN convert_to_lbs(ba.amount, ba.unit) * h.cost_per_lb
      WHEN 'adjuncts' THEN convert_to_lbs(ba.amount, ba.unit) * a.cost_per_lb
      WHEN 'fruits' THEN convert_to_lbs(ba.amount, ba.unit) * f.cost_per_lb
      ELSE 0
    END, 0
  ))::numeric, 2) AS estimated_cost
FROM batch_additions ba
LEFT JOIN hops h ON ba.catalog_table = 'hops' AND h.id = ba.catalog_id
LEFT JOIN adjuncts a ON ba.catalog_table = 'adjuncts' AND a.id = ba.catalog_id
LEFT JOIN fruits f ON ba.catalog_table = 'fruits' AND f.id = ba.catalog_id;

COMMENT ON VIEW batch_additions_with_costs IS 'Batch additions with estimated costs from catalog prices, with unit conversion. Spice additions cost 0 since 00297 (spices.cost_per_unit dropped — was never populated).';

-- ---- order_items_with_details (from 00190, minus package_id) ----------------
CREATE VIEW public.order_items_with_details
WITH (security_invoker = true) AS
 SELECT oi.id,
    oi.order_id,
    oi.batch_id,
    oi.selling_format_id,
    oi.quantity,
    oi.unit_price,
    oi.notes,
    oi.created_at,
    oi.brand_id,
    b.name AS brand_name,
    b.abv AS brand_abv,
    sf.name AS selling_format_name,
    c.type AS container_type,
    c.volume_oz,
    sf.unit_count,
    c.name AS container_name,
    oi.quantity::numeric * COALESCE(oi.unit_price, 0::numeric) AS line_total
   FROM order_items oi
     LEFT JOIN brands b ON b.id = oi.brand_id
     LEFT JOIN selling_formats sf ON sf.id = oi.selling_format_id
     LEFT JOIN containers c ON c.id = sf.container_id;

COMMENT ON VIEW order_items_with_details IS 'Order items with brand, selling format, and container details plus computed line totals.';

-- ---- yeast_pitches_with_remaining (from 00191, minus current_viability) -----
-- estimated_viability (computed) is the live replacement for the dropped
-- stored column.
CREATE VIEW public.yeast_pitches_with_remaining
WITH (security_invoker = true) AS
 SELECT yp.id,
    yp.strain_id,
    yp.source_type,
    yp.parent_pitch_id,
    yp.generation,
    yp.status,
    yp.volume_ml,
    yp.cell_count_thousand,
    yp.initial_viability,
    yp.cost,
    yp.cost_per_batch,
    yp.received_date,
    yp.harvest_date,
    yp.use_by_date,
    yp.location_id,
    yp.notes,
    yp.created_at,
    yp.updated_at,
    yp.created_by,
    yp.quantity_lbs,
    yp.cell_density_thousand,
    yp.vessel_id,
    y.name AS strain_name,
    y.manufacturer AS strain_manufacturer,
    y.product_code AS strain_code,
    y.type AS strain_type,
    y.form AS strain_form,
    y.attenuation_typical AS strain_attenuation,
    v.name AS vessel_name,
    v.vessel_type AS vessel_vessel_type,
    l.name AS location_name,
    yp.quantity_lbs - COALESCE(( SELECT sum(e.quantity_lbs) AS sum
           FROM yeast_pitch_events e
          WHERE e.pitch_id = yp.id), 0::numeric) AS quantity_remaining_lbs,
    COALESCE(( SELECT count(DISTINCT e.batch_id) AS count
           FROM yeast_pitch_events e
          WHERE e.pitch_id = yp.id), 0::bigint)::integer AS batches_pitched,
    EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone)::integer AS days_old,
    GREATEST(0::numeric, LEAST(100::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
        CASE
            WHEN y.form = 'dry'::text THEN 0.5
            ELSE 2.0
        END))::numeric(5,2) AS estimated_viability,
        CASE
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 90::numeric THEN 'excellent'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 75::numeric THEN 'good'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 50::numeric THEN 'marginal'::text
            WHEN GREATEST(0::numeric, yp.initial_viability - EXTRACT(day FROM now() - COALESCE(yp.harvest_date::timestamp without time zone, yp.received_date::timestamp without time zone)::timestamp with time zone) *
            CASE
                WHEN y.form = 'dry'::text THEN 0.5
                ELSE 2.0
            END) >= 25::numeric THEN 'low'::text
            ELSE 'inactive'::text
        END AS viability_status
   FROM yeast_pitches yp
     JOIN yeasts y ON yp.strain_id = y.id
     LEFT JOIN vessels v ON yp.vessel_id = v.id
     LEFT JOIN locations l ON yp.location_id = l.id;

COMMENT ON VIEW yeast_pitches_with_remaining IS 'Yeast pitches with strain details, vessel info, calculated viability, and remaining quantity derived from pitch events.';

-- =============================================================================
-- 4. _schema_registry corrections (the AI layer reads these via
--    get_ai_schema_context — keep them truthful)
-- =============================================================================

-- recipes description (00001) advertised the dropped legacy JSONB.
UPDATE _schema_registry
SET description = 'Beer recipes: targets and process parameters. Ingredients live in the structured junction tables (recipe_malts, recipe_hops, recipe_adjuncts, ...).',
    updated_at = NOW()
WHERE table_name = 'recipes';

-- Pure element removals below use the jsonb `-` idiom (array minus string
-- element, or object minus key) instead of whole-value overwrites, so any
-- out-of-band registry edits on live survive the apply.

-- recipe_yeasts key_fields (00145) advertised the dropped pitch_rate.
UPDATE _schema_registry
SET key_fields = key_fields - 'pitch_rate',
    updated_at = NOW()
WHERE table_name = 'recipe_yeasts';

-- yeast_pitches (00035) advertised batch_id in both relationships (a jsonb
-- object keyed by related table) and key_fields (an array).
UPDATE _schema_registry
SET relationships = relationships - 'batches',
    key_fields = key_fields - 'batch_id',
    updated_at = NOW()
WHERE table_name = 'yeast_pitches';

-- Registry row for the permanently-dropped chain-only view.
DELETE FROM _schema_registry
WHERE table_name = 'yeast_pitches_with_details';

-- order_items relationships (00001) still advertised belongs_to: packages
-- via the dropped package_id.
UPDATE _schema_registry
SET relationships = relationships - 'belongs_to: packages',
    updated_at = NOW()
WHERE table_name = 'order_items';

-- batches relationships (00005) still advertised has_many: packages — the
-- table itself was dropped in 00294; corrected here.
UPDATE _schema_registry
SET relationships = relationships - 'has_many: packages',
    updated_at = NOW()
WHERE table_name = 'batches';

-- =============================================================================
-- 5. PostgREST schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
