-- =============================================================================
-- Migration: Migrate data from package_types/keg_types to containers/selling_formats
-- =============================================================================
-- Phase 1: Populate new tables from old data
-- Phase 2: Add selling_format_id to referencing tables and backfill
-- Phase 3: Seed channel_formats from show_in_pricing

-- -----------------------------------------------------------------------------
-- Phase 1: Populate containers and selling_formats
-- -----------------------------------------------------------------------------

-- 1a. Create containers from package_types (deduped by container_type + volume_oz)
-- Each unique (container_type, volume_oz) becomes one container.
INSERT INTO containers (id, name, type, volume_oz, is_active, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  CASE
    WHEN volume_oz = FLOOR(volume_oz) THEN FLOOR(volume_oz)::text
    ELSE volume_oz::text
  END || 'oz ' || INITCAP(container_type),
  'package',
  volume_oz,
  bool_or(is_active),
  ROW_NUMBER() OVER (ORDER BY container_type, volume_oz)::integer * 10,
  MIN(created_at),
  MAX(updated_at)
FROM package_types
WHERE container_type != 'keg'
GROUP BY container_type, volume_oz;

-- 1b. Create containers from keg_types
INSERT INTO containers (id, name, type, volume_bbl, deposit_amount, is_active, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  name,
  'keg',
  volume_bbl,
  COALESCE(deposit_amount, 0),
  COALESCE(is_active, true),
  COALESCE(position, 0) + 1000,
  created_at,
  updated_at
FROM keg_types;

-- 1c. Create selling_formats from package_types
-- Each package_type row becomes one selling_format linked to its container.
-- REUSE the package_type UUID as the selling_format UUID for easy FK migration.
INSERT INTO selling_formats (id, container_id, name, unit_count, is_active, position, created_at, updated_at)
SELECT
  pt.id,
  c.id,
  pt.name,
  COALESCE(pt.units_per_case, 1),
  COALESCE(pt.is_active, true),
  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY COALESCE(pt.units_per_case, 1))::integer * 10,
  pt.created_at,
  pt.updated_at
FROM package_types pt
JOIN containers c ON c.type = 'package'
  AND c.volume_oz = pt.volume_oz
  AND LOWER(c.name) LIKE '%' || pt.container_type || '%'
WHERE pt.container_type != 'keg';

-- 1d. Create selling_formats from keg_types ("Per Keg" for each)
-- REUSE the keg_type UUID as the selling_format UUID.
INSERT INTO selling_formats (id, container_id, name, unit_count, is_active, position, created_at, updated_at)
SELECT
  kt.id,
  c.id,
  'Per Keg',
  1,
  COALESCE(kt.is_active, true),
  0,
  kt.created_at,
  kt.updated_at
FROM keg_types kt
JOIN containers c ON c.type = 'keg' AND c.name = kt.name;

-- -----------------------------------------------------------------------------
-- Phase 2: Add selling_format_id to referencing tables
-- -----------------------------------------------------------------------------

-- Because we reused old UUIDs as selling_format IDs, the backfill is simple:
-- selling_format_id = COALESCE(keg_type_id, package_type_id)

-- Drop XOR constraints that reference old columns (from migration 00080)
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_format_xor;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_keg_owner;
ALTER TABLE session_line_items DROP CONSTRAINT IF EXISTS chk_sli_format_xor;
ALTER TABLE session_line_items DROP CONSTRAINT IF EXISTS chk_sli_keg_owner;
ALTER TABLE finished_goods DROP CONSTRAINT IF EXISTS chk_fg_format_xor;

-- order_items
ALTER TABLE order_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE order_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- session_line_items
ALTER TABLE session_line_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE session_line_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- finished_goods
ALTER TABLE finished_goods ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE finished_goods SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- keg_transactions (keg_type_id only)
ALTER TABLE keg_transactions ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE keg_transactions SET selling_format_id = keg_type_id;
ALTER TABLE keg_transactions ALTER COLUMN selling_format_id SET NOT NULL;

-- keg_owner_deposits (keg_type_id only)
ALTER TABLE keg_owner_deposits ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE keg_owner_deposits SET selling_format_id = keg_type_id;
ALTER TABLE keg_owner_deposits ALTER COLUMN selling_format_id SET NOT NULL;

-- order_change_request_items
ALTER TABLE order_change_request_items ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE order_change_request_items SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- square_catalog_map
ALTER TABLE square_catalog_map ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE square_catalog_map SET selling_format_id = COALESCE(keg_type_id, package_type_id);

-- square_draft_sales (keg_type_id only)
ALTER TABLE square_draft_sales ADD COLUMN selling_format_id UUID REFERENCES selling_formats(id) ON DELETE SET NULL;
UPDATE square_draft_sales SET selling_format_id = keg_type_id;

-- Create indexes on new columns
CREATE INDEX idx_order_items_selling_format ON order_items(selling_format_id);
CREATE INDEX idx_session_line_items_selling_format ON session_line_items(selling_format_id);
CREATE INDEX idx_finished_goods_selling_format ON finished_goods(selling_format_id);
CREATE INDEX idx_keg_transactions_selling_format ON keg_transactions(selling_format_id);

-- -----------------------------------------------------------------------------
-- Phase 3: Seed channel_formats from show_in_pricing
-- -----------------------------------------------------------------------------
-- For every selling_format where the old show_in_pricing was true,
-- enable it in ALL active sales channels (preserving current global behavior)
INSERT INTO channel_formats (selling_format_id, sales_channel_id)
SELECT sf.id, sc.id
FROM selling_formats sf
JOIN sales_channels sc ON sc.is_active = true
WHERE sf.id IN (
  SELECT id FROM package_types WHERE show_in_pricing = true AND container_type != 'keg'
  UNION ALL
  SELECT id FROM keg_types WHERE show_in_pricing = true
);
