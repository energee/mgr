-- MGR Initial Schema Migration
-- This creates the core tables for the brewery management system.
--
-- Philosophy:
-- - AI-first: Tables are documented for LLM introspection
-- - Multi-tenant: brewery_id on all tables with RLS
-- - Allocation-based: No mutable balances, derive from allocations
-- - Universal state machines: Consistent status patterns

-- =============================================================================
-- Schema Registry (AI Context)
-- =============================================================================
-- This table provides self-documenting metadata for AI agents to understand
-- the schema without requiring external documentation.

CREATE TABLE _schema_registry (
  table_name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,  -- system, production, inventory, packaging, purchasing, sales, reporting
  relationships JSONB DEFAULT '[]',
  key_fields JSONB DEFAULT '[]',
  state_machine JSONB,  -- null if not stateful
  query_examples JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE _schema_registry IS 'Self-documenting schema metadata for AI agents. Query this table to understand the database structure.';

-- =============================================================================
-- Multi-Tenancy Core
-- =============================================================================

CREATE TABLE breweries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE breweries IS 'Brewery tenants. All other tables reference a brewery_id.';

CREATE TABLE user_breweries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  roles TEXT[] DEFAULT ARRAY['member'],  -- owner, admin, member
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, brewery_id)
);

COMMENT ON TABLE user_breweries IS 'Maps users to breweries with roles. A user can belong to multiple breweries.';

-- =============================================================================
-- Production Domain
-- =============================================================================

CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style TEXT,
  description TEXT,
  target_og DECIMAL(4,3),  -- Original gravity (e.g., 1.050)
  target_fg DECIMAL(4,3),  -- Final gravity
  target_abv DECIMAL(3,1), -- Alcohol by volume
  target_ibu INTEGER,      -- International Bitterness Units
  target_srm INTEGER,      -- Standard Reference Method (color)
  batch_size_gallons DECIMAL(6,2),
  boil_time_minutes INTEGER,
  mash_temp_f INTEGER,
  ingredients JSONB DEFAULT '[]',  -- Array of {type, name, amount, unit, timing}
  instructions JSONB DEFAULT '[]', -- Array of step instructions
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipes IS 'Recipes. Contains all specifications and instructions for brewing.';

CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  batch_number TEXT NOT NULL,  -- Human-readable identifier (e.g., "2024-001")
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned, brewing, fermenting, conditioning, packaging, completed, cancelled
  volume_gallons DECIMAL(6,2),
  brew_date DATE,
  fermenter TEXT,  -- Fermenter identifier
  actual_og DECIMAL(4,3),
  actual_fg DECIMAL(4,3),
  actual_abv DECIMAL(3,1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brewery_id, batch_number)
);

COMMENT ON TABLE batches IS 'Production batches. Represents a single brewing run through its lifecycle from planning to completion.';

CREATE INDEX idx_batches_status ON batches(brewery_id, status);
CREATE INDEX idx_batches_brew_date ON batches(brewery_id, brew_date);

CREATE TABLE batch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL,  -- status_change, measurement, note
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE batch_logs IS 'Audit log for batch events. Records all status changes, measurements, and notes.';

CREATE INDEX idx_batch_logs_batch ON batch_logs(batch_id, created_at DESC);

-- =============================================================================
-- Inventory Domain
-- =============================================================================

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  category TEXT NOT NULL,  -- grain, hops, yeast, adjunct, packaging, other
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,  -- lb, oz, kg, g, each, case
  reorder_point DECIMAL(10,2),
  reorder_qty DECIMAL(10,2),
  supplier TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE inventory_items IS 'Inventory item catalog. Defines items that can be received, allocated, and consumed.';

CREATE INDEX idx_inventory_items_category ON inventory_items(brewery_id, category);

CREATE TABLE allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  allocation_type TEXT NOT NULL,  -- receipt, batch_usage, adjustment, transfer, waste
  quantity DECIMAL(10,4) NOT NULL,  -- Positive for additions, negative for usage
  unit_cost DECIMAL(10,4),
  reference_type TEXT,  -- batch, order, adjustment
  reference_id UUID,    -- Links to the related record
  lot_number TEXT,
  expiration_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE allocations IS 'Inventory movements. All quantity changes are recorded here. Sum allocations to get current balance.';

