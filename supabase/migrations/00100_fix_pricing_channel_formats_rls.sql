-- Migration: fix_pricing_channel_formats_rls
-- 1. Replace overly-permissive pricing_channel_formats RLS policies with
--    settings:manage (admin-only) write access, matching the pattern used
--    for pricing_tiers, pricing_tier_prices, and other catalog/pricing tables.
-- 2. Add "other" container type to enum_values to preserve editability of
--    any package_types records that were created with container_type = 'other'
--    before the static CONTAINER_TYPE_OPTIONS constant was removed.

-- =============================================================================
-- Fix pricing_channel_formats RLS
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can view pricing channel formats" ON pricing_channel_formats;
DROP POLICY IF EXISTS "Authenticated users can insert pricing channel formats" ON pricing_channel_formats;
DROP POLICY IF EXISTS "Authenticated users can delete pricing channel formats" ON pricing_channel_formats;

CREATE POLICY pricing_channel_formats_select ON pricing_channel_formats
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY pricing_channel_formats_write ON pricing_channel_formats
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- =============================================================================
-- Add "other" container type to enum_values
-- =============================================================================

INSERT INTO enum_values (enum_type, value, label, description, sort_order)
VALUES ('package_container_type', 'other', 'Other', 'Other container type', 99)
ON CONFLICT (enum_type, value) DO NOTHING;
