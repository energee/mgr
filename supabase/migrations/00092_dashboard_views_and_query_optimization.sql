-- =============================================================================
-- Migration 00092: Dashboard Views and Query Optimization
-- =============================================================================
-- Creates pre-aggregated views for dashboard pages to eliminate unbounded
-- client-side queries. Fixes inefficient view patterns (correlated subqueries,
-- type-coercion joins).
-- =============================================================================

-- =============================================================================
-- 1. Dashboard Summary Views
-- =============================================================================

-- Batch status counts: replaces client-side counting of all batches
CREATE VIEW batch_status_counts
WITH (security_invoker = true)
AS
SELECT
  status,
  COUNT(*)::integer AS count
FROM batches
GROUP BY status;

-- Order status counts: replaces client-side counting of all orders
CREATE VIEW order_status_counts
WITH (security_invoker = true)
AS
SELECT
  status,
  COUNT(*)::integer AS count
FROM orders
GROUP BY status;

-- Order totals: pre-aggregated line item totals per order
-- Used by multiple dashboard queries that currently fetch ALL order_items
CREATE VIEW order_totals
WITH (security_invoker = true)
AS
SELECT
  order_id,
  SUM(quantity * unit_price) AS total_value
FROM order_items
GROUP BY order_id;

-- Customer revenue summary: replaces 3-query + client-side aggregation pattern
CREATE VIEW customer_revenue_summary
WITH (security_invoker = true)
AS
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  sc.name AS sales_channel,
  COUNT(o.id)::integer AS order_count,
  COALESCE(SUM(ot.total_value), 0) AS total_revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id AND o.status IN ('fulfilled', 'out_the_door')
LEFT JOIN order_totals ot ON ot.order_id = o.id
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
GROUP BY c.id, c.name, sc.name;

-- Product mix by brand: replaces 2-query + client-side aggregation pattern
CREATE VIEW product_mix_by_brand
WITH (security_invoker = true)
AS
SELECT
  b.id AS brand_id,
  b.name AS brand_name,
  SUM(oi.quantity)::integer AS total_quantity,
  SUM(oi.quantity * oi.unit_price) AS total_revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id AND o.status IN ('fulfilled', 'out_the_door')
JOIN brands b ON b.id = oi.brand_id
GROUP BY b.id, b.name;

-- Inventory low stock items: replaces 2-query + client-side filter pattern
CREATE VIEW inventory_low_stock_items
WITH (security_invoker = true)
AS
SELECT
  ii.id,
  ii.name,
  ii.category,
  ii.unit,
  ii.reorder_point,
  COALESCE(lq.current_qty, 0)::numeric AS current_qty
FROM inventory_items ii
LEFT JOIN (
  SELECT
    inventory_item_id,
    SUM(remaining_quantity) AS current_qty
  FROM inventory_lots_with_quantities
  GROUP BY inventory_item_id
) lq ON lq.inventory_item_id = ii.id
WHERE ii.reorder_point IS NOT NULL
  AND COALESCE(lq.current_qty, 0) <= ii.reorder_point;

-- Inventory summary by category: replaces 2-query + client-side grouping pattern
CREATE VIEW inventory_summary_by_category
WITH (security_invoker = true)
AS
SELECT
  COALESCE(ii.category, 'other') AS category,
  COUNT(DISTINCT ii.id)::integer AS item_count,
  ROUND(COALESCE(SUM(
    CASE WHEN il.unit_cost IS NOT NULL AND il.quantity > 0
      THEN il.quantity * il.unit_cost
      ELSE 0
    END
  ), 0)::numeric, 2) AS total_value
FROM inventory_items ii
LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
GROUP BY COALESCE(ii.category, 'other');

-- =============================================================================
-- 2. Fix customers_with_order_summary - replace LATERAL correlated subqueries
-- =============================================================================
-- The old view used LATERAL JOIN with nested correlated subqueries that
-- re-scanned order_items per customer per order. The new version pre-aggregates
-- order totals once and joins.

DROP VIEW IF EXISTS customers_with_order_summary CASCADE;