CREATE INDEX idx_allocations_item ON allocations(inventory_item_id, created_at DESC);
CREATE INDEX idx_allocations_reference ON allocations(reference_type, reference_id);

-- =============================================================================
-- Packaging Domain
-- =============================================================================

CREATE TABLE package_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- e.g., "16oz Can", "Half Barrel Keg", "750ml Bottle"
  container_type TEXT NOT NULL,  -- can, bottle, keg, growler
  volume_oz DECIMAL(6,2) NOT NULL,
  units_per_case INTEGER,  -- For cans/bottles
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE package_types IS 'Package type definitions. Describes the physical containers products are packaged into.';

CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  package_type_id UUID NOT NULL REFERENCES package_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL,  -- Number of units packaged
  packaged_date DATE NOT NULL,
  best_by_date DATE,
  lot_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE packages IS 'Packaged product records. Links batches to physical packages for inventory and sales tracking.';

CREATE INDEX idx_packages_batch ON packages(batch_id);

-- =============================================================================
-- Sales Domain
-- =============================================================================

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL,  -- distributor, retail, taproom, direct
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address JSONB,  -- {street, city, state, zip}
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE customers IS 'Customer records. Includes distributors, retailers, and direct customers.';

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_id UUID NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, confirmed, scheduled, picking, packed, fulfilled, cancelled
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  requested_date DATE,
  scheduled_date DATE,
  fulfilled_date DATE,
  shipping_address JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brewery_id, order_number)
);

COMMENT ON TABLE orders IS 'Sales orders. Tracks orders through their lifecycle from draft to fulfillment.';

CREATE INDEX idx_orders_status ON orders(brewery_id, status);
CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,  -- Links to specific packaged product
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  package_type_id UUID REFERENCES package_types(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE order_items IS 'Order line items. Each line represents a product and quantity on an order.';

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- =============================================================================
-- Populate Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples) VALUES
('breweries', 'Brewery tenants. The root of multi-tenancy.', 'system',
 '["has_many: user_breweries", "has_many: recipes", "has_many: batches", "has_many: inventory_items", "has_many: orders"]',
 '["name", "slug"]', NULL,
 '["Get brewery by slug", "List all breweries for a user"]'),

('user_breweries', 'Maps users to breweries with role-based access.', 'system',
 '["belongs_to: auth.users", "belongs_to: breweries"]',
 '["user_id", "brewery_id", "roles"]', NULL,
 '["Get user roles for a brewery", "List users in a brewery"]'),

('recipes', 'Recipes with ingredients and instructions.', 'production',
 '["belongs_to: breweries", "has_many: batches"]',
 '["name", "style", "target_abv", "target_ibu"]', NULL,
 '["Find IPA recipes", "Get recipe with highest ABV", "List active recipes"]'),

('batches', 'Production batches tracking brewing lifecycle.', 'production',
 '["belongs_to: breweries", "belongs_to: recipes", "has_many: batch_logs", "has_many: packages"]',
 '["batch_number", "name", "status", "brew_date"]',
 '{"stateField": "status", "states": ["planned", "brewing", "fermenting", "conditioning", "packaging", "completed", "cancelled"], "transitions": {"planned": ["brewing", "cancelled"], "brewing": ["fermenting", "cancelled"], "fermenting": ["conditioning", "cancelled"], "conditioning": ["packaging", "cancelled"], "packaging": ["completed", "cancelled"]}}',
 '["List batches currently fermenting", "Find batches brewed this month", "Get batch with batch_number 2024-001"]'),

('batch_logs', 'Audit log for batch events and measurements.', 'production',
 '["belongs_to: batches", "belongs_to: auth.users"]',
 '["log_type", "data"]', NULL,
 '["Get status change history for a batch", "Find all gravity readings for a batch"]'),

