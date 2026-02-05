-- Recipe Variants (Split Templates)
-- Planned cold-side variations for a recipe.
-- Each variant represents a distinct beer that can be produced from one brew.

-- =============================================================================
-- recipe_variants: parent table for variant definitions
-- =============================================================================

CREATE TABLE recipe_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INT NOT NULL DEFAULT 0,
  planned_volume_bbl DECIMAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variants"
  ON recipe_variants FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variants_recipe ON recipe_variants(recipe_id);

COMMENT ON TABLE recipe_variants IS 'Planned cold-side variations for a recipe (split templates)';

-- =============================================================================
-- recipe_variant_hops: dry hop additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_hops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  hop_id UUID NOT NULL REFERENCES hops(id),
  weight_oz DECIMAL NOT NULL CHECK (weight_oz > 0),
  timing TEXT NOT NULL DEFAULT 'dry_hop',
  days INT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_hops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_hops"
  ON recipe_variant_hops FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_hops_variant ON recipe_variant_hops(recipe_variant_id);

COMMENT ON TABLE recipe_variant_hops IS 'Hop additions planned for a recipe variant (typically dry hops)';

-- =============================================================================
-- recipe_variant_adjuncts: cold-side adjuncts per variant
-- =============================================================================

CREATE TABLE recipe_variant_adjuncts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  adjunct_id UUID NOT NULL REFERENCES adjuncts(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_adjuncts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_adjuncts"
  ON recipe_variant_adjuncts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_adjuncts_variant ON recipe_variant_adjuncts(recipe_variant_id);

COMMENT ON TABLE recipe_variant_adjuncts IS 'Adjunct additions planned for a recipe variant';

-- =============================================================================
-- recipe_variant_fruits: cold-side fruit additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_fruits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  fruit_id UUID NOT NULL REFERENCES fruits(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_fruits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_fruits"
  ON recipe_variant_fruits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_fruits_variant ON recipe_variant_fruits(recipe_variant_id);

COMMENT ON TABLE recipe_variant_fruits IS 'Fruit additions planned for a recipe variant';

-- =============================================================================
-- recipe_variant_spices: cold-side spice additions per variant
-- =============================================================================

CREATE TABLE recipe_variant_spices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_variant_id UUID NOT NULL REFERENCES recipe_variants(id) ON DELETE CASCADE,
  spice_id UUID NOT NULL REFERENCES spices(id),
  amount DECIMAL NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL,
  timing TEXT,
  boil_time_min INT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recipe_variant_spices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recipe_variant_spices"
  ON recipe_variant_spices FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_recipe_variant_spices_variant ON recipe_variant_spices(recipe_variant_id);

COMMENT ON TABLE recipe_variant_spices IS 'Spice additions planned for a recipe variant';

-- =============================================================================
-- Schema Registry entries
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, key_fields, relationships) VALUES
  ('recipe_variants', 'Planned cold-side variations (split templates) for a recipe', 'production',
   '["name", "planned_volume_bbl", "position"]'::jsonb,
   '["recipes(recipe_id)"]'::jsonb),
  ('recipe_variant_hops', 'Hop additions (typically dry hops) planned for a recipe variant', 'production',
   '["weight_oz", "timing", "days"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "hops(hop_id)"]'::jsonb),
  ('recipe_variant_adjuncts', 'Adjunct additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "adjuncts(adjunct_id)"]'::jsonb),
  ('recipe_variant_fruits', 'Fruit additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "fruits(fruit_id)"]'::jsonb),
  ('recipe_variant_spices', 'Spice additions planned for a recipe variant', 'production',
   '["amount", "unit", "timing"]'::jsonb,
   '["recipe_variants(recipe_variant_id)", "spices(spice_id)"]'::jsonb);
