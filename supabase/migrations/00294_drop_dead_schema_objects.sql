-- Migration: 00294_drop_dead_schema_objects.sql
-- Schema audit 2026-08-21 (docs/plans/2026-08-21-schema-audit.md, H1–H4 + M2):
-- drop confirmed-dead objects — zero app reads/writes, ref-counted against
-- src/, migration function bodies, and supabase/live-catalog.snapshot.txt.
--
-- Every destructive statement is preceded by an in-migration empty-guard so a
-- live apply FAILS LOUDLY instead of destroying data. If a guard fires, the
-- operator exports the rows first, then re-runs.
--
-- Dropped here:
--   1. recipe_variants family (H1): recipe_variants_with_costs view,
--      recipe_variant_{hops,adjuncts,fruits,spices}, recipe_variants, and
--      batches.recipe_variant_id (nothing ever inserts a variant, so the
--      column can never be populated). The dangling "recipe_variant" entity
--      relation was removed from src/entities/batch/core.ts in this commit.
--   2. recipe_collaborators (H4): zero references outside generated types.
--   3. recent_vessel_cleanings view + vessel_cleanings table + cleaning_type
--      enum (H3): no write path exists anywhere; the only reader (AI chat
--      tool getVesselCleanings) is removed in this commit.
--   4. packages (H2): superseded by finished_goods + selling_formats.
--   5. pricing_channel_formats (M2): executes the already-scoped retirement
--      from issue #724; 00285 itself labeled it "SUPERSEDED … DEAD".
--
-- Deliberately NOT touched: allocations_legacy and _backup_fulfill_past_orders
-- (data-bearing by design; retention is a human decision).
--
-- src/types/supabase.ts is generated from the live DB and will be regenerated
-- after live-apply (scripts/db-push.sh); leftover types are harmless meanwhile.

-- =============================================================================
-- 0. Guards — every table must be empty (and batches.recipe_variant_id all
--    NULL) or the whole migration aborts before any drop runs.
-- =============================================================================
DO $$
DECLARE
  _tbl TEXT;
  _tbl_has_rows BOOLEAN;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'recipe_variant_hops',
    'recipe_variant_adjuncts',
    'recipe_variant_fruits',
    'recipe_variant_spices',
    'recipe_variants',
    'recipe_collaborators',
    'vessel_cleanings',
    'packages',
    'pricing_channel_formats'
  ] LOOP
    -- to_regclass guard: on a fresh replay the table exists (created earlier
    -- in the chain); tolerate live environments where it was already removed.
    IF to_regclass('public.' || _tbl) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', _tbl)
        INTO STRICT _tbl_has_rows;
      IF _tbl_has_rows THEN
        RAISE EXCEPTION
          '% is not empty — export before dropping (schema audit 2026-08-21)',
          _tbl;
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  _has_values BOOLEAN;
BEGIN
  -- Dynamic SQL so this block still parses/plans on environments where the
  -- column is already gone (AND does not short-circuit at plan time).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'batches'
      AND column_name = 'recipe_variant_id'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.batches WHERE recipe_variant_id IS NOT NULL LIMIT 1)'
      INTO STRICT _has_values;
    IF _has_values THEN
      RAISE EXCEPTION
        'batches.recipe_variant_id has non-NULL values — export before dropping (schema audit 2026-08-21)';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE package_id IS NOT NULL LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'order_items.package_id has non-NULL values referencing packages — export before dropping (schema audit 2026-08-21)';
  END IF;
END $$;

-- =============================================================================
-- 1. recipe_variants family (H1)
-- =============================================================================
DROP VIEW IF EXISTS recipe_variants_with_costs;

-- batches.recipe_variant_id is referenced by batches_with_brew_info (defined
-- with b.* — final shape 00204) and, transitively, batches_with_blend_info
-- (00236). Drop both, drop the column, then recreate them VERBATIM from
-- 00204 / 00236 (only difference: the view no longer exposes the dropped
-- column via b.*).
DROP VIEW IF EXISTS batches_with_blend_info;
DROP VIEW IF EXISTS batches_with_brew_info;

