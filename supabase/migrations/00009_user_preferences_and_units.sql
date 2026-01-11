-- Migration: 00009_user_preferences_and_units.sql
-- Purpose: Add user preferences table and standardize volume units to BBL
-- Decision: DEC-UNIT-001

-- =============================================================================
-- 1. Create user_preferences table
-- =============================================================================

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Unit preferences
  volume_unit TEXT NOT NULL DEFAULT 'bbl'
    CONSTRAINT chk_volume_unit CHECK (volume_unit IN ('bbl', 'gal', 'l', 'hl')),
  weight_unit TEXT NOT NULL DEFAULT 'lbs'
    CONSTRAINT chk_weight_unit CHECK (weight_unit IN ('lbs', 'kg')),
  temperature_unit TEXT NOT NULL DEFAULT 'f'
    CONSTRAINT chk_temperature_unit CHECK (temperature_unit IN ('f', 'c')),
  gravity_unit TEXT NOT NULL DEFAULT 'plato'
    CONSTRAINT chk_gravity_unit CHECK (gravity_unit IN ('plato', 'sg')),
  retail_volume_unit TEXT NOT NULL DEFAULT 'oz'
    CONSTRAINT chk_retail_volume_unit CHECK (retail_volume_unit IN ('oz', 'ml')),

  -- UI preferences
  theme TEXT NOT NULL DEFAULT 'system'
    CONSTRAINT chk_theme CHECK (theme IN ('light', 'dark', 'system')),
  date_format TEXT NOT NULL DEFAULT 'MM/dd/yyyy',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT user_preferences_user_unique UNIQUE (user_id)
);

-- Index for fast lookup by user
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- Comments
COMMENT ON TABLE user_preferences IS 'Per-user preferences including unit display settings. Auto-created on user signup.';
COMMENT ON COLUMN user_preferences.volume_unit IS 'Display unit for production volumes: bbl (barrels), gal (gallons), l (liters), hl (hectoliters)';
COMMENT ON COLUMN user_preferences.weight_unit IS 'Display unit for weights: lbs (pounds), kg (kilograms)';
COMMENT ON COLUMN user_preferences.temperature_unit IS 'Display unit for temperature: f (Fahrenheit), c (Celsius)';
COMMENT ON COLUMN user_preferences.gravity_unit IS 'Display unit for gravity: plato, sg (specific gravity)';
COMMENT ON COLUMN user_preferences.retail_volume_unit IS 'Display unit for retail container volumes: oz (fluid ounces), ml (milliliters)';

-- =============================================================================
-- 2. Auto-create preferences on user signup
-- =============================================================================

CREATE OR REPLACE FUNCTION create_user_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_preferences();

-- Create preferences for existing users
INSERT INTO user_preferences (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- =============================================================================
-- 3. RLS Policies
-- =============================================================================

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only see their own preferences
CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences" ON user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- System can insert (via trigger)
CREATE POLICY "System can insert preferences" ON user_preferences
  FOR INSERT WITH CHECK (true);

-- =============================================================================
-- 4. Standardize batch volume to BBL
-- =============================================================================

-- Rename column from volume_gallons to volume_bbl
ALTER TABLE batches RENAME COLUMN volume_gallons TO volume_bbl;

-- Convert existing values from gallons to BBL (1 BBL = 31 gallons)
UPDATE batches
SET volume_bbl = volume_bbl / 31.0
WHERE volume_bbl IS NOT NULL;

-- Update column comment
COMMENT ON COLUMN batches.volume_bbl IS 'Batch volume in barrels (BBL). Displayed in user preferred unit via application layer.';

-- =============================================================================
-- 5. Update schema registry
-- =============================================================================

INSERT INTO _schema_registry (
  table_name, description, domain, relationships, key_fields, state_machine, query_examples, ai_context, calculated_fields
) VALUES (
  'user_preferences',
  'Per-user preferences including unit display settings, theme, and date format. Auto-created on user signup via database trigger.',
  'system',
  '["user_id → auth.users"]'::jsonb,
  '["user_id", "volume_unit", "weight_unit", "temperature_unit", "gravity_unit"]'::jsonb,
  NULL,
  '["Get user preferences", "Update volume display unit"]'::jsonb,
  jsonb_build_object(
    'purpose', 'Store user-specific display preferences for units and UI',
    'unit_system', jsonb_build_object(
      'canonical_units', jsonb_build_object(
        'volume', 'bbl',
        'weight', 'lbs',
        'temperature', 'f',
        'gravity', 'plato',
        'retail_volume', 'oz'
      ),
      'display_options', jsonb_build_object(
        'volume', ARRAY['bbl', 'gal', 'l', 'hl'],
        'weight', ARRAY['lbs', 'kg'],
        'temperature', ARRAY['f', 'c'],
        'gravity', ARRAY['plato', 'sg'],
        'retail_volume', ARRAY['oz', 'ml']
      )
    )
  ),
  NULL
) ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  ai_context = EXCLUDED.ai_context,
  updated_at = now();

-- Update batches schema registry to reflect volume_bbl
UPDATE _schema_registry
SET
  key_fields = '["batch_number", "name", "status", "volume_bbl", "planned_start_date"]'::jsonb,
  ai_context = jsonb_set(
    COALESCE(ai_context, '{}'::jsonb),
    '{unit_note}',
    '"volume_bbl stores volume in barrels. Convert to user preferred unit for display."'::jsonb
  ),
  updated_at = now()
WHERE table_name = 'batches';
