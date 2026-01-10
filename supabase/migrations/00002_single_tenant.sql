-- MGR Single-Tenant Migration
-- Converts from multi-tenant (brewery_id everywhere) to single-tenant with settings table.
--
-- Changes:
-- - Creates a singleton `settings` table for brewery configuration
-- - Removes `brewery_id` from all tables
-- - Drops `breweries` and `user_breweries` tables
-- - Simplifies RLS to just check authenticated

-- =============================================================================
-- Create Settings Table (Singleton)
-- =============================================================================

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brewery_name TEXT NOT NULL DEFAULT 'My Brewery',
  address JSONB,  -- {street, city, state, zip}
  phone TEXT,
  email TEXT,
  website TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  currency TEXT DEFAULT 'USD',
  date_format TEXT DEFAULT 'MM/DD/YYYY',
  -- TTB Information
  ttb_permit_number TEXT,
  ttb_registry_number TEXT,
  -- Business settings
  default_batch_size_gallons DECIMAL(6,2) DEFAULT 7,
  fiscal_year_start_month INTEGER DEFAULT 1,  -- January
  -- Feature flags
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure singleton
  CONSTRAINT settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

COMMENT ON TABLE settings IS 'Singleton table for brewery settings and configuration. Only one row allowed.';

-- Insert default settings row
INSERT INTO settings (id, brewery_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'My Brewery');

-- =============================================================================
-- Drop Old RLS Policies
-- =============================================================================

DROP POLICY IF EXISTS brewery_access ON breweries;
DROP POLICY IF EXISTS user_brewery_access ON user_breweries;
DROP POLICY IF EXISTS recipe_access ON recipes;
DROP POLICY IF EXISTS batch_access ON batches;
DROP POLICY IF EXISTS batch_log_access ON batch_logs;
DROP POLICY IF EXISTS inventory_item_access ON inventory_items;
DROP POLICY IF EXISTS allocation_access ON allocations;
DROP POLICY IF EXISTS package_type_access ON package_types;
DROP POLICY IF EXISTS package_access ON packages;
DROP POLICY IF EXISTS customer_access ON customers;
DROP POLICY IF EXISTS order_access ON orders;
DROP POLICY IF EXISTS order_item_access ON order_items;

-- Drop the helper function
DROP FUNCTION IF EXISTS user_has_brewery_access(UUID);

-- =============================================================================
-- Remove brewery_id from Tables
-- =============================================================================

-- Drop foreign key constraints first
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_brewery_id_fkey;
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_brewery_id_fkey;
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_brewery_id_fkey;
ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_brewery_id_fkey;
ALTER TABLE package_types DROP CONSTRAINT IF EXISTS package_types_brewery_id_fkey;
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_brewery_id_fkey;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_brewery_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_brewery_id_fkey;

-- Drop unique constraints that include brewery_id
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_brewery_id_batch_number_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_brewery_id_order_number_key;

-- Drop indexes that reference brewery_id
DROP INDEX IF EXISTS idx_batches_status;
DROP INDEX IF EXISTS idx_batches_brew_date;
DROP INDEX IF EXISTS idx_inventory_items_category;
DROP INDEX IF EXISTS idx_orders_status;

-- Remove brewery_id columns
ALTER TABLE recipes DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE batches DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE inventory_items DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE allocations DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE package_types DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE packages DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE customers DROP COLUMN IF EXISTS brewery_id;
ALTER TABLE orders DROP COLUMN IF EXISTS brewery_id;

-- Add back unique constraints without brewery_id
ALTER TABLE batches ADD CONSTRAINT batches_batch_number_key UNIQUE (batch_number);
ALTER TABLE orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);

-- Recreate indexes without brewery_id
CREATE INDEX idx_batches_status ON batches(status);
CREATE INDEX idx_batches_brew_date ON batches(brew_date);
CREATE INDEX idx_inventory_items_category ON inventory_items(category);
CREATE INDEX idx_orders_status ON orders(status);

-- =============================================================================
-- Drop Multi-Tenant Tables
-- =============================================================================

DROP TABLE IF EXISTS user_breweries;
DROP TABLE IF EXISTS breweries;

-- =============================================================================
-- Create Simple RLS Policies (Authenticated Users Only)
-- =============================================================================

-- Settings: All authenticated users can read, but only admins should update
-- (For now, all authenticated users can do everything - add role checks later)
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY settings_access ON settings
  FOR ALL USING (auth.uid() IS NOT NULL);

-- All other tables: Authenticated users have full access
CREATE POLICY recipe_access ON recipes
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY batch_access ON batches
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY batch_log_access ON batch_logs
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY inventory_item_access ON inventory_items
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY allocation_access ON allocations
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY package_type_access ON package_types
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY package_access ON packages
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY customer_access ON customers
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY order_access ON orders
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY order_item_access ON order_items
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

-- Remove brewery references
DELETE FROM _schema_registry WHERE table_name IN ('breweries', 'user_breweries');

-- Add settings table
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples) VALUES
('settings', 'Singleton brewery settings and configuration.', 'system',
 '[]',
 '["brewery_name", "timezone", "ttb_permit_number"]', NULL,
 '["Get brewery settings", "Update timezone"]');

-- Update relationships in existing entries
UPDATE _schema_registry
SET relationships = '["has_many: batches"]'::jsonb
WHERE table_name = 'recipes';

UPDATE _schema_registry
SET relationships = '["belongs_to: recipes", "has_many: batch_logs", "has_many: packages"]'::jsonb
WHERE table_name = 'batches';

UPDATE _schema_registry
SET relationships = '["has_many: allocations"]'::jsonb
WHERE table_name = 'inventory_items';

UPDATE _schema_registry
SET relationships = '["belongs_to: inventory_items"]'::jsonb
WHERE table_name = 'allocations';

UPDATE _schema_registry
SET relationships = '["has_many: packages"]'::jsonb
WHERE table_name = 'package_types';

UPDATE _schema_registry
SET relationships = '["belongs_to: batches", "belongs_to: package_types", "has_many: order_items"]'::jsonb
WHERE table_name = 'packages';

UPDATE _schema_registry
SET relationships = '["has_many: orders"]'::jsonb
WHERE table_name = 'customers';

UPDATE _schema_registry
SET relationships = '["belongs_to: customers", "has_many: order_items"]'::jsonb
WHERE table_name = 'orders';

-- =============================================================================
-- Updated At Trigger for Settings
-- =============================================================================

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
