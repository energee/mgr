-- Migration: 00013_rls_performance_fix.sql
-- Purpose: Fix RLS policy performance issues and remove duplicate index
--
-- Issues addressed:
-- 1. auth_rls_initplan warnings: RLS policies re-evaluating auth.uid() for each row
--    Fix: Wrap auth.uid() in (SELECT ...) to make it an InitPlan (evaluated once)
-- 2. duplicate_index warning: idx_brew_log_batches_brew and idx_brew_log_batches_brew_log
--    both index brew_log_batches(brew_log_id)
--
-- Reference: DEC-PERF-004 in docs/spec/architecture.md

-- =============================================================================
-- DROP DUPLICATE INDEX
-- =============================================================================

-- idx_brew_log_batches_brew_log was created in 00004_brew_logs.sql
-- idx_brew_log_batches_brew was created in 00012_performance_indexes.sql
-- Both index the same column (brew_log_id), so we drop the duplicate
DROP INDEX IF EXISTS idx_brew_log_batches_brew;

-- =============================================================================
-- FIX RLS POLICIES - Core Tables (00002_single_tenant.sql)
-- =============================================================================

-- settings
DROP POLICY IF EXISTS settings_access ON settings;
CREATE POLICY settings_access ON settings
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipes
DROP POLICY IF EXISTS recipe_access ON recipes;
CREATE POLICY recipe_access ON recipes
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- batches
DROP POLICY IF EXISTS batch_access ON batches;
CREATE POLICY batch_access ON batches
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- batch_logs
DROP POLICY IF EXISTS batch_log_access ON batch_logs;
CREATE POLICY batch_log_access ON batch_logs
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- inventory_items
DROP POLICY IF EXISTS inventory_item_access ON inventory_items;
CREATE POLICY inventory_item_access ON inventory_items
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- allocations_legacy
DROP POLICY IF EXISTS allocation_access ON allocations_legacy;
CREATE POLICY allocation_access ON allocations_legacy
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- package_types
DROP POLICY IF EXISTS package_type_access ON package_types;
CREATE POLICY package_type_access ON package_types
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- packages
DROP POLICY IF EXISTS package_access ON packages;
CREATE POLICY package_access ON packages
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- customers
DROP POLICY IF EXISTS customer_access ON customers;
CREATE POLICY customer_access ON customers
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- orders
DROP POLICY IF EXISTS order_access ON orders;
CREATE POLICY order_access ON orders
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- order_items
DROP POLICY IF EXISTS order_item_access ON order_items;
CREATE POLICY order_item_access ON order_items
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- FIX RLS POLICIES - Brands (00003_brands.sql)
-- =============================================================================

DROP POLICY IF EXISTS brand_access ON brands;
CREATE POLICY brand_access ON brands
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- FIX RLS POLICIES - Brew Logs (00004_brew_logs.sql)
-- =============================================================================

DROP POLICY IF EXISTS brew_log_access ON brew_logs;
CREATE POLICY brew_log_access ON brew_logs
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS brew_log_batch_access ON brew_log_batches;
CREATE POLICY brew_log_batch_access ON brew_log_batches
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- FIX RLS POLICIES - Vessels (00006_vessels.sql)
-- =============================================================================

DROP POLICY IF EXISTS location_access ON locations;
CREATE POLICY location_access ON locations
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS vessel_access ON vessels;
CREATE POLICY vessel_access ON vessels
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS vessel_transfer_access ON vessel_transfers;
CREATE POLICY vessel_transfer_access ON vessel_transfers
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS vessel_cleaning_access ON vessel_cleanings;
CREATE POLICY vessel_cleaning_access ON vessel_cleanings
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- FIX RLS POLICIES - User Preferences (00009_user_preferences_and_units.sql)
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own preferences" ON user_preferences;
CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;
CREATE POLICY "Users can update own preferences" ON user_preferences
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- FIX RLS POLICIES - Unified Allocations (00010_unified_allocations.sql)
-- =============================================================================