ALTER TABLE batches DROP COLUMN IF EXISTS recipe_variant_id;

-- Junctions before parent (FK order).
DROP TABLE IF EXISTS recipe_variant_hops;
DROP TABLE IF EXISTS recipe_variant_adjuncts;
DROP TABLE IF EXISTS recipe_variant_fruits;
DROP TABLE IF EXISTS recipe_variant_spices;
DROP TABLE IF EXISTS recipe_variants;

-- ---- Recreate batches_with_brew_info (verbatim from 00204) ------------------
CREATE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
SELECT
  b.*,
  (
    SELECT MIN(bl.brew_date)
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS brew_date,
  -- Volume-weighted average knockout gravity, averaged in Plato and then
  -- converted to SG (formula must stay identical to platoToSg() in
  -- src/domain/units.ts — see 00204).
  (
    SELECT 1 + wp.avg_plato / (258.6 - 0.8796 * wp.avg_plato)
    FROM (
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
        END AS avg_plato
      FROM brew_log_batches blb
      JOIN brew_logs bl ON bl.id = blb.brew_log_id
      WHERE blb.batch_id = b.id
    ) wp
  ) AS actual_og,
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS volume_from_brews_bbl,
  (
    SELECT COUNT(*)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS brew_count,
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

-- ---- Recreate batches_with_blend_info (verbatim from 00236) -----------------
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
-- 2. recipe_collaborators (H4)
-- =============================================================================
DROP TABLE IF EXISTS recipe_collaborators;

-- =============================================================================
-- 3. vessel_cleanings + view + enum (H3)
-- =============================================================================
DROP VIEW IF EXISTS recent_vessel_cleanings;
DROP TABLE IF EXISTS vessel_cleanings;
-- The cleaning_type Postgres ENUM (00006) was only used by
-- vessel_cleanings.cleaning_type; orphaned once the table is gone.
DROP TYPE IF EXISTS cleaning_type;
-- No migration seeds 'cleaning_type' into the enum_values registry (00037
-- seeded other types only), but delete defensively in case rows were added
-- out-of-band on live.
DELETE FROM enum_values WHERE enum_type = 'cleaning_type';

-- =============================================================================
-- 4. packages (H2)
-- =============================================================================
-- order_items.package_id (00001) FKs packages. The column itself is on the M1
-- column-drop audit list (step 5 of the audit plan, gated on live-NULL checks
-- across the whole batch), so only the FK constraint is removed here — the
-- guard above already proved the column is all-NULL. Dropped dynamically:
-- constraint names can drift between chain and live.
DO $$
DECLARE
  _rec RECORD;
BEGIN
  IF to_regclass('public.packages') IS NOT NULL THEN
    FOR _rec IN
      SELECT conname, conrelid::regclass AS referencing_table
      FROM pg_constraint
      WHERE confrelid = to_regclass('public.packages')
        AND contype = 'f'
    LOOP
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        _rec.referencing_table, _rec.conname
      );
    END LOOP;
  END IF;
END $$;

DROP TABLE IF EXISTS packages;

-- =============================================================================
-- 5. pricing_channel_formats (M2 — executes issue #724's scoped retirement)
-- =============================================================================
DROP TABLE IF EXISTS pricing_channel_formats;

-- =============================================================================
-- 6. _schema_registry cleanup
-- =============================================================================
DELETE FROM _schema_registry
WHERE table_name IN (
  'recipe_variants',
  'recipe_variant_hops',
  'recipe_variant_adjuncts',
  'recipe_variant_fruits',
  'recipe_variant_spices',
  'recipe_collaborators',
  'vessel_cleanings',
  'packages',
  'pricing_channel_formats'
);

-- vessels still advertised "has_many: vessel_cleanings" (00006).
UPDATE _schema_registry
SET relationships = relationships - 'has_many: vessel_cleanings'
WHERE table_name = 'vessels';
