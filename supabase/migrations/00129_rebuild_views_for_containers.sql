-- =============================================================================
-- Migration: Rebuild all views and functions for containers/selling_formats
-- =============================================================================
-- Replaces all references to package_types/keg_types dual-FK pattern with
-- selling_format_id → selling_formats → containers join chain.

-- =============================================================================
-- 1. DROP VIEWS IN DEPENDENCY ORDER
-- =============================================================================

-- Level 4 (depends on level 3)
DROP VIEW IF EXISTS customers_with_order_summary CASCADE;

-- Level 3 (depends on level 2)
DROP VIEW IF EXISTS customer_keg_balance_summary CASCADE;
DROP VIEW IF EXISTS keg_aging_report CASCADE;

-- Level 2 (depends on level 1)
DROP VIEW IF EXISTS customer_keg_balances CASCADE;
DROP VIEW IF EXISTS keg_fleet_summary CASCADE;
DROP VIEW IF EXISTS keg_inventory_with_details CASCADE;
DROP VIEW IF EXISTS keg_inventory_summary CASCADE;
DROP VIEW IF EXISTS keg_turnover_metrics CASCADE;
DROP VIEW IF EXISTS customer_keg_transaction_history CASCADE;
DROP VIEW IF EXISTS finished_goods_supply_by_product CASCADE;

-- Level 1 (base views)
DROP VIEW IF EXISTS finished_goods_with_availability CASCADE;
DROP VIEW IF EXISTS finished_goods_with_ttb_class CASCADE;
DROP VIEW IF EXISTS order_demand_by_product CASCADE;
DROP VIEW IF EXISTS bin_contents CASCADE;
DROP VIEW IF EXISTS keg_inventory CASCADE;
DROP VIEW IF EXISTS packaging_formats CASCADE;

-- =============================================================================
-- 2. RECREATE packaging_formats AS VIEW OVER selling_formats + containers
-- =============================================================================

CREATE VIEW packaging_formats
WITH (security_invoker = true)
AS
SELECT
  sf.id,
  sf.name,
  c.name AS container_name,
  c.type AS container_type,
  c.volume_oz,
  c.volume_bbl,
  sf.unit_count,
  c.deposit_amount,
  sf.is_active,
  c.is_active AS container_active,
  sf.container_id,
  sf.position
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id;

COMMENT ON VIEW packaging_formats IS
  'Unified view of selling formats with container details. Replaces old package_types/keg_types union.';

-- =============================================================================
-- 3. RECREATE FINISHED GOODS VIEWS
-- =============================================================================