-- suppliers
DROP POLICY IF EXISTS suppliers_access ON suppliers;
CREATE POLICY suppliers_access ON suppliers
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- supplier_catalog
DROP POLICY IF EXISTS supplier_catalog_access ON supplier_catalog;
CREATE POLICY supplier_catalog_access ON supplier_catalog
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- purchase_orders
DROP POLICY IF EXISTS purchase_orders_access ON purchase_orders;
CREATE POLICY purchase_orders_access ON purchase_orders
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- po_line_items
DROP POLICY IF EXISTS po_line_items_access ON po_line_items;
CREATE POLICY po_line_items_access ON po_line_items
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- po_receives
DROP POLICY IF EXISTS po_receives_access ON po_receives;
CREATE POLICY po_receives_access ON po_receives
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- inventory_lots
DROP POLICY IF EXISTS inventory_lots_access ON inventory_lots;
CREATE POLICY inventory_lots_access ON inventory_lots
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- packaging_sessions
DROP POLICY IF EXISTS packaging_sessions_access ON packaging_sessions;
CREATE POLICY packaging_sessions_access ON packaging_sessions
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- session_line_items
DROP POLICY IF EXISTS session_line_items_access ON session_line_items;
CREATE POLICY session_line_items_access ON session_line_items
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- finished_goods
DROP POLICY IF EXISTS finished_goods_access ON finished_goods;
CREATE POLICY finished_goods_access ON finished_goods
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- bins
DROP POLICY IF EXISTS bins_access ON bins;
CREATE POLICY bins_access ON bins
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- bin_inventory
DROP POLICY IF EXISTS bin_inventory_access ON bin_inventory;
CREATE POLICY bin_inventory_access ON bin_inventory
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- location_transfers
DROP POLICY IF EXISTS location_transfers_access ON location_transfers;
CREATE POLICY location_transfers_access ON location_transfers
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- transfer_lines
DROP POLICY IF EXISTS transfer_lines_access ON transfer_lines;
CREATE POLICY transfer_lines_access ON transfer_lines
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- allocations (new unified table)
DROP POLICY IF EXISTS allocations_access ON allocations;
CREATE POLICY allocations_access ON allocations
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- FIX RLS POLICIES - Catalog Tables (00011_catalog_and_recipe_junction.sql)
-- =============================================================================

-- beer_styles
DROP POLICY IF EXISTS beer_styles_access ON beer_styles;
CREATE POLICY beer_styles_access ON beer_styles
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- yeasts
DROP POLICY IF EXISTS yeasts_access ON yeasts;
CREATE POLICY yeasts_access ON yeasts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- malts
DROP POLICY IF EXISTS malts_access ON malts;
CREATE POLICY malts_access ON malts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- hops
DROP POLICY IF EXISTS hops_access ON hops;
CREATE POLICY hops_access ON hops
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- adjuncts
DROP POLICY IF EXISTS adjuncts_access ON adjuncts;
CREATE POLICY adjuncts_access ON adjuncts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- sugars
DROP POLICY IF EXISTS sugars_access ON sugars;
CREATE POLICY sugars_access ON sugars
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- spices
DROP POLICY IF EXISTS spices_access ON spices;
CREATE POLICY spices_access ON spices
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- fruits
DROP POLICY IF EXISTS fruits_access ON fruits;
CREATE POLICY fruits_access ON fruits
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- additives
DROP POLICY IF EXISTS additives_access ON additives;
CREATE POLICY additives_access ON additives
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- water_profiles
DROP POLICY IF EXISTS water_profiles_access ON water_profiles;
CREATE POLICY water_profiles_access ON water_profiles
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_malts
DROP POLICY IF EXISTS recipe_malts_access ON recipe_malts;
CREATE POLICY recipe_malts_access ON recipe_malts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_hops
DROP POLICY IF EXISTS recipe_hops_access ON recipe_hops;
CREATE POLICY recipe_hops_access ON recipe_hops
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_adjuncts
DROP POLICY IF EXISTS recipe_adjuncts_access ON recipe_adjuncts;
CREATE POLICY recipe_adjuncts_access ON recipe_adjuncts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_sugars
DROP POLICY IF EXISTS recipe_sugars_access ON recipe_sugars;
CREATE POLICY recipe_sugars_access ON recipe_sugars
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_spices
DROP POLICY IF EXISTS recipe_spices_access ON recipe_spices;
CREATE POLICY recipe_spices_access ON recipe_spices
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_fruits
DROP POLICY IF EXISTS recipe_fruits_access ON recipe_fruits;
CREATE POLICY recipe_fruits_access ON recipe_fruits
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_additions
DROP POLICY IF EXISTS recipe_additions_access ON recipe_additions;
CREATE POLICY recipe_additions_access ON recipe_additions
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- recipe_collaborators
DROP POLICY IF EXISTS recipe_collaborators_access ON recipe_collaborators;
CREATE POLICY recipe_collaborators_access ON recipe_collaborators
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- DONE
-- =============================================================================

SELECT 'RLS performance fix migration complete! Fixed 52 policies and removed 1 duplicate index.' AS message;
