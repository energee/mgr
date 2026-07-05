-- Keg Inventory Table
-- Phase 10.2: Track keg quantities by type, state, and location

-- =============================================================================
-- 1. KEG STATE ENUM
-- =============================================================================

CREATE TYPE keg_state AS ENUM (
  'empty',           -- Clean, empty kegs ready to be filled
  'filled',          -- Filled with beer, in inventory
  'shipped',         -- Out with a customer
  'returned_dirty',  -- Returned from customer, needs cleaning
  'cleaning',        -- In the cleaning process
  'maintenance',     -- Out for repair/inspection
  'retired'          -- No longer in service
);

-- =============================================================================
-- 2. KEG_INVENTORY TABLE
-- =============================================================================

CREATE TABLE keg_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keg_type_id UUID NOT NULL REFERENCES keg_types(id) ON DELETE RESTRICT,
  state keg_state NOT NULL DEFAULT 'empty',
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- For filled kegs, track what's in them
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  finished_good_id UUID REFERENCES finished_goods(id) ON DELETE SET NULL,
  -- Notes and metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Unique constraint: one row per type/state/location/batch combination
  CONSTRAINT keg_inventory_unique UNIQUE (keg_type_id, state, location_id, batch_id, finished_good_id)
);

COMMENT ON TABLE keg_inventory IS 'Aggregate keg inventory tracking by type, state, and location';
COMMENT ON COLUMN keg_inventory.keg_type_id IS 'Type of keg (1/2 BBL, 1/6 BBL, etc.)';
COMMENT ON COLUMN keg_inventory.state IS 'Current state of the kegs (empty, filled, shipped, etc.)';
COMMENT ON COLUMN keg_inventory.location_id IS 'Physical location of the kegs';
COMMENT ON COLUMN keg_inventory.quantity IS 'Number of kegs in this state';
COMMENT ON COLUMN keg_inventory.batch_id IS 'For filled kegs, the source batch';
COMMENT ON COLUMN keg_inventory.finished_good_id IS 'For filled kegs, the finished good';

-- Enable RLS
ALTER TABLE keg_inventory ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Note: Single-tenant application - all authenticated users have full access.
-- This follows the pattern established in other inventory tables (keg_types, locations, etc.)
-- Admin-level access control is enforced in the application layer.
CREATE POLICY "keg_inventory_select" ON keg_inventory
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "keg_inventory_insert" ON keg_inventory
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "keg_inventory_update" ON keg_inventory
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "keg_inventory_delete" ON keg_inventory
  FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

CREATE INDEX idx_keg_inventory_type ON keg_inventory(keg_type_id);
CREATE INDEX idx_keg_inventory_state ON keg_inventory(state);
CREATE INDEX idx_keg_inventory_location ON keg_inventory(location_id);
CREATE INDEX idx_keg_inventory_batch ON keg_inventory(batch_id) WHERE batch_id IS NOT NULL;

-- =============================================================================
-- 4. UPDATED_AT TRIGGER
-- =============================================================================

-- HISTORICAL NO-OP: update_updated_at_column() never existed (the repo-wide
-- helper is update_updated_at()), so this statement failed on every
-- environment; no such trigger exists live, and keg_inventory becomes a view
-- in 00032 regardless. Commented out so a from-scratch replay reproduces the
-- live state. See PR #322.
-- CREATE TRIGGER set_keg_inventory_updated_at
--   BEFORE UPDATE ON keg_inventory
--   FOR EACH ROW
--   EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. SUMMARY VIEW
-- =============================================================================

CREATE VIEW keg_inventory_summary
WITH (security_invoker = true)
AS
SELECT
  kt.id AS keg_type_id,
  kt.name AS keg_type_name,
  kt.code AS keg_type_code,
  kt.volume_bbl,
  ki.state,
  COALESCE(SUM(ki.quantity), 0) AS total_quantity,
  COUNT(DISTINCT ki.location_id) AS location_count
FROM keg_types kt
LEFT JOIN keg_inventory ki ON kt.id = ki.keg_type_id
WHERE kt.is_active = true
GROUP BY kt.id, kt.name, kt.code, kt.volume_bbl, ki.state
ORDER BY kt.position, kt.name, ki.state;

COMMENT ON VIEW keg_inventory_summary IS 'Summary of keg quantities by type and state';

-- =============================================================================
-- 6. SEED INITIAL INVENTORY (Optional - just creates structure)
-- =============================================================================

-- No seed data - inventory starts empty and is built up through transactions

-- =============================================================================
-- 7. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('keg_inventory', 'Keg inventory tracking by type, state, and location', 'inventory',
   '{"keg_types": "keg_type_id", "locations": "location_id", "batches": "batch_id", "finished_goods": "finished_good_id"}'::jsonb,
   '["id", "keg_type_id", "state", "location_id", "quantity"]'::jsonb,
   '["How many empty kegs do we have?", "Show keg inventory by type", "Which kegs are at which location?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
