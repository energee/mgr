-- MGR Recipe Templates Migration
--
-- Adds template support to recipes for creating reusable recipe blueprints.

-- =============================================================================
-- Add is_template Column to Recipes
-- =============================================================================

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;

COMMENT ON COLUMN recipes.is_template IS 'True if this is a template recipe for cloning';

-- Index for filtering templates
CREATE INDEX IF NOT EXISTS idx_recipes_is_template ON recipes(is_template) WHERE is_template = true;

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  key_fields = key_fields || '["is_template"]'::jsonb,
  updated_at = NOW()
WHERE table_name = 'recipes';
