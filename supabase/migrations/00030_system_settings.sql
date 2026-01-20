-- System Settings Table
-- Phase 8.1: Brewery-wide configuration settings
--
-- NOTE: This table complements the existing `settings` singleton table:
-- - `settings` (00002): Operational defaults (batch size, date format, features)
-- - `system_settings` (this): Extensible key-value store for tax, compliance, etc.
-- Future migration may consolidate these tables.

-- =============================================================================
-- 1. SYSTEM_SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE system_settings IS 'Brewery-wide configuration settings (key-value store)';
COMMENT ON COLUMN system_settings.key IS 'Unique setting key (e.g., brewery_name, federal_tax_rate)';
COMMENT ON COLUMN system_settings.value IS 'Setting value as JSON (supports strings, numbers, objects)';
COMMENT ON COLUMN system_settings.category IS 'Setting category for grouping (general, tax, fiscal, compliance)';

-- Enable RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: All authenticated users can read
CREATE POLICY "system_settings_select" ON system_settings
  FOR SELECT TO authenticated USING (true);

-- RLS Policy: Authenticated users can update/insert (single-tenant, no user_id)
-- Note: WITH CHECK (true) is acceptable for single-tenant reference data per DEC-SEC-006
-- Admin-level access control is enforced in the application layer
CREATE POLICY "system_settings_update" ON system_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "system_settings_insert" ON system_settings
  FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================================================
-- 2. SEED DEFAULT SETTINGS
-- =============================================================================

INSERT INTO system_settings (key, value, description, category) VALUES
  -- General Settings
  ('brewery_name', '"My Brewery"', 'Name of the brewery', 'general'),
  ('brewery_address', '{"street": "", "city": "", "state": "", "zip": "", "country": "USA"}', 'Brewery physical address', 'general'),
  ('brewery_phone', '""', 'Brewery contact phone number', 'general'),
  ('brewery_email', '""', 'Brewery contact email', 'general'),
  ('brewery_website', '""', 'Brewery website URL', 'general'),
  ('timezone', '"America/New_York"', 'Default timezone for the brewery', 'general'),

  -- Tax Settings
  ('federal_excise_tax_rate', '3.50', 'Federal excise tax per barrel (first 60,000 BBL)', 'tax'),
  ('federal_excise_tax_rate_full', '16.00', 'Federal excise tax per barrel (over 60,000 BBL)', 'tax'),
  ('state_excise_tax_rate', '0.00', 'State excise tax per barrel', 'tax'),
  ('sales_tax_rate', '0.00', 'Default sales tax rate (decimal, e.g., 0.06 for 6%)', 'tax'),

  -- Fiscal Settings
  ('fiscal_year_start_month', '1', 'Month fiscal year starts (1-12)', 'fiscal'),
  ('fiscal_year_start_day', '1', 'Day fiscal year starts (1-31)', 'fiscal'),

  -- Compliance Settings
  ('ttb_brewery_number', '""', 'TTB Brewer''s Notice number', 'compliance'),
  ('ttb_permit_number', '""', 'TTB Permit number', 'compliance'),
  ('abc_license_number', '""', 'State ABC license number', 'compliance')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 3. UPDATED_AT TRIGGER
-- =============================================================================

CREATE TRIGGER set_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. HELPER FUNCTION TO GET SETTING VALUE
-- =============================================================================

CREATE OR REPLACE FUNCTION get_system_setting(setting_key TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT value FROM system_settings WHERE key = setting_key;
$$;

CREATE OR REPLACE FUNCTION get_system_setting_text(setting_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT value::text FROM system_settings WHERE key = setting_key;
$$;

-- =============================================================================
-- 5. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('system_settings', 'Brewery-wide configuration settings', 'system',
   '{}'::jsonb,
   '["id", "key", "value", "category"]'::jsonb,
   '["What is the brewery name?", "What are the tax rates?", "Show all system settings"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
