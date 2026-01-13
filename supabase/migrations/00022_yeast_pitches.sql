-- Migration: 00022_yeast_pitches.sql
-- Purpose: Add yeast pitch tracking for lineage, viability, and cost spreading
-- See: docs/data-model/production.md for full specification

-- =============================================================================
-- Yeast Pitches Table
-- =============================================================================

CREATE TABLE yeast_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strain_id UUID NOT NULL REFERENCES yeasts(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase', 'harvest')),
  parent_pitch_id UUID REFERENCES yeast_pitches(id) ON DELETE SET NULL,
  generation INTEGER NOT NULL DEFAULT 1,

  -- Cell count and viability
  cell_count_billions DECIMAL(10,2),
  viability_percent DECIMAL(5,2),

  -- Dates
  harvest_date DATE,
  received_date DATE,
  pitched_date DATE,

  -- Cost tracking
  cost DECIMAL(10,2),

  -- Status
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'pitched', 'discarded')),

  -- Batch references
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,           -- Batch it was pitched into
  source_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,    -- Batch it was harvested from

  -- Notes
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE yeast_pitches IS 'Yeast pitch tracking with lineage and viability';
COMMENT ON COLUMN yeast_pitches.source_type IS 'purchase = from vendor, harvest = from previous batch';
COMMENT ON COLUMN yeast_pitches.generation IS 'Generation number (1 = original, 2+ = propagated)';
COMMENT ON COLUMN yeast_pitches.batch_id IS 'Batch this pitch was used in';
COMMENT ON COLUMN yeast_pitches.source_batch_id IS 'For harvests, the batch it came from';

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_yeast_pitches_strain ON yeast_pitches(strain_id);
CREATE INDEX idx_yeast_pitches_status ON yeast_pitches(status, harvest_date);
CREATE INDEX idx_yeast_pitches_batch ON yeast_pitches(batch_id);
CREATE INDEX idx_yeast_pitches_source_batch ON yeast_pitches(source_batch_id);
CREATE INDEX idx_yeast_pitches_parent ON yeast_pitches(parent_pitch_id, generation);

-- =============================================================================
-- Triggers
-- =============================================================================

CREATE TRIGGER update_yeast_pitches_updated_at
  BEFORE UPDATE ON yeast_pitches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- RLS Policies
-- =============================================================================

ALTER TABLE yeast_pitches ENABLE ROW LEVEL SECURITY;

CREATE POLICY yeast_pitches_access ON yeast_pitches
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- Viability View
-- =============================================================================

CREATE VIEW yeast_pitches_with_viability
WITH (security_invoker = true)
AS
SELECT
  yp.*,
  y.name AS strain_name,
  y.manufacturer AS strain_manufacturer,
  y.type AS strain_type,
  b.batch_number,
  b.name AS batch_name,
  sb.batch_number AS source_batch_number,
  -- Calculate current viability based on decay
  -- Viability decays ~3% per day at refrigerator temps
  CASE
    WHEN yp.status = 'available' AND yp.viability_percent IS NOT NULL AND yp.harvest_date IS NOT NULL THEN
      GREATEST(0, yp.viability_percent * POWER(0.97, EXTRACT(day FROM CURRENT_DATE - yp.harvest_date)))
    ELSE yp.viability_percent
  END AS current_viability_percent,
  -- Days since harvest
  CASE
    WHEN yp.harvest_date IS NOT NULL THEN
      EXTRACT(day FROM CURRENT_DATE - yp.harvest_date)::INTEGER
    ELSE NULL
  END AS days_since_harvest
FROM yeast_pitches yp
LEFT JOIN yeasts y ON y.id = yp.strain_id
LEFT JOIN batches b ON b.id = yp.batch_id
LEFT JOIN batches sb ON sb.id = yp.source_batch_id;

COMMENT ON VIEW yeast_pitches_with_viability IS 'Yeast pitches with calculated current viability';

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples) VALUES
('yeast_pitches', 'Yeast pitch tracking with lineage and viability', 'production',
 '["belongs_to: yeasts", "belongs_to: batches", "self_reference: parent_pitch"]',
 '["strain_id", "generation", "viability_percent", "status", "batch_id"]',
 '["List available pitches", "Get pitch lineage", "Find pitches by strain", "Calculate viability for pitch"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
