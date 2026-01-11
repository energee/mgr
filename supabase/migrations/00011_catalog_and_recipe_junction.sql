-- Catalog Tables and Recipe Junction Tables Migration
-- Implements DEC-HP-002: Recipe ingredients as junction tables
--
-- This migration creates:
-- - All catalog tables (malts, hops, yeasts, adjuncts, sugars, spices, fruits, additives)
-- - Beer styles reference table
-- - Water profiles table
-- - Recipe junction tables for ingredients
-- - Updates recipes table with new columns
-- - Creates recipes_with_estimates view

-- =============================================================================
-- CATALOG DOMAIN - Reference Tables
-- =============================================================================

-- Beer Styles (BJCP-based)
CREATE TABLE beer_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  og_min DECIMAL(4,3),
  og_max DECIMAL(4,3),
  fg_min DECIMAL(4,3),
  fg_max DECIMAL(4,3),
  ibu_min INTEGER,
  ibu_max INTEGER,
  srm_min INTEGER,
  srm_max INTEGER,
  abv_min DECIMAL(3,1),
  abv_max DECIMAL(3,1),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

COMMENT ON TABLE beer_styles IS 'Beer style definitions (BJCP guidelines) with parameter ranges.';

-- Yeasts
CREATE TABLE yeasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manufacturer TEXT,
  product_code TEXT,
  type TEXT NOT NULL DEFAULT 'ale',  -- ale, lager, wild, hybrid
  form TEXT DEFAULT 'liquid',  -- dry, liquid
  attenuation_min DECIMAL(4,1),
  attenuation_max DECIMAL(4,1),
  attenuation_typical DECIMAL(4,1),
  temp_min_f INTEGER,
  temp_max_f INTEGER,
  temp_ideal_f INTEGER,
  flocculation TEXT,  -- low, medium, high, very_high
  alcohol_tolerance DECIMAL(3,1),
  pitching_rate DECIMAL(3,1) DEFAULT 0.75,  -- million cells/mL/°P
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE yeasts IS 'Yeast strains catalog with fermentation characteristics.';

CREATE INDEX idx_yeasts_manufacturer ON yeasts(manufacturer);
CREATE INDEX idx_yeasts_type ON yeasts(type);

-- Malts
CREATE TABLE malts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  maltster TEXT,
  country TEXT,
  type TEXT NOT NULL DEFAULT 'base',  -- base, specialty, roasted, adjunct
  color_lovibond DECIMAL(5,1),
  potential_ppg DECIMAL(4,1),
  max_percentage INTEGER,
  requires_mash BOOLEAN DEFAULT true,
  diastatic_power DECIMAL(5,1),
  protein_percent DECIMAL(4,1),
  moisture_percent DECIMAL(4,1),
  description TEXT,
  bag_weight_lbs DECIMAL(6,2) DEFAULT 55,
  cost_per_lb DECIMAL(8,4),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE malts IS 'Malt and grain catalog with brewing properties.';

CREATE INDEX idx_malts_type ON malts(type);
CREATE INDEX idx_malts_maltster ON malts(maltster);

-- Hops
CREATE TABLE hops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  origin TEXT,
  type TEXT DEFAULT 'dual',  -- bittering, aroma, dual
  alpha_acid_min DECIMAL(4,1),
  alpha_acid_max DECIMAL(4,1),
  alpha_acid_typical DECIMAL(4,1),
  beta_acid_min DECIMAL(4,1),
  beta_acid_max DECIMAL(4,1),
  hsi DECIMAL(4,1),  -- Hop Storage Index (% loss/6mo)
  oil_ml_100g DECIMAL(5,2),
  myrcene_percent DECIMAL(4,1),
  humulene_percent DECIMAL(4,1),
  caryophyllene_percent DECIMAL(4,1),
  farnesene_percent DECIMAL(4,1),
  flavor_profile TEXT,
  substitutes TEXT,
  cost_per_lb DECIMAL(8,4),
  bag_weight_lbs DECIMAL(6,2) DEFAULT 11,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE hops IS 'Hop varieties catalog with acid and oil profiles.';

