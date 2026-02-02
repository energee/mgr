-- Migration: 00055_batch_blending.sql
-- Batch blending support

CREATE TABLE batch_blends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blend_batch_id UUID NOT NULL REFERENCES batches(id),
  source_batch_id UUID NOT NULL REFERENCES batches(id),
  volume_bbl NUMERIC(10,4) NOT NULL CHECK (volume_bbl > 0),
  notes TEXT,
  blended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  UNIQUE(blend_batch_id, source_batch_id)
);

COMMENT ON TABLE batch_blends IS 'Tracks source batches and volumes used in blending operations';
COMMENT ON COLUMN batch_blends.blend_batch_id IS 'The resulting blended batch';
COMMENT ON COLUMN batch_blends.source_batch_id IS 'A source batch contributing to the blend';
COMMENT ON COLUMN batch_blends.volume_bbl IS 'Volume contributed from the source batch in BBL';

ALTER TABLE batch_blends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view batch blends"
  ON batch_blends FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert batch blends"
  ON batch_blends FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update batch blends"
  ON batch_blends FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete batch blends"
  ON batch_blends FOR DELETE
  USING (auth.uid() IS NOT NULL);

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES (
  'batch_blends',
  'Tracks source batches and volumes used in blending operations',
  'production',
  '[{"table": "batches", "type": "many-to-one", "column": "blend_batch_id", "description": "The resulting blended batch"},
    {"table": "batches", "type": "many-to-one", "column": "source_batch_id", "description": "A source batch contributing to the blend"}]'::jsonb
);

CREATE VIEW batch_blend_details
WITH (security_invoker = true)
AS
SELECT
  bb.*,
  sb.batch_number AS source_batch_number,
  sb.name AS source_batch_name,
  sb.status AS source_batch_status,
  sb.volume_bbl AS source_batch_volume,
  sb.actual_abv AS source_batch_abv,
  r.name AS source_recipe_name,
  tb.batch_number AS blend_batch_number,
  tb.name AS blend_batch_name
FROM batch_blends bb
JOIN batches sb ON sb.id = bb.source_batch_id
LEFT JOIN recipes r ON r.id = sb.recipe_id
JOIN batches tb ON tb.id = bb.blend_batch_id;

COMMENT ON VIEW batch_blend_details IS 'Batch blends with joined source and target batch details';

CREATE INDEX idx_batch_blends_blend_batch ON batch_blends(blend_batch_id);
CREATE INDEX idx_batch_blends_source_batch ON batch_blends(source_batch_id);