CREATE VIEW finished_goods_with_availability
WITH (security_invoker = true)
AS
SELECT
  fg.id,
  fg.batch_id,
  fg.brand_id,
  fg.selling_format_id,
  fg.session_line_item_id,
  fg.quantity,
  fg.lot_number,
  fg.production_date,
  fg.best_by_date,
  fg.expiration_date,
  fg.notes,
  fg.version,
  fg.created_by,
  fg.created_at,
  fg.updated_at,
  b.name AS brand_name,
  sf.name AS selling_format_name,
  c.name AS container_name,
  c.type AS container_type,
  fg.quantity AS total_quantity,
  COALESCE(sum(
    CASE
      WHEN a.status = 'completed'::text THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS allocated_quantity,
  COALESCE(sum(
    CASE
      WHEN a.status = 'planned'::text THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS reserved_quantity,
  fg.quantity::numeric - COALESCE(sum(
    CASE
      WHEN a.status = ANY (ARRAY['planned'::text, 'completed'::text]) THEN a.quantity
      ELSE 0::numeric
    END), 0::numeric) AS available_quantity
FROM finished_goods fg
LEFT JOIN brands b ON b.id = fg.brand_id
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN allocations a ON a.source_type = 'finished_good'::text AND a.source_id = fg.id
GROUP BY fg.id, b.name, sf.name, c.name, c.type;

CREATE VIEW finished_goods_supply_by_product
WITH (security_invoker = true)
AS
SELECT
  fg.brand_id,
  fg.selling_format_id,
  sum(fg.quantity)::integer AS total_quantity,
  sum(fga.available_quantity)::integer AS available_quantity,
  sum(fga.allocated_quantity)::integer AS allocated_quantity,
  sum(fga.reserved_quantity)::integer AS reserved_quantity
FROM finished_goods fg
JOIN finished_goods_with_availability fga ON fga.id = fg.id
WHERE fg.brand_id IS NOT NULL
  AND fg.selling_format_id IS NOT NULL
GROUP BY fg.brand_id, fg.selling_format_id;

CREATE VIEW finished_goods_with_ttb_class
WITH (security_invoker = true)
AS
SELECT
  fg.id,
  fg.batch_id,
  fg.brand_id,
  fg.selling_format_id,
  fg.session_line_item_id,
  fg.quantity,
  fg.lot_number,
  fg.production_date,
  fg.best_by_date,
  fg.expiration_date,
  fg.notes,
  fg.version,
  fg.created_by,
  fg.created_at,
  fg.updated_at,
  sf.name AS selling_format_name,
  c.type AS container_type,
  COALESCE(c.volume_oz, (c.volume_bbl * 3968.0)::numeric(6,2)) AS volume_oz,
  sf.unit_count,
  get_ttb_tax_class(c.type) AS ttb_tax_class,
  (fg.quantity::numeric * COALESCE(c.volume_oz, (c.volume_bbl * 3968.0)::numeric(6,2)) / 3968.0)::numeric(10,4) AS volume_bbl,
  b.name AS brand_name
FROM finished_goods fg
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
JOIN brands b ON fg.brand_id = b.id;

-- =============================================================================
-- 4. RECREATE ORDER DEMAND VIEW
-- =============================================================================

CREATE VIEW order_demand_by_product
WITH (security_invoker = true)
AS
SELECT
  oi.brand_id,
  oi.selling_format_id,
  date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone)::date AS demand_week,
  sum(oi.quantity)::integer AS total_quantity,
  count(DISTINCT o.id)::integer AS order_count,
  min(COALESCE(o.scheduled_date, o.requested_date)) AS earliest_due_date,
  max(COALESCE(o.scheduled_date, o.requested_date)) AS latest_due_date,
  array_agg(DISTINCT o.id) AS order_ids,
  array_agg(DISTINCT o.status) AS order_statuses
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE (o.status <> ALL (ARRAY['fulfilled'::text, 'cancelled'::text]))
  AND oi.brand_id IS NOT NULL
  AND oi.selling_format_id IS NOT NULL
  AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
GROUP BY oi.brand_id, oi.selling_format_id,
  (date_trunc('week'::text, COALESCE(o.scheduled_date, o.requested_date)::timestamp with time zone));

-- =============================================================================
-- 5. RECREATE BIN CONTENTS VIEW
-- =============================================================================

CREATE VIEW bin_contents
WITH (security_invoker = true)
AS
SELECT
  bi.bin_id,
  'finished_good'::text AS item_type,
  fg.id AS item_id,
  b.name AS item_name,
  sf.name AS package_name,
  fg.lot_number,
  bi.quantity,
  fg.production_date AS item_date
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands b ON b.id = fg.brand_id
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
WHERE bi.quantity > 0

UNION ALL

SELECT
  bii.bin_id,
  'raw_material'::text AS item_type,
  il.id AS item_id,
  ii.name AS item_name,
  NULL::text AS package_name,
  il.lot_number,
  bii.quantity,
  il.received_date AS item_date
FROM bin_inventory_items bii
JOIN inventory_lots il ON il.id = bii.inventory_lot_id
JOIN inventory_items ii ON ii.id = il.inventory_item_id
WHERE bii.quantity > 0::numeric;

-- =============================================================================
-- 6. RECREATE KEG INVENTORY VIEWS
-- =============================================================================

-- Base keg inventory (calculated from transactions)
CREATE VIEW keg_inventory
WITH (security_invoker = true)
AS
WITH inflows AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    to_state AS state,
    to_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  GROUP BY selling_format_id, keg_owner_id, to_state, to_location_id, batch_id, finished_good_id
),
outflows AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    from_state AS state,
    from_location_id AS location_id,
    batch_id,
    finished_good_id,
    SUM(quantity) AS qty
  FROM keg_transactions
  WHERE from_state IS NOT NULL
  GROUP BY selling_format_id, keg_owner_id, from_state, from_location_id, batch_id, finished_good_id
),
combined AS (
  SELECT
    selling_format_id,
    keg_owner_id,
    state,
    location_id,
    batch_id,
    finished_good_id,
    COALESCE(SUM(qty), 0) AS quantity
  FROM (
    SELECT selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id, qty FROM inflows
    UNION ALL
    SELECT selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id, -qty FROM outflows
  ) sub
  GROUP BY selling_format_id, keg_owner_id, state, location_id, batch_id, finished_good_id
  HAVING COALESCE(SUM(qty), 0) > 0
)
SELECT
  gen_random_uuid() AS id,
  selling_format_id,
  keg_owner_id,
  state::keg_state,
  location_id,
  quantity::INTEGER,
  batch_id,
  finished_good_id
FROM combined;

-- Keg inventory with joined details
CREATE VIEW keg_inventory_with_details
WITH (security_invoker = true)
AS
SELECT
  ki.id,
  ki.selling_format_id,
  ki.keg_owner_id,
  ki.state,
  ki.location_id,
  ki.quantity,
  ki.batch_id,
  ki.finished_good_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  l.name AS location_name,
  bat.batch_number,
  fg_brand.name AS finished_good_name
FROM keg_inventory ki
JOIN selling_formats sf ON sf.id = ki.selling_format_id
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON ko.id = ki.keg_owner_id
LEFT JOIN locations l ON l.id = ki.location_id
LEFT JOIN batches bat ON bat.id = ki.batch_id
LEFT JOIN finished_goods fg ON fg.id = ki.finished_good_id
LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id;

-- Keg inventory summary by type/owner/state
CREATE VIEW keg_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  sf.id AS selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  ki.keg_owner_id,
  ko.name AS keg_owner_name,
  ki.state,
  COALESCE(SUM(ki.quantity), 0) AS total_quantity,
  COUNT(DISTINCT ki.location_id) AS location_count
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_inventory ki ON sf.id = ki.selling_format_id
LEFT JOIN keg_owners ko ON ki.keg_owner_id = ko.id
WHERE c.type = 'keg' AND sf.is_active = true
GROUP BY sf.id, c.name, c.volume_bbl, ki.keg_owner_id, ko.name, ki.state
ORDER BY sf.position, c.name, ki.state;

-- Keg transactions with joined details
CREATE VIEW keg_transactions_with_details
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.selling_format_id,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.from_location_id,
  kt.to_location_id,
  kt.order_id,
  kt.customer_id,
  kt.packaging_session_id,
  kt.batch_id,
  kt.finished_good_id,
  kt.keg_owner_id,
  kt.notes,
  kt.created_by_name,
  kt.created_at,
  c.name AS keg_type_name,
  c.volume_bbl,
  ko.name AS keg_owner_name,
  ko.code AS keg_owner_code,
  cust.name AS customer_name,
  o.order_number,
  bat.batch_number,
  fg.lot_number AS finished_good_lot,
  fg_brand.name AS finished_good_brand,
  fg_brand.name AS finished_good_name,
  fl.name AS from_location_name,
  tl.name AS to_location_name,
  tl.name AS location_name
FROM keg_transactions kt
JOIN selling_formats sf ON sf.id = kt.selling_format_id
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
LEFT JOIN customers cust ON kt.customer_id = cust.id
LEFT JOIN orders o ON kt.order_id = o.id
LEFT JOIN batches bat ON kt.batch_id = bat.id
LEFT JOIN finished_goods fg ON kt.finished_good_id = fg.id
LEFT JOIN brands fg_brand ON fg.brand_id = fg_brand.id
LEFT JOIN locations fl ON kt.from_location_id = fl.id
LEFT JOIN locations tl ON kt.to_location_id = tl.id
ORDER BY kt.created_at DESC;

-- =============================================================================
-- 7. RECREATE CUSTOMER KEG BALANCE VIEWS
-- =============================================================================

CREATE VIEW customer_keg_balances
WITH (security_invoker = true)
AS
WITH balance_changes AS (
  SELECT customer_id, selling_format_id, keg_owner_id, quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'ship' AND customer_id IS NOT NULL
  UNION ALL
  SELECT customer_id, selling_format_id, keg_owner_id, -quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'return' AND customer_id IS NOT NULL
)
SELECT
  cust.id AS customer_id,
  cust.name AS customer_name,
  sf.id AS selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  bc.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, c.deposit_amount) AS deposit_amount,
  SUM(bc.delta) AS kegs_out,
  SUM(bc.delta)::numeric * COALESCE(kod.deposit_amount, c.deposit_amount, 0::numeric) AS deposit_value
