-- 00278_recreate_packaging_sessions_summary_view.sql
-- Issue #612: packaging_sessions_with_summary froze its column list at
-- creation time and never picked up packaging_sessions.default_bin_id.
--
-- 00159 defined the view as `SELECT ps.*, <aggregates>`. Postgres expands `*`
-- once, at CREATE VIEW time, and stores the resolved column list — so the
-- column 00219 later added to the base table
-- (`ALTER TABLE packaging_sessions ADD COLUMN default_bin_id`) never appeared
-- in the view.
--
-- The packaging_session entity reads from this view (`viewTable`) but writes
-- to the base table. Because the detail record carried no `default_bin_id`
-- key, EntityDetailUnified seeded the editable "Default FG Bin" select with
-- `""`, and the generic `""`->NULL save pass then wrote NULL over the stored
-- bin on every save — including saves that only touched Notes. The field also
-- always rendered blank in view mode, so the loss was invisible.
--
-- Fix: drop and recreate the view with the identical body from 00159, which
-- re-expands `ps.*` against the current base table and picks up
-- default_bin_id (and anything else added since). No dependent objects exist
-- (only 00074 and 00159 ever referenced this view name), no data is touched,
-- and the existing summary columns keep their exact semantics.
--
-- A vitest guard added with this migration
-- (src/entities/__tests__/section-fields-schema-sync.test.ts) asserts that
-- every editable section field of every entity exists on the Row of
-- `viewTable ?? table`, so the next frozen-`*` drift fails CI instead of
-- silently nulling a column.

DROP VIEW IF EXISTS packaging_sessions_with_summary;

CREATE VIEW packaging_sessions_with_summary
WITH (security_invoker = true)
AS
SELECT
  ps.*,
  COALESCE(agg.line_count, 0) AS line_count,
  agg.brands,
  COALESCE(agg.total_planned, 0) AS total_planned,
  COALESCE(agg.total_actual, 0) AS total_actual,
  (COALESCE(agg.total_actual, 0) - COALESCE(agg.total_planned, 0)) AS total_variance
FROM packaging_sessions ps
LEFT JOIN (
  SELECT
    sli.session_id,
    COUNT(*) AS line_count,
    STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS brands,
    SUM(sli.planned_quantity) AS total_planned,
    SUM(sli.actual_quantity) AS total_actual
  FROM session_line_items sli
  JOIN brands b ON b.id = sli.brand_id
  GROUP BY sli.session_id
) agg ON agg.session_id = ps.id;

COMMENT ON VIEW packaging_sessions_with_summary
  IS 'Packaging sessions with aggregated line item counts, brand names, quantity totals, and variance. Recreated in 00278 so the frozen ps.* expansion picks up default_bin_id (00219) — see issue #612.';

-- Self-check: the column the entity form round-trips must now be selectable
-- from the view, and the summary columns must survive the recreate.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT STRING_AGG(c, ', ')
  INTO v_missing
  FROM UNNEST(ARRAY[
    'default_bin_id', 'id', 'status', 'session_date', 'notes',
    'line_count', 'brands', 'total_planned', 'total_actual', 'total_variance'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'packaging_sessions_with_summary'
      AND column_name = c
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'packaging_sessions_with_summary is missing expected column(s): %', v_missing;
  END IF;
END;
$$;
