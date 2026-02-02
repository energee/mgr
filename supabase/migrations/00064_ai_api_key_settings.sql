-- Migration: Add API key storage for AI assistant
-- Global key in system_settings, per-user key in user_preferences

-- Global Anthropic API key (brewery-wide fallback)
INSERT INTO system_settings (id, key, value, description, category)
VALUES (
  gen_random_uuid(),
  'anthropic_api_key',
  'null'::jsonb,
  'Anthropic API key for the AI brewery assistant (global fallback)',
  'integrations'
)
ON CONFLICT (key) DO NOTHING;

-- Restrict client-side access to sensitive keys.
-- The API route reads/writes these server-side via the service role, bypassing RLS.
DROP POLICY IF EXISTS "system_settings_select" ON system_settings;
CREATE POLICY "system_settings_select" ON system_settings
  FOR SELECT TO authenticated
  USING (key NOT LIKE '%api_key%');

DROP POLICY IF EXISTS "system_settings_update" ON system_settings;
CREATE POLICY "system_settings_update" ON system_settings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND key NOT LIKE '%api_key%')
  WITH CHECK (key NOT LIKE '%api_key%');

DROP POLICY IF EXISTS "system_settings_insert" ON system_settings;
CREATE POLICY "system_settings_insert" ON system_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND key NOT LIKE '%api_key%');

-- Per-user API key column
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

COMMENT ON COLUMN user_preferences.anthropic_api_key IS 'Per-user Anthropic API key, overrides global system setting';

-- Update schema registry for user_preferences
UPDATE _schema_registry
SET key_fields = key_fields || '["anthropic_api_key"]'::jsonb
WHERE table_name = 'user_preferences';
