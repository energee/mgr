-- =============================================================================
-- Migration: Ensure is_template column exists on recipes
-- =============================================================================
-- Migration 00018 should have added this, but it's not appearing in generated types.
-- This migration ensures the column exists.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;

COMMENT ON COLUMN recipes.is_template IS 'True if this is a template recipe for cloning';

-- Recreate index if needed
DROP INDEX IF EXISTS idx_recipes_is_template;
CREATE INDEX idx_recipes_is_template ON recipes(is_template) WHERE is_template = true;
