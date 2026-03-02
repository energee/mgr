-- Add missing indexes on foreign key columns identified in the productionization audit.
-- These indexes improve JOIN performance and prevent sequential scans on FK lookups.

-- Keg tables (from 00079)
CREATE INDEX IF NOT EXISTS idx_keg_owner_deposits_keg_type_id ON keg_owner_deposits(keg_type_id);
CREATE INDEX IF NOT EXISTS idx_keg_inventory_keg_owner_id ON keg_inventory(keg_owner_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_keg_owner_id ON keg_transactions(keg_owner_id);

-- Order change requests (from 00089)
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_order_item_id ON order_change_request_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_brand_id ON order_change_request_items(brand_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_package_type_id ON order_change_request_items(package_type_id);
CREATE INDEX IF NOT EXISTS idx_order_change_request_items_keg_type_id ON order_change_request_items(keg_type_id);
CREATE INDEX IF NOT EXISTS idx_order_change_requests_reviewed_by ON order_change_requests(reviewed_by);

-- Recipe variant ingredient tables (from 00082)
CREATE INDEX IF NOT EXISTS idx_recipe_variant_hops_hop_id ON recipe_variant_hops(hop_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_adjuncts_adjunct_id ON recipe_variant_adjuncts(adjunct_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_fruits_fruit_id ON recipe_variant_fruits(fruit_id);
CREATE INDEX IF NOT EXISTS idx_recipe_variant_spices_spice_id ON recipe_variant_spices(spice_id);

-- Square integration (from 00088)
CREATE INDEX IF NOT EXISTS idx_square_catalog_map_package_type_id ON square_catalog_map(package_type_id);
CREATE INDEX IF NOT EXISTS idx_square_catalog_map_keg_type_id ON square_catalog_map(keg_type_id);
CREATE INDEX IF NOT EXISTS idx_square_sync_log_location_id ON square_sync_log(location_id);
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_brand_id ON square_draft_sales(brand_id);
CREATE INDEX IF NOT EXISTS idx_square_draft_sales_keg_type_id ON square_draft_sales(keg_type_id);

-- Supplier catalog (from 00010, missed by earlier FK-index sweeps)
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_supplier_id ON supplier_catalog(supplier_id);

-- Yeast pitch events (from 00095)
CREATE INDEX IF NOT EXISTS idx_yeast_pitch_events_created_by ON yeast_pitch_events(created_by);

-- Deliveries audit columns (from 00073)
CREATE INDEX IF NOT EXISTS idx_deliveries_created_by ON deliveries(created_by);
CREATE INDEX IF NOT EXISTS idx_deliveries_updated_by ON deliveries(updated_by);
