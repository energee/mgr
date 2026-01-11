-- Performance Indexes Migration
-- Implements DEC-HP-004: Comprehensive indexes for common query patterns
--
-- This migration adds indexes for:
-- - Batch queries (status, dates)
-- - Order fulfillment (status, customer, dates)
-- - Vessel operations
-- - Brew log queries
-- - Inventory lookups

-- =============================================================================
-- BATCH INDEXES
-- =============================================================================

-- Status-based queries (dashboard, filtering)
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);

-- Date-based queries (scheduling, calendar)
CREATE INDEX IF NOT EXISTS idx_batches_planned_date ON batches(planned_start_date)
  WHERE planned_start_date IS NOT NULL;

-- Recipe lookups
CREATE INDEX IF NOT EXISTS idx_batches_recipe ON batches(recipe_id)
  WHERE recipe_id IS NOT NULL;

-- Composite: status + date for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_batches_status_date ON batches(status, planned_start_date);

-- =============================================================================
-- ORDER INDEXES
-- =============================================================================

-- Status-based filtering
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Customer lookups
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- Date-based queries (fulfillment planning)
CREATE INDEX IF NOT EXISTS idx_orders_requested_date ON orders(requested_date)
  WHERE requested_date IS NOT NULL;

-- Composite: status + date for order pipeline
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, requested_date);

-- =============================================================================
-- CUSTOMER INDEXES
-- =============================================================================

-- Name search
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Active customers
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active)
  WHERE is_active = true;

-- =============================================================================
-- VESSEL INDEXES
-- =============================================================================

-- Status for availability queries
CREATE INDEX IF NOT EXISTS idx_vessels_status ON vessels(status);

-- Type for capacity planning
CREATE INDEX IF NOT EXISTS idx_vessels_type ON vessels(vessel_type);

-- Location for physical inventory
CREATE INDEX IF NOT EXISTS idx_vessels_location ON vessels(location_id)
  WHERE location_id IS NOT NULL;

-- Composite: type + status for finding available vessels
CREATE INDEX IF NOT EXISTS idx_vessels_type_status ON vessels(vessel_type, status);

-- =============================================================================
-- VESSEL TRANSFER INDEXES
-- =============================================================================

-- Critical for vessels_with_current_batch view (LATERAL subquery)
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_to_vessel ON vessel_transfers(to_vessel_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_from_vessel ON vessel_transfers(from_vessel_id, batch_id, transferred_at);

-- Batch history
CREATE INDEX IF NOT EXISTS idx_vessel_transfers_batch ON vessel_transfers(batch_id);

-- =============================================================================
-- BREW LOG INDEXES
-- =============================================================================

-- Status filtering
CREATE INDEX IF NOT EXISTS idx_brew_logs_status ON brew_logs(status);

-- Date queries
CREATE INDEX IF NOT EXISTS idx_brew_logs_brew_date ON brew_logs(brew_date)
  WHERE brew_date IS NOT NULL;

-- Recipe lookups
CREATE INDEX IF NOT EXISTS idx_brew_logs_recipe ON brew_logs(recipe_id)
  WHERE recipe_id IS NOT NULL;

-- =============================================================================
-- BREW LOG BATCHES INDEXES
-- =============================================================================

-- Find batches for a brew log
CREATE INDEX IF NOT EXISTS idx_brew_log_batches_brew ON brew_log_batches(brew_log_id);

-- Find brew logs for a batch
CREATE INDEX IF NOT EXISTS idx_brew_log_batches_batch ON brew_log_batches(batch_id);

-- =============================================================================
-- RECIPE INDEXES
-- =============================================================================

-- Style filtering
CREATE INDEX IF NOT EXISTS idx_recipes_style ON recipes(style_id)
  WHERE style_id IS NOT NULL;

-- Brand filtering
CREATE INDEX IF NOT EXISTS idx_recipes_brand ON recipes(brand_id)
  WHERE brand_id IS NOT NULL;

-- Active recipes
CREATE INDEX IF NOT EXISTS idx_recipes_active ON recipes(is_active)
  WHERE is_active = true;

-- Name search
CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes(name);

-- =============================================================================
-- INVENTORY ITEM INDEXES
-- =============================================================================

-- Category filtering
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);

-- Name search
CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(name);

-- Active items
CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items(is_active)
  WHERE is_active = true;

-- =============================================================================
-- BRAND INDEXES
-- =============================================================================

-- Style filtering
CREATE INDEX IF NOT EXISTS idx_brands_style ON brands(style_id)
  WHERE style_id IS NOT NULL;

-- Name search
CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

-- =============================================================================
-- PACKAGE TYPE INDEXES
-- =============================================================================

-- Name lookup
CREATE INDEX IF NOT EXISTS idx_package_types_name ON package_types(name);

-- =============================================================================
-- TEXT SEARCH INDEXES (for fuzzy search)
-- =============================================================================

-- GIN indexes for text search on common search fields
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_recipes_name_trgm ON recipes USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inventory_items_name_trgm ON inventory_items USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_malts_name_trgm ON malts USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_hops_name_trgm ON hops USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_yeasts_name_trgm ON yeasts USING gin(name gin_trgm_ops);

SELECT 'Performance indexes migration complete!' AS message;