FROM customers cust
JOIN balance_changes bc ON cust.id = bc.customer_id
JOIN selling_formats sf ON bc.selling_format_id = sf.id
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON bc.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = bc.keg_owner_id
  AND kod.selling_format_id = bc.selling_format_id
WHERE sf.is_active = true
GROUP BY cust.id, cust.name, sf.id, c.name, c.volume_bbl,
         bc.keg_owner_id, ko.name, kod.deposit_amount, c.deposit_amount
HAVING SUM(bc.delta) <> 0
ORDER BY cust.name, c.name;

CREATE VIEW customer_keg_balance_summary
WITH (security_invoker = true)
AS
SELECT
  customer_id,
  customer_name,
  SUM(kegs_out) AS total_kegs_out,
  SUM(deposit_value) AS total_deposit_value,
  COUNT(DISTINCT selling_format_id) AS keg_type_count
FROM customer_keg_balances
GROUP BY customer_id, customer_name
ORDER BY customer_name;

CREATE VIEW customer_keg_transaction_history
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  kt.keg_owner_id,
  ko.name AS keg_owner_name,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.customer_id,
  cust.name AS customer_name,
  kt.order_id,
  o.order_number,
  kt.notes,
  kt.created_by_name,
  kt.created_at
FROM keg_transactions kt
JOIN selling_formats sf ON sf.id = kt.selling_format_id
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON kt.keg_owner_id = ko.id
LEFT JOIN customers cust ON kt.customer_id = cust.id
LEFT JOIN orders o ON kt.order_id = o.id
WHERE kt.customer_id IS NOT NULL
  AND kt.transaction_type IN ('ship', 'return')
