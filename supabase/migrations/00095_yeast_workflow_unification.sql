-- Migration: Yeast Workflow Unification
-- Description: Add brink vessel type, yeast_pitch_events table,
-- modify yeast_pitches for weight-based tracking with thousand-cell precision.

-- =============================================================================
-- 1. Add 'brink' to vessel_type enum
-- =============================================================================
ALTER TYPE vessel_type ADD VALUE IF NOT EXISTS 'brink';

-- =============================================================================
-- 2. Drop dependent views first (must drop before modifying columns)
-- =============================================================================
DROP VIEW IF EXISTS yeast_lineage_summary;
DROP VIEW IF EXISTS yeast_pitches_with_details;

-- =============================================================================
-- 3. Modify yeast_pitches table
-- =============================================================================

-- Add new columns
ALTER TABLE yeast_pitches
  ADD COLUMN IF NOT EXISTS quantity_lbs DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS cell_density_thousand DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS vessel_id UUID REFERENCES vessels(id);

-- Rename cell_count_billion to cell_count_thousand
ALTER TABLE yeast_pitches RENAME COLUMN cell_count_billion TO cell_count_thousand;

-- Migrate existing data: convert billion to thousand (multiply by 1,000,000)
UPDATE yeast_pitches
SET cell_count_thousand = cell_count_thousand * 1000000
WHERE cell_count_thousand IS NOT NULL;

-- Drop batch_id FK constraint, index, and column
ALTER TABLE yeast_pitches DROP CONSTRAINT IF EXISTS yeast_pitches_batch_id_fkey;
DROP INDEX IF EXISTS idx_yeast_pitches_batch;
ALTER TABLE yeast_pitches DROP COLUMN IF EXISTS batch_id;

-- Drop pitched_at column
ALTER TABLE yeast_pitches DROP COLUMN IF EXISTS pitched_at;

-- Add index for vessel_id
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_vessel ON yeast_pitches(vessel_id);

-- =============================================================================
-- 4. Create yeast_pitch_events table
-- =============================================================================
CREATE TABLE yeast_pitch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES yeast_pitches(id),
  batch_id UUID NOT NULL REFERENCES batches(id),
  quantity_lbs DECIMAL(10,2) NOT NULL,
  cells_pitched_thousand DECIMAL(14,2),
  viability_at_pitch DECIMAL(5,2),
  pitched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_yeast_pitch_events_pitch ON yeast_pitch_events(pitch_id);
CREATE INDEX idx_yeast_pitch_events_batch ON yeast_pitch_events(batch_id);

-- RLS
ALTER TABLE yeast_pitch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY yeast_pitch_events_access ON yeast_pitch_events
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================================================
-- 5. Create yeast_pitches_with_remaining view (replaces yeast_pitches_with_details)
-- =============================================================================
CREATE VIEW yeast_pitches_with_remaining
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
  v.name AS vessel_name,
  v.vessel_type AS vessel_vessel_type,
  l.name AS location_name,
  -- Quantity remaining (total minus sum of events)
  yp.quantity_lbs - COALESCE(
    (SELECT SUM(e.quantity_lbs) FROM yeast_pitch_events e WHERE e.pitch_id = yp.id),
    0
  ) AS quantity_remaining_lbs,
  -- Batches pitched from this source
  COALESCE(
    (SELECT COUNT(DISTINCT e.batch_id) FROM yeast_pitch_events e WHERE e.pitch_id = yp.id),
    0
  )::int AS batches_pitched,
  -- Age calculation
  EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))::int AS days_old,
  -- Viability decay
  GREATEST(0, LEAST(100,
    yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )
  ))::numeric(5,2) AS estimated_viability,
  -- Viability status
  CASE
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 90 THEN 'excellent'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 75 THEN 'good'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 50 THEN 'marginal'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date::timestamp, yp.received_date::timestamp))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 25 THEN 'low'
    ELSE 'inactive'
  END AS viability_status
FROM yeast_pitches yp
JOIN yeasts y ON yp.strain_id = y.id
LEFT JOIN vessels v ON yp.vessel_id = v.id
LEFT JOIN locations l ON yp.location_id = l.id;

-- =============================================================================
-- 6. Create batch_yeast_summary view
-- =============================================================================
CREATE VIEW batch_yeast_summary
WITH (security_invoker = true)
AS
SELECT
  e.batch_id,
  e.id AS event_id,
  e.pitch_id,
  e.quantity_lbs,
  e.cells_pitched_thousand,
  e.viability_at_pitch,
  e.pitched_at,
  e.notes,
  yp.strain_id,
  yp.generation,
  yp.source_type,
  y.name AS strain_name,
  y.manufacturer AS strain_manufacturer,
  y.product_code AS strain_code,
  y.type AS strain_type,
  y.form AS strain_form
