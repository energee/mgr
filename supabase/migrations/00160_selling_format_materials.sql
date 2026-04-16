-- =============================================================================
-- Migration: 00160_selling_format_materials
--
-- Adds the selling_format_materials BOM (bill-of-materials) junction table and
-- pallet layer fields to selling_formats.
--
-- selling_format_materials defines what packaging materials (cans, lids,
-- PakTechs, trays, keg caps, etc.) are needed per unit of a selling format.
--
-- The new pallet layer columns on selling_formats enable pallet quantity
-- calculations: pallet_quantity is auto-computed from units_per_layer *
-- default_layers when both are set.
-- =============================================================================

-- =============================================================================
-- 1. Create selling_format_materials table
-- =============================================================================

CREATE TABLE selling_format_materials (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  selling_format_id   UUID          NOT NULL REFERENCES selling_formats(id) ON DELETE CASCADE,
  inventory_item_id   UUID          NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_per_unit   DECIMAL(10,4) NOT NULL CHECK (quantity_per_unit > 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (selling_format_id, inventory_item_id)
);

COMMENT ON TABLE selling_format_materials IS
  'Bill-of-materials for a selling format. Each row defines how much of a given '
  'inventory item (can, lid, PakTech, tray, keg cap, etc.) is required per unit '
  'of that selling format.';

COMMENT ON COLUMN selling_format_materials.quantity_per_unit IS
  'Amount of the inventory item consumed per unit sold in this format.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_sfm_selling_format_id  ON selling_format_materials (selling_format_id);
CREATE INDEX idx_sfm_inventory_item_id  ON selling_format_materials (inventory_item_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE selling_format_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY selling_format_materials_authenticated
  ON selling_format_materials
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER set_selling_format_materials_updated_at
  BEFORE UPDATE ON selling_format_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. Add pallet layer columns to selling_formats
-- =============================================================================

ALTER TABLE selling_formats
  ADD COLUMN IF NOT EXISTS units_per_layer  INTEGER CHECK (units_per_layer > 0),
  ADD COLUMN IF NOT EXISTS default_layers   INTEGER CHECK (default_layers > 0),
  ADD COLUMN IF NOT EXISTS pallet_quantity  INTEGER CHECK (pallet_quantity > 0);

COMMENT ON COLUMN selling_formats.units_per_layer IS
  'How many units of this selling format fit on one pallet layer. '
  'Used with default_layers to auto-compute pallet_quantity.';

COMMENT ON COLUMN selling_formats.default_layers IS
  'Default number of layers per pallet. '
  'Used with units_per_layer to auto-compute pallet_quantity.';

COMMENT ON COLUMN selling_formats.pallet_quantity IS
  'Total units per pallet. Auto-computed as units_per_layer * default_layers '
  'when both layer fields are set; can be overridden manually when only one '
  'layer field is provided.';

-- =============================================================================
-- 3. Trigger: auto-compute pallet_quantity from layer fields
-- =============================================================================

CREATE OR REPLACE FUNCTION compute_pallet_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Only recompute when BOTH layer fields are provided.
  -- If both are NULL, clear pallet_quantity.
  -- If only one is set, leave pallet_quantity unchanged (allow manual override).
  IF NEW.units_per_layer IS NOT NULL AND NEW.default_layers IS NOT NULL THEN
    NEW.pallet_quantity := NEW.units_per_layer * NEW.default_layers;
  ELSIF NEW.units_per_layer IS NULL AND NEW.default_layers IS NULL THEN
    NEW.pallet_quantity := NULL;
  END IF;
  -- When exactly one layer field is set, pallet_quantity is left as-is.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION compute_pallet_quantity() IS
  'Trigger function that auto-computes selling_formats.pallet_quantity from '
  'units_per_layer * default_layers. Fires on INSERT and UPDATE of layer fields. '
  'Clears pallet_quantity when both layer fields are NULL. When only one layer '
  'field is set, pallet_quantity is left unchanged to allow manual override.';

CREATE TRIGGER trg_selling_formats_pallet_quantity
  BEFORE INSERT OR UPDATE OF units_per_layer, default_layers
  ON selling_formats
  FOR EACH ROW EXECUTE FUNCTION compute_pallet_quantity();

-- =============================================================================
-- 4. Schema registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('selling_format_materials',
   'Bill-of-materials (BOM) for selling formats. Maps each selling format to the '
   'packaging inventory items it requires (cans, lids, PakTechs, trays, keg caps) '
   'and the quantity needed per unit sold.',
   'inventory',
   '{"selling_formats": "selling_format_id", "inventory_items": "inventory_item_id"}'::jsonb,
   '["id", "selling_format_id", "inventory_item_id", "quantity_per_unit"]'::jsonb,
   '["What materials are needed for a 4-pack selling format?", '
   '"List all BOM entries for selling formats", '
   '"How much material is consumed per unit of format X?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description    = EXCLUDED.description,
  domain         = EXCLUDED.domain,
  relationships  = EXCLUDED.relationships,
  key_fields     = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;

-- Update selling_formats key_fields to include the new pallet columns
UPDATE _schema_registry
SET
  key_fields = '["name", "container_id", "unit_count", "is_active", "units_per_layer", "default_layers", "pallet_quantity"]'::jsonb,
  updated_at = NOW()
WHERE table_name = 'selling_formats';

-- =============================================================================
-- Done
-- =============================================================================

SELECT 'Selling format materials BOM table and pallet layer fields migration complete!' AS message;
