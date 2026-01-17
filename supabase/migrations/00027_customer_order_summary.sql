-- Customer Order Summary View
-- Provides order totals and summary for customer balance tracking (Phase 4.5)

-- =============================================================================
-- CUSTOMER ORDER SUMMARY VIEW
-- =============================================================================

CREATE OR REPLACE VIEW customers_with_order_summary
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
  COALESCE(order_stats.pending_revenue, 0) AS pending_revenue
FROM customers c
LEFT JOIN sales_channels sc ON c.sales_channel_id = sc.id
LEFT JOIN price_tiers pt ON c.price_tier_id = pt.id
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
) order_stats ON true;

COMMENT ON VIEW customers_with_order_summary IS 'Customers with order statistics and pricing info for balance tracking';

-- =============================================================================
-- SCHEMA REGISTRY UPDATE
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('customers_with_order_summary', 'View joining customers with order totals and pricing configuration', 'sales',
   '{"sales_channels": "sales_channel_id", "price_tiers": "price_tier_id", "orders": "customer_id"}'::jsonb,
   '["id", "name", "sales_channel_name", "total_orders", "total_revenue", "last_order_date"]'::jsonb,
   '["SELECT * FROM customers_with_order_summary WHERE total_orders > 0", "Find active customers with recent orders"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
