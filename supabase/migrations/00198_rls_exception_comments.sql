-- Migration: 00198_rls_exception_comments
--
-- Documents every deliberately-permissive RLS policy in `public` with an
-- inline `COMMENT ON POLICY ... IS 'RLS-EXCEPTION: <reason>'` marker.
--
-- Task 8 of `docs/plans/2026-05-19-rls-single-source-of-truth-plan.md`.
--
-- The integration test `src/__tests__/integration/rls-coverage.test.ts` queries
-- `pg_policies` joined to `pg_description` for any policy whose `qual` or
-- `with_check` is `true` or `(auth.uid() IS NOT NULL)` (either the direct form
-- or the Supabase init-plan form `(( SELECT auth.uid() AS uid) IS NOT NULL)`),
-- and fails CI if any such policy lacks an `RLS-EXCEPTION:`-prefixed comment.
--
-- Per-policy comments instead of an allowlist file because:
--   * The comment lives next to the policy. Drop the policy and the
--     comment goes with it, so a replacement permissive policy fails the
--     guardrail until a new comment is added.
--   * No risk of a comment file silently going out of sync with the schema.
--
-- Every category below explains WHY the policy bypasses role-based auth and
-- which boundary still protects the data.
--
-- PR #322: every COMMENT below is guarded on the policy actually existing.
-- Live has drifted out-of-band since the audit (package_types and
-- water_addition_profiles were dropped entirely), so unconditional COMMENTs
-- fail there; migrations-built databases still get full comment coverage.


-- ----------------------------------------------------------------------------
-- Self-documenting schema metadata
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = '_schema_registry' AND policyname = 'schema_registry_read') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'schema_registry_read', '_schema_registry', 'RLS-EXCEPTION: self-documenting schema metadata table; any authenticated user may SELECT for AI agents and tooling. No write policy exists — rows are seeded only by migrations.');
  ELSE
    RAISE NOTICE 'policy schema_registry_read on _schema_registry absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;

-- ----------------------------------------------------------------------------
-- Catalog / shared-reference tables (00097_permission_based_roles.sql §5k)
--   Read: any authenticated user.
--   Write: `settings:manage` permission (separate `_write` policy on same table).
-- These rows are non-PII reference data shared across the whole brewery.
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'additives' AND policyname = 'additives_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'additives_select', 'additives', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy additives_select on additives absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'adjuncts' AND policyname = 'adjuncts_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'adjuncts_select', 'adjuncts', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy adjuncts_select on adjuncts absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'beer_styles' AND policyname = 'beer_styles_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'beer_styles_select', 'beer_styles', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy beer_styles_select on beer_styles absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brands' AND policyname = 'brands_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'brands_select', 'brands', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy brands_select on brands absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'enum_values' AND policyname = 'enum_values_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'enum_values_select', 'enum_values', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy enum_values_select on enum_values absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fruits' AND policyname = 'fruits_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'fruits_select', 'fruits', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy fruits_select on fruits absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hops' AND policyname = 'hops_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'hops_select', 'hops', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy hops_select on hops absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'malts' AND policyname = 'malts_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'malts_select', 'malts', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy malts_select on malts absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'package_types' AND policyname = 'package_types_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'package_types_select', 'package_types', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy package_types_select on package_types absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pricing_history' AND policyname = 'pricing_history_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'pricing_history_select', 'pricing_history', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy pricing_history_select on pricing_history absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pricing_tier_prices' AND policyname = 'pricing_tier_prices_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'pricing_tier_prices_select', 'pricing_tier_prices', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy pricing_tier_prices_select on pricing_tier_prices absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pricing_tiers' AND policyname = 'pricing_tiers_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'pricing_tiers_select', 'pricing_tiers', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy pricing_tiers_select on pricing_tiers absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_channels' AND policyname = 'sales_channels_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'sales_channels_select', 'sales_channels', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy sales_channels_select on sales_channels absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'spices' AND policyname = 'spices_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'spices_select', 'spices', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy spices_select on spices absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sugars' AND policyname = 'sugars_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'sugars_select', 'sugars', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy sugars_select on sugars absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'water_profiles' AND policyname = 'water_profiles_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'water_profiles_select', 'water_profiles', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy water_profiles_select on water_profiles absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'yeasts' AND policyname = 'yeasts_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'yeasts_select', 'yeasts', 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.');
  ELSE
    RAISE NOTICE 'policy yeasts_select on yeasts absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;

