-- Yeast Pitch Tracking
-- Phase 9.2: Track individual yeast pitches from purchase through repitching
--
-- DESIGN: Track yeast inventory with generation/lineage for cost spreading
-- and viability decay calculations.

-- =============================================================================
-- 1. YEAST PITCHES TABLE
-- =============================================================================
-- Individual yeast pitches that can be purchased, harvested, and repitched.
-- Tracks lineage via parent_pitch_id for generation counting and cost spreading.

CREATE TABLE yeast_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Strain reference
  strain_id UUID NOT NULL REFERENCES yeasts(id),

  -- Source info
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase', 'harvest')),
  parent_pitch_id UUID REFERENCES yeast_pitches(id),  -- For harvested pitches
  generation INTEGER NOT NULL DEFAULT 1,  -- Increments with each harvest

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (
    status IN ('in_stock', 'in_use', 'harvested', 'depleted', 'discarded')
  ),

  -- Quantity and viability
  volume_ml DECIMAL(10, 2),
  cell_count_billion DECIMAL(10, 2),  -- Estimated billion cells
  initial_viability DECIMAL(5, 2) DEFAULT 95.00,  -- % at time of receipt/harvest
  current_viability DECIMAL(5, 2),  -- Calculated based on age

  -- Cost tracking
  cost DECIMAL(10, 2),  -- Purchase cost (NULL for harvests)
  cost_per_batch DECIMAL(10, 2),  -- Calculated: original cost / batches in lineage

  -- Dates
  received_date DATE,  -- When purchased/received
  harvest_date DATE,  -- When harvested (for harvest source)
  use_by_date DATE,  -- Recommended use-by date

  -- Usage tracking
  batch_id UUID REFERENCES batches(id),  -- Which batch this was pitched into
  pitched_at TIMESTAMPTZ,  -- When it was pitched

  -- Storage
  location_id UUID REFERENCES locations(id),

  -- Notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE yeast_pitches IS 'Individual yeast pitches tracking lineage, viability, and usage. Supports purchase and harvest sources with generation tracking for cost spreading.';

-- Indexes for common queries
CREATE INDEX idx_yeast_pitches_strain ON yeast_pitches(strain_id);
CREATE INDEX idx_yeast_pitches_status ON yeast_pitches(status);
CREATE INDEX idx_yeast_pitches_source_type ON yeast_pitches(source_type);
CREATE INDEX idx_yeast_pitches_parent ON yeast_pitches(parent_pitch_id);
CREATE INDEX idx_yeast_pitches_batch ON yeast_pitches(batch_id);
CREATE INDEX idx_yeast_pitches_location ON yeast_pitches(location_id);

-- =============================================================================
-- 2. VIEW: YEAST PITCHES WITH DETAILS
-- =============================================================================
-- Join strain info and calculate current viability based on age.

CREATE VIEW yeast_pitches_with_details
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
  b.batch_number,
  b.name AS batch_name,
  parent.strain_id AS parent_strain_id,
  -- Calculate days since receipt/harvest
  CASE
    WHEN yp.source_type = 'purchase' THEN
      EXTRACT(DAY FROM (NOW() - yp.received_date))::INTEGER
    WHEN yp.source_type = 'harvest' THEN
      EXTRACT(DAY FROM (NOW() - yp.harvest_date))::INTEGER
    ELSE NULL
  END AS days_old,
  -- Calculate estimated current viability (decay ~2-4% per day for liquid, less for dry)
  CASE
    WHEN yp.status = 'depleted' OR yp.status = 'discarded' THEN 0
    WHEN y.form = 'dry' THEN
      GREATEST(0, COALESCE(yp.initial_viability, 95) -
        (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 0.5))
    ELSE
      -- Liquid yeast: ~2% decay per day
      GREATEST(0, COALESCE(yp.initial_viability, 95) -
        (EXTRACT(DAY FROM (NOW() - COALESCE(yp.received_date, yp.harvest_date)))::DECIMAL * 2))
  END AS estimated_viability,
  -- Viability status
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
LEFT JOIN batches b ON yp.batch_id = b.id
LEFT JOIN yeast_pitches parent ON yp.parent_pitch_id = parent.id;

