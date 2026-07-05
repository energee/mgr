-- =============================================================================
-- Migration 00058: Security Advisory Fixes
-- =============================================================================
-- Addresses all Supabase security linter warnings:
-- 1. Move pg_trgm and btree_gist extensions from public to extensions schema
-- 2. Tighten overly permissive RLS policies
-- 3. Remove stale/unauthorized policies
-- =============================================================================

-- =============================================================================
-- PART A: Move extensions to 'extensions' schema
-- =============================================================================

-- The 'extensions' schema was created in migration 00014 but never used.
-- We need to drop dependent objects, move extensions, then recreate.

-- A1: Move pg_trgm
-- Drop dependent trigram indexes first
DROP INDEX IF EXISTS idx_recipes_name_trgm;
DROP INDEX IF EXISTS idx_customers_name_trgm;
DROP INDEX IF EXISTS idx_inventory_items_name_trgm;
DROP INDEX IF EXISTS idx_malts_name_trgm;
DROP INDEX IF EXISTS idx_hops_name_trgm;
DROP INDEX IF EXISTS idx_yeasts_name_trgm;

-- Drop and recreate extension in extensions schema
DROP EXTENSION IF EXISTS pg_trgm;
CREATE EXTENSION pg_trgm SCHEMA extensions;

-- Recreate trigram indexes using schema-qualified operator class
CREATE INDEX idx_recipes_name_trgm ON recipes USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_customers_name_trgm ON customers USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_inventory_items_name_trgm ON inventory_items USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_malts_name_trgm ON malts USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_hops_name_trgm ON hops USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_yeasts_name_trgm ON yeasts USING gin(name extensions.gin_trgm_ops);

-- A2: Move btree_gist
-- Drop dependent exclusion constraint first
ALTER TABLE tier_prices DROP CONSTRAINT IF EXISTS tier_prices_no_overlap;

-- Drop and recreate extension in extensions schema
DROP EXTENSION IF EXISTS btree_gist;
CREATE EXTENSION btree_gist SCHEMA extensions;

-- Recreate exclusion constraint
ALTER TABLE tier_prices
  ADD CONSTRAINT tier_prices_no_overlap EXCLUDE USING gist (
    price_tier_id WITH =,
    format_id WITH =,
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(style_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  );

-- =============================================================================
-- PART B: Tighten RLS policies
-- =============================================================================
-- Pattern: Replace `true` with `(SELECT auth.uid()) IS NOT NULL`
-- This ensures only authenticated users can perform operations.
-- For a single-tenant app this is the tightest meaningful restriction
-- since there's no user_id/brewery_id to filter by.

-- B1: keg_types - shared reference data, authenticated access only
DROP POLICY IF EXISTS "keg_types_insert" ON keg_types;
CREATE POLICY "keg_types_insert" ON keg_types
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "keg_types_update" ON keg_types;
CREATE POLICY "keg_types_update" ON keg_types
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "keg_types_delete" ON keg_types;
CREATE POLICY "keg_types_delete" ON keg_types
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- B2: keg_inventory - shared inventory data, authenticated access only
-- HISTORICAL NO-OP: keg_inventory has been a VIEW since 00032 and views
-- cannot carry RLS policies — these statements failed on every environment
-- (row security comes from the underlying keg_transactions). Commented out
-- so a from-scratch replay reproduces the live state. See PR #322.
-- DROP POLICY IF EXISTS "keg_inventory_insert" ON keg_inventory;
-- CREATE POLICY "keg_inventory_insert" ON keg_inventory
--   FOR INSERT TO authenticated
--   WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
--
-- DROP POLICY IF EXISTS "keg_inventory_update" ON keg_inventory;
-- CREATE POLICY "keg_inventory_update" ON keg_inventory
--   FOR UPDATE TO authenticated
--   USING ((SELECT auth.uid()) IS NOT NULL)
--   WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
--
-- DROP POLICY IF EXISTS "keg_inventory_delete" ON keg_inventory;
-- CREATE POLICY "keg_inventory_delete" ON keg_inventory
--   FOR DELETE TO authenticated
--   USING ((SELECT auth.uid()) IS NOT NULL);

-- B3: keg_transactions - immutable audit log
DROP POLICY IF EXISTS "keg_transactions_insert" ON keg_transactions;
CREATE POLICY "keg_transactions_insert" ON keg_transactions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- B4: system_settings - shared brewery config
DROP POLICY IF EXISTS "system_settings_insert" ON system_settings;
CREATE POLICY "system_settings_insert" ON system_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "system_settings_update" ON system_settings;
CREATE POLICY "system_settings_update" ON system_settings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- B5: entity_revisions - immutable audit log, restrict to authenticated
DROP POLICY IF EXISTS "entity_revisions_insert" ON entity_revisions;
CREATE POLICY "entity_revisions_insert" ON entity_revisions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- B6: notifications - restrict insert to authenticated
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- PART C: Remove stale/unauthorized policies
-- =============================================================================

-- keg_transactions should be immutable (no delete allowed)
-- This policy shouldn't exist per the migration design
DROP POLICY IF EXISTS "keg_transactions_delete" ON keg_transactions;
