-- Migration: 00088_square_integration.sql
-- Purpose: Square POS integration tables, views, and settings

-- =============================================================================
-- 1. LOCATION SCHEMA CHANGES
-- =============================================================================

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS square_location_id TEXT,
  ADD COLUMN IF NOT EXISTS pos_bin_id UUID REFERENCES bins(id);

COMMENT ON COLUMN locations.square_location_id IS 'Square location ID linking this location to a Square POS location';
COMMENT ON COLUMN locations.pos_bin_id IS 'Default POS bin for inventory deductions from Square sales at this location';

-- =============================================================================
-- 2. SQUARE SETTINGS TABLE (merchant-level singleton)
-- =============================================================================

CREATE TABLE square_settings (
  id UUID PRIMARY KEY,
  access_token TEXT,
  webhook_signature_key TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  last_catalog_sync_at TIMESTAMPTZ,
  last_inventory_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT square_settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000002'::uuid)
);

COMMENT ON TABLE square_settings IS 'Merchant-level Square POS configuration (singleton row)';
COMMENT ON COLUMN square_settings.access_token IS 'Square API access token (sensitive, hidden from client via safe view)';
COMMENT ON COLUMN square_settings.webhook_signature_key IS 'Shared secret for validating inbound Square webhooks (sensitive)';
COMMENT ON COLUMN square_settings.is_enabled IS 'Master toggle for Square integration';
COMMENT ON COLUMN square_settings.last_catalog_sync_at IS 'Timestamp of last successful catalog sync to Square';
COMMENT ON COLUMN square_settings.last_inventory_sync_at IS 'Timestamp of last successful inventory count push to Square';

ALTER TABLE square_settings ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant app, no user_id column. Per DEC-SEC-006, auth.uid() IS NOT NULL
-- is the tightest meaningful restriction. Admin-level access control enforced in app layer.
CREATE POLICY "Authenticated users can manage square_settings"
  ON square_settings FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE TRIGGER set_square_settings_updated_at
  BEFORE UPDATE ON square_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Insert singleton row
INSERT INTO square_settings (id, is_enabled)
VALUES ('00000000-0000-0000-0000-000000000002', false)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 3. SQUARE SETTINGS SAFE VIEW (hides sensitive columns)
-- =============================================================================

CREATE VIEW square_settings_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  is_enabled,
  last_catalog_sync_at,
  last_inventory_sync_at,
  created_at,
  updated_at
FROM square_settings;

COMMENT ON VIEW square_settings_safe IS 'Client-safe view of Square settings that hides access_token and webhook_signature_key';

-- =============================================================================
-- 4. SQUARE CATALOG MAP TABLE
-- =============================================================================

CREATE TABLE square_catalog_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id),
  package_type_id UUID REFERENCES package_types(id),
  keg_type_id UUID REFERENCES keg_types(id),
  square_catalog_id TEXT NOT NULL,
  square_version BIGINT,
  object_type TEXT NOT NULL CHECK (object_type IN ('ITEM', 'ITEM_VARIATION')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE square_catalog_map IS 'Maps MGR brands and package/keg types to Square catalog objects';
COMMENT ON COLUMN square_catalog_map.brand_id IS 'MGR brand this catalog entry represents';
COMMENT ON COLUMN square_catalog_map.package_type_id IS 'Package type for ITEM_VARIATION rows; NULL for parent ITEM or keg variations';
COMMENT ON COLUMN square_catalog_map.keg_type_id IS 'Keg type for ITEM_VARIATION rows; NULL for parent ITEM or packaged variations';
COMMENT ON COLUMN square_catalog_map.square_catalog_id IS 'Square permanent catalog object ID';
COMMENT ON COLUMN square_catalog_map.square_version IS 'Square catalog object version for optimistic concurrency';
COMMENT ON COLUMN square_catalog_map.object_type IS 'Square catalog object type: ITEM (parent) or ITEM_VARIATION (sellable SKU)';

-- Unique constraints: one Square ITEM per brand
CREATE UNIQUE INDEX uq_square_catalog_map_brand_item
  ON square_catalog_map (brand_id)
  WHERE object_type = 'ITEM';

-- One ITEM_VARIATION per brand + package_type (packaged products)
CREATE UNIQUE INDEX uq_square_catalog_map_brand_package
  ON square_catalog_map (brand_id, package_type_id)
  WHERE keg_type_id IS NULL AND object_type = 'ITEM_VARIATION';

-- One ITEM_VARIATION per brand + keg_type (draft products)
CREATE UNIQUE INDEX uq_square_catalog_map_brand_keg
  ON square_catalog_map (brand_id, keg_type_id)
  WHERE package_type_id IS NULL AND object_type = 'ITEM_VARIATION';

ALTER TABLE square_catalog_map ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant integration data per DEC-SEC-006
CREATE POLICY "Authenticated users can manage square_catalog_map"
  ON square_catalog_map FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE TRIGGER set_square_catalog_map_updated_at
  BEFORE UPDATE ON square_catalog_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 5. SQUARE SYNC LOG TABLE
-- =============================================================================

CREATE TABLE square_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('catalog_push', 'inventory_push', 'sale_ingest')),
  location_id UUID REFERENCES locations(id),
  items_synced INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  details JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE square_sync_log IS 'Audit log of Square sync operations with counts and error details';