CREATE INDEX idx_hops_type ON hops(type);
CREATE INDEX idx_hops_origin ON hops(origin);

-- Adjuncts (non-malt fermentables)
CREATE TABLE adjuncts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'grain',  -- grain, extract, other
  color_lovibond DECIMAL(5,1),
  potential_ppg DECIMAL(4,1),
  requires_mash BOOLEAN DEFAULT false,
  description TEXT,
  cost_per_lb DECIMAL(8,4),
  bag_weight_lbs DECIMAL(6,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE adjuncts IS 'Adjunct ingredients (rice, corn, etc.).';

-- Sugars
CREATE TABLE sugars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'simple',  -- simple, invert, honey, maple, etc.
  color_lovibond DECIMAL(5,1),
  potential_ppg DECIMAL(4,1),
  fermentability DECIMAL(5,1),  -- % fermentable
  description TEXT,
  cost_per_lb DECIMAL(8,4),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sugars IS 'Sugar/syrup ingredients with fermentability.';

-- Spices
CREATE TABLE spices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'spice',  -- spice, herb, botanical, other
  description TEXT,
  typical_amount DECIMAL(8,4),
  typical_unit TEXT DEFAULT 'oz',
  cost_per_unit DECIMAL(8,4),
  unit TEXT DEFAULT 'oz',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE spices IS 'Spices and botanicals catalog.';

-- Fruits
CREATE TABLE fruits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'puree',  -- whole, puree, juice, concentrate, dried
  form TEXT DEFAULT 'frozen',  -- fresh, frozen, aseptic, canned
  sugar_content DECIMAL(4,1),  -- Brix
  description TEXT,
  cost_per_lb DECIMAL(8,4),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fruits IS 'Fruit additions catalog.';

-- Additives (water salts, clarifiers, nutrients, etc.)
CREATE TABLE additives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- water_salt, acid, clarifier, nutrient, enzyme, antifoam, other
  description TEXT,
  typical_amount DECIMAL(8,4),
  typical_unit TEXT,
  cost_per_unit DECIMAL(8,4),
  unit TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE additives IS 'Brewing additives: water salts, clarifiers, nutrients, enzymes.';

CREATE INDEX idx_additives_type ON additives(type);

-- =============================================================================
-- WATER PROFILES
-- =============================================================================

CREATE TABLE water_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  calcium_ppm DECIMAL(6,1),
  magnesium_ppm DECIMAL(6,1),
  sodium_ppm DECIMAL(6,1),
  sulfate_ppm DECIMAL(6,1),
  chloride_ppm DECIMAL(6,1),
  bicarbonate_ppm DECIMAL(6,1),
  ph DECIMAL(3,1),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE water_profiles IS 'Reusable water profiles (source water chemistry).';

-- =============================================================================
-- UPDATE RECIPES TABLE
-- =============================================================================

-- Add new columns to recipes
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS style_id UUID REFERENCES beer_styles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS yeast_id UUID REFERENCES yeasts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS water_profile_id UUID REFERENCES water_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS volume_bbl DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS batch_size_bbl DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS preboil_volume_bbl DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS target_ko_volume_bbl DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS mash_water_volume_gal DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS sparge_water_volume_gal DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS fermentation_days INTEGER,
  ADD COLUMN IF NOT EXISTS conditioning_days INTEGER,
  ADD COLUMN IF NOT EXISTS whirlpool_time_min INTEGER,
  ADD COLUMN IF NOT EXISTS whirlpool_temp_f INTEGER,
  ADD COLUMN IF NOT EXISTS whirlpool_rest_min INTEGER,
  ADD COLUMN IF NOT EXISTS target_mash_ph DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS mash_efficiency DECIMAL(4,1) DEFAULT 75,
  ADD COLUMN IF NOT EXISTS water_to_grain_ratio DECIMAL(3,1) DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS target_ko_temp_f INTEGER,
  ADD COLUMN IF NOT EXISTS target_attenuation DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS target_pitching_rate DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS yeast_nutrient_amount_g DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS mash_schedule JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS fermentation_schedule JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS brew_day_notes TEXT,
  ADD COLUMN IF NOT EXISTS tasting_notes TEXT,
  ADD COLUMN IF NOT EXISTS development_notes TEXT,
  ADD COLUMN IF NOT EXISTS use_default_additions BOOLEAN DEFAULT true;

-- Rename boil_time_minutes to boil_time_min for consistency
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'recipes' AND column_name = 'boil_time_minutes') THEN
    ALTER TABLE recipes RENAME COLUMN boil_time_minutes TO boil_time_min;
  END IF;
