-- Migration: 00162_order_shipping_materials.sql
-- Creates tables for order-level shipping material tracking with customer-specific preferences:
--   brewery_shipping_defaults  - brewery-wide default materials per role
--   customer_shipping_materials - per-customer material overrides per role
--   customer_pallet_configs    - per-customer, per-selling-format pallet layer counts
--   order_materials            - actual/estimated shipping materials per order

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. brewery_shipping_defaults
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE brewery_shipping_defaults (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID        NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  material_role     TEXT        NOT NULL CHECK (material_role IN ('pallet', 'wrap', 'other')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (material_role)
);

ALTER TABLE brewery_shipping_defaults ENABLE ROW LEVEL SECURITY;

-- check-permissive-rls: skip single-tenant brewery defaults; any authenticated user is part of the brewery
CREATE POLICY "Authenticated users can manage brewery_shipping_defaults"
  ON brewery_shipping_defaults
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_brewery_shipping_defaults_updated_at
  BEFORE UPDATE ON brewery_shipping_defaults
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. customer_shipping_materials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_shipping_materials (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  inventory_item_id UUID        NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  material_role     TEXT        NOT NULL CHECK (material_role IN ('pallet', 'wrap', 'other')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, material_role)
);

CREATE INDEX idx_customer_shipping_materials_customer_id
  ON customer_shipping_materials (customer_id);

ALTER TABLE customer_shipping_materials ENABLE ROW LEVEL SECURITY;

-- check-permissive-rls: skip single-tenant customer shipping; any authenticated user manages all customers
CREATE POLICY "Authenticated users can manage customer_shipping_materials"
  ON customer_shipping_materials
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_customer_shipping_materials_updated_at
  BEFORE UPDATE ON customer_shipping_materials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. customer_pallet_configs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_pallet_configs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  selling_format_id  UUID        NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  layers             INTEGER     NOT NULL CHECK (layers > 0),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, selling_format_id)
);

CREATE INDEX idx_customer_pallet_configs_customer_id
  ON customer_pallet_configs (customer_id);

ALTER TABLE customer_pallet_configs ENABLE ROW LEVEL SECURITY;

-- check-permissive-rls: skip single-tenant pallet configs; any authenticated user manages all customers
CREATE POLICY "Authenticated users can manage customer_pallet_configs"
  ON customer_pallet_configs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_customer_pallet_configs_updated_at
  BEFORE UPDATE ON customer_pallet_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. order_materials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE order_materials (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  inventory_item_id UUID           NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  estimated_qty     DECIMAL(10, 4) NOT NULL DEFAULT 0,
  actual_qty        DECIMAL(10, 4),
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, inventory_item_id)
);

CREATE INDEX idx_order_materials_order_id
  ON order_materials (order_id);

ALTER TABLE order_materials ENABLE ROW LEVEL SECURITY;

-- check-permissive-rls: skip single-tenant order materials; any authenticated user manages all orders
CREATE POLICY "Authenticated users can manage order_materials"
  ON order_materials
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_order_materials_updated_at
  BEFORE UPDATE ON order_materials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema registry entries
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO _schema_registry (table_name, description, domain, relationships) VALUES
(
  'brewery_shipping_defaults',
  'Brewery-wide default shipping materials per role (pallet, wrap, other). One row per material_role; overridden at the customer level via customer_shipping_materials.',
  'sales',
  '{"inventory_items": "inventory_item_id references inventory_items"}'
),
(
  'customer_shipping_materials',
  'Per-customer shipping material preferences, keyed by customer and material_role. Overrides brewery_shipping_defaults for a specific customer.',
  'sales',
  '{"customers": "customer_id references customers", "inventory_items": "inventory_item_id references inventory_items"}'
),
(
  'customer_pallet_configs',
  'Per-customer, per-selling-format pallet layer counts used when estimating pallet material quantities for orders.',
  'sales',
  '{"customers": "customer_id references customers", "selling_formats": "selling_format_id references selling_formats"}'
),
(
  'order_materials',
  'Shipping materials (estimated and actual quantities) associated with a specific order. Populated from customer/brewery defaults at order creation and adjusted through fulfillment.',
  'sales',
  '{"orders": "order_id references orders", "inventory_items": "inventory_item_id references inventory_items"}'
);
