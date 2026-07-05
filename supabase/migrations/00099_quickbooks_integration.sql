-- Migration: 00088_quickbooks_integration.sql
-- Purpose: QuickBooks Online integration tables, views, and settings

-- =============================================================================
-- 1. CUSTOMER SCHEMA CHANGES
-- =============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_tax_exempt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER;

COMMENT ON COLUMN customers.is_tax_exempt IS 'Tax exempt flag synced to QBO Customer.Taxable (inverted)';
COMMENT ON COLUMN customers.payment_terms_days IS 'Payment terms in days; null falls back to system default';

-- =============================================================================
-- 2. QBO SYNC MAPPINGS TABLE
-- =============================================================================

CREATE TABLE qbo_sync_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,          -- 'customer', 'supplier', 'order', 'purchase_order'
  entity_id UUID NOT NULL,            -- MGR entity ID
  qbo_entity_type TEXT NOT NULL,      -- 'Customer', 'Vendor', 'Invoice', 'Bill'
  qbo_entity_id TEXT NOT NULL,        -- QBO ID (string, not UUID)
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

COMMENT ON TABLE qbo_sync_mappings IS 'Maps MGR entity IDs to QBO entity IDs for sync tracking';

ALTER TABLE qbo_sync_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY qbo_sync_mappings_select ON qbo_sync_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY qbo_sync_mappings_insert ON qbo_sync_mappings
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_sync_mappings_update ON qbo_sync_mappings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_sync_mappings_delete ON qbo_sync_mappings
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);

CREATE TRIGGER set_qbo_sync_mappings_updated_at
  BEFORE UPDATE ON qbo_sync_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 3. QBO SYNC LOG TABLE
-- =============================================================================

CREATE TABLE qbo_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,                     -- 'create', 'update', 'retry'
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'success', 'error'
  error_message TEXT,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE qbo_sync_log IS 'Audit log of all QuickBooks sync attempts with status and payloads';

ALTER TABLE qbo_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY qbo_sync_log_select ON qbo_sync_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY qbo_sync_log_insert ON qbo_sync_log
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_sync_log_update ON qbo_sync_log
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_sync_log_delete ON qbo_sync_log
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- 4. QBO ACCOUNT MAPPINGS TABLE
-- =============================================================================

CREATE TABLE qbo_account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,      -- 'sales_revenue', 'cogs', 'shipping', etc.
  qbo_account_id TEXT,                -- QBO Account ID
  qbo_account_name TEXT,              -- Cached display name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE qbo_account_mappings IS 'Maps MGR accounting categories to QuickBooks chart of accounts';

ALTER TABLE qbo_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY qbo_account_mappings_select ON qbo_account_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY qbo_account_mappings_insert ON qbo_account_mappings
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_account_mappings_update ON qbo_account_mappings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY qbo_account_mappings_delete ON qbo_account_mappings
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);

CREATE TRIGGER set_qbo_account_mappings_updated_at
  BEFORE UPDATE ON qbo_account_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 5. INDEXES
-- =============================================================================

CREATE INDEX idx_qbo_sync_mappings_entity ON qbo_sync_mappings (entity_type, entity_id);
CREATE INDEX idx_qbo_sync_log_entity ON qbo_sync_log (entity_type, entity_id);
CREATE INDEX idx_qbo_sync_log_status ON qbo_sync_log (status) WHERE status = 'error';
CREATE INDEX idx_qbo_sync_log_created ON qbo_sync_log (created_at DESC);

-- =============================================================================
-- 6. QBO SYNC STATUS VIEW
-- =============================================================================

CREATE VIEW qbo_sync_status
WITH (security_invoker = true)
AS
SELECT
  m.entity_type,
  m.entity_id,
  m.qbo_entity_type,
  m.qbo_entity_id,
  m.last_synced_at,
  l.status AS last_sync_status,
  l.error_message AS last_error,
  l.created_at AS last_sync_attempted_at
