-- =============================================================================
-- Migration: Add yeast_pitch_events table and yeast_pitches_with_remaining view
-- =============================================================================
-- These database objects exist in the running database but have no migration,
-- meaning a fresh `supabase db reset` would break the yeast management feature.
--
-- Also adds missing columns to yeast_pitches (vessel_id, quantity_lbs,
-- cell_count_thousand, cell_density_thousand) that were added outside of
-- migrations.
-- =============================================================================

-- =============================================================================
-- 1. Add missing columns to yeast_pitches
-- =============================================================================

ALTER TABLE yeast_pitches
  ADD COLUMN IF NOT EXISTS vessel_id UUID REFERENCES vessels(id),
  ADD COLUMN IF NOT EXISTS quantity_lbs DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS cell_count_thousand DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS cell_density_thousand DECIMAL(14, 2);

COMMENT ON COLUMN yeast_pitches.vessel_id IS 'Brink vessel containing this pitch';
COMMENT ON COLUMN yeast_pitches.quantity_lbs IS 'Weight of yeast slurry in pounds';
COMMENT ON COLUMN yeast_pitches.cell_count_thousand IS 'Estimated cells in thousands';
COMMENT ON COLUMN yeast_pitches.cell_density_thousand IS 'Cells per lb in thousands';

CREATE INDEX IF NOT EXISTS idx_yeast_pitches_vessel ON yeast_pitches(vessel_id);

-- =============================================================================
-- 2. Yeast Pitch Events table
-- =============================================================================
-- Records individual pitch events — when yeast is pitched to a batch.
-- Decouples the one-to-one batch_id on yeast_pitches (which tracked only one
-- batch) into a many-to-many through this table.

CREATE TABLE IF NOT EXISTS yeast_pitch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES yeast_pitches(id),
  batch_id UUID NOT NULL REFERENCES batches(id),
  quantity_lbs DECIMAL(10, 2) NOT NULL,
  pitched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viability_at_pitch DECIMAL(5, 2),
  cells_pitched_thousand DECIMAL(14, 2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE yeast_pitch_events IS 'Records of yeast being pitched to batches. Tracks quantity, viability at pitch time, and cell count per event.';

CREATE INDEX IF NOT EXISTS idx_yeast_pitch_events_pitch ON yeast_pitch_events(pitch_id);
CREATE INDEX IF NOT EXISTS idx_yeast_pitch_events_batch ON yeast_pitch_events(batch_id);

ALTER TABLE yeast_pitch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY yeast_pitch_events_access ON yeast_pitch_events
  FOR ALL
  USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 3. View: yeast_pitches_with_remaining
-- =============================================================================
-- Enhanced view replacing yeast_pitches_with_details. Adds:
--   - vessel_name and vessel_vessel_type from vessels join
--   - quantity_remaining_lbs computed from pitch events
--   - batches_pitched count from pitch events
--   - cost_per_batch from lineage summary

CREATE OR REPLACE VIEW yeast_pitches_with_remaining
WITH (security_invoker = true)
AS
SELECT
  yp.*,
  y.name AS strain_name,
  y.manufacturer AS strain_manufacturer,
  y.product_code AS strain_code,
  y.type AS strain_type,
  y.form AS strain_form,
  y.attenuation_typical AS strain_attenuation,
  l.name AS location_name,
  v.name AS vessel_name,
  v.vessel_type AS vessel_vessel_type,
  -- Batch info from events (replaces single batch_id column)
  pe.batches_pitched,
  pe.batch_name,
  -- Remaining quantity = original - sum of pitched
  COALESCE(yp.quantity_lbs, 0) - COALESCE(pe.total_pitched_lbs, 0) AS quantity_remaining_lbs,
  -- Days since receipt/harvest
  CASE
    WHEN yp.source_type = 'purchase' THEN
      EXTRACT(DAY FROM (NOW() - yp.received_date))::INTEGER
    WHEN yp.source_type = 'harvest' THEN
      EXTRACT(DAY FROM (NOW() - yp.harvest_date))::INTEGER
    ELSE NULL
  END AS days_old,
  -- Estimated current viability (decay: ~2%/day liquid, ~0.5%/day dry)
  CASE
    WHEN yp.status = 'depleted' OR yp.status = 'discarded' THEN 0
    WHEN y.form = 'dry' THEN
      GREATEST(0, COALESCE(yp.initial_viability, 95) -
        (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 0.5))
    ELSE
      GREATEST(0, COALESCE(yp.initial_viability, 95) -
        (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 2))
  END AS estimated_viability,
  -- Viability status category
  CASE
    WHEN yp.status IN ('depleted', 'discarded') THEN 'inactive'
    WHEN y.form = 'dry' THEN
      CASE
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 0.5) >= 90 THEN 'excellent'
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 0.5) >= 75 THEN 'good'
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 0.5) >= 50 THEN 'marginal'
        ELSE 'low'
      END
    ELSE
      CASE
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 2) >= 90 THEN 'excellent'
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 2) >= 75 THEN 'good'
        WHEN COALESCE(yp.initial_viability, 95) -
             (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 2) >= 50 THEN 'marginal'
        ELSE 'low'
      END
  END AS viability_status
FROM yeast_pitches yp
JOIN yeasts y ON yp.strain_id = y.id
LEFT JOIN locations l ON yp.location_id = l.id
LEFT JOIN vessels v ON yp.vessel_id = v.id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::INTEGER AS batches_pitched,
    COALESCE(SUM(e.quantity_lbs), 0) AS total_pitched_lbs,
    (SELECT b.name FROM batches b WHERE b.id = (
      SELECT e2.batch_id FROM yeast_pitch_events e2
      WHERE e2.pitch_id = yp.id
      ORDER BY e2.pitched_at DESC
      LIMIT 1
    )) AS batch_name
  FROM yeast_pitch_events e
  WHERE e.pitch_id = yp.id
) pe ON true;

COMMENT ON VIEW yeast_pitches_with_remaining IS 'Yeast pitches with strain details, vessel info, calculated viability, and remaining quantity derived from pitch events.';

-- =============================================================================
-- 4. Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('yeast_pitch_events',
   'Records of yeast being pitched to batches. Tracks quantity, viability at pitch time, and cell count per event.',
   'production',
   '{"yeast_pitches": "pitch_id", "batches": "batch_id"}'::jsonb,
   '["id", "pitch_id", "batch_id", "quantity_lbs", "pitched_at"]'::jsonb,
   '["Show pitch events for a yeast pitch", "How much yeast was pitched to batch X?", "List all pitch events"]'::jsonb),

  ('yeast_pitches_with_remaining',
   'Yeast pitches with strain details, vessel info, calculated viability, and remaining quantity derived from pitch events.',
   'production',
   '{"yeasts": "strain_id", "locations": "location_id", "vessels": "vessel_id"}'::jsonb,
   '["id", "strain_name", "status", "estimated_viability", "viability_status", "quantity_remaining_lbs"]'::jsonb,
   '["Show yeast inventory with viability and remaining quantity", "Find pitches with low viability", "List pitches in brinks"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;

-- =============================================================================
-- Done
-- =============================================================================

SELECT 'Yeast pitch events table and remaining view migration complete!' AS message;