END $$;

-- =============================================================================
-- RECIPE JUNCTION TABLES
-- =============================================================================

-- Recipe Malts
CREATE TABLE recipe_malts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  malt_id UUID NOT NULL REFERENCES malts(id) ON DELETE RESTRICT,
  weight_lbs DECIMAL(10,4) NOT NULL,
  color_lov DECIMAL(4,1),  -- snapshot from catalog at time of add
  ppg INTEGER,              -- snapshot from catalog
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_malts IS 'Recipe grain bill - malt additions.';

CREATE INDEX idx_recipe_malts_recipe ON recipe_malts(recipe_id);
CREATE INDEX idx_recipe_malts_malt ON recipe_malts(malt_id);

-- Recipe Hops
CREATE TABLE recipe_hops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  hop_id UUID NOT NULL REFERENCES hops(id) ON DELETE RESTRICT,
  weight_oz DECIMAL(10,4) NOT NULL,
  alpha_acid DECIMAL(4,2),  -- snapshot from catalog or lot-specific
  timing TEXT NOT NULL DEFAULT 'boil',  -- mash, first_wort, boil, whirlpool, dry_hop
  boil_time_min INTEGER,    -- for boil/whirlpool additions
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_recipe_hops_timing CHECK (
    timing IN ('mash', 'first_wort', 'boil', 'whirlpool', 'dry_hop')
  )
);

COMMENT ON TABLE recipe_hops IS 'Recipe hop schedule.';

CREATE INDEX idx_recipe_hops_recipe ON recipe_hops(recipe_id);
CREATE INDEX idx_recipe_hops_hop ON recipe_hops(hop_id);

-- Recipe Adjuncts
CREATE TABLE recipe_adjuncts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  adjunct_id UUID NOT NULL REFERENCES adjuncts(id) ON DELETE RESTRICT,
  weight_lbs DECIMAL(10,4) NOT NULL,
  timing TEXT DEFAULT 'mash',  -- mash, boil, fermentation
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_adjuncts IS 'Recipe adjunct additions.';

CREATE INDEX idx_recipe_adjuncts_recipe ON recipe_adjuncts(recipe_id);

-- Recipe Sugars
CREATE TABLE recipe_sugars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sugar_id UUID NOT NULL REFERENCES sugars(id) ON DELETE RESTRICT,
  weight_lbs DECIMAL(10,4) NOT NULL,
  timing TEXT DEFAULT 'boil',  -- boil, fermentation, packaging
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_sugars IS 'Recipe sugar additions.';

CREATE INDEX idx_recipe_sugars_recipe ON recipe_sugars(recipe_id);

-- Recipe Spices
CREATE TABLE recipe_spices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  spice_id UUID NOT NULL REFERENCES spices(id) ON DELETE RESTRICT,
  amount DECIMAL(10,4) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'oz',  -- oz, g, tsp, tbsp, each
  timing TEXT DEFAULT 'boil',  -- boil, whirlpool, fermentation, secondary
  boil_time_min INTEGER,
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_spices IS 'Recipe spice/botanical additions.';

CREATE INDEX idx_recipe_spices_recipe ON recipe_spices(recipe_id);

