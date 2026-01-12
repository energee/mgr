-- MGR Mash and Fermentation Schedules Migration
--
-- Adds structured mash and fermentation schedules to recipes.
-- Uses JSONB arrays for flexibility while maintaining structure.

-- =============================================================================
-- Add Mash Schedule to Recipes
-- =============================================================================

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS mash_schedule JSONB DEFAULT '[]';

COMMENT ON COLUMN recipes.mash_schedule IS 'Array of mash steps: [{step_type, name, temp_f, duration_min, notes}]';

-- =============================================================================
-- Add Fermentation Schedule to Recipes
-- =============================================================================

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS fermentation_schedule JSONB DEFAULT '[]';

COMMENT ON COLUMN recipes.fermentation_schedule IS 'Array of fermentation stages: [{stage, temp_f, duration_days, notes}]';

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  key_fields = key_fields || '["mash_schedule", "fermentation_schedule"]'::jsonb,
  updated_at = NOW()
WHERE table_name = 'recipes';