CREATE VIEW customers_with_order_summary
WITH (security_invoker = true)
AS
WITH ot AS (
  SELECT order_id, SUM(quantity * unit_price) AS total_value
  FROM order_items
  GROUP BY order_id
),
order_stats AS (
  SELECT
    o.customer_id,
    COUNT(*)::integer AS total_orders,
    SUM(CASE WHEN o.status IN ('fulfilled', 'out_the_door')
      THEN COALESCE(ot.total_value, 0)
      ELSE 0 END) AS total_revenue,
    MAX(o.order_date) AS last_order_date,
    COUNT(*) FILTER (WHERE o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled'))::integer AS pending_orders,
    SUM(CASE WHEN o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled')
      THEN COALESCE(ot.total_value, 0)
      ELSE 0 END) AS pending_revenue
  FROM orders o
  LEFT JOIN ot ON ot.order_id = o.id
  GROUP BY o.customer_id
)
SELECT
  c.*,
  sc.name AS sales_channel_name,
  pt.name AS price_tier_name,
  COALESCE(os.total_orders, 0) AS total_orders,
  COALESCE(os.total_revenue, 0) AS total_revenue,
  os.last_order_date,
  COALESCE(os.pending_orders, 0) AS pending_orders,
  COALESCE(os.pending_revenue, 0) AS pending_revenue,
  COALESCE(kb.total_kegs_out, 0)::integer AS total_kegs_out,
  COALESCE(kb.total_deposit_value, 0)::numeric(10,2) AS total_deposit_value
FROM customers c
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
LEFT JOIN pricing_tiers pt ON c.price_tier_id = pt.id
LEFT JOIN order_stats os ON os.customer_id = c.id
LEFT JOIN customer_keg_balance_summary kb ON c.id = kb.customer_id;

-- =============================================================================
-- 3. Fix keg_aging_report - replace COALESCE(::text, '') with IS NOT DISTINCT FROM
-- =============================================================================
-- The old join condition forced text casts that prevent index usage.
-- IS NOT DISTINCT FROM handles NULL comparison correctly and is indexable.

DROP VIEW IF EXISTS keg_aging_report CASCADE;

CREATE VIEW keg_aging_report
WITH (security_invoker = true)
AS
WITH shipped_kegs AS (
  SELECT
    kt.customer_id,
    kt.keg_type_id,
    kt.keg_owner_id,
    kt.created_at AS shipped_at,
    kt.quantity AS shipped_qty,
    kt.order_id
  FROM keg_transactions kt
  WHERE kt.transaction_type = 'ship' AND kt.customer_id IS NOT NULL
),
returned_kegs AS (
  SELECT
    customer_id,
    keg_type_id,
    keg_owner_id,
    SUM(quantity) AS returned_qty
  FROM keg_transactions
  WHERE transaction_type = 'return' AND customer_id IS NOT NULL
  GROUP BY customer_id, keg_type_id, keg_owner_id
),
keg_balances AS (
  SELECT
    s.customer_id,
    s.keg_type_id,
    s.keg_owner_id,
    s.shipped_at,
    s.order_id,
    s.shipped_qty,
    COALESCE(r.returned_qty, 0::bigint) AS total_returned,
    EXTRACT(DAY FROM NOW() - s.shipped_at)::integer AS days_out
  FROM shipped_kegs s
  LEFT JOIN returned_kegs r
    ON s.customer_id = r.customer_id
    AND s.keg_type_id = r.keg_type_id
    AND s.keg_owner_id IS NOT DISTINCT FROM r.keg_owner_id
)
SELECT
  kb.customer_id,
  c.name AS customer_name,
  kb.keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kb.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, kt.deposit_amount) AS deposit_amount,
  ckb.kegs_out,
  kb.days_out,
  CASE
    WHEN kb.days_out > 90 THEN 'critical'::text
    WHEN kb.days_out > 60 THEN 'warning'::text
    WHEN kb.days_out > 30 THEN 'attention'::text
    ELSE 'normal'::text
  END AS aging_status,
  ckb.kegs_out::numeric * COALESCE(kod.deposit_amount, kt.deposit_amount, 0::numeric) AS deposit_at_risk
