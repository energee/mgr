-- Batch-Centric Brew Logs Migration
--
-- Removes recipe_id FK from brew_logs. Recipe is now derived from
-- linked batches via brew_log_batches junction table.
-- Brew logs are records of brewing batches, not recipes.

-- =============================================================================
-- Drop recipe_id from brew_logs
-- =============================================================================

-- Drop dependent views first (they reference recipe_id)
DROP VIEW IF EXISTS brew_log_metrics CASCADE;

-- Drop indexes (some were created with different names in different migrations)
DROP INDEX IF EXISTS idx_brew_logs_recipe;
DROP INDEX IF EXISTS idx_brew_logs_recipe_id;

-- Drop the column (cascades FK constraint)
ALTER TABLE brew_logs DROP COLUMN recipe_id;

-- =============================================================================
-- Create brew_logs_with_batches view
-- =============================================================================
-- Enriches brew_logs with batch and recipe data derived from the junction table.
-- This is the primary view for list and detail pages.

CREATE OR REPLACE VIEW brew_logs_with_batches
WITH (security_invoker = true)
AS
SELECT
  bl.*,
  bs.recipe_id,
  bs.recipe_name,
  bs.batch_count,
  bs.batch_numbers
FROM brew_logs bl
LEFT JOIN LATERAL (
  SELECT
    (array_agg(b.recipe_id))[1] AS recipe_id,
    (array_agg(r.name))[1] AS recipe_name,
    COUNT(*)::int AS batch_count,
    string_agg(b.batch_number, ', ' ORDER BY b.batch_number) AS batch_numbers
  FROM brew_log_batches blb
  JOIN batches b ON b.id = blb.batch_id
  LEFT JOIN recipes r ON r.id = b.recipe_id
  WHERE blb.brew_log_id = bl.id
) bs ON true;

COMMENT ON VIEW brew_logs_with_batches IS 'Brew logs enriched with batch/recipe data derived from brew_log_batches junction. Recipe is derived from linked batches, not stored directly.';

-- =============================================================================
-- Update brew_log_metrics view
-- =============================================================================
-- Remove JOIN on recipes (recipe_id no longer on brew_logs).
-- Derive recipe info from batches instead.

-- Recreate brew_log_metrics without recipe_id dependency
CREATE VIEW brew_log_metrics
WITH (security_invoker = true)
AS
SELECT
  bl.id,
  bl.brew_date,
  bl.status,
  bs.recipe_name,
  bs.batch_count,
  -- Extract OG from knockout event
  (
    SELECT (m->>'value')::DECIMAL(4,1)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' IN ('ko_end', 'boil_end')
      AND m->>'metric' = 'gravity_plato'
    LIMIT 1
  ) AS actual_og,
  -- Extract volume to fermenter from knockout event
  (
    SELECT (m->>'value')::DECIMAL(8,2)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'ko_end'
      AND m->>'metric' = 'volume_bbl'
    LIMIT 1
  ) AS volume_to_fermenter_bbl,
  -- Extract mash pH from mash_in event
  (
    SELECT (m->>'value')::DECIMAL(3,2)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'mash_in'
      AND m->>'metric' = 'ph'
    LIMIT 1
  ) AS actual_mash_ph,
  -- Extract pre-boil gravity from boil_start event
  (
    SELECT (m->>'value')::DECIMAL(4,1)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'boil_start'
      AND m->>'metric' = 'gravity_plato'
    LIMIT 1
  ) AS pre_boil_gravity,
  -- Total volume allocated to batches
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.brew_log_id = bl.id
  ) AS allocated_volume_bbl,
  -- Phases completed
  (
    SELECT jsonb_agg(e->>'phase')
    FROM jsonb_array_elements(bl.events) e
  ) AS phases_completed
FROM brew_logs bl
LEFT JOIN LATERAL (
  SELECT
    (array_agg(r.name))[1] AS recipe_name,
    COUNT(*)::int AS batch_count
  FROM brew_log_batches blb
  JOIN batches b ON b.id = blb.batch_id
  LEFT JOIN recipes r ON r.id = b.recipe_id
  WHERE blb.brew_log_id = bl.id
) bs ON true;

COMMENT ON VIEW brew_log_metrics IS 'Brew logs with calculated metrics extracted from events JSONB and batch data. Use this for list views and reports.';

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  description = 'Brew day records (hot-side process). Events array captures timeline with measurements. Linked to batches via brew_log_batches. Recipe derived from linked batches.',
  relationships = '["belongs_to: auth.users (brewer)", "has_many: brew_log_batches"]',
  key_fields = '["brew_number", "brew_date", "status", "events"]'
WHERE table_name = 'brew_logs';
