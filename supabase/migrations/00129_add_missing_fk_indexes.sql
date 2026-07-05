-- Add missing foreign key indexes identified in the productionization audit.
-- Foreign key columns without indexes cause slow joins and sequential scans
-- on the referenced side of DELETE/UPDATE cascades.

-- Keg tables (from migration 00079)
CREATE INDEX IF NOT EXISTS idx_keg_owner_deposits_keg_type_id ON keg_owner_deposits (keg_type_id);
-- HISTORICAL NO-OP: keg_inventory is a VIEW (00032/00079); indexes on views
-- are impossible, so this failed on every environment. See PR #322.
-- CREATE INDEX IF NOT EXISTS idx_keg_inventory_keg_owner_id ON keg_inventory (keg_owner_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_keg_owner_id ON keg_transactions (keg_owner_id);

-- Order change requests (from migration 00089)
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_order_item_id ON order_change_request_items (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_brand_id ON order_change_request_items (brand_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_package_type_id ON order_change_request_items (package_type_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_keg_type_id ON order_change_request_items (keg_type_id);
CREATE INDEX IF NOT EXISTS idx_order_change_requests_reviewed_by ON order_change_requests (reviewed_by);

-- Recipe variants (from migration 00082)
CREATE INDEX IF NOT EXISTS idx_recipe_variant_hops_hop_id ON recipe_variant_hops (hop_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_adjuncts_adjunct_id ON recipe_variant_adjuncts (adjunct_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_fruits_fruit_id ON recipe_variant_fruits (fruit_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_spices_spice_id ON recipe_variant_spices (spice_id);

-- Square integration (from migration 00088)
CREATE INDEX IF NOT EXISTS idx_square_catalog_map_package_type_id ON square_catalog_map (package_type_id);
CREATE INDEX IF NOT EXISTS idx_square_catalog_map_keg_type_id ON square_catalog_map (keg_type_id);
CREATE INDEX IF NOT EXISTS idx_square_sync_log_location_id ON square_sync_log (location_id);
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_brand_id ON square_draft_sales (brand_id);
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_keg_type_id ON square_draft_sales (keg_type_id);

-- Other tables
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_supplier_id ON supplier_catalog (supplier_id);
-- Existence guard (PR #322): yeast_pitch_events existed only out-of-band in
-- live when this ran; a from-scratch replay creates it in 00158. The index is
-- re-stated idempotently in 00199 so both histories converge.
DO $$ BEGIN
  IF to_regclass('public.yeast_pitch_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_yeast_pitch_events_created_by ON yeast_pitch_events (created_by);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_deliveries_created_by ON deliveries (created_by);
CREATE INDEX IF NOT EXISTS idx_deliveries_updated_by ON deliveries (updated_by);
