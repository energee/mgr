-- Water Addition Profiles
-- Named, reusable sets of water salt/acid additions (e.g., "Hoppy IPA Salts").
-- Profile items stored in recipe_additions with profile_id FK.

-- =============================================================================
-- 1. CREATE water_addition_profiles TABLE
-- =============================================================================

CREATE TABLE water_addition_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE water_addition_profiles IS 'Named, reusable sets of water salt/acid additions for recipes';
COMMENT ON COLUMN water_addition_profiles.name IS 'Profile name, e.g. Hoppy IPA Salts';
COMMENT ON COLUMN water_addition_profiles.is_active IS 'Inactive profiles hidden from dropdowns';

ALTER TABLE water_addition_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read water addition profiles"
  ON water_addition_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert water addition profiles"
  ON water_addition_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update water addition profiles"
  ON water_addition_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete water addition profiles"
  ON water_addition_profiles FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_water_addition_profiles_updated_at
  BEFORE UPDATE ON water_addition_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. MODIFY recipe_additions: add profile_id FK, clean up dead columns
-- =============================================================================

ALTER TABLE recipe_additions
  ADD COLUMN profile_id UUID REFERENCES water_addition_profiles(id) ON DELETE CASCADE;

CREATE INDEX idx_recipe_additions_profile
  ON recipe_additions(profile_id) WHERE profile_id IS NOT NULL;

DELETE FROM recipe_additions WHERE recipe_id IS NULL;

ALTER TABLE recipe_additions
  ADD CONSTRAINT recipe_additions_owner_check
  CHECK (
    (recipe_id IS NOT NULL AND profile_id IS NULL) OR
    (recipe_id IS NULL AND profile_id IS NOT NULL)
  );

ALTER TABLE recipe_additions DROP COLUMN IF EXISTS is_default;

-- =============================================================================
-- 3. DROP VIEW (depends on use_default_additions column being dropped)
-- =============================================================================

DROP VIEW IF EXISTS recipes_with_estimates;

-- =============================================================================
-- 4. MODIFY recipes: replace use_default_additions with water_addition_profile_id
-- =============================================================================

ALTER TABLE recipes
  ADD COLUMN water_addition_profile_id UUID
    REFERENCES water_addition_profiles(id) ON DELETE SET NULL;

ALTER TABLE recipes DROP COLUMN IF EXISTS use_default_additions;

-- =============================================================================
-- 5. RECREATE recipes_with_estimates VIEW with new column
-- =============================================================================

CREATE VIEW recipes_with_estimates
WITH (security_invoker = true)
AS
WITH grain_totals AS (
    SELECT rm.recipe_id,
        sum(rm.weight_lbs) AS total_grain_lbs,
        sum(rm.weight_lbs * COALESCE(rm.ppg::numeric, m.potential_ppg, 36::numeric)) AS total_points,
        sum(rm.weight_lbs * COALESCE(rm.color_lov, m.color_lovibond, 2::numeric)) AS mcu_sum
    FROM recipe_malts rm
        JOIN malts m ON m.id = rm.malt_id
    GROUP BY rm.recipe_id
), hop_ibu AS (
    SELECT rh.recipe_id,
        sum(rh.weight_oz * COALESCE(rh.alpha_acid, h.alpha_acid_typical, 10::numeric) *
            CASE rh.timing
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
                ELSE 0::numeric
            END) AS weighted_ibu_factor
    FROM recipe_hops rh
        JOIN hops h ON h.id = rh.hop_id
    GROUP BY rh.recipe_id
), batch_counts AS (
    SELECT recipe_id, count(*)::int AS batch_count
    FROM batches
    WHERE recipe_id IS NOT NULL
    GROUP BY recipe_id
)
SELECT r.id,
    r.name,
    r.style,
    r.description,
    r.target_og,
    r.target_fg,
    r.target_abv,
    r.target_ibu,
    r.target_srm,
    r.batch_size_gallons,
    r.boil_time_min,
    r.mash_temp_f,
    r.ingredients,
    r.instructions,
    r.notes,
    r.is_active,
    r.created_at,
    r.updated_at,
    r.brand_id,
    r.style_id,
    r.yeast_id,
    r.water_profile_id,
    r.created_by,
    r.volume_bbl,
    r.batch_size_bbl,
    r.preboil_volume_bbl,
    r.target_ko_volume_bbl,
    r.mash_water_volume_gal,
    r.sparge_water_volume_gal,
    r.fermentation_days,
    r.conditioning_days,
    r.whirlpool_time_min,
    r.whirlpool_temp_f,
    r.whirlpool_rest_min,
    r.target_mash_ph,
    r.mash_efficiency,
    r.water_to_grain_ratio,
    r.target_ko_temp_f,
    r.target_attenuation,
    r.target_pitching_rate,
    r.yeast_nutrient_amount_g,
    r.mash_schedule,
    r.fermentation_schedule,
    r.brew_day_notes,
    r.tasting_notes,
    r.development_notes,
    r.water_addition_profile_id,
    r.is_template,
    r.status,
    bs.name AS style_name,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000, 3)
        ELSE NULL::numeric
    END AS est_og,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1 + gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * (1 - COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100), 3)
        ELSE NULL::numeric
    END AS est_fg,
    CASE
        WHEN gt.total_grain_lbs > 0 AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(gt.total_points * COALESCE(r.mash_efficiency, 75) / 100 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31) / 1000 * COALESCE(r.target_attenuation, y.attenuation_typical, 75) / 100 * 131.25, 1)
        ELSE NULL::numeric
    END AS est_abv,
    CASE
        WHEN hi.weighted_ibu_factor IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(hi.weighted_ibu_factor * 74.89 / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31))
        ELSE NULL::numeric
    END AS est_ibu,
    CASE
        WHEN gt.mcu_sum IS NOT NULL AND COALESCE(r.batch_size_bbl, r.volume_bbl, 1) > 0 THEN round(1.4922 * power(gt.mcu_sum / (COALESCE(r.batch_size_bbl, r.volume_bbl, 1) * 31), 0.6859), 1)
        ELSE NULL::numeric
    END AS est_srm,
    NULL::numeric AS est_cogs,
    COALESCE(bc.batch_count, 0) AS batch_count,
    r.pricing_tier_id
FROM recipes r
    LEFT JOIN beer_styles bs ON bs.id = r.style_id
    LEFT JOIN grain_totals gt ON gt.recipe_id = r.id
    LEFT JOIN hop_ibu hi ON hi.recipe_id = r.id
    LEFT JOIN yeasts y ON y.id = r.yeast_id
    LEFT JOIN batch_counts bc ON bc.recipe_id = r.id;

-- =============================================================================
-- 6. INSERT default_water_profile_id INTO system_settings
-- =============================================================================

INSERT INTO system_settings (key, value, description, category) VALUES
  ('default_water_profile_id', 'null', 'Default source water profile UUID for new recipes', 'production')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 7. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples)
VALUES
  ('water_addition_profiles', 'Named, reusable sets of water salt/acid additions for recipes', 'system',
   '[{"table": "recipe_additions", "type": "hasMany", "fk": "profile_id"}, {"table": "recipes", "type": "hasMany", "fk": "water_addition_profile_id"}]'::jsonb,
   '["id", "name", "is_active"]'::jsonb,
   '["Show all water addition profiles", "What water salts does the Hoppy IPA profile use?"]'::jsonb)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples;