('inventory_items', 'Inventory item catalog for tracking supplies.', 'inventory',
 '["belongs_to: breweries", "has_many: allocations"]',
 '["category", "name", "unit"]', NULL,
 '["List grain inventory", "Find items below reorder point", "Get hops in stock"]'),

('allocations', 'Inventory movements. Sum to get current balance.', 'inventory',
 '["belongs_to: breweries", "belongs_to: inventory_items"]',
 '["allocation_type", "quantity", "reference_type"]', NULL,
 '["Get current quantity for an item (SUM allocations)", "List receipts this month", "Find usage for a batch"]'),

('package_types', 'Package type definitions (cans, kegs, bottles).', 'packaging',
 '["belongs_to: breweries", "has_many: packages"]',
 '["name", "container_type", "volume_oz"]', NULL,
 '["List keg types", "Get can package types"]'),

('packages', 'Packaged product records linking batches to containers.', 'packaging',
 '["belongs_to: breweries", "belongs_to: batches", "belongs_to: package_types", "has_many: order_items"]',
 '["quantity", "packaged_date", "lot_code"]', NULL,
 '["Get packages for a batch", "Find packages expiring soon"]'),

('customers', 'Customer records for sales.', 'sales',
 '["belongs_to: breweries", "has_many: orders"]',
 '["name", "customer_type", "email"]', NULL,
 '["List distributors", "Find customer by name", "Get active retail accounts"]'),

('orders', 'Sales orders through fulfillment lifecycle.', 'sales',
 '["belongs_to: breweries", "belongs_to: customers", "has_many: order_items"]',
 '["order_number", "status", "order_date", "customer_id"]',
 '{"stateField": "status", "states": ["draft", "confirmed", "scheduled", "picking", "packed", "fulfilled", "cancelled"], "transitions": {"draft": ["confirmed", "cancelled"], "confirmed": ["scheduled", "cancelled"], "scheduled": ["picking", "cancelled"], "picking": ["packed", "cancelled"], "packed": ["fulfilled", "cancelled"]}}',
 '["List orders pending fulfillment", "Get orders for a customer", "Find orders scheduled for this week"]'),

('order_items', 'Order line items linking orders to products.', 'sales',
 '["belongs_to: orders", "belongs_to: packages", "belongs_to: batches"]',
 '["quantity", "unit_price"]', NULL,
 '["Get items for an order", "Find orders containing a specific batch"]');

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

ALTER TABLE breweries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_breweries ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Brewery access: Users can only see breweries they belong to
CREATE POLICY brewery_access ON breweries
  FOR ALL USING (
    id IN (SELECT brewery_id FROM user_breweries WHERE user_id = auth.uid())
  );

-- User breweries: Users can see their own memberships
CREATE POLICY user_brewery_access ON user_breweries
  FOR ALL USING (user_id = auth.uid());

-- Generic brewery-scoped policy helper function
CREATE OR REPLACE FUNCTION user_has_brewery_access(brewery_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_breweries
    WHERE user_id = auth.uid()
    AND user_breweries.brewery_id = $1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply brewery-scoped RLS to all other tables
CREATE POLICY recipe_access ON recipes
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY batch_access ON batches
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY batch_log_access ON batch_logs
  FOR ALL USING (
    batch_id IN (SELECT id FROM batches WHERE user_has_brewery_access(brewery_id))
  );

CREATE POLICY inventory_item_access ON inventory_items
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY allocation_access ON allocations
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY package_type_access ON package_types
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY package_access ON packages
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY customer_access ON customers
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY order_access ON orders
  FOR ALL USING (user_has_brewery_access(brewery_id));

CREATE POLICY order_item_access ON order_items
  FOR ALL USING (
    order_id IN (SELECT id FROM orders WHERE user_has_brewery_access(brewery_id))
  );

-- Schema registry is read-only for all authenticated users
CREATE POLICY schema_registry_read ON _schema_registry
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Updated At Trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_breweries_updated_at BEFORE UPDATE ON breweries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_recipes_updated_at BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_batches_updated_at BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_package_types_updated_at BEFORE UPDATE ON package_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_schema_registry_updated_at BEFORE UPDATE ON _schema_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
