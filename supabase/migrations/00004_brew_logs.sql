-- MGR Brew Logs Migration
--
-- Creates the brew_logs entity, decoupled from batches to support:
-- - Split fermentation (1 brew → multiple batches)
-- - Parti-gyle brewing (1 brew → multiple batches with different gravities)
-- - Blend at knockout (multiple brews → 1 batch, rare but supported)
--
-- The brew_log captures the hot-side process (mash through knockout).
-- The batch captures the cold-side process (fermentation through packaging).

-- =============================================================================
-- Brew Logs Table
-- =============================================================================

CREATE TABLE brew_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brew_number TEXT NOT NULL UNIQUE,  -- e.g., "BRW-2024-001"
  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  brew_date DATE NOT NULL,
  brewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, in_progress, completed, cancelled

  -- Timeline: Array of brew day events (source of truth for all measurements)
  -- Schema: [{id, phase, custom_phase, time, measurements: [{metric, value, custom_metric}], ingredient, vessel, notes}]
  events JSONB DEFAULT '[]',

  -- Legacy data for migration from old structured format
  legacy_data JSONB,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE brew_logs IS 'Brew day records (hot-side). Events array is source of truth for timeline and measurements. Linked to batches via brew_log_batches for flexible split/blend scenarios.';

-- Indexes for common queries
CREATE INDEX idx_brew_logs_date ON brew_logs(brew_date DESC);
CREATE INDEX idx_brew_logs_recipe ON brew_logs(recipe_id);
CREATE INDEX idx_brew_logs_brewer ON brew_logs(brewer_id);
CREATE INDEX idx_brew_logs_status ON brew_logs(status);

-- =============================================================================
-- Brew Log to Batch Junction Table
-- =============================================================================

CREATE TABLE brew_log_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brew_log_id UUID NOT NULL REFERENCES brew_logs(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  volume_bbl DECIMAL(8,2) NOT NULL,  -- Volume of wort allocated to this batch
  notes TEXT,  -- e.g., "first runnings", "split for Brett ferment"
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(brew_log_id, batch_id)
);

COMMENT ON TABLE brew_log_batches IS 'Links brew logs to batches with volume allocation. Supports 1:1, 1:many (split), and many:1 (blend) relationships.';

CREATE INDEX idx_brew_log_batches_brew_log ON brew_log_batches(brew_log_id);
CREATE INDEX idx_brew_log_batches_batch ON brew_log_batches(batch_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE brew_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE brew_log_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY brew_log_access ON brew_logs
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY brew_log_batch_access ON brew_log_batches
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Updated At Trigger
-- =============================================================================

CREATE TRIGGER update_brew_logs_updated_at BEFORE UPDATE ON brew_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, state_machine, query_examples) VALUES
('brew_logs', 'Brew day records (hot-side process). Events array captures timeline with measurements. Decoupled from batches to support split fermentation and blending.', 'production',
 '["belongs_to: recipes", "belongs_to: auth.users (brewer)", "has_many: brew_log_batches"]',
 '["brew_number", "brew_date", "status", "events"]',
 '{"stateField": "status", "states": ["draft", "in_progress", "completed", "cancelled"], "transitions": {"draft": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"]}}',
 '["List brews from this week", "Find brews by recipe", "Get brew with number BRW-2024-001", "Show brews in progress"]'),

('brew_log_batches', 'Junction table linking brew logs to batches with volume allocation. Enables split fermentation (1 brew → many batches) and blend scenarios (many brews → 1 batch).', 'production',
 '["belongs_to: brew_logs", "belongs_to: batches"]',
 '["brew_log_id", "batch_id", "volume_bbl"]', NULL,
 '["Get batches for a brew", "Find brews that contributed to a batch", "Calculate total volume allocated from a brew"]');

-- =============================================================================
-- Helper Views
-- =============================================================================

-- View to get brew logs with calculated metrics from events
CREATE OR REPLACE VIEW brew_log_metrics AS
SELECT
  bl.id,
  bl.brew_number,
  bl.brew_date,
  bl.status,
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
  ) AS allocated_volume_bbl
FROM brew_logs bl;

COMMENT ON VIEW brew_log_metrics IS 'Brew logs with calculated metrics extracted from events JSONB. Use this for list views and reports.';
