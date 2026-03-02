-- =============================================================================
-- Migration 00100: Fix Dashboard Trend Functions
-- =============================================================================
-- Addresses code review findings:
-- 1. Add GRANT EXECUTE TO authenticated for all 3 trend functions
-- 2. Clamp p_days to max 365 to prevent large date series generation
-- 3. Fix lots_depleted timestamp comparison to use ::date cast
-- 4. Document updated_at approximation for completions tracking
-- =============================================================================

-- =============================================================================
-- 1. Production Trends (re-create with p_days clamp + documentation)
-- =============================================================================
-- NOTE: Completions are tracked via updated_at, which is an approximation.
-- If a completed batch is later edited (e.g., notes or volume corrected),
-- the completion date will shift to the edit date. A dedicated completed_at
-- column would be more accurate but is not yet available.

CREATE OR REPLACE FUNCTION get_production_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  batches_started integer,
  volume_bbl numeric,
  batches_completed integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  starts AS (
    SELECT
      planned_start_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(volume_bbl), 0) AS vol
    FROM batches
    WHERE planned_start_date >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
      AND planned_start_date IS NOT NULL
    GROUP BY planned_start_date
  ),
  -- Completions use updated_at as an approximation (see migration header comment)
  completions AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM batches
    WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(s.cnt, 0)::integer AS batches_started,
    COALESCE(s.vol, 0)::numeric AS volume_bbl,
    COALESCE(c.cnt, 0)::integer AS batches_completed
  FROM date_series ds
  LEFT JOIN starts s ON s.date = ds.date
  LEFT JOIN completions c ON c.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- 2. Inventory Trends (re-create with p_days clamp + allocation-based depletion)
-- =============================================================================
-- NOTE: Depletion is derived from allocations, not from inventory_lots.quantity
-- (which stores the immutable initial received quantity). A lot is "depleted"
-- when its received quantity minus allocated quantity <= 0. The depletion date
-- is approximated as the date of the most recent allocation against that lot.

CREATE OR REPLACE FUNCTION get_inventory_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  lots_created integer,
  lots_depleted integer,
  total_lot_activity integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  created AS (
    SELECT
      created_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE created_at >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
    GROUP BY created_at::date
  ),
  depleted AS (
    SELECT
      lot_depleted_date AS date,
      COUNT(*)::integer AS cnt
    FROM (
      SELECT
        il.id,
        il.created_at::date AS lot_created_date,
        MAX(a.updated_at)::date AS lot_depleted_date
      FROM inventory_lots il
      JOIN allocations a
        ON a.source_type = 'inventory_lot'
        AND a.source_id = il.id
        AND a.status IN ('planned', 'completed')
      GROUP BY il.id, il.quantity, il.created_at
      HAVING il.quantity - SUM(a.quantity) <= 0
    ) depleted_lots
    WHERE lot_depleted_date >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
      AND lot_depleted_date != lot_created_date
    GROUP BY lot_depleted_date
  )
  SELECT
    ds.date,
    COALESCE(cr.cnt, 0)::integer AS lots_created,
    COALESCE(dp.cnt, 0)::integer AS lots_depleted,
    (COALESCE(cr.cnt, 0) + COALESCE(dp.cnt, 0))::integer AS total_lot_activity
  FROM date_series ds
  LEFT JOIN created cr ON cr.date = ds.date
  LEFT JOIN depleted dp ON dp.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- 3. Sales Trends (re-create with p_days clamp)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_sales_trends(p_days integer DEFAULT 30)
RETURNS TABLE (
  date date,
  order_count integer,
  revenue numeric,
  fulfilled_count integer
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  daily_orders AS (
    SELECT
      o.order_date AS date,
      COUNT(*)::integer AS cnt,
      COALESCE(SUM(oi_totals.total), 0) AS rev
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(quantity * unit_price) AS total
      FROM order_items
      GROUP BY order_id
    ) oi_totals ON oi_totals.order_id = o.id
    WHERE o.order_date >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
      AND o.status != 'cancelled'
    GROUP BY o.order_date
  ),
  daily_fulfilled AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM orders
    WHERE status = 'fulfilled'
      AND updated_at >= CURRENT_DATE - (LEAST(p_days, 365) * 2 - 1)
    GROUP BY updated_at::date
  )
  SELECT
    ds.date,
    COALESCE(do2.cnt, 0)::integer AS order_count,
    COALESCE(do2.rev, 0)::numeric AS revenue,
    COALESCE(df.cnt, 0)::integer AS fulfilled_count
  FROM date_series ds
  LEFT JOIN daily_orders do2 ON do2.date = ds.date
  LEFT JOIN daily_fulfilled df ON df.date = ds.date
  ORDER BY ds.date;
$$;

-- =============================================================================
-- 4. Grant execute permissions to authenticated users
-- =============================================================================

GRANT EXECUTE ON FUNCTION get_production_trends(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_inventory_trends(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_sales_trends(integer) TO authenticated;

-- =============================================================================
-- Notify PostgREST to reload schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