COMMENT ON VIEW yeast_pitches_with_details IS 'Yeast pitches with strain details, calculated viability, and batch info.';

-- =============================================================================
-- 3. VIEW: YEAST LINEAGE SUMMARY
-- =============================================================================
-- Aggregate view showing lineage statistics for cost spreading.

CREATE VIEW yeast_lineage_summary
WITH (security_invoker = true)
AS
WITH RECURSIVE lineage AS (
  -- Start with purchased pitches (root of lineage)
  SELECT
    id,
    id AS root_id,
    strain_id,
    cost,
    1 AS depth
  FROM yeast_pitches
  WHERE source_type = 'purchase'

  UNION ALL

  -- Add harvested pitches
  SELECT
    yp.id,
    l.root_id,
    yp.strain_id,
    l.cost,
    l.depth + 1
  FROM yeast_pitches yp
  JOIN lineage l ON yp.parent_pitch_id = l.id
)
SELECT
  root_id,
  y.name AS strain_name,
  MAX(l.cost) AS original_cost,
  COUNT(*) AS total_pitches_in_lineage,
  COUNT(*) FILTER (WHERE yp.batch_id IS NOT NULL) AS batches_used,
  CASE
    WHEN COUNT(*) FILTER (WHERE yp.batch_id IS NOT NULL) > 0 THEN
      MAX(l.cost) / COUNT(*) FILTER (WHERE yp.batch_id IS NOT NULL)
    ELSE MAX(l.cost)
  END AS cost_per_batch,
  MAX(l.depth) AS max_generations
FROM lineage l
JOIN yeast_pitches yp ON l.id = yp.id
JOIN yeasts y ON l.strain_id = y.id
GROUP BY root_id, y.name;

COMMENT ON VIEW yeast_lineage_summary IS 'Summary of yeast lineages showing total pitches, batches used, and cost per batch.';

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE yeast_pitches ENABLE ROW LEVEL SECURITY;

-- All authenticated users can access (matches codebase pattern from 00025)
CREATE POLICY yeast_pitches_access ON yeast_pitches
  FOR ALL
  USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 5. TRIGGERS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE TRIGGER set_yeast_pitches_updated_at
  BEFORE UPDATE ON yeast_pitches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-increment generation when harvesting
CREATE OR REPLACE FUNCTION increment_yeast_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- If this is a harvest (has parent), increment generation from parent
  IF NEW.source_type = 'harvest' AND NEW.parent_pitch_id IS NOT NULL THEN
    SELECT generation + 1 INTO NEW.generation
    FROM yeast_pitches
    WHERE id = NEW.parent_pitch_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_increment_yeast_generation
  BEFORE INSERT ON yeast_pitches
  FOR EACH ROW
  EXECUTE FUNCTION increment_yeast_generation();

-- =============================================================================
-- 6. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('yeast_pitches',
   'Individual yeast pitches tracking lineage, viability, and usage. Supports purchase and harvest sources with generation tracking for cost spreading.',
   'production',
   '{"yeasts": "strain_id", "batches": "batch_id", "locations": "location_id", "yeast_pitches": "parent_pitch_id"}'::jsonb,
   '["id", "strain_id", "source_type", "status", "generation", "batch_id"]'::jsonb,
   '["List available yeast pitches", "Show yeast lineage for a strain", "What is the viability of pitch X?", "Find pitches ready for use", "Show yeast cost per batch"]'::jsonb),

  ('yeast_pitches_with_details',
   'Yeast pitches with strain details, calculated viability, and batch info.',
   'production',
   '{"yeasts": "strain_id", "batches": "batch_id", "locations": "location_id"}'::jsonb,
   '["id", "strain_name", "status", "estimated_viability", "viability_status"]'::jsonb,
   '["Show yeast inventory with viability", "Find pitches with low viability", "List pitches by strain"]'::jsonb),

  ('yeast_lineage_summary',
   'Summary of yeast lineages showing total pitches, batches used, and cost per batch.',
   'production',
   '{"yeasts": "strain_id"}'::jsonb,
   '["root_id", "strain_name", "batches_used", "cost_per_batch", "max_generations"]'::jsonb,
   '["What is the cost per batch for yeast lineage?", "How many batches have used this yeast lineage?", "Show yeast ROI"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
