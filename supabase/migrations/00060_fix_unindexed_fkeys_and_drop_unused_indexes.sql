-- ============================================================
-- Part 1: Add indexes for unindexed foreign keys
-- ============================================================

-- allocations
CREATE INDEX IF NOT EXISTS idx_allocations_approved_by ON public.allocations (approved_by);
CREATE INDEX IF NOT EXISTS idx_allocations_created_by ON public.allocations (created_by);

-- allocations_legacy
CREATE INDEX IF NOT EXISTS idx_allocations_legacy_created_by ON public.allocations_legacy (created_by);

-- batch_logs
CREATE INDEX IF NOT EXISTS idx_batch_logs_created_by ON public.batch_logs (created_by);

-- batches
CREATE INDEX IF NOT EXISTS idx_batches_archived_by ON public.batches (archived_by);
CREATE INDEX IF NOT EXISTS idx_batches_cancelled_by ON public.batches (cancelled_by);

-- finished_goods
CREATE INDEX IF NOT EXISTS idx_finished_goods_created_by ON public.finished_goods (created_by);
CREATE INDEX IF NOT EXISTS idx_finished_goods_package_type_id ON public.finished_goods (package_type_id);
CREATE INDEX IF NOT EXISTS idx_finished_goods_session_line_item_id ON public.finished_goods (session_line_item_id);

-- inventory_lots
CREATE INDEX IF NOT EXISTS idx_inventory_lots_po_receive_id ON public.inventory_lots (po_receive_id);

-- keg_inventory
-- HISTORICAL NO-OP: keg_inventory has been a VIEW since 00032; indexes on
-- views are impossible, so this failed on every environment. Commented out
-- so a from-scratch replay reproduces the live state. See PR #322.
-- CREATE INDEX IF NOT EXISTS idx_keg_inventory_finished_good_id ON public.keg_inventory (finished_good_id);

