-- Deprecate Settings Singleton Table
-- Consolidates all settings into system_settings key-value store
--
-- The original `settings` singleton table (00002) is being replaced by
-- the more flexible `system_settings` key-value store (00030).

-- =============================================================================
-- 1. ADD MISSING KEYS TO SYSTEM_SETTINGS
-- =============================================================================

INSERT INTO system_settings (key, value, description, category) VALUES
  ('currency', '"USD"', 'Currency code for monetary values', 'general'),
  ('date_format', '"MM/DD/YYYY"', 'Date display format', 'general'),
  ('ttb_registry_number', '""', 'TTB registry number', 'compliance'),
  ('default_batch_size_gallons', '7', 'Default batch size in gallons', 'general'),
  ('features', '{}', 'Feature flags', 'general')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. MIGRATE DATA FROM SETTINGS SINGLETON TO SYSTEM_SETTINGS
-- =============================================================================

-- Migrate existing values from settings to system_settings
DO $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM settings WHERE id = '00000000-0000-0000-0000-000000000001';

  IF FOUND THEN
    -- General settings
    UPDATE system_settings SET value = to_jsonb(s.brewery_name) WHERE key = 'brewery_name' AND s.brewery_name IS NOT NULL;
    UPDATE system_settings SET value = COALESCE(s.address, '{}')::jsonb WHERE key = 'brewery_address' AND s.address IS NOT NULL;
    UPDATE system_settings SET value = to_jsonb(s.phone) WHERE key = 'brewery_phone' AND s.phone IS NOT NULL AND s.phone != '';
    UPDATE system_settings SET value = to_jsonb(s.email) WHERE key = 'brewery_email' AND s.email IS NOT NULL AND s.email != '';
    UPDATE system_settings SET value = to_jsonb(s.website) WHERE key = 'brewery_website' AND s.website IS NOT NULL AND s.website != '';
    UPDATE system_settings SET value = to_jsonb(s.timezone) WHERE key = 'timezone' AND s.timezone IS NOT NULL;
    UPDATE system_settings SET value = to_jsonb(s.currency) WHERE key = 'currency' AND s.currency IS NOT NULL;
    UPDATE system_settings SET value = to_jsonb(s.date_format) WHERE key = 'date_format' AND s.date_format IS NOT NULL;
    UPDATE system_settings SET value = to_jsonb(s.default_batch_size_gallons) WHERE key = 'default_batch_size_gallons' AND s.default_batch_size_gallons IS NOT NULL;

    -- Compliance settings
    UPDATE system_settings SET value = to_jsonb(s.ttb_permit_number) WHERE key = 'ttb_permit_number' AND s.ttb_permit_number IS NOT NULL AND s.ttb_permit_number != '';
    UPDATE system_settings SET value = to_jsonb(s.ttb_registry_number) WHERE key = 'ttb_registry_number' AND s.ttb_registry_number IS NOT NULL AND s.ttb_registry_number != '';

    -- Fiscal settings
    UPDATE system_settings SET value = to_jsonb(s.fiscal_year_start_month) WHERE key = 'fiscal_year_start_month' AND s.fiscal_year_start_month IS NOT NULL;

    -- Features
    UPDATE system_settings SET value = COALESCE(s.features, '{}')::jsonb WHERE key = 'features' AND s.features IS NOT NULL;
  END IF;
END $$;

-- =============================================================================
-- 3. ADD DEPRECATION COMMENT TO SETTINGS TABLE
-- =============================================================================

COMMENT ON TABLE settings IS 'DEPRECATED: Use system_settings instead. This table will be removed in a future migration.';

-- =============================================================================
-- 4. UPDATE SCHEMA REGISTRY
-- =============================================================================

UPDATE _schema_registry
SET description = 'DEPRECATED: Brewery settings singleton. Use system_settings key-value store instead.'
WHERE table_name = 'settings';
