-- =============================================================================
-- actual_og: convert Plato -> SG at the database boundary
-- =============================================================================
-- Audit 2026-07-06 finding H3. Brew-log knockout gravity measurements are
-- recorded in degrees Plato (metric 'gravity_plato'), and
-- batches_with_brew_info.actual_og exposed their volume-weighted average RAW:
-- actual_og was a Plato-scale number (~12.5) while every consumer treats it
-- as specific gravity (~1.050) — the SG contract is documented in
-- src/domain/units.ts (formatGravityFromSg): "Recipe estimates and
-- `actual_og` / `actual_fg` are stored as SG (1.0xx)". Downstream damage:
--   - pitch dialog: sgToPlato(actual_og) on a Plato value -> absurd pitch
--     weights auto-filled;
--   - packaging completion: actual_abv = (OG - FG) x 131.25 with Plato OG
--     -> actual_abv ~ 1508 written to the batch;
--   - blend dialog / batch insights: garbage OG display next to SG targets.
--
-- Fix: the VIEW converts, and is the single conversion point — no TypeScript
-- consumer converts (or compensates) on top of it.
--
-- The weighted average stays in Plato (the measured unit, preserving the
-- existing averaging semantics — this also mirrors how the TS domain code
-- treats raw readings: canonicalise/average in Plato, convert for the SG
-- boundary), then the average is converted ONCE using the same standard
-- brewing formula as platoToSg() in src/domain/units.ts:
--
--     SG = 1 + Plato / (258.6 - 0.8796 * Plato)      (quoted exactly)
--
-- batches.actual_fg and recipe estimates are already SG at the source
-- (packaging completion / entry forms write SG) — checked: the view has no
-- actual_fg expression of its own (it passes through b.*), so actual_og was
-- the only Plato leak.
--
-- The view is dropped and recreated (not OR REPLACE) because batches gained
-- completed_at (00175) after the view's last recreation (00155): the frozen
-- b.* expansion no longer matches, so OR REPLACE would fail on column order.
-- Recreating also (additively) exposes batches.completed_at through the view.
-- Live-verified 2026-07-06: no other view depends on batches_with_brew_info.

DROP VIEW IF EXISTS batches_with_brew_info;

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
  -- converted to SG (see header — formula must stay identical to platoToSg()
  -- in src/domain/units.ts).
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

-- =============================================================================
-- analyze_batch_performance: actuals.og in SG, from the gravity metric
-- =============================================================================
-- Pre-00204 the 'og' block read measurements[0].value from the first ko_end
-- event UNFILTERED (whatever metric happened to be first) and returned the
-- raw Plato text while recipe.target_og is SG. Now it extracts the
-- 'gravity_plato' measurement specifically (same phases/metric as the view
-- above) and converts to SG with the same formula. Everything else is
-- unchanged from 00187 (which repaired the fermentation block).
CREATE OR REPLACE FUNCTION analyze_batch_performance(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'batch_id', b.id,
    'batch_code', b.batch_code,
    'status', b.status,
    'recipe', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'target_og', re.est_og,
      'target_fg', re.est_fg,
      'target_abv', re.est_abv
    ),
    'actuals', jsonb_build_object(
      -- Knockout gravity is measured in Plato; convert to SG (formula
      -- identical to platoToSg() in src/domain/units.ts and to the
      -- batches_with_brew_info view above).
      'og', (
        SELECT 1 + p.plato / (258.6 - 0.8796 * p.plato)
        FROM (
          SELECT (m->>'value')::DECIMAL(4,1) AS plato
          FROM brew_logs bl
          JOIN brew_log_batches blb ON blb.brew_log_id = bl.id
          CROSS JOIN jsonb_array_elements(bl.events) e
          CROSS JOIN jsonb_array_elements(e->'measurements') m
          WHERE blb.batch_id = b.id
            AND e->>'phase' IN ('ko_end', 'boil_end')
            AND m->>'metric' = 'gravity_plato'
          LIMIT 1
        ) p
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
      'readings_count', (
        SELECT count(*)
        FROM batch_logs blog
        WHERE blog.batch_id = b.id
          AND blog.log_type = 'measurement'
      ),
      'latest_reading', (
        SELECT blog.data || jsonb_build_object('recorded_at', blog.created_at)
        FROM batch_logs blog
        WHERE blog.batch_id = b.id
          AND blog.log_type = 'measurement'
        ORDER BY blog.created_at DESC
        LIMIT 1
      )
    )
  ) INTO v_result
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN recipes_with_estimates re ON re.id = r.id
  WHERE b.id = p_batch_id;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'Batch not found'));
END;
$$;

-- =============================================================================
-- Data repair: NULL out ABVs written while actual_og was Plato
-- =============================================================================
-- The packaging-completion flow computed (Plato OG - SG FG) x 131.25, e.g.
-- (12.5 - 1.010) x 131.25 ~ 1508, and wrote it to batches.actual_abv. No
-- beer exceeds 25% ABV — anything above that can only be this unit
-- corruption, so it is nulled rather than "converted" (the original inputs
-- remain in brew logs/readings and a correct ABV can be re-derived).
-- Live-checked 2026-07-06: 0 rows currently affected (no batches carry
-- actual_abv at all); the guard protects replays and other environments.
UPDATE batches SET actual_abv = NULL WHERE actual_abv > 25;
