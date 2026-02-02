-- Re-create FK-covering indexes that were erroneously dropped in previous migration,
-- plus add indexes for FKs that were never indexed.
-- Note: "unused index" advisories for FK-covering indexes are expected and should be
-- kept because they prevent full table scans on cascading deletes/updates.

-- batch_blends
CREATE INDEX IF NOT EXISTS idx_batch_blends_created_by ON public.batch_blends (created_by);

-- batches
CREATE INDEX IF NOT EXISTS idx_batches_recipe_id ON public.batches (recipe_id);

-- bin_inventory
CREATE INDEX IF NOT EXISTS idx_bin_inventory_bin_id ON public.bin_inventory (bin_id);

-- brew_logs
CREATE INDEX IF NOT EXISTS idx_brew_logs_brewer_id ON public.brew_logs (brewer_id);
CREATE INDEX IF NOT EXISTS idx_brew_logs_recipe_id ON public.brew_logs (recipe_id);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_price_tier_id ON public.customers (price_tier_id);
CREATE INDEX IF NOT EXISTS idx_customers_sales_channel_id ON public.customers (sales_channel_id);

-- finished_goods
CREATE INDEX IF NOT EXISTS idx_finished_goods_batch_id ON public.finished_goods (batch_id);
CREATE INDEX IF NOT EXISTS idx_finished_goods_brand_id ON public.finished_goods (brand_id);

-- keg_inventory
CREATE INDEX IF NOT EXISTS idx_keg_inventory_batch_id ON public.keg_inventory (batch_id);
CREATE INDEX IF NOT EXISTS idx_keg_inventory_location_id ON public.keg_inventory (location_id);

-- keg_transactions
CREATE INDEX IF NOT EXISTS idx_keg_transactions_batch_id ON public.keg_transactions (batch_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_customer_id ON public.keg_transactions (customer_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_keg_type_id ON public.keg_transactions (keg_type_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_order_id ON public.keg_transactions (order_id);

-- location_transfers
CREATE INDEX IF NOT EXISTS idx_location_transfers_from_bin_id ON public.location_transfers (from_bin_id);
CREATE INDEX IF NOT EXISTS idx_location_transfers_to_bin_id ON public.location_transfers (to_bin_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_brand_id ON public.order_items (brand_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);

-- packages
CREATE INDEX IF NOT EXISTS idx_packages_batch_id ON public.packages (batch_id);

-- pick_list_items
CREATE INDEX IF NOT EXISTS idx_pick_list_items_location_id ON public.pick_list_items (location_id);

-- pick_lists
CREATE INDEX IF NOT EXISTS idx_pick_lists_created_by ON public.pick_lists (created_by);

-- po_receives
CREATE INDEX IF NOT EXISTS idx_po_receives_po_line_item_id ON public.po_receives (po_line_item_id);

-- price_tiers
CREATE INDEX IF NOT EXISTS idx_price_tiers_sales_channel_id ON public.price_tiers (sales_channel_id);

-- purchase_orders
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders (supplier_id);

-- recipe_additions
CREATE INDEX IF NOT EXISTS idx_recipe_additions_recipe_id ON public.recipe_additions (recipe_id);

-- recipe_adjuncts
CREATE INDEX IF NOT EXISTS idx_recipe_adjuncts_recipe_id ON public.recipe_adjuncts (recipe_id);

-- recipe_fruits
CREATE INDEX IF NOT EXISTS idx_recipe_fruits_recipe_id ON public.recipe_fruits (recipe_id);

-- recipe_hops
CREATE INDEX IF NOT EXISTS idx_recipe_hops_hop_id ON public.recipe_hops (hop_id);

-- recipe_malts
CREATE INDEX IF NOT EXISTS idx_recipe_malts_malt_id ON public.recipe_malts (malt_id);
CREATE INDEX IF NOT EXISTS idx_recipe_malts_recipe_id ON public.recipe_malts (recipe_id);

-- recipe_spices
CREATE INDEX IF NOT EXISTS idx_recipe_spices_recipe_id ON public.recipe_spices (recipe_id);

-- recipe_sugars
CREATE INDEX IF NOT EXISTS idx_recipe_sugars_recipe_id ON public.recipe_sugars (recipe_id);

-- recipe_yeasts
CREATE INDEX IF NOT EXISTS idx_recipe_yeasts_yeast_id ON public.recipe_yeasts (yeast_id);

-- recipes
CREATE INDEX IF NOT EXISTS idx_recipes_brand_id ON public.recipes (brand_id);
CREATE INDEX IF NOT EXISTS idx_recipes_style_id ON public.recipes (style_id);

-- session_line_items
CREATE INDEX IF NOT EXISTS idx_session_line_items_session_id ON public.session_line_items (session_id);

-- tier_prices
CREATE INDEX IF NOT EXISTS idx_tier_prices_brand_id ON public.tier_prices (brand_id);
CREATE INDEX IF NOT EXISTS idx_tier_prices_format_id ON public.tier_prices (format_id);
CREATE INDEX IF NOT EXISTS idx_tier_prices_style_id ON public.tier_prices (style_id);

-- transfer_lines
CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer_id ON public.transfer_lines (transfer_id);

-- vessel_cleanings
CREATE INDEX IF NOT EXISTS idx_vessel_cleanings_vessel_id ON public.vessel_cleanings (vessel_id);

-- vessel_transfers
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_batch_id ON public.vessel_transfers (batch_id);
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_from_vessel_id ON public.vessel_transfers (from_vessel_id);

-- vessels
CREATE INDEX IF NOT EXISTS idx_vessels_current_batch_id ON public.vessels (current_batch_id);
CREATE INDEX IF NOT EXISTS idx_vessels_location_id ON public.vessels (location_id);

-- yeast_pitches
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_batch_id ON public.yeast_pitches (batch_id);
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_location_id ON public.yeast_pitches (location_id);
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_parent_pitch_id ON public.yeast_pitches (parent_pitch_id);
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_strain_id ON public.yeast_pitches (strain_id);