ORDER BY kt.created_at DESC;

-- =============================================================================
-- 8. RECREATE KEG REPORT VIEWS
-- =============================================================================

CREATE VIEW keg_aging_report
WITH (security_invoker = true)
AS
WITH shipped_kegs AS (
  SELECT
    kt.customer_id,
    kt.selling_format_id,
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
    selling_format_id,
    keg_owner_id,
    SUM(quantity) AS returned_qty
  FROM keg_transactions
  WHERE transaction_type = 'return' AND customer_id IS NOT NULL
  GROUP BY customer_id, selling_format_id, keg_owner_id
),
keg_balances AS (
  SELECT
    s.customer_id,
    s.selling_format_id,
    s.keg_owner_id,
    s.shipped_at,
    s.order_id,
    s.shipped_qty,
    COALESCE(r.returned_qty, 0::bigint) AS total_returned,
    EXTRACT(DAY FROM NOW() - s.shipped_at)::integer AS days_out
  FROM shipped_kegs s
  LEFT JOIN returned_kegs r
    ON s.customer_id = r.customer_id
    AND s.selling_format_id = r.selling_format_id
    AND COALESCE(s.keg_owner_id::text, '') = COALESCE(r.keg_owner_id::text, '')
)
SELECT
  kb.customer_id,
  cust.name AS customer_name,
  kb.selling_format_id,
  c.name AS keg_type_name,
  kb.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, c.deposit_amount) AS deposit_amount,
  ckb.kegs_out,
  kb.days_out,
  CASE
    WHEN kb.days_out > 90 THEN 'critical'::text
    WHEN kb.days_out > 60 THEN 'warning'::text
    WHEN kb.days_out > 30 THEN 'attention'::text
    ELSE 'normal'::text
  END AS aging_status,
  ckb.kegs_out::numeric * COALESCE(kod.deposit_amount, c.deposit_amount, 0::numeric) AS deposit_at_risk
FROM keg_balances kb
JOIN customers cust ON kb.customer_id = cust.id
JOIN selling_formats sf ON kb.selling_format_id = sf.id
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_owners ko ON kb.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = kb.keg_owner_id
  AND kod.selling_format_id = kb.selling_format_id
JOIN customer_keg_balances ckb
  ON kb.customer_id = ckb.customer_id
  AND kb.selling_format_id = ckb.selling_format_id
  AND COALESCE(kb.keg_owner_id::text, '') = COALESCE(ckb.keg_owner_id::text, '')
WHERE ckb.kegs_out > 0
ORDER BY kb.days_out DESC, cust.name;

