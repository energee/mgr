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

-- Per-user API key column
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;

COMMENT ON COLUMN user_preferences.anthropic_api_key IS 'Per-user Anthropic API key, overrides global system setting';