-- Recipe Fruits
CREATE TABLE recipe_fruits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  fruit_id UUID NOT NULL REFERENCES fruits(id) ON DELETE RESTRICT,
  amount DECIMAL(10,4) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'lbs',  -- lbs, oz, gal, l, can
  timing TEXT DEFAULT 'secondary',  -- boil_end, primary, secondary, packaging
  position INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_fruits IS 'Recipe fruit additions.';

CREATE INDEX idx_recipe_fruits_recipe ON recipe_fruits(recipe_id);

-- Recipe Additions (water chemistry, clarifiers, etc.)
CREATE TABLE recipe_additions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,  -- NULL for brewery defaults
  additive_id UUID NOT NULL REFERENCES additives(id) ON DELETE RESTRICT,
  amount DECIMAL(8,4) NOT NULL,
  unit TEXT NOT NULL,  -- g, oz, tsp, tbsp, ml, tablets
  timing TEXT NOT NULL,  -- mash, sparge, boil, whirlpool, fermentation, packaging
  target TEXT,  -- for water salts: mash, sparge, kettle
  is_default BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE recipe_additions IS 'Recipe water chemistry and other additive additions.';

CREATE INDEX idx_recipe_additions_recipe ON recipe_additions(recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX idx_recipe_additions_default ON recipe_additions(is_default) WHERE is_default = true;

-- =============================================================================
-- RECIPE COLLABORATORS
-- =============================================================================

CREATE TABLE recipe_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recipe_id, user_id)
);

COMMENT ON TABLE recipe_collaborators IS 'Users who collaborated on a recipe.';

-- =============================================================================
-- CALCULATED VIEWS
-- =============================================================================