-- ----------------------------------------------------------------------------
-- Catalog-pattern policies added by Tasks 3, 4, 6 (migrations 00194, 00195, 00197)
-- Same rationale as the §5k catalog tables: shared reference data; writes
-- still flow through the role-gated companion policy.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename='selling_format_materials'
       AND policyname='selling_format_materials_select'
  ) THEN
    EXECUTE $cmt$COMMENT ON POLICY selling_format_materials_select ON selling_format_materials IS 'RLS-EXCEPTION: BOM reference data; any authenticated staff member may read. Write is gated by settings:manage on the companion _write policy (migration 00194).'$cmt$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename='brewery_shipping_defaults'
       AND policyname='brewery_shipping_defaults_select'
  ) THEN
    EXECUTE $cmt$COMMENT ON POLICY brewery_shipping_defaults_select ON brewery_shipping_defaults IS 'RLS-EXCEPTION: brewery-wide shipping defaults; any authenticated user may read. Write is gated by settings:manage on the companion _write policy (migration 00195).'$cmt$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename='water_addition_profiles'
       AND policyname='water_addition_profiles_select'
  ) THEN
    EXECUTE $cmt$COMMENT ON POLICY water_addition_profiles_select ON water_addition_profiles IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy (migration 00197).'$cmt$;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Audit log (immutable post-insert)
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'entity_revisions' AND policyname = 'entity_revisions_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'entity_revisions_select', 'entity_revisions', 'RLS-EXCEPTION: audit log readable by any authenticated user; row data references domain rows that are themselves RLS-protected, so the audit row alone does not leak business data. Inserts are constrained by changed_by = auth.uid() in entity_revisions_insert (migration 00102). No UPDATE / DELETE policies exist — rows are immutable.');
  ELSE
    RAISE NOTICE 'policy entity_revisions_select on entity_revisions absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;

-- ----------------------------------------------------------------------------
-- Legacy / read-only retention
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'allocations_legacy' AND policyname = 'allocations_legacy_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'allocations_legacy_select', 'allocations_legacy', 'RLS-EXCEPTION: legacy table retained for historical reference (renamed in migration 00010). No write policy exists; data is frozen.');
  ELSE
    RAISE NOTICE 'policy allocations_legacy_select on allocations_legacy absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;

-- ----------------------------------------------------------------------------
-- System settings — read is permissive but a RESTRICTIVE companion policy
-- (`system_settings_hide_sensitive`) hides keys matching is_sensitive_setting().
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings' AND policyname = 'system_settings_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'system_settings_select', 'system_settings', 'RLS-EXCEPTION: read is wholesale-permissive but the RESTRICTIVE companion policy system_settings_hide_sensitive filters out is_sensitive_setting(key) rows (API keys, OAuth tokens). Write is gated by settings:manage on system_settings_write.');
  ELSE
    RAISE NOTICE 'policy system_settings_select on system_settings absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;

-- ----------------------------------------------------------------------------
-- User directory — display names, roles, status for UI rendering
-- ----------------------------------------------------------------------------
DO $do$ BEGIN
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_select') THEN
    EXECUTE format('COMMENT ON POLICY %I ON %I IS %L', 'user_profiles_select', 'user_profiles', 'RLS-EXCEPTION: authenticated users may read user_profiles to render display names, roles, and active status across the app (assigned-to dropdowns, audit attribution, etc.). PII columns are not stored at the schema level (no addresses, phone). Insert/update/delete are restricted by user_profiles_insert_admin, user_profiles_update, and user_profiles_delete_admin.');
  ELSE
    RAISE NOTICE 'policy user_profiles_select on user_profiles absent; skipping RLS-EXCEPTION comment';
  END IF;
END $do$;