FROM keg_balances kb
JOIN customers c ON kb.customer_id = c.id
JOIN keg_types kt ON kb.keg_type_id = kt.id
LEFT JOIN keg_owners ko ON kb.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = kb.keg_owner_id
  AND kod.keg_type_id = kb.keg_type_id
JOIN customer_keg_balances ckb
  ON kb.customer_id = ckb.customer_id
  AND kb.keg_type_id = ckb.keg_type_id
  AND kb.keg_owner_id IS NOT DISTINCT FROM ckb.keg_owner_id
WHERE ckb.kegs_out > 0
ORDER BY kb.days_out DESC, c.name;

-- =============================================================================
-- 4. Refactor get_inventory_overview() - use pre-aggregated allocation totals
-- =============================================================================
-- The old function used correlated subqueries per row to sum allocations.
-- The new version pre-aggregates allocations once and joins.

CREATE OR REPLACE FUNCTION get_inventory_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_fg JSONB;
  v_rm JSONB;
  v_batches JSONB;
BEGIN
  -- Pre-aggregate finished goods with availability (already exists as a view)
  SELECT jsonb_agg(jsonb_build_object(
    'brand', fg_summary.brand_name,
    'package_type', fg_summary.package_name,
    'total_quantity', fg_summary.total_qty,
    'available_quantity', fg_summary.available_qty
  ))
  INTO v_fg
  FROM (
    SELECT
      br.name AS brand_name,
      pt.name AS package_name,
      SUM(bi.quantity) AS total_qty,
      SUM(bi.quantity) - COALESCE(SUM(at.allocated_qty), 0) AS available_qty
    FROM bin_inventory bi
    JOIN finished_goods fg ON fg.id = bi.finished_good_id
    JOIN brands br ON br.id = fg.brand_id
    JOIN package_types pt ON pt.id = fg.package_type_id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'finished_good' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) at ON at.source_id = fg.id
    GROUP BY br.id, br.name, pt.id, pt.name
  ) fg_summary;

  -- Pre-aggregate raw materials with availability
  SELECT jsonb_agg(jsonb_build_object(
    'item_name', ri.name,
    'item_type', ri.type,
    'quantity_available', ri.available,
    'unit', ri.unit
  ))
  INTO v_rm
  FROM (
    SELECT
      ii.name,
      ii.catalog_type AS type,
      ii.unit,
      COALESCE(SUM(il.quantity), 0) - COALESCE(SUM(at.allocated_qty), 0) AS available
    FROM inventory_items ii
    LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'inventory_lot' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) at ON at.source_id = il.id
    GROUP BY ii.id, ii.name, ii.catalog_type, ii.unit
  ) ri
  WHERE ri.available > 0;

  -- Active batches (no change needed - already efficient)
  SELECT jsonb_agg(jsonb_build_object(
    'batch_number', b.batch_number,
    'recipe_name', r.name,
    'status', b.status,
    'planned_start', b.planned_start_date
  ))
  INTO v_batches
  FROM batches b
  JOIN recipes r ON r.id = b.recipe_id
  WHERE b.status NOT IN ('completed', 'cancelled')
  ORDER BY b.planned_start_date;

  v_result := jsonb_build_object(
    'finished_goods', COALESCE(v_fg, '[]'::jsonb),
    'raw_materials', COALESCE(v_rm, '[]'::jsonb),
    'batches_in_progress', COALESCE(v_batches, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

-- =============================================================================
-- 5. Additional Indexes for Common Query Patterns
-- =============================================================================

-- Composite index for keg aging queries (transaction_type + customer + time)
CREATE INDEX IF NOT EXISTS idx_keg_transactions_ship_customer
  ON keg_transactions(transaction_type, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

-- Composite index for inventory lot lookups by item + expiration
CREATE INDEX IF NOT EXISTS idx_inventory_lots_item_expiration
  ON inventory_lots(inventory_item_id, expiration_date)
  WHERE expiration_date IS NOT NULL;

-- =============================================================================
-- 6. Notify PostgREST to reload schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
