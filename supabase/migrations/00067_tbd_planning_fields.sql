-- =============================================================================
-- Migration: TBD Planning Fields
-- =============================================================================
-- Adds support for TBD (To Be Determined) products in order items and recipe
-- completeness tracking for planning purposes.
--
-- Features:
--   1. TBD support in order_items (style_id + tbd_notes when brand_id is NULL)
--   2. Recipe status (draft/spec/complete) for tracking completeness
--   3. Batch planning fields (target_package_date, estimated_volume_bbl)
-- =============================================================================

-- =============================================================================
-- 1. ADD TBD SUPPORT TO ORDER_ITEMS
-- =============================================================================
-- When brand_id is NULL, the product is TBD and style_id + tbd_notes provide context

ALTER TABLE order_items
ADD COLUMN style_id UUID REFERENCES beer_styles(id) ON DELETE SET NULL,
ADD COLUMN tbd_notes TEXT;

COMMENT ON COLUMN order_items.style_id IS 'Style hint for TBD products (when brand_id is NULL)';
COMMENT ON COLUMN order_items.tbd_notes IS 'Description for TBD products (e.g., "contract brew for ABC, ~6.5% ABV")';

-- Add index for TBD order items queries
CREATE INDEX idx_order_items_tbd ON order_items(style_id) WHERE brand_id IS NULL;

-- =============================================================================
-- 2. ADD RECIPE STATUS FOR INCOMPLETE SPECS
-- =============================================================================
-- draft: just started, very incomplete
-- spec: has style + rough targets, enough for planning but not brewing
-- complete: fully specified, ready to brew

ALTER TABLE recipes
ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';

-- Backfill: existing recipes are complete (default handles this via NOT NULL DEFAULT)
-- No explicit UPDATE needed since DEFAULT is 'complete'

-- Add constraint for valid status values
ALTER TABLE recipes
ADD CONSTRAINT chk_recipe_status CHECK (status IN ('draft', 'spec', 'complete'));

COMMENT ON COLUMN recipes.status IS 'Recipe completeness: draft (incomplete), spec (enough for planning), complete (ready to brew)';

-- =============================================================================
-- 3. ADD BATCH PLANNING FIELDS
-- =============================================================================

ALTER TABLE batches
ADD COLUMN target_package_date DATE,
ADD COLUMN estimated_volume_bbl DECIMAL(10,2);

COMMENT ON COLUMN batches.target_package_date IS 'Estimated packaging date, calculated from recipe fermentation/conditioning time';
COMMENT ON COLUMN batches.estimated_volume_bbl IS 'Estimated volume for planning (before actual measurement)';

-- =============================================================================
-- 4. UPDATE SCHEMA REGISTRY
-- =============================================================================

UPDATE _schema_registry SET
  key_fields = '["order_id", "brand_id", "style_id", "package_type_id", "quantity"]'::jsonb,
  description = 'Order line items. brand_id NULL = TBD product, use style_id + tbd_notes for planning.',
  updated_at = NOW()
WHERE table_name = 'order_items';

UPDATE _schema_registry SET
  key_fields = '["name", "style_id", "status", "is_template", "is_active"]'::jsonb,
  state_machine = '{"stateField": "status", "states": ["draft", "spec", "complete"], "transitions": {"draft": ["spec", "complete"], "spec": ["complete"]}}'::jsonb,
  updated_at = NOW()
WHERE table_name = 'recipes';
