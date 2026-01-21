-- Customer Keg Balances
-- Phase 10.4: Track kegs out with customers
--
-- DESIGN: Following the unified allocations pattern from CLAUDE.md:
-- Balances are CALCULATED from keg_transactions, never stored as mutable values.
-- This view calculates: kegs shipped to customer - kegs returned from customer = kegs out

-- =============================================================================
-- 1. CUSTOMER KEG BALANCES VIEW
-- =============================================================================
-- Calculates kegs currently out with each customer by keg type.
-- Positive balance means customer has kegs out (owes kegs).
-- Only shows rows with non-zero balances.

CREATE VIEW customer_keg_balances
WITH (security_invoker = true)
AS
WITH balance_changes AS (
  -- Kegs shipped to customers (positive - customer owes kegs)
  SELECT
    customer_id,
    keg_type_id,
    quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'ship'
    AND customer_id IS NOT NULL

  UNION ALL

  -- Kegs returned from customers (negative - reduces what customer owes)
  SELECT
    customer_id,
    keg_type_id,
    -quantity AS delta
  FROM keg_transactions
  WHERE transaction_type = 'return'
    AND customer_id IS NOT NULL
)
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  kt.deposit_amount,
  SUM(bc.delta) AS kegs_out,
  SUM(bc.delta) * COALESCE(kt.deposit_amount, 0) AS deposit_value
FROM customers c
INNER JOIN balance_changes bc ON c.id = bc.customer_id
INNER JOIN keg_types kt ON bc.keg_type_id = kt.id
WHERE kt.is_active = true
GROUP BY c.id, c.name, kt.id, kt.name, kt.code, kt.volume_bbl, kt.deposit_amount
HAVING SUM(bc.delta) != 0
ORDER BY c.name, kt.name;

COMMENT ON VIEW customer_keg_balances IS 'Calculated view of kegs out with each customer by type. Positive kegs_out means customer has kegs. Derived from keg_transactions.';

-- =============================================================================
-- 2. CUSTOMER KEG BALANCE SUMMARY VIEW
-- =============================================================================
-- Aggregated totals per customer (all keg types combined).

CREATE VIEW customer_keg_balance_summary
WITH (security_invoker = true)
AS
SELECT
  customer_id,
  customer_name,
  SUM(kegs_out) AS total_kegs_out,
  SUM(deposit_value) AS total_deposit_value,
  COUNT(DISTINCT keg_type_id) AS keg_type_count
FROM customer_keg_balances
GROUP BY customer_id, customer_name
ORDER BY customer_name;

COMMENT ON VIEW customer_keg_balance_summary IS 'Summary of total kegs out per customer (all types combined). Derived from customer_keg_balances.';

-- =============================================================================
-- 3. UPDATE CUSTOMERS_WITH_ORDER_SUMMARY VIEW
-- =============================================================================
-- Add keg balance fields to the existing customer summary view.
-- IMPORTANT: Preserves the original order calculation logic from migration 00027:
-- - total_revenue: Sum of order_items for fulfilled/out_the_door orders only
-- - pending_revenue: Sum of order_items for orders not yet completed or cancelled

DROP VIEW IF EXISTS customers_with_order_summary;

CREATE VIEW customers_with_order_summary
WITH (security_invoker = true)
AS
SELECT
  c.*,
  sc.name AS sales_channel_name,
  pt.name AS price_tier_name,
  COALESCE(order_stats.total_orders, 0) AS total_orders,
  COALESCE(order_stats.total_revenue, 0) AS total_revenue,
  order_stats.last_order_date,
  COALESCE(order_stats.pending_orders, 0) AS pending_orders,
  COALESCE(order_stats.pending_revenue, 0) AS pending_revenue,
  -- New keg balance fields
  COALESCE(kb.total_kegs_out, 0)::INTEGER AS total_kegs_out,
  COALESCE(kb.total_deposit_value, 0)::DECIMAL(10,2) AS total_deposit_value
FROM customers c
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
LEFT JOIN price_tiers pt ON c.price_tier_id = pt.id
-- Original LATERAL join for order statistics (preserves 00027 logic)
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::INTEGER AS total_orders,
    SUM(CASE WHEN o.status IN ('fulfilled', 'out_the_door') THEN
      COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0)
    ELSE 0 END) AS total_revenue,
    MAX(o.order_date) AS last_order_date,
    COUNT(*) FILTER (WHERE o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled'))::INTEGER AS pending_orders,
    SUM(CASE WHEN o.status NOT IN ('fulfilled', 'out_the_door', 'cancelled') THEN
      COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id), 0)
    ELSE 0 END) AS pending_revenue
  FROM orders o
  WHERE o.customer_id = c.id
) order_stats ON true
-- New: join keg balance summary
LEFT JOIN customer_keg_balance_summary kb ON c.id = kb.customer_id;

COMMENT ON VIEW customers_with_order_summary IS 'Customers with order statistics, pricing info, and keg balances. Order revenue calculated from order_items for completed orders only.';

-- =============================================================================
-- 4. KEG TRANSACTION HISTORY BY CUSTOMER VIEW
-- =============================================================================
-- View for displaying keg transaction history for a specific customer.

CREATE VIEW customer_keg_transaction_history
WITH (security_invoker = true)
AS
SELECT
  kt.id,
  kt.transaction_type,
  kt.keg_type_id,
  ktype.name AS keg_type_name,
  ktype.code AS keg_type_code,
  ktype.volume_bbl,
  kt.quantity,
  kt.from_state,
  kt.to_state,
  kt.customer_id,
  c.name AS customer_name,
  kt.order_id,
  o.order_number,
  kt.notes,
  kt.created_by_name,
  kt.created_at
FROM keg_transactions kt
INNER JOIN keg_types ktype ON kt.keg_type_id = ktype.id
LEFT JOIN customers c ON kt.customer_id = c.id
LEFT JOIN orders o ON kt.order_id = o.id
WHERE kt.customer_id IS NOT NULL
  AND kt.transaction_type IN ('ship', 'return')
ORDER BY kt.created_at DESC;

COMMENT ON VIEW customer_keg_transaction_history IS 'Keg transaction history filtered to customer-related transactions (ship/return).';

-- =============================================================================
-- 5. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('customer_keg_balances', 'Calculated view of kegs out with each customer by type. Positive kegs_out means customer owes kegs. Derived from keg_transactions.', 'inventory',
   '{"customers": "customer_id", "keg_types": "keg_type_id"}'::jsonb,
   '["customer_id", "keg_type_id", "kegs_out", "deposit_value"]'::jsonb,
   '["How many kegs does customer X have?", "Show all customers with kegs out", "Total deposit value by customer"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;

-- Update customers registry to note keg balance fields
UPDATE _schema_registry
SET description = 'Customer accounts including distributors, retailers, taproom, and direct. View includes order totals and keg balances.',
    key_fields = '["name", "customer_type", "sales_channel_id", "total_orders", "total_kegs_out"]'::jsonb
WHERE table_name = 'customers';
