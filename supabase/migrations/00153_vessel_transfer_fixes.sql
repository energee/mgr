-- =============================================================================
-- Migration: 00153_vessel_transfer_fixes
--
-- Fixes multiple issues in the batch/vessel/transfer domain:
--
-- 1. FIX batches_with_brew_info view: DISTINCT ON without ORDER BY in the
--    current_vessels CTE caused non-deterministic results, making every batch
--    show Vessel = "—". Adds ORDER BY v.current_batch_id, v.name.
--
-- 2. RESTORE batches_with_blend_info view: Migration 00101 used DROP CASCADE
--    on batches_with_brew_info which silently dropped the dependent
--    batches_with_blend_info view. It was never recreated. Two components
--    (batch-blend-history.tsx, batch-blend-dialog.tsx) reference it.
--
-- 3. CLEANUP duplicate vessel_transfers and add unique index.
--    Same pattern as 00147_allocation_unique_constraint.sql.
--
-- 4. FIX kettle vessel type: vessel named "Kettle" was created with
--    vessel_type='fermenter' instead of 'kettle'.
-- =============================================================================

-- =============================================================================
-- 1. Drop dependent views in correct order
-- =============================================================================

DROP VIEW IF EXISTS batches_with_blend_info;
DROP VIEW IF EXISTS batches_with_brew_info;

-- =============================================================================
-- 2. Recreate batches_with_brew_info with fixed DISTINCT ON + vessel_type
-- =============================================================================

CREATE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
WITH brew_stats AS (
  SELECT
    blb.batch_id,
    MIN(bl.brew_date) AS brew_date,
    COALESCE(SUM(blb.volume_bbl), 0) AS volume_from_brews_bbl,
    COUNT(*)::bigint AS brew_count,
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
    END AS actual_og
  FROM brew_log_batches blb
  JOIN brew_logs bl ON bl.id = blb.brew_log_id
  GROUP BY blb.batch_id
),
current_vessels AS (
  SELECT DISTINCT ON (v.current_batch_id)
    v.current_batch_id AS batch_id,
    v.id AS current_vessel_id,
    v.name AS current_vessel_name,
    v.vessel_type AS current_vessel_type
  FROM vessels v
  WHERE v.current_batch_id IS NOT NULL
  ORDER BY v.current_batch_id, v.name
)
SELECT
  b.*,
  bs.brew_date,
  bs.actual_og,
  COALESCE(bs.volume_from_brews_bbl, 0) AS volume_from_brews_bbl,
  COALESCE(bs.brew_count, 0) AS brew_count,
  cv.current_vessel_id,
  cv.current_vessel_name,
  cv.current_vessel_type
FROM batches b
LEFT JOIN brew_stats bs ON bs.batch_id = b.id
LEFT JOIN current_vessels cv ON cv.batch_id = b.id;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs and current vessel. Use this view when you need brew date, OG, and vessel info without manual joins.';

-- =============================================================================
-- 3. Recreate dependent view: batches_with_blend_info
--    (Originally from 00063, last defined in 00086)
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
-- 4. AUDIT: Check for duplicate vessel_transfers
-- =============================================================================

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT batch_id, from_vessel_id, to_vessel_id, transferred_at
    FROM vessel_transfers
    GROUP BY batch_id, from_vessel_id, to_vessel_id, transferred_at
    HAVING count(*) > 1
  ) dupes;

  IF dup_count > 0 THEN
    RAISE WARNING '[00153] Found % duplicate vessel_transfer group(s). Cleaning up — keeping earliest created_at per group.',
      dup_count;
  END IF;
END;
$$;

-- =============================================================================
-- 5. DELETE duplicate vessel_transfers (keep earliest created_at per group)
-- =============================================================================

DELETE FROM vessel_transfers
WHERE id NOT IN (
  SELECT DISTINCT ON (batch_id, from_vessel_id, to_vessel_id, transferred_at) id
  FROM vessel_transfers
  ORDER BY batch_id, from_vessel_id, to_vessel_id, transferred_at, created_at ASC
);

-- =============================================================================
-- 6. CREATE UNIQUE INDEX on vessel_transfers
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_transfers_unique_per_batch
  ON vessel_transfers (
    batch_id,
    COALESCE(from_vessel_id, '00000000-0000-0000-0000-000000000000'),
    to_vessel_id,
    transferred_at
  );

COMMENT ON INDEX idx_vessel_transfers_unique_per_batch IS
  'Prevents duplicate vessel transfers for the same batch, source, destination, and timestamp. '
  'COALESCE handles nullable from_vessel_id (knockout transfers from kettle). '
  'Closes the double-submit race condition.';

-- =============================================================================
-- 7. FIX kettle vessel type
-- =============================================================================

UPDATE vessels
SET vessel_type = 'kettle'
WHERE name = 'Kettle' AND vessel_type != 'kettle';