FROM yeast_pitch_events e
JOIN yeast_pitches yp ON e.pitch_id = yp.id
JOIN yeasts y ON yp.strain_id = y.id;

-- =============================================================================
-- 7. Recreate yeast_lineage_summary view (updated for events model)
-- =============================================================================
CREATE VIEW yeast_lineage_summary
WITH (security_invoker = true)
AS
WITH RECURSIVE lineage AS (
  SELECT
    id, id AS root_id, strain_id, parent_pitch_id,
    generation, source_type, cost, status
  FROM yeast_pitches
  WHERE source_type = 'purchase'

  UNION ALL

  SELECT
    yp.id, l.root_id, yp.strain_id, yp.parent_pitch_id,
    yp.generation, yp.source_type, yp.cost, yp.status
  FROM yeast_pitches yp
  JOIN lineage l ON yp.parent_pitch_id = l.id
)
SELECT
  l.root_id,
  y.name AS strain_name,
  root.cost AS original_cost,
  COUNT(l.id)::int AS total_pitches_in_lineage,
  COUNT(DISTINCT e.batch_id)::int AS batches_used,
  CASE
    WHEN COUNT(DISTINCT e.batch_id) > 0
    THEN ROUND(root.cost / COUNT(DISTINCT e.batch_id), 2)
    ELSE root.cost
  END AS cost_per_batch,
  MAX(l.generation)::int AS max_generations
FROM lineage l
JOIN yeasts y ON l.strain_id = y.id
JOIN yeast_pitches root ON l.root_id = root.id
LEFT JOIN yeast_pitch_events e ON e.pitch_id = l.id
GROUP BY l.root_id, y.name, root.cost;

-- =============================================================================
-- 8. Drop start_batch_fermentation function
-- =============================================================================
DROP FUNCTION IF EXISTS start_batch_fermentation(UUID, UUID, NUMERIC, TEXT);

-- =============================================================================
-- 9. Schema registry updates
-- =============================================================================

-- Update yeast_pitches registry
UPDATE _schema_registry
SET
  description = 'Tracks individual yeast pitches from purchase through brink storage and re-pitching. Supports lineage tracking, viability decay, and weight-based partial deductions via yeast_pitch_events.',
  relationships = jsonb_build_object(
    'belongs_to', jsonb_build_array('yeasts', 'vessels', 'locations'),
    'has_many', jsonb_build_array('yeast_pitch_events'),
    'self_reference', 'parent_pitch_id for lineage'
  )
WHERE table_name = 'yeast_pitches';

-- Add yeast_pitch_events registry
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields)
VALUES (
  'yeast_pitch_events',
  'Immutable event log recording each yeast pitch deduction from a source (brink/purchase) into a batch. Quantity remaining on the source is calculated as total minus sum of events.',
  'production',
  jsonb_build_object(
    'belongs_to', jsonb_build_array('yeast_pitches', 'batches')
  ),
  jsonb_build_array('id', 'pitch_id', 'batch_id', 'quantity_lbs', 'cells_pitched_thousand', 'viability_at_pitch')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields;

-- Update view registry entries
DELETE FROM _schema_registry WHERE table_name = 'yeast_pitches_with_details';

INSERT INTO _schema_registry (table_name, description, domain, key_fields)
VALUES (
  'yeast_pitches_with_remaining',
  'Enriched yeast pitch view with strain info, vessel details, calculated quantity remaining (from events), viability decay, and age.',
  'production',
  jsonb_build_array('id', 'strain_name', 'status', 'quantity_remaining_lbs', 'estimated_viability', 'viability_status')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields;

INSERT INTO _schema_registry (table_name, description, domain, key_fields)
VALUES (
  'batch_yeast_summary',
  'View showing all yeast pitched into a batch with strain details, generation, quantity, and cell counts.',
  'production',
  jsonb_build_array('batch_id', 'event_id', 'strain_name', 'quantity_lbs', 'cells_pitched_thousand')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields;

-- Remove start_batch_fermentation from batches ai_context
UPDATE _schema_registry
SET ai_context = ai_context #- '{functions}'
WHERE table_name = 'batches'
  AND ai_context IS NOT NULL
  AND ai_context ? 'functions';
