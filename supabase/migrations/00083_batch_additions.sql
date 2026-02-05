-- Batch Additions & Variant Linkage
-- Tracks actual cold-side additions to batches and links batches to planned recipe variants.

-- =============================================================================
-- batch_additions: actual cold-side additions recorded on a batch
-- =============================================================================

CREATE TABLE batch_additions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  addition_type TEXT NOT NULL CHECK (addition_type IN ('hop', 'adjunct', 'fruit', 'spice', 'yeast', 'other')),
  catalog_id UUID,
  catalog_table TEXT,
  name TEXT NOT NULL,
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  days INT,
  date_added DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE batch_additions ENABLE ROW LEVEL SECURITY;

-- Note: WITH CHECK (true) is acceptable for single-tenant reference data per DEC-SEC-006
CREATE POLICY "Authenticated users can manage batch_additions"
  ON batch_additions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_batch_additions_batch ON batch_additions(batch_id);

COMMENT ON TABLE batch_additions IS 'Actual cold-side additions recorded on a batch (dry hops, fruit, adjuncts, etc.)';

-- =============================================================================
-- Add recipe_variant_id to batches
-- =============================================================================

ALTER TABLE batches ADD COLUMN recipe_variant_id UUID
  REFERENCES recipe_variants(id) ON DELETE SET NULL;

CREATE INDEX idx_batches_recipe_variant ON batches(recipe_variant_id);

COMMENT ON COLUMN batches.recipe_variant_id IS 'Links batch to planned recipe variant for plan vs actual comparison';

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields, relationships) VALUES
  ('batch_additions', 'Actual cold-side additions recorded on a batch', 'production',
   '["addition_type", "name", "amount", "unit", "timing", "date_added"]'::jsonb,
   '["batches(batch_id)"]'::jsonb);
