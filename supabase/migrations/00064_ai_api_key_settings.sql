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

-- Restrict SELECT on system_settings to exclude sensitive keys from client-side reads.
-- The API route reads these server-side via the service role, bypassing RLS.
DROP POLICY IF EXISTS "system_settings_select" ON system_settings;
CREATE POLICY "system_settings_select" ON system_settings
  FOR SELECT TO authenticated
  USING (key NOT LIKE '%api_key%');

-- Allow server-side reads of API keys via a separate policy for service role
-- (service role bypasses RLS, so no explicit policy needed)

-- Per-user API key column
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

COMMENT ON COLUMN user_preferences.anthropic_api_key IS 'Per-user Anthropic API key, overrides global system setting';

-- Update schema registry for user_preferences
UPDATE _schema_registry
SET key_fields = key_fields || '["anthropic_api_key"]'::jsonb
WHERE table_name = 'user_preferences';