COMMENT ON COLUMN square_sync_log.sync_type IS 'Type of sync: catalog_push, inventory_push, or sale_ingest';
COMMENT ON COLUMN square_sync_log.location_id IS 'Target location for inventory/sale syncs; NULL for catalog syncs';
COMMENT ON COLUMN square_sync_log.items_synced IS 'Count of successfully synced items';
COMMENT ON COLUMN square_sync_log.items_failed IS 'Count of items that failed to sync';
COMMENT ON COLUMN square_sync_log.details IS 'Detailed error messages, item lists, and diagnostics';
COMMENT ON COLUMN square_sync_log.started_at IS 'When the sync operation began';
COMMENT ON COLUMN square_sync_log.completed_at IS 'When the sync operation finished (NULL if still running)';

ALTER TABLE square_sync_log ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant audit data per DEC-SEC-006
CREATE POLICY "Authenticated users can manage square_sync_log"
  ON square_sync_log FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- 6. SQUARE DRAFT SALES TABLE
-- =============================================================================

CREATE TABLE square_draft_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_order_id TEXT NOT NULL,
  square_payment_id TEXT,
  brand_id UUID NOT NULL REFERENCES brands(id),
  keg_type_id UUID NOT NULL REFERENCES keg_types(id),
  quantity INTEGER NOT NULL,
  volume_oz DECIMAL(10,2),
  unit_price_cents INTEGER,
  location_id UUID NOT NULL REFERENCES locations(id),
  sold_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE square_draft_sales IS 'Draft beer sales ingested from Square POS for inventory deduction';
COMMENT ON COLUMN square_draft_sales.square_order_id IS 'Square order ID for traceability and deduplication';
COMMENT ON COLUMN square_draft_sales.square_payment_id IS 'Square payment ID associated with this sale';
COMMENT ON COLUMN square_draft_sales.brand_id IS 'Brand sold';
COMMENT ON COLUMN square_draft_sales.keg_type_id IS 'Keg type (determines serving size)';
COMMENT ON COLUMN square_draft_sales.quantity IS 'Number of servings sold';
COMMENT ON COLUMN square_draft_sales.volume_oz IS 'Calculated total volume in ounces';
COMMENT ON COLUMN square_draft_sales.unit_price_cents IS 'Price per serving in cents';
COMMENT ON COLUMN square_draft_sales.location_id IS 'Location where the sale occurred';
COMMENT ON COLUMN square_draft_sales.sold_at IS 'Timestamp of the sale from Square';

-- Deduplication: one record per order + brand + keg_type combination
CREATE UNIQUE INDEX uq_square_draft_sales_dedup
  ON square_draft_sales (square_order_id, brand_id, keg_type_id);

ALTER TABLE square_draft_sales ENABLE ROW LEVEL SECURITY;

-- Note: Single-tenant sales data per DEC-SEC-006
CREATE POLICY "Authenticated users can manage square_draft_sales"
  ON square_draft_sales FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- 7. LOCATIONS WITH POS VIEW
-- =============================================================================

CREATE VIEW locations_with_pos
WITH (security_invoker = true)
AS
SELECT
  l.*,
  b.name AS pos_bin_name,
  b.bin_type AS pos_bin_type
FROM locations l
LEFT JOIN bins b ON b.id = l.pos_bin_id;

COMMENT ON VIEW locations_with_pos IS 'Locations enriched with POS bin details for Square integration';

-- =============================================================================
-- 8. INDEXES
-- =============================================================================

CREATE INDEX idx_square_catalog_map_brand ON square_catalog_map (brand_id);
CREATE INDEX idx_square_catalog_map_catalog_id ON square_catalog_map (square_catalog_id);
CREATE INDEX idx_square_sync_log_type_created ON square_sync_log (sync_type, created_at DESC);
CREATE INDEX idx_square_draft_sales_location_sold ON square_draft_sales (location_id, sold_at DESC);
CREATE INDEX idx_locations_pos_bin ON locations (pos_bin_id) WHERE pos_bin_id IS NOT NULL;

-- =============================================================================
-- 9. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, entity_type, key_fields, relationships, query_examples) VALUES
  ('square_settings',
   'Merchant-level Square POS settings (singleton)',
   'integrations', 'system',
   '["is_enabled", "last_catalog_sync_at", "last_inventory_sync_at"]'::jsonb,
   '{"singleton": true}'::jsonb,
   '["Is Square integration enabled?", "When was the last catalog sync?"]'::jsonb),
  ('square_catalog_map',
   'Maps MGR brands and package/keg types to Square catalog objects',
   'integrations', 'system',
   '["brand_id", "package_type_id", "keg_type_id", "square_catalog_id", "object_type"]'::jsonb,
   '{"belongs_to": ["brands", "package_types", "keg_types"]}'::jsonb,
   '["What Square catalog ID maps to this brand?", "Show all catalog mappings"]'::jsonb),
  ('square_sync_log',
   'Audit log of Square sync operations with counts and error details',
   'integrations', 'system',
   '["sync_type", "items_synced", "items_failed"]'::jsonb,
   '{"belongs_to": ["locations"]}'::jsonb,
   '["Show recent Square sync errors", "How many items synced in last catalog push?"]'::jsonb),
  ('square_draft_sales',
   'Draft beer sales ingested from Square POS for inventory deduction',
   'integrations', 'system',
   '["square_order_id", "brand_id", "keg_type_id", "quantity", "sold_at"]'::jsonb,
   '{"belongs_to": ["brands", "keg_types", "locations"]}'::jsonb,
   '["Show draft sales for today", "Total volume sold by brand this week"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  entity_type = EXCLUDED.entity_type,
  key_fields = EXCLUDED.key_fields,
  relationships = EXCLUDED.relationships,
  query_examples = EXCLUDED.query_examples;

-- Update locations registry to reflect new columns
UPDATE _schema_registry
SET key_fields = key_fields || '["square_location_id", "pos_bin_id"]'::jsonb
WHERE table_name = 'locations';