CREATE VIEW keg_fleet_summary
WITH (security_invoker = true)
AS
SELECT
  sf.id AS selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  ki.keg_owner_id,
  ko.name AS keg_owner_name,
  COALESCE(kod.deposit_amount, c.deposit_amount) AS deposit_amount,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'empty'::keg_state), 0::bigint)::integer AS empty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'filled'::keg_state), 0::bigint)::integer AS filled_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::integer AS shipped_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'returned_dirty'::keg_state), 0::bigint)::integer AS dirty_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'cleaning'::keg_state), 0::bigint)::integer AS cleaning_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'maintenance'::keg_state), 0::bigint)::integer AS maintenance_count,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'retired'::keg_state), 0::bigint)::integer AS retired_count,
  COALESCE(SUM(ki.quantity), 0::bigint)::integer AS total_kegs,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint)::integer AS active_kegs,
  CASE
    WHEN COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 0::bigint) > 0
    THEN (COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = ANY (ARRAY['filled'::keg_state, 'shipped'::keg_state])), 0::bigint)::numeric
          / COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state <> ALL (ARRAY['retired'::keg_state, 'maintenance'::keg_state])), 1::bigint)::numeric
          * 100::numeric)::numeric(5,1)
    ELSE 0::numeric
  END AS utilization_pct,
  COALESCE(SUM(ki.quantity) FILTER (WHERE ki.state = 'shipped'::keg_state), 0::bigint)::numeric
    * COALESCE(kod.deposit_amount, c.deposit_amount, 0::numeric) AS deposits_outstanding
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id
LEFT JOIN keg_inventory ki ON sf.id = ki.selling_format_id
LEFT JOIN keg_owners ko ON ki.keg_owner_id = ko.id
LEFT JOIN keg_owner_deposits kod
  ON kod.keg_owner_id = ki.keg_owner_id
  AND kod.selling_format_id = sf.id
WHERE c.type = 'keg' AND sf.is_active = true
GROUP BY sf.id, c.name, c.volume_bbl,
         ki.keg_owner_id, ko.name,
         kod.deposit_amount, c.deposit_amount
ORDER BY c.name;

CREATE VIEW keg_turnover_metrics
WITH (security_invoker = true)
AS
WITH transaction_pairs AS (
  SELECT
    ship.selling_format_id,
    ship.keg_owner_id,
    ship.customer_id,
    ship.created_at AS shipped_at,
    ret.created_at AS returned_at,
    EXTRACT(DAY FROM ret.created_at - ship.created_at)::integer AS cycle_days
  FROM keg_transactions ship
  JOIN keg_transactions ret
    ON ret.customer_id = ship.customer_id
    AND ret.selling_format_id = ship.selling_format_id
    AND COALESCE(ret.keg_owner_id::text, '') = COALESCE(ship.keg_owner_id::text, '')
    AND ret.transaction_type = 'return'
    AND ret.created_at > ship.created_at
  WHERE ship.transaction_type = 'ship'
    AND ship.created_at > (NOW() - '365 days'::interval)
)
SELECT
  sf.id AS selling_format_id,
  c.name AS keg_type_name,
  c.volume_bbl,
  tp.keg_owner_id,
  ko.name AS keg_owner_name,
  COUNT(tp.cycle_days) AS completed_cycles,
  COALESCE(AVG(tp.cycle_days), 0::numeric)::numeric(10,1) AS avg_cycle_days,
  COALESCE(MIN(tp.cycle_days), 0) AS min_cycle_days,
  COALESCE(MAX(tp.cycle_days), 0) AS max_cycle_days,
  CASE
    WHEN COALESCE(AVG(tp.cycle_days), 0::numeric) > 0::numeric
    THEN (365.0 / AVG(tp.cycle_days))::numeric(10,2)
    ELSE 0::numeric
  END AS annual_turnover_rate
FROM selling_formats sf
JOIN containers c ON c.id = sf.container_id
LEFT JOIN transaction_pairs tp ON sf.id = tp.selling_format_id
LEFT JOIN keg_owners ko ON tp.keg_owner_id = ko.id
WHERE c.type = 'keg' AND sf.is_active = true
GROUP BY sf.id, c.name, c.volume_bbl, tp.keg_owner_id, ko.name
ORDER BY c.name;

