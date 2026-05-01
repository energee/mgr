-- Add optimistic locking version column to recipes.
-- The recipe-editor's saveAll path reads/writes recipes.version to coordinate
-- multi-section saves. Without this column, every save errored with
-- "column 'version' does not exist", which the client mistook for a
-- concurrent-modification conflict.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN recipes.version IS 'Optimistic locking version for concurrent-edit detection in the recipe editor';

-- Reuse the increment_version() trigger function defined in 00141.
DROP TRIGGER IF EXISTS recipes_version_trigger ON recipes;
CREATE TRIGGER recipes_version_trigger
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION increment_version();
