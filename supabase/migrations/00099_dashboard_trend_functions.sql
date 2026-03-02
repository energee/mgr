-- =============================================================================
-- Migration 00099: Dashboard Trend RPC Functions
-- =============================================================================
-- Creates 3 RPC functions that return daily-aggregated trend data for
-- dashboard charts. Each returns 2*p_days of data (current + comparison
-- period) so the frontend can compute deltas from a single query.
-- =============================================================================

-- =============================================================================
-- 1. Production Trends
-- =============================================================================
-- Returns daily batch starts, volume, and completions.
-- Source: batches table grouped by planned_start_date (no actual_start_date column).

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
      CURRENT_DATE - (p_days * 2 - 1),
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
    WHERE planned_start_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND planned_start_date IS NOT NULL
    GROUP BY planned_start_date
  ),
  completions AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM batches
    WHERE status = 'completed'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
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
-- 2. Inventory Trends
-- =============================================================================
-- Returns daily lot creation activity and current stock metrics.
-- Since inventory doesn't have historical snapshots, tracks lot activity
-- (lots created per day) as the trend metric.

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
      CURRENT_DATE - (p_days * 2 - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS date
  ),
  created AS (
    SELECT
      created_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE created_at >= CURRENT_DATE - (p_days * 2 - 1)
    GROUP BY created_at::date
  ),
  depleted AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM inventory_lots
    WHERE quantity <= 0
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
      AND updated_at != created_at
    GROUP BY updated_at::date
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
-- 3. Sales Trends
-- =============================================================================
-- Returns daily order count, revenue, and fulfillment count.
-- Revenue from order_items (quantity * unit_price).

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
      CURRENT_DATE - (p_days * 2 - 1),
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
    WHERE o.order_date >= CURRENT_DATE - (p_days * 2 - 1)
      AND o.status != 'cancelled'
    GROUP BY o.order_date
  ),
  daily_fulfilled AS (
    SELECT
      updated_at::date AS date,
      COUNT(*)::integer AS cnt
    FROM orders
    WHERE status = 'fulfilled'
      AND updated_at >= CURRENT_DATE - (p_days * 2 - 1)
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
-- Notify PostgREST to reload schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
