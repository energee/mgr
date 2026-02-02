-- =============================================================================
-- Migration 00059: RLS InitPlan Optimization & Duplicate Index Cleanup
-- =============================================================================
-- Addresses Supabase performance advisory warnings:
-- 1. auth_rls_initplan: Wrap auth.uid() in (SELECT ...) to avoid per-row re-evaluation
-- 2. multiple_permissive_policies: Consolidate overlapping policies on enum_values and user_profiles
-- 3. duplicate_index: Drop redundant indexes on recipe junction tables
-- =============================================================================

-- =============================================================================
-- PART A: Fix auth_rls_initplan warnings
-- =============================================================================
-- Replace policies that use auth.uid() directly with (SELECT auth.uid())
-- so Postgres evaluates it once as an InitPlan rather than per-row.

-- A1: sales_channels
DROP POLICY IF EXISTS sales_channels_access ON sales_channels;
CREATE POLICY sales_channels_access ON sales_channels
  FOR ALL
  USING ((SELECT auth.uid()) IS NOT NULL);

-- A2: price_tiers
DROP POLICY IF EXISTS price_tiers_access ON price_tiers;
CREATE POLICY price_tiers_access ON price_tiers
  FOR ALL
  USING ((SELECT auth.uid()) IS NOT NULL);

-- A3: tier_prices
DROP POLICY IF EXISTS tier_prices_access ON tier_prices;
CREATE POLICY tier_prices_access ON tier_prices
  FOR ALL
  USING ((SELECT auth.uid()) IS NOT NULL);

-- A4: yeast_pitches
DROP POLICY IF EXISTS yeast_pitches_access ON yeast_pitches;
CREATE POLICY yeast_pitches_access ON yeast_pitches
  FOR ALL
  USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- PART B: Fix multiple_permissive_policies + initplan on user_profiles
-- =============================================================================
-- Issues:
--   - user_profiles_select uses auth.uid() without SELECT wrapper
--   - user_profiles_update_own and user_profiles_update_admin are both
--     permissive FOR UPDATE, causing multiple policy evaluation
--   - user_profiles_insert_admin uses auth.uid() without SELECT wrapper
--
-- Fix: Recreate all policies with (SELECT auth.uid()) and consolidate
-- the two UPDATE policies into one that handles both cases.

DROP POLICY IF EXISTS user_profiles_select ON user_profiles;
CREATE POLICY user_profiles_select ON user_profiles
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS user_profiles_update_own ON user_profiles;
DROP POLICY IF EXISTS user_profiles_update_admin ON user_profiles;
CREATE POLICY user_profiles_update ON user_profiles
  FOR UPDATE
  USING (
    (SELECT auth.uid()) = id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS user_profiles_insert_admin ON user_profiles;
CREATE POLICY user_profiles_insert_admin ON user_profiles
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- =============================================================================
-- PART C: Fix multiple_permissive_policies + initplan on enum_values
-- =============================================================================
-- Issues:
--   - enum_values_select (FOR SELECT) and enum_values_modify (FOR ALL)
--     overlap on SELECT, creating multiple permissive policies
--   - Both use auth.uid() without SELECT wrapper
--
-- Fix: Drop both. Recreate with separate per-action policies:
--   - SELECT: all authenticated users
--   - INSERT/UPDATE/DELETE: admin only

DROP POLICY IF EXISTS enum_values_select ON enum_values;
DROP POLICY IF EXISTS enum_values_modify ON enum_values;

CREATE POLICY enum_values_select ON enum_values
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY enum_values_insert ON enum_values
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY enum_values_update ON enum_values
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY enum_values_delete ON enum_values
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- =============================================================================
-- PART D: Drop duplicate indexes on recipe junction tables
-- =============================================================================
-- Migration 00011 created idx_recipe_*_recipe and migration 00053 created
-- idx_recipe_*_recipe_id on the same columns. Drop the duplicates from 00053.

DROP INDEX IF EXISTS idx_recipe_adjuncts_recipe_id;
DROP INDEX IF EXISTS idx_recipe_fruits_recipe_id;
DROP INDEX IF EXISTS idx_recipe_hops_recipe_id;
DROP INDEX IF EXISTS idx_recipe_malts_recipe_id;
DROP INDEX IF EXISTS idx_recipe_spices_recipe_id;
DROP INDEX IF EXISTS idx_recipe_sugars_recipe_id;
