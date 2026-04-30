-- Migration: Extend supplier_catalog to support inventory_item catalog_type
-- and remove the free-text supplier field from inventory_items.
--
-- Previously, supplier_catalog only linked suppliers to catalog items (malts,
-- hops, yeasts, etc.). This migration allows it to also link suppliers to
-- inventory_items, enabling structured supplier relationships for raw materials
-- and packaging supplies. The legacy free-text supplier field is migrated to
-- notes and dropped.

-- -----------------------------------------------------------------------------
-- 1. Document that 'inventory_item' is now a valid catalog_type value
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN supplier_catalog.catalog_type IS
  'Discriminator for which catalog the row links to. Valid values: '
  '''malt'', ''hop'', ''yeast'', ''adjunct'', ''other'', ''inventory_item''. '
  'Use ''inventory_item'' to link a supplier to an inventory_items row.';

-- -----------------------------------------------------------------------------
-- 2. Migrate existing free-text supplier data to notes
-- -----------------------------------------------------------------------------
UPDATE inventory_items
SET notes = CASE
  WHEN notes IS NOT NULL AND supplier IS NOT NULL
    THEN notes || E'\n[Migrated supplier: ' || supplier || ']'
  WHEN supplier IS NOT NULL
    THEN '[Migrated supplier: ' || supplier || ']'
  ELSE notes
END
WHERE supplier IS NOT NULL AND supplier != '';

-- -----------------------------------------------------------------------------
-- 3. Drop the free-text supplier column
-- -----------------------------------------------------------------------------
ALTER TABLE inventory_items DROP COLUMN supplier;

-- -----------------------------------------------------------------------------
-- 4. Partial index for preferred supplier resolution on inventory_items
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_inv_item_preferred
  ON supplier_catalog(catalog_id, is_preferred DESC, price ASC)
  WHERE catalog_type = 'inventory_item';

-- -----------------------------------------------------------------------------
-- 5. Update schema registry for supplier_catalog
-- -----------------------------------------------------------------------------
UPDATE _schema_registry
SET description = 'Links suppliers to catalog items and inventory items with pricing, '
                  'lead times, and preferred-supplier flags. Supports catalog_type values: '
                  'malt, hop, yeast, adjunct, other, inventory_item.'
WHERE table_name = 'supplier_catalog';