-- Recipes with calculated estimates
-- Note: This is a complex view that calculates OG, FG, ABV, IBU, SRM from ingredients
CREATE OR REPLACE VIEW recipes_with_estimates AS
WITH grain_totals AS (
  SELECT
    rm.recipe_id,
    SUM(rm.weight_lbs) as total_grain_lbs,
    SUM(rm.weight_lbs * COALESCE(rm.ppg, m.potential_ppg, 36)) as total_points,
    SUM(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2)) as mcu_sum
  FROM recipe_malts rm
  JOIN malts m ON m.id = rm.malt_id
  GROUP BY rm.recipe_id
),
hop_ibu AS (
  SELECT
    rh.recipe_id,
    -- Tinseth formula: IBU = (W * AA% * U * 74.89) / V
    -- Where U = 1.65 * 0.000125^(OG-1) * (1 - e^(-0.04*t)) / 4.15
    -- Simplified: use typical utilization by timing
    SUM(
      rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10)
      * CASE rh.timing
          WHEN 'boil' THEN
            CASE
              WHEN COALESCE(rh.boil_time_min, 60) >= 60 THEN 0.27
              WHEN COALESCE(rh.boil_time_min, 60) >= 45 THEN 0.24
              WHEN COALESCE(rh.boil_time_min, 60) >= 30 THEN 0.20
              WHEN COALESCE(rh.boil_time_min, 60) >= 15 THEN 0.14
              WHEN COALESCE(rh.boil_time_min, 60) >= 10 THEN 0.10
              WHEN COALESCE(rh.boil_time_min, 60) >= 5 THEN 0.05
              ELSE 0.02
            END
          WHEN 'first_wort' THEN 0.10
          WHEN 'whirlpool' THEN 0.05
          WHEN 'mash' THEN 0.08
          ELSE 0  -- dry_hop contributes no IBU
        END
    ) as weighted_ibu_factor
  FROM recipe_hops rh
  JOIN hops h ON h.id = rh.hop_id
  GROUP BY rh.recipe_id
)
SELECT
  r.*,
  -- OG calculation: Points = (grain_lbs * PPG * efficiency) / volume_gal
  -- OG = 1 + points / 1000
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
    ELSE NULL
  END as est_og,

  -- FG calculation: FG = 1 + (OG - 1) * (1 - attenuation)
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1 + (
        (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
        / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
      ) * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
    ELSE NULL
  END as est_fg,

  -- ABV calculation: (OG - FG) * 131.25
  CASE
    WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(
        (
          (gt.total_points * COALESCE(r.mash_efficiency, 75) / 100)
          / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000
        ) * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25
      , 1)
    ELSE NULL
  END as est_abv,

  -- IBU calculation: weighted_ibu_factor * 74.89 / volume_gal
  CASE
    WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
    ELSE NULL
  END as est_ibu,

  -- SRM calculation: Morey equation: SRM = 1.4922 * (MCU ^ 0.6859)
  -- MCU = (weight_lbs * color_lov) / volume_gal
  CASE
    WHEN gt.mcu_sum > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN
      ROUND(1.4922 * POWER(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859))
    ELSE NULL
  END as est_srm

FROM recipes r
LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
LEFT JOIN yeasts y ON y.id = r.yeast_id;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE beer_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE yeasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE malts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hops ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjuncts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sugars ENABLE ROW LEVEL SECURITY;
ALTER TABLE spices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE additives ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_malts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_hops ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_adjuncts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_sugars ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_spices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_fruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_additions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_collaborators ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users (single-tenant)
CREATE POLICY beer_styles_access ON beer_styles FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY yeasts_access ON yeasts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY malts_access ON malts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY hops_access ON hops FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY adjuncts_access ON adjuncts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY sugars_access ON sugars FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY spices_access ON spices FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY fruits_access ON fruits FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY additives_access ON additives FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY water_profiles_access ON water_profiles FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_malts_access ON recipe_malts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_hops_access ON recipe_hops FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_adjuncts_access ON recipe_adjuncts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_sugars_access ON recipe_sugars FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_spices_access ON recipe_spices FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_fruits_access ON recipe_fruits FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_additions_access ON recipe_additions FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY recipe_collaborators_access ON recipe_collaborators FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

CREATE TRIGGER update_beer_styles_updated_at BEFORE UPDATE ON beer_styles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_yeasts_updated_at BEFORE UPDATE ON yeasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_malts_updated_at BEFORE UPDATE ON malts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_hops_updated_at BEFORE UPDATE ON hops
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_adjuncts_updated_at BEFORE UPDATE ON adjuncts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sugars_updated_at BEFORE UPDATE ON sugars
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_spices_updated_at BEFORE UPDATE ON spices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_fruits_updated_at BEFORE UPDATE ON fruits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_additives_updated_at BEFORE UPDATE ON additives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_water_profiles_updated_at BEFORE UPDATE ON water_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples, ai_context) VALUES
('beer_styles', 'Beer style definitions (BJCP guidelines) with parameter ranges.', 'catalog',
 '{"has_many": [{"name": "recipes", "table": "recipes"}]}'::jsonb,
 '["name", "category", "og_min", "og_max", "ibu_min", "ibu_max"]'::jsonb,
 '["Find styles by category", "Get IPA styles", "List all styles with ABV > 8%"]'::jsonb,
 '{"purpose": "BJCP style guidelines for recipe analysis", "ai_actions": ["Compare recipe to style", "Suggest style for recipe"]}'::jsonb),

('yeasts', 'Yeast strains catalog with fermentation characteristics.', 'catalog',
 '{"has_many": [{"name": "recipes", "table": "recipes"}]}'::jsonb,
 '["name", "manufacturer", "product_code", "type", "attenuation_typical"]'::jsonb,
 '["Find yeast by manufacturer", "List ale yeasts", "Get high-attenuation yeasts"]'::jsonb,
 '{"purpose": "Yeast strain reference for fermentation planning", "ai_actions": ["Suggest yeast for style", "Calculate pitch rate"]}'::jsonb),