-- keg_transactions
-- DRIFT SHIM (added retroactively — see PR #322): from_location_id,
-- to_location_id, and packaging_session_id were added to keg_transactions
-- directly in the live DB (no migration captured the ALTER); the indexes
-- below assume they exist. No-op on live.
ALTER TABLE public.keg_transactions
  ADD COLUMN IF NOT EXISTS from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packaging_session_id UUID REFERENCES packaging_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_keg_transactions_finished_good_id ON public.keg_transactions (finished_good_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_from_location_id ON public.keg_transactions (from_location_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_packaging_session_id ON public.keg_transactions (packaging_session_id);
CREATE INDEX IF NOT EXISTS idx_keg_transactions_to_location_id ON public.keg_transactions (to_location_id);

-- location_transfers
CREATE INDEX IF NOT EXISTS idx_location_transfers_received_by ON public.location_transfers (received_by);
CREATE INDEX IF NOT EXISTS idx_location_transfers_shipped_by ON public.location_transfers (shipped_by);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_batch_id ON public.order_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_order_items_package_id ON public.order_items (package_id);
CREATE INDEX IF NOT EXISTS idx_order_items_package_type_id ON public.order_items (package_type_id);

-- packages
CREATE INDEX IF NOT EXISTS idx_packages_package_type_id ON public.packages (package_type_id);

-- packaging_sessions
CREATE INDEX IF NOT EXISTS idx_packaging_sessions_created_by ON public.packaging_sessions (created_by);

-- po_receives
CREATE INDEX IF NOT EXISTS idx_po_receives_received_by ON public.po_receives (received_by);

-- purchase_orders
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON public.purchase_orders (created_by);

-- recipe_additions
CREATE INDEX IF NOT EXISTS idx_recipe_additions_additive_id ON public.recipe_additions (additive_id);

-- recipe_adjuncts
CREATE INDEX IF NOT EXISTS idx_recipe_adjuncts_adjunct_id ON public.recipe_adjuncts (adjunct_id);

-- recipe_collaborators
CREATE INDEX IF NOT EXISTS idx_recipe_collaborators_user_id ON public.recipe_collaborators (user_id);

-- recipe_fruits
CREATE INDEX IF NOT EXISTS idx_recipe_fruits_fruit_id ON public.recipe_fruits (fruit_id);

-- recipe_spices
CREATE INDEX IF NOT EXISTS idx_recipe_spices_spice_id ON public.recipe_spices (spice_id);

-- recipe_sugars
CREATE INDEX IF NOT EXISTS idx_recipe_sugars_sugar_id ON public.recipe_sugars (sugar_id);

-- recipes
CREATE INDEX IF NOT EXISTS idx_recipes_created_by ON public.recipes (created_by);
CREATE INDEX IF NOT EXISTS idx_recipes_water_profile_id ON public.recipes (water_profile_id);
CREATE INDEX IF NOT EXISTS idx_recipes_yeast_id ON public.recipes (yeast_id);

-- session_line_items
CREATE INDEX IF NOT EXISTS idx_session_line_items_brand_id ON public.session_line_items (brand_id);
CREATE INDEX IF NOT EXISTS idx_session_line_items_package_type_id ON public.session_line_items (package_type_id);

-- transfer_lines
CREATE INDEX IF NOT EXISTS idx_transfer_lines_finished_good_id ON public.transfer_lines (finished_good_id);

-- user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_invited_by ON public.user_profiles (invited_by);

-- vessel_cleanings
CREATE INDEX IF NOT EXISTS idx_vessel_cleanings_cleaned_by ON public.vessel_cleanings (cleaned_by);

-- vessel_transfers
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_transferred_by ON public.vessel_transfers (transferred_by);

-- yeast_pitches
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_created_by ON public.yeast_pitches (created_by);

-- ============================================================
-- Part 2: Drop unused indexes
-- (tier_prices_no_overlap skipped - it backs a constraint)
-- ============================================================

-- allocations_legacy
DROP INDEX IF EXISTS public.idx_allocations_reference;

-- recipes (trigram)
DROP INDEX IF EXISTS public.idx_recipes_name_trgm;

-- customers (trigram)
DROP INDEX IF EXISTS public.idx_customers_name_trgm;

-- packages
DROP INDEX IF EXISTS public.idx_packages_batch;

-- inventory_items
DROP INDEX IF EXISTS public.idx_inventory_items_name_trgm;
DROP INDEX IF EXISTS public.idx_inventory_items_category;
DROP INDEX IF EXISTS public.idx_inventory_items_name_lower;
DROP INDEX IF EXISTS public.idx_inventory_items_name;
DROP INDEX IF EXISTS public.idx_inventory_items_active;

-- malts
DROP INDEX IF EXISTS public.idx_malts_name_trgm;
DROP INDEX IF EXISTS public.idx_malts_type;
DROP INDEX IF EXISTS public.idx_malts_maltster;

-- hops
DROP INDEX IF EXISTS public.idx_hops_name_trgm;
DROP INDEX IF EXISTS public.idx_hops_type;
DROP INDEX IF EXISTS public.idx_hops_origin;

-- yeasts
DROP INDEX IF EXISTS public.idx_yeasts_name_trgm;
DROP INDEX IF EXISTS public.idx_yeasts_manufacturer;
DROP INDEX IF EXISTS public.idx_yeasts_type;

-- tier_prices
DROP INDEX IF EXISTS public.idx_tier_prices_tier;
DROP INDEX IF EXISTS public.idx_tier_prices_format;
DROP INDEX IF EXISTS public.idx_tier_prices_brand;
DROP INDEX IF EXISTS public.idx_tier_prices_style;
DROP INDEX IF EXISTS public.idx_tier_prices_effective;
DROP INDEX IF EXISTS public.idx_tier_prices_effective_dates;

-- vessels
DROP INDEX IF EXISTS public.idx_vessels_type;
DROP INDEX IF EXISTS public.idx_vessels_location;
DROP INDEX IF EXISTS public.idx_vessels_current_batch;
DROP INDEX IF EXISTS public.idx_vessels_status;
DROP INDEX IF EXISTS public.idx_vessels_type_status;

-- orders
DROP INDEX IF EXISTS public.idx_orders_customer;
DROP INDEX IF EXISTS public.idx_orders_status;
DROP INDEX IF EXISTS public.idx_orders_planning;
DROP INDEX IF EXISTS public.idx_orders_requested_date;
DROP INDEX IF EXISTS public.idx_orders_status_date;

-- price_tiers
DROP INDEX IF EXISTS public.idx_price_tiers_default;
DROP INDEX IF EXISTS public.idx_price_tiers_channel;

-- order_items
DROP INDEX IF EXISTS public.idx_order_items_order;
DROP INDEX IF EXISTS public.idx_order_items_brand_package;
DROP INDEX IF EXISTS public.idx_order_items_brand;

-- brew_logs
DROP INDEX IF EXISTS public.idx_brew_logs_date;
DROP INDEX IF EXISTS public.idx_brew_logs_recipe;
DROP INDEX IF EXISTS public.idx_brew_logs_brewer;
DROP INDEX IF EXISTS public.idx_brew_logs_brew_date;

-- batches
DROP INDEX IF EXISTS public.idx_batches_status;
DROP INDEX IF EXISTS public.idx_batches_planned_start;
DROP INDEX IF EXISTS public.idx_batches_planning;
DROP INDEX IF EXISTS public.idx_batches_recipe;
DROP INDEX IF EXISTS public.idx_batches_status_date;

-- brands
DROP INDEX IF EXISTS public.idx_brands_style;

-- recipes
DROP INDEX IF EXISTS public.idx_recipes_brand;
DROP INDEX IF EXISTS public.idx_recipes_brand_active;
DROP INDEX IF EXISTS public.idx_recipes_is_template;
DROP INDEX IF EXISTS public.idx_recipes_style;
DROP INDEX IF EXISTS public.idx_recipes_active;
DROP INDEX IF EXISTS public.idx_recipes_name;

-- packaging_sessions
DROP INDEX IF EXISTS public.idx_packaging_sessions_status;
DROP INDEX IF EXISTS public.idx_packaging_sessions_date;

-- session_line_items
DROP INDEX IF EXISTS public.idx_session_line_items_session;

-- finished_goods
DROP INDEX IF EXISTS public.idx_finished_goods_batch;
DROP INDEX IF EXISTS public.idx_finished_goods_brand;
DROP INDEX IF EXISTS public.idx_finished_goods_lot;
DROP INDEX IF EXISTS public.idx_finished_goods_expiration;

-- bins
DROP INDEX IF EXISTS public.idx_bins_location;
DROP INDEX IF EXISTS public.idx_bins_type;

-- bin_inventory
DROP INDEX IF EXISTS public.idx_bin_inventory_bin;
DROP INDEX IF EXISTS public.idx_bin_inventory_fg;

-- location_transfers
DROP INDEX IF EXISTS public.idx_location_transfers_status;
DROP INDEX IF EXISTS public.idx_location_transfers_from;
DROP INDEX IF EXISTS public.idx_location_transfers_to;

-- transfer_lines
DROP INDEX IF EXISTS public.idx_transfer_lines_transfer;

-- allocations
DROP INDEX IF EXISTS public.idx_allocations_destination;
DROP INDEX IF EXISTS public.idx_allocations_status_date;
DROP INDEX IF EXISTS public.idx_allocations_src_dest_status;
DROP INDEX IF EXISTS public.idx_allocations_pending_approval;

-- additives
DROP INDEX IF EXISTS public.idx_additives_type;

-- enum_values
DROP INDEX IF EXISTS public.idx_enum_values_type_active;

-- recipe_malts
DROP INDEX IF EXISTS public.idx_recipe_malts_recipe;
DROP INDEX IF EXISTS public.idx_recipe_malts_malt;

-- recipe_hops
DROP INDEX IF EXISTS public.idx_recipe_hops_hop;

-- recipe_adjuncts
DROP INDEX IF EXISTS public.idx_recipe_adjuncts_recipe;

-- recipe_sugars
DROP INDEX IF EXISTS public.idx_recipe_sugars_recipe;

-- recipe_spices
DROP INDEX IF EXISTS public.idx_recipe_spices_recipe;

-- recipe_fruits
DROP INDEX IF EXISTS public.idx_recipe_fruits_recipe;

-- recipe_additions
DROP INDEX IF EXISTS public.idx_recipe_additions_recipe;
DROP INDEX IF EXISTS public.idx_recipe_additions_default;

-- recipe_yeasts
DROP INDEX IF EXISTS public.idx_recipe_yeasts_recipe;
DROP INDEX IF EXISTS public.idx_recipe_yeasts_yeast;

-- keg_inventory
DROP INDEX IF EXISTS public.idx_keg_inventory_type;
DROP INDEX IF EXISTS public.idx_keg_inventory_state;
DROP INDEX IF EXISTS public.idx_keg_inventory_location;
DROP INDEX IF EXISTS public.idx_keg_inventory_batch;

-- keg_transactions
DROP INDEX IF EXISTS public.idx_keg_transactions_keg_type;
DROP INDEX IF EXISTS public.idx_keg_transactions_created_at;
DROP INDEX IF EXISTS public.idx_keg_transactions_customer;
DROP INDEX IF EXISTS public.idx_keg_transactions_order;
DROP INDEX IF EXISTS public.idx_keg_transactions_batch;

-- purchase_orders
DROP INDEX IF EXISTS public.idx_purchase_orders_status;
DROP INDEX IF EXISTS public.idx_purchase_orders_supplier;

-- po_receives
DROP INDEX IF EXISTS public.idx_po_receives_line_item;

-- supplier_catalog
DROP INDEX IF EXISTS public.idx_supplier_catalog_preferred;
DROP INDEX IF EXISTS public.idx_supplier_catalog_catalog_lookup;

-- package_types
DROP INDEX IF EXISTS public.idx_package_types_name;

-- notifications
DROP INDEX IF EXISTS public.idx_notifications_created_at;
DROP INDEX IF EXISTS public.idx_notifications_entity;
DROP INDEX IF EXISTS public.idx_notifications_expires;

-- vessel_transfers
DROP INDEX IF EXISTS public.idx_vessel_transfers_batch;
DROP INDEX IF EXISTS public.idx_vessel_transfers_to;
DROP INDEX IF EXISTS public.idx_vessel_transfers_from;
DROP INDEX IF EXISTS public.idx_vessel_transfers_date;
DROP INDEX IF EXISTS public.idx_vessel_transfers_from_vessel;

-- vessel_cleanings
DROP INDEX IF EXISTS public.idx_vessel_cleanings_vessel;
DROP INDEX IF EXISTS public.idx_vessel_cleanings_date;
DROP INDEX IF EXISTS public.idx_vessel_cleanings_type;

-- customers
DROP INDEX IF EXISTS public.idx_customers_sales_channel;
DROP INDEX IF EXISTS public.idx_customers_price_tier;
DROP INDEX IF EXISTS public.idx_customers_name;
DROP INDEX IF EXISTS public.idx_customers_active;

-- yeast_pitches
DROP INDEX IF EXISTS public.idx_yeast_pitches_strain;
DROP INDEX IF EXISTS public.idx_yeast_pitches_source_type;
DROP INDEX IF EXISTS public.idx_yeast_pitches_parent;
DROP INDEX IF EXISTS public.idx_yeast_pitches_batch;
DROP INDEX IF EXISTS public.idx_yeast_pitches_location;

-- entity_revisions
DROP INDEX IF EXISTS public.idx_entity_revisions_changed_at;
DROP INDEX IF EXISTS public.idx_entity_revisions_changed_by;

-- user_profiles
DROP INDEX IF EXISTS public.idx_user_profiles_email;
DROP INDEX IF EXISTS public.idx_user_profiles_role;
