-- Water Chemistry Targets
-- Adds target mineral ppm values and source water profile reference
-- to water_addition_profiles for auto-calculating salt additions.

ALTER TABLE water_addition_profiles
  ADD COLUMN water_profile_id UUID REFERENCES water_profiles(id) ON DELETE SET NULL,
  ADD COLUMN target_calcium_ppm DECIMAL(6,1),
  ADD COLUMN target_magnesium_ppm DECIMAL(6,1),
  ADD COLUMN target_sodium_ppm DECIMAL(6,1),
  ADD COLUMN target_sulfate_ppm DECIMAL(6,1),
  ADD COLUMN target_chloride_ppm DECIMAL(6,1),
  ADD COLUMN target_bicarbonate_ppm DECIMAL(6,1),
  ADD COLUMN target_ph DECIMAL(3,1);

COMMENT ON COLUMN water_addition_profiles.water_profile_id IS 'Source water profile for auto-calculation baseline';
COMMENT ON COLUMN water_addition_profiles.target_calcium_ppm IS 'Target calcium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_magnesium_ppm IS 'Target magnesium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_sodium_ppm IS 'Target sodium in ppm';
COMMENT ON COLUMN water_addition_profiles.target_sulfate_ppm IS 'Target sulfate in ppm';
COMMENT ON COLUMN water_addition_profiles.target_chloride_ppm IS 'Target chloride in ppm';
COMMENT ON COLUMN water_addition_profiles.target_bicarbonate_ppm IS 'Target bicarbonate in ppm';
COMMENT ON COLUMN water_addition_profiles.target_ph IS 'Target mash pH';

CREATE INDEX idx_water_addition_profiles_water_profile
  ON water_addition_profiles(water_profile_id)
  WHERE water_profile_id IS NOT NULL;

-- Update schema registry
UPDATE _schema_registry
SET relationships = relationships || '[{"table": "water_profiles", "type": "belongsTo", "fk": "water_profile_id"}]'::jsonb
WHERE table_name = 'water_addition_profiles';