FROM qbo_sync_mappings m
LEFT JOIN LATERAL (
  SELECT status, error_message, created_at
  FROM qbo_sync_log
  WHERE entity_type = m.entity_type AND entity_id = m.entity_id
  ORDER BY created_at DESC
  LIMIT 1
) l ON true;

-- =============================================================================
-- 7. SYSTEM SETTINGS FOR QBO OAUTH
-- =============================================================================

INSERT INTO system_settings (key, value, description, category) VALUES
  ('qbo_client_id',            'null'::jsonb,      'QuickBooks Online OAuth Client ID',        'integrations'),
  ('qbo_client_secret',        'null'::jsonb,      'QuickBooks Online OAuth Client Secret',     'integrations'),
  ('qbo_access_token',         'null'::jsonb,      'QuickBooks Online OAuth Access Token',      'integrations'),
  ('qbo_refresh_token',        'null'::jsonb,      'QuickBooks Online OAuth Refresh Token',     'integrations'),
  ('qbo_realm_id',             'null'::jsonb,      'QuickBooks Online Company (Realm) ID',     'integrations'),
  ('qbo_token_expires_at',     'null'::jsonb,      'QBO access token expiry timestamp',        'integrations'),
  ('qbo_environment',          '"sandbox"'::jsonb,  'QBO API environment: sandbox or production','integrations'),
  ('qbo_auto_sync_enabled',    'false'::jsonb,     'Enable automatic QBO sync on state transitions', 'integrations'),
  ('default_payment_terms_days','30'::jsonb,        'Default payment terms in days for invoices','integrations')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 8. RLS: SENSITIVE QBO SETTINGS HELPER FUNCTION + RESTRICTIVE POLICY
-- =============================================================================

CREATE OR REPLACE FUNCTION is_sensitive_setting(setting_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT setting_key IN ('qbo_access_token', 'qbo_refresh_token', 'qbo_client_secret')
$$;

-- Restrictive policy layered on top of existing permissive policies.
-- Even if the permissive SELECT policy allows the row, this blocks sensitive keys
-- from being read through the authenticated client. The service role bypasses RLS
-- entirely, so server-side token management is unaffected.
CREATE POLICY system_settings_hide_sensitive ON system_settings
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT is_sensitive_setting(key));

-- =============================================================================
-- 9. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields, relationships, query_examples) VALUES
  ('qbo_sync_mappings',
   'Maps MGR entities to QuickBooks Online entities for sync tracking',
   'integrations',
   '["entity_type", "entity_id", "qbo_entity_type", "qbo_entity_id"]'::jsonb,
   '{"polymorphic": "entity_type + entity_id maps to any MGR entity"}'::jsonb,
   '["Is this customer synced to QBO?", "Find QBO mapping for order"]'::jsonb),
  ('qbo_sync_log',
   'Audit log of all QuickBooks sync attempts with status and payloads',
   'integrations',
   '["entity_type", "entity_id", "action", "status"]'::jsonb,
   '{"references": "qbo_sync_mappings via entity_type + entity_id"}'::jsonb,
   '["Show recent QBO sync errors", "When was this invoice last synced?"]'::jsonb),
  ('qbo_account_mappings',
   'Maps MGR accounting categories to QuickBooks chart of accounts',
   'integrations',
   '["category", "qbo_account_id"]'::jsonb,
   '{}'::jsonb,
   '["What QBO account is used for sales revenue?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  -- entity_type assignment removed in PR #322: _schema_registry has no such
  -- column, so this statement had never executed anywhere; the live rows were
  -- inserted out-of-band with this same content.
  key_fields = EXCLUDED.key_fields,
  relationships = EXCLUDED.relationships,
  query_examples = EXCLUDED.query_examples;

-- Update customers registry to reflect new columns
UPDATE _schema_registry
SET key_fields = key_fields || '["is_tax_exempt", "payment_terms_days"]'::jsonb
WHERE table_name = 'customers';