('malts', 'Malt and grain catalog with brewing properties.', 'catalog',
 '{"has_many": [{"name": "recipe_malts", "table": "recipe_malts"}]}'::jsonb,
 '["name", "maltster", "type", "color_lovibond", "potential_ppg"]'::jsonb,
 '["Find base malts", "List malts by color range", "Get malts from specific maltster"]'::jsonb,
 '{"purpose": "Grain ingredients for recipe formulation", "ai_actions": ["Calculate grain bill", "Suggest malt substitutes"]}'::jsonb),

('hops', 'Hop varieties catalog with acid and oil profiles.', 'catalog',
 '{"has_many": [{"name": "recipe_hops", "table": "recipe_hops"}]}'::jsonb,
 '["name", "origin", "type", "alpha_acid_typical"]'::jsonb,
 '["Find aroma hops", "List hops by origin", "Get high-alpha hops"]'::jsonb,
 '{"purpose": "Hop varieties for bittering and aroma", "ai_actions": ["Calculate IBU", "Suggest hop substitutes"]}'::jsonb),

('water_profiles', 'Reusable water profiles (source water chemistry).', 'production',
 '{"has_many": [{"name": "recipes", "table": "recipes"}]}'::jsonb,
 '["name", "sulfate_ppm", "chloride_ppm", "calcium_ppm"]'::jsonb,
 '["Get Burton profile", "Find balanced profiles", "List profiles for hoppy beers"]'::jsonb,
 '{"purpose": "Water chemistry for brewing", "ai_actions": ["Analyze water for style", "Suggest salt additions"]}'::jsonb),

('recipe_malts', 'Recipe grain bill - malt additions.', 'production',
 '{"belongs_to": [{"name": "recipe", "table": "recipes"}, {"name": "malt", "table": "malts"}]}'::jsonb,
 '["recipe_id", "malt_id", "weight_lbs", "position"]'::jsonb,
 '["Get grain bill for recipe", "Find recipes using specific malt"]'::jsonb,
 '{"purpose": "Links recipes to malts with weights"}'::jsonb),

('recipe_hops', 'Recipe hop schedule.', 'production',
 '{"belongs_to": [{"name": "recipe", "table": "recipes"}, {"name": "hop", "table": "hops"}]}'::jsonb,
 '["recipe_id", "hop_id", "weight_oz", "timing", "boil_time_min"]'::jsonb,
 '["Get hop schedule for recipe", "Find recipes using specific hop"]'::jsonb,
 '{"purpose": "Links recipes to hops with timing and amounts"}'::jsonb)

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  ai_context = EXCLUDED.ai_context,
  updated_at = NOW();

-- Update recipes entry with calculated_fields
UPDATE _schema_registry SET
  calculated_fields = '[
    {"field": "est_og", "source": "recipes_with_estimates view", "formula": "1 + (grain_points * efficiency / volume_gal) / 1000"},
    {"field": "est_fg", "source": "recipes_with_estimates view", "formula": "1 + (OG - 1) * (1 - attenuation)"},
    {"field": "est_abv", "source": "recipes_with_estimates view", "formula": "(OG - FG) * 131.25"},
    {"field": "est_ibu", "source": "recipes_with_estimates view", "formula": "Tinseth formula with timing-based utilization"},
    {"field": "est_srm", "source": "recipes_with_estimates view", "formula": "1.4922 * (MCU ^ 0.6859)"}
  ]'::jsonb,
  relationships = '{"belongs_to": [{"name": "brand", "table": "brands"}, {"name": "style", "table": "beer_styles"}, {"name": "yeast", "table": "yeasts"}, {"name": "water_profile", "table": "water_profiles"}], "has_many": [{"name": "malts", "table": "recipe_malts"}, {"name": "hops", "table": "recipe_hops"}, {"name": "batches", "table": "batches"}]}'::jsonb,
  updated_at = NOW()
WHERE table_name = 'recipes';

SELECT 'Catalog and recipe junction tables migration complete!' AS message;