-- =============================================================================
-- 9. RECREATE CUSTOMERS WITH ORDER SUMMARY
-- =============================================================================

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
    SUM(CASE WHEN o.status = 'fulfilled'
      THEN COALESCE(ot.total_value, 0)
      ELSE 0 END) AS total_revenue,
    MAX(o.order_date) AS last_order_date,
    COUNT(*) FILTER (WHERE o.status NOT IN ('fulfilled', 'cancelled'))::integer AS pending_orders,
    SUM(CASE WHEN o.status NOT IN ('fulfilled', 'cancelled')
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
-- 10. REBUILD FUNCTIONS
-- =============================================================================

-- 10a. Keg ship transactions from order fulfillment
CREATE OR REPLACE FUNCTION create_keg_ship_transactions_from_order(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_count INTEGER := 0;
  v_container_type TEXT;
BEGIN
  SELECT id, customer_id, order_number INTO v_order
  FROM orders WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  FOR v_item IN
    SELECT oi.*, c.type AS container_type
    FROM order_items oi
    JOIN selling_formats sf ON sf.id = oi.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    WHERE oi.order_id = p_order_id
      AND c.type = 'keg'
      AND oi.quantity > 0
  LOOP
    -- Idempotency: skip if ship transaction already exists for this order item
    IF EXISTS (
      SELECT 1 FROM keg_transactions
      WHERE order_id = p_order_id
        AND selling_format_id = v_item.selling_format_id
        AND transaction_type = 'ship'
        AND COALESCE(keg_owner_id, '00000000-0000-0000-0000-000000000000') =
            COALESCE(v_item.keg_owner_id, '00000000-0000-0000-0000-000000000000')
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO keg_transactions (
      transaction_type,
      selling_format_id,
      keg_owner_id,
      quantity,
      from_state,
      to_state,
      customer_id,
      order_id,
      notes
    ) VALUES (
      'ship',
      v_item.selling_format_id,
      v_item.keg_owner_id,
      v_item.quantity,
      'filled',
      'shipped',
      v_order.customer_id,
      v_order.id,
      'Auto-created from order ' || v_order.order_number || ' fulfillment'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 10b. Finished goods from packaging session completion
CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_batch_info JSONB;
  v_batch_id UUID;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
  v_container_type TEXT;
BEGIN
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)', p_session_id, v_session.status;
  END IF;

  FOR v_line IN
    SELECT * FROM session_line_items
    WHERE session_id = p_session_id
  LOOP
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      RAISE EXCEPTION 'Line item % has no actual quantity', v_line.id;
    END IF;

    -- Idempotency check
    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE;
    END IF;

    -- Extract batch_id from source_batches JSONB (use first batch)
    v_batch_info := v_line.source_batches->0;
    IF v_batch_info IS NOT NULL AND v_batch_info->>'batch_id' IS NOT NULL THEN
      v_batch_id := (v_batch_info->>'batch_id')::UUID;
    ELSE
      v_batch_id := NULL;
    END IF;

    v_lot_number := generate_lot_number(v_session.session_date);

    -- Create finished_goods record
    INSERT INTO finished_goods (
      batch_id,
      brand_id,
      selling_format_id,
      session_line_item_id,
      quantity,
      lot_number,
      production_date,
      created_by
    ) VALUES (
      v_batch_id,
      v_line.brand_id,
      v_line.selling_format_id,
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    -- Create allocation record (batch -> finished_good)
    IF v_batch_id IS NOT NULL THEN
      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        status,
        lot_number,
        notes,
        completed_at,
        created_by
      ) VALUES (
        'batch',
        v_batch_id,
        'finished_good',
        v_fg_id,
        v_line.actual_quantity,
        'completed',
        v_lot_number,
        'Auto-created from packaging session ' || p_session_id::TEXT,
        NOW(),
        v_session.created_by
      );
    END IF;

    -- For keg lines, also create a fill keg_transaction
    -- Determine container type from selling_format
    SELECT c.type INTO v_container_type
    FROM selling_formats sf
    JOIN containers c ON c.id = sf.container_id
    WHERE sf.id = v_line.selling_format_id;

    IF v_container_type = 'keg' THEN
      INSERT INTO keg_transactions (
        transaction_type,
        selling_format_id,
        keg_owner_id,
        quantity,
        from_state,
        to_state,
        packaging_session_id,
        batch_id,
        finished_good_id,
        notes
      ) VALUES (
        'fill',
        v_line.selling_format_id,
        v_line.keg_owner_id,
        v_line.actual_quantity,
        'empty',
        'filled',
        p_session_id,
        v_batch_id,
        v_fg_id,
        'Auto-created from packaging session completion'
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 10c. Production shortfalls calculation
CREATE OR REPLACE FUNCTION calculate_production_shortfalls(
  p_include_drafts BOOLEAN DEFAULT true,
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  brand_id UUID,
  brand_name TEXT,
  selling_format_id UUID,
  selling_format_name TEXT,
  demand_week DATE,
  demand_quantity INTEGER,
  available_quantity INTEGER,
  in_production_bbl NUMERIC,
  in_production_units INTEGER,
  shortfall_quantity INTEGER,
  recommended_brew_start DATE,
  lead_time_days INTEGER,
  recipe_id UUID,
  recipe_name TEXT,
  is_urgent BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_packaging_buffer INTEGER := 2;
BEGIN
  RETURN QUERY
  WITH demand AS (
    SELECT
      oi.brand_id,
      oi.selling_format_id,
      DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::date AS demand_week,
      SUM(oi.quantity)::integer AS quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE (
      CASE
        WHEN p_include_drafts THEN o.status NOT IN ('fulfilled', 'cancelled')
        ELSE o.status IN ('confirmed', 'scheduled', 'picking', 'packed')
      END
    )
      AND oi.brand_id IS NOT NULL
      AND oi.selling_format_id IS NOT NULL
      AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
      AND COALESCE(o.scheduled_date, o.requested_date) <= CURRENT_DATE + (p_horizon_weeks * 7)
    GROUP BY oi.brand_id, oi.selling_format_id, DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))
  ),
  supply AS (
    SELECT
      fgsp.brand_id,
      fgsp.selling_format_id,
      COALESCE(fgsp.available_quantity, 0)::integer AS available_qty
    FROM finished_goods_supply_by_product fgsp
  ),
  in_production AS (
    SELECT
      bip.brand_id,
      d_inner.selling_format_id,
      SUM(bip.volume_bbl) AS volume_bbl,
      SUM(bip.volume_bbl * COALESCE(
        calculate_units_per_bbl(c.volume_oz, sf.unit_count),
        10.0
      ))::integer AS estimated_units
    FROM batches_in_production_by_brand bip
    CROSS JOIN LATERAL (
      SELECT DISTINCT d.selling_format_id
      FROM demand d
      WHERE d.brand_id = bip.brand_id
    ) d_inner
    JOIN selling_formats sf ON sf.id = d_inner.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    GROUP BY bip.brand_id, d_inner.selling_format_id
  ),
  preferred_recipe AS (
    SELECT DISTINCT ON (r.brand_id)
      r.brand_id,
      r.id AS recipe_id,
      r.name AS recipe_name,
      COALESCE(r.fermentation_days, 14) AS fermentation_days,
      COALESCE(r.conditioning_days, 7) AS conditioning_days
    FROM recipes r
    WHERE r.is_active = true
      AND r.brand_id IS NOT NULL
    ORDER BY r.brand_id, r.updated_at DESC
  )
  SELECT
    d.brand_id,
    b.name AS brand_name,
    d.selling_format_id,
    sf.name AS selling_format_name,
    d.demand_week,
    d.quantity AS demand_quantity,
    COALESCE(s.available_qty, 0) AS available_quantity,
    COALESCE(ip.volume_bbl, 0) AS in_production_bbl,
    COALESCE(ip.estimated_units, 0) AS in_production_units,
    GREATEST(d.quantity - COALESCE(s.available_qty, 0) - COALESCE(ip.estimated_units, 0), 0)::integer AS shortfall_quantity,
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date AS recommended_brew_start,
    (COALESCE(pr.fermentation_days, 14) +
     COALESCE(pr.conditioning_days, 7) +
     v_packaging_buffer) AS lead_time_days,
    pr.recipe_id,
    pr.recipe_name,
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date <= CURRENT_DATE + 7 AS is_urgent
  FROM demand d
  JOIN brands b ON b.id = d.brand_id
  JOIN selling_formats sf ON sf.id = d.selling_format_id
  LEFT JOIN supply s ON s.brand_id = d.brand_id AND s.selling_format_id = d.selling_format_id
  LEFT JOIN in_production ip ON ip.brand_id = d.brand_id AND ip.selling_format_id = d.selling_format_id
  LEFT JOIN preferred_recipe pr ON pr.brand_id = d.brand_id
  WHERE d.quantity > COALESCE(s.available_qty, 0) + COALESCE(ip.estimated_units, 0)
  ORDER BY
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date <= CURRENT_DATE + 7 DESC,
    d.demand_week,
    d.brand_id;
END;
$$;

-- 10d. Apply change request
CREATE OR REPLACE FUNCTION apply_change_request(
  p_change_request_id UUID,
  p_approved_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_order RECORD;
  v_cutoff_state TEXT;
  v_order_state_rank INTEGER;
  v_cutoff_rank INTEGER;
  v_item RECORD;
  v_price DECIMAL(10,2);
  v_state_ranks CONSTANT TEXT[] := ARRAY['draft','confirmed','scheduled','picking','packed','fulfilled'];
BEGIN
  -- 1. Validate the change request
  SELECT * INTO v_request
  FROM order_change_requests
  WHERE id = p_change_request_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found or not pending';
  END IF;

  -- 2. Get the order and its customer's sales channel cutoff
  SELECT o.*, c.sales_channel_id INTO v_order
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = v_request.order_id;

  SELECT COALESCE(sc.change_request_cutoff_state, 'confirmed') INTO v_cutoff_state
  FROM sales_channels sc
  WHERE sc.id = v_order.sales_channel_id;

  IF v_cutoff_state IS NULL THEN
    v_cutoff_state := 'confirmed';
  END IF;

  -- 3. Check if order has passed the cutoff state
  v_order_state_rank := array_position(v_state_ranks, v_order.status);
  v_cutoff_rank := array_position(v_state_ranks, v_cutoff_state);

  IF v_order_state_rank IS NOT NULL AND v_cutoff_rank IS NOT NULL
     AND v_order_state_rank >= v_cutoff_rank THEN
    RAISE EXCEPTION 'Order has passed the change request cutoff state (%)' , v_cutoff_state;
  END IF;

  -- 4. Apply each item change
  FOR v_item IN
    SELECT * FROM order_change_request_items
    WHERE change_request_id = p_change_request_id
  LOOP
    CASE v_item.change_type
      WHEN 'modify' THEN
        UPDATE order_items
        SET quantity = v_item.quantity
        WHERE id = v_item.order_item_id;

      WHEN 'remove' THEN
        WITH removed_item AS (
          SELECT oi.quantity, oi.brand_id, oi.selling_format_id
          FROM order_items oi WHERE oi.id = v_item.order_item_id
        ),
        matching_allocations AS (
          SELECT a.id, a.quantity,
                 SUM(a.quantity) OVER (ORDER BY a.created_at) AS running_total
          FROM allocations a, removed_item ri
          WHERE a.destination_type = 'order'
            AND a.destination_id = v_request.order_id
            AND a.status = 'planned'
            AND a.source_id IN (
              SELECT fg.id FROM finished_goods fg
              WHERE fg.brand_id = ri.brand_id
                AND fg.selling_format_id = ri.selling_format_id
            )
        )
        UPDATE allocations
        SET status = 'cancelled'
        WHERE id IN (
          SELECT ma.id FROM matching_allocations ma, removed_item ri
          WHERE ma.running_total - ma.quantity < ri.quantity
        );

        DELETE FROM order_items WHERE id = v_item.order_item_id;

      WHEN 'add' THEN
        INSERT INTO order_items (
          order_id, brand_id, selling_format_id, quantity, unit_price
        ) VALUES (
          v_request.order_id,
          v_item.brand_id,
          v_item.selling_format_id,
          v_item.quantity,
          NULL
        );
    END CASE;
  END LOOP;

  -- 5. Mark the request as approved
  UPDATE order_change_requests
  SET status = 'approved',
      reviewed_by = p_approved_by,
      reviewed_at = now()
  WHERE id = p_change_request_id;

  -- 6. Touch the order so entity_revisions trigger fires
  UPDATE orders
  SET updated_at = now()
  WHERE id = v_request.order_id;
END;
$$;

-- 10e. Inventory overview for AI/dashboard
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
  SELECT jsonb_agg(jsonb_build_object(
    'brand', fg_summary.brand_name,
    'selling_format', fg_summary.format_name,
    'total_quantity', fg_summary.total_qty,
    'available_quantity', fg_summary.available_qty
  ))
  INTO v_fg
  FROM (
    SELECT
      br.name AS brand_name,
      sf.name AS format_name,
      SUM(bi.quantity) AS total_qty,
      SUM(bi.quantity) - COALESCE(SUM(at.allocated_qty), 0) AS available_qty
    FROM bin_inventory bi
    JOIN finished_goods fg ON fg.id = bi.finished_good_id
    JOIN brands br ON br.id = fg.brand_id
    JOIN selling_formats sf ON sf.id = fg.selling_format_id
    LEFT JOIN (
      SELECT source_id, SUM(quantity) AS allocated_qty
      FROM allocations
      WHERE source_type = 'finished_good' AND status IN ('planned', 'completed')
      GROUP BY source_id
    ) at ON at.source_id = fg.id
    GROUP BY br.id, br.name, sf.id, sf.name
  ) fg_summary;

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
-- 11. ADD FK CONSTRAINT TO pricing_tier_prices.format_id
-- =============================================================================
-- Now that selling_formats UUIDs match the old package_type/keg_type UUIDs,
-- we can add a proper FK constraint.

-- First drop any old index that might conflict
DROP INDEX IF EXISTS idx_pricing_tier_prices_format;

-- Add FK to selling_formats (format_id already populated with correct UUIDs)
ALTER TABLE pricing_tier_prices
  ADD CONSTRAINT pricing_tier_prices_format_id_fkey
  FOREIGN KEY (format_id) REFERENCES selling_formats(id) ON DELETE CASCADE;

CREATE INDEX idx_pricing_tier_prices_format ON pricing_tier_prices(format_id);
