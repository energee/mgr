-- =============================================================================
-- Migration: 00170_get_planned_batches_by_day
--
-- Adds get_planned_batches_by_day(p_days), which returns one row per day in
-- the trailing window with two counts:
--
--   planned_count    Count of batches whose planned_start_date == day.
--   completed_count  Count of batches whose planned_start_date == day AND
--                    that subsequently reached status = 'completed'. This
--                    is a "we hit our plan" signal: how many of the brews
--                    scheduled for this day actually got finished. Anchored
--                    to planned_start_date so the count never shifts when
--                    a completed batch is later edited.
--
-- The window is dense (one row per day) via generate_series so the client
-- can render a heatmap without holes.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_planned_batches_by_day(
  p_days INTEGER DEFAULT 365
)
RETURNS TABLE (
  day              DATE,
  planned_count    INTEGER,
  completed_count  INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1))::DATE,
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS day
  ),
  planned AS (
    SELECT planned_start_date::DATE AS day, COUNT(*)::INTEGER AS n
    FROM batches
    WHERE planned_start_date IS NOT NULL
      AND planned_start_date::DATE >= (CURRENT_DATE - (p_days - 1))
      AND planned_start_date::DATE <= CURRENT_DATE
    GROUP BY planned_start_date::DATE
  ),
  completed AS (
    -- Count batches whose PLANNED start day is in the window AND that
    -- subsequently reached status='completed'. The dot is a "we hit our
    -- plan" indicator: did the brews scheduled for this day actually get
    -- finished? It is anchored to planned_start_date, NOT to a completion
    -- event date — so the dot never moves once placed.
    SELECT planned_start_date::DATE AS day, COUNT(*)::INTEGER AS n
    FROM batches
    WHERE planned_start_date IS NOT NULL
      AND status = 'completed'
      AND planned_start_date::DATE >= (CURRENT_DATE - (p_days - 1))
      AND planned_start_date::DATE <= CURRENT_DATE
    GROUP BY planned_start_date::DATE
  )
  SELECT
    d.day,
    COALESCE(p.n, 0) AS planned_count,
    COALESCE(c.n, 0) AS completed_count
  FROM days d
  LEFT JOIN planned   p ON p.day = d.day
  LEFT JOIN completed c ON c.day = d.day
  ORDER BY d.day;
END;
$$;

COMMENT ON FUNCTION get_planned_batches_by_day(INTEGER) IS
  'Daily counts of planned batches and of those-that-completed for the dashboard activity heatmap. Both counts anchored to planned_start_date.';

-- Refresh PostgREST schema cache so the new RPC is reachable from the client.
NOTIFY pgrst, 'reload schema';
