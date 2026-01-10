-- MGR Batches Cleanup Migration
--
-- Refactors batches to be cold-side only (fermentation → packaging).
-- Hot-side data now lives on brew_logs.
--
-- Changes:
-- - brew_date → planned_start_date (for scheduling, not actual brew date)
-- - actual_og removed (derived from brew_log events)
--
-- Kept fields:
-- - actual_fg: Fermentation result (measured during/after fermentation)
-- - actual_abv: Calculated from OG/FG (can derive OG from linked brew_logs)

-- =============================================================================
-- Rename brew_date to planned_start_date
-- =============================================================================

ALTER TABLE batches RENAME COLUMN brew_date TO planned_start_date;

-- Update index name
DROP INDEX IF EXISTS idx_batches_brew_date;
CREATE INDEX idx_batches_planned_start ON batches(planned_start_date);

-- =============================================================================
-- Remove actual_og (now derived from brew_logs)
-- =============================================================================

ALTER TABLE batches DROP COLUMN IF EXISTS actual_og;

-- =============================================================================
-- Update batches table comment
-- =============================================================================

COMMENT ON TABLE batches IS 'Production batches (cold-side: fermentation through packaging). Linked to brew_logs via brew_log_batches junction table for hot-side data.';

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  description = 'Production batches (cold-side: fermentation through packaging). Has planned_start_date for scheduling. Actual brew date and OG come from linked brew_logs.',
  relationships = '["belongs_to: recipes", "has_many: batch_logs", "has_many: packages", "has_many_through: brew_logs (via brew_log_batches)"]',
  key_fields = '["batch_number", "name", "status", "planned_start_date", "fermenter"]',
  query_examples = '["List batches currently fermenting", "Find batches planned for this week", "Get batch with batch_number 2024-001", "Show batches with actual brew dates (use batches_with_brew_info view)"]',
  updated_at = NOW()
WHERE table_name = 'batches';

-- =============================================================================
-- Helpful view: Batches with brew info
-- =============================================================================

CREATE OR REPLACE VIEW batches_with_brew_info AS
SELECT
  b.*,
  -- Get brew date from linked brew log (use earliest if multiple)
  (
    SELECT MIN(bl.brew_date)
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS brew_date,
  -- Get OG from linked brew log (weighted average if multiple)
  (
    SELECT
      CASE
        WHEN SUM(blb.volume_bbl) > 0 THEN
          SUM(
            blb.volume_bbl * (
              SELECT (m->>'value')::DECIMAL(4,1)
              FROM jsonb_array_elements(bl.events) e,
                   jsonb_array_elements(e->'measurements') m
              WHERE e->>'phase' IN ('ko_end', 'boil_end')
                AND m->>'metric' = 'gravity_plato'
              LIMIT 1
            )
          ) / SUM(blb.volume_bbl)
        ELSE NULL
      END
    FROM brew_log_batches blb
    JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE blb.batch_id = b.id
  ) AS actual_og,
  -- Get total volume from linked brew logs
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS volume_from_brews_bbl,
  -- Count of contributing brews
  (
    SELECT COUNT(*)
    FROM brew_log_batches blb
    WHERE blb.batch_id = b.id
  ) AS brew_count
FROM batches b;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs. Use this view when you need brew date and OG without manual joins.';
