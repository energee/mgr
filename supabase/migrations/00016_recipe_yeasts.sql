-- MGR Recipe Yeasts Migration
--
-- Creates recipe_yeasts junction table to link recipes to yeast strains.
-- Supports multiple yeast strains per recipe (e.g., primary + Brett, blends).

-- =============================================================================
-- Recipe Yeasts Junction Table
-- =============================================================================

CREATE TABLE recipe_yeasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  yeast_id UUID NOT NULL REFERENCES yeasts(id) ON DELETE RESTRICT,
  pitch_rate DECIMAL(4,2) DEFAULT 0.75,  -- million cells/mL/°P
  fermentation_temp_f INTEGER,            -- target fermentation temp
  is_primary BOOLEAN DEFAULT true,        -- primary vs secondary/brett
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(recipe_id, yeast_id)
);

COMMENT ON TABLE recipe_yeasts IS 'Recipe yeast additions. Supports multiple strains.';

CREATE INDEX idx_recipe_yeasts_recipe ON recipe_yeasts(recipe_id);
CREATE INDEX idx_recipe_yeasts_yeast ON recipe_yeasts(yeast_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE recipe_yeasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipe_yeast_access ON recipe_yeasts
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- Schema Registry
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES (
  'recipe_yeasts',
  'Recipe yeast additions. Links recipes to yeast catalog with pitch rate and fermentation temp.',
  'production',
  '["belongs_to: recipes", "belongs_to: yeasts"]',
  '["recipe_id", "yeast_id", "pitch_rate", "is_primary"]',
  '["Get yeasts for a recipe", "Find recipes using a specific yeast", "List recipes with Brett additions"]'
);
