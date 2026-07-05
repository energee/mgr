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

-- ----------------------------------------------------------------------------
-- Self-documenting schema metadata
-- ----------------------------------------------------------------------------
COMMENT ON POLICY schema_registry_read ON _schema_registry IS
  'RLS-EXCEPTION: self-documenting schema metadata table; any authenticated user may SELECT for AI agents and tooling. No write policy exists — rows are seeded only by migrations.';

-- ----------------------------------------------------------------------------
-- Catalog / shared-reference tables (00097_permission_based_roles.sql §5k)
--   Read: any authenticated user.
--   Write: `settings:manage` permission (separate `_write` policy on same table).
-- These rows are non-PII reference data shared across the whole brewery.
-- ----------------------------------------------------------------------------
COMMENT ON POLICY additives_select           ON additives           IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY adjuncts_select            ON adjuncts            IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY beer_styles_select         ON beer_styles         IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY brands_select              ON brands              IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY enum_values_select         ON enum_values         IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY fruits_select              ON fruits              IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY hops_select                ON hops                IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY malts_select               ON malts               IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY package_types_select       ON package_types       IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY pricing_history_select     ON pricing_history     IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY pricing_tier_prices_select ON pricing_tier_prices IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY pricing_tiers_select       ON pricing_tiers       IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY sales_channels_select      ON sales_channels      IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY spices_select              ON spices              IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY sugars_select              ON sugars              IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY water_profiles_select      ON water_profiles      IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';
COMMENT ON POLICY yeasts_select              ON yeasts              IS 'RLS-EXCEPTION: catalog/reference table; write is gated by settings:manage on the companion _write policy.';

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
COMMENT ON POLICY entity_revisions_select ON entity_revisions IS
  'RLS-EXCEPTION: audit log readable by any authenticated user; row data references domain rows that are themselves RLS-protected, so the audit row alone does not leak business data. Inserts are constrained by changed_by = auth.uid() in entity_revisions_insert (migration 00102). No UPDATE / DELETE policies exist — rows are immutable.';

-- ----------------------------------------------------------------------------
-- Legacy / read-only retention
-- ----------------------------------------------------------------------------
COMMENT ON POLICY allocations_legacy_select ON allocations_legacy IS
  'RLS-EXCEPTION: legacy table retained for historical reference (renamed in migration 00010). No write policy exists; data is frozen.';

-- ----------------------------------------------------------------------------
-- System settings — read is permissive but a RESTRICTIVE companion policy
-- (`system_settings_hide_sensitive`) hides keys matching is_sensitive_setting().
-- ----------------------------------------------------------------------------
COMMENT ON POLICY system_settings_select ON system_settings IS
  'RLS-EXCEPTION: read is wholesale-permissive but the RESTRICTIVE companion policy system_settings_hide_sensitive filters out is_sensitive_setting(key) rows (API keys, OAuth tokens). Write is gated by settings:manage on system_settings_write.';

-- ----------------------------------------------------------------------------
-- User directory — display names, roles, status for UI rendering
-- ----------------------------------------------------------------------------
COMMENT ON POLICY user_profiles_select ON user_profiles IS
  'RLS-EXCEPTION: authenticated users may read user_profiles to render display names, roles, and active status across the app (assigned-to dropdowns, audit attribution, etc.). PII columns are not stored at the schema level (no addresses, phone). Insert/update/delete are restricted by user_profiles_insert_admin, user_profiles_update, and user_profiles_delete_admin.';
