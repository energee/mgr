-- =============================================================================
-- Order Items Brand Reference
-- Add brand_id to order_items for product selection
-- =============================================================================

-- Add brand_id to order_items
ALTER TABLE order_items ADD COLUMN brand_id UUID REFERENCES brands(id) ON DELETE RESTRICT;

-- Create index for efficient brand lookups
CREATE INDEX idx_order_items_brand ON order_items(brand_id) WHERE brand_id IS NOT NULL;

COMMENT ON COLUMN order_items.brand_id IS 'The brand/product being ordered. Combined with package_type_id defines the SKU.';

-- =============================================================================
-- Order Items View with Details
-- Join order items with brand and package type info for display
-- =============================================================================

CREATE VIEW order_items_with_details
WITH (security_invoker = true)
AS
SELECT
  oi.*,
  b.name as brand_name,
  b.abv as brand_abv,
  pt.name as package_type_name,
  pt.container_type,
  pt.volume_oz,
  pt.units_per_case,
  (oi.quantity * COALESCE(oi.unit_price, 0)) as line_total
FROM order_items oi
LEFT JOIN brands b ON b.id = oi.brand_id
LEFT JOIN package_types pt ON pt.id = oi.package_type_id;

COMMENT ON VIEW order_items_with_details IS 'Order line items with joined brand and package type details for display';

-- =============================================================================
-- Order Totals View
-- Aggregate order totals from line items
-- =============================================================================

CREATE VIEW orders_with_totals
WITH (security_invoker = true)
AS
SELECT
  o.*,
  c.name as customer_name,
  COALESCE(SUM(oi.quantity * COALESCE(oi.unit_price, 0)), 0) as order_total,
  COALESCE(SUM(oi.quantity), 0) as total_units,
  COUNT(oi.id) as line_count
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name;

COMMENT ON VIEW orders_with_totals IS 'Orders with calculated totals from line items';

-- =============================================================================
-- Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  relationships = '["belongs_to: orders", "belongs_to: brands", "belongs_to: package_types", "belongs_to: batches", "belongs_to: packages"]',
  key_fields = '["order_id", "brand_id", "package_type_id", "quantity", "unit_price"]'
WHERE table_name = 'order_items';
