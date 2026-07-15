-- Atomic, version-checked recipe editor save (#446).
--
-- The editor previously replaced every child collection with independent
-- DELETE and INSERT PostgREST requests. This function makes the parent patch
-- and all requested child replacements one transaction, serialized by a lock
-- on recipes.version. Omitted sections are untouched; a present [] clears.

CREATE OR REPLACE FUNCTION save_recipe_aggregate_atomic(
  p_recipe_id UUID,
  p_expected_version INTEGER,
  p_recipe_patch JSONB DEFAULT '{}'::JSONB,
  p_sections JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_current_version INTEGER;
  v_committed_version INTEGER;
  v_unknown_key TEXT;
BEGIN
  p_recipe_patch := COALESCE(p_recipe_patch, '{}'::JSONB);
  p_sections := COALESCE(p_sections, '{}'::JSONB);

  IF jsonb_typeof(p_recipe_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Recipe patch must be a JSON object';
  END IF;
  IF jsonb_typeof(p_sections) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Recipe sections must be a JSON object';
  END IF;

  SELECT key INTO v_unknown_key
  FROM jsonb_object_keys(p_recipe_patch) AS keys(key)
  WHERE NOT (key = ANY (ARRAY[
    'name', 'batch_size_bbl', 'boil_time_min', 'style_id', 'brand_id',
    'volume_bbl', 'yeast_id', 'target_attenuation', 'target_pitching_rate',
    'water_profile_id', 'target_water_profile_id', 'mash_water_volume_gal',
    'sparge_water_volume_gal', 'preboil_volume_bbl', 'mash_temp_f',
    'target_mash_ph', 'mash_efficiency', 'mash_schedule',
    'whirlpool_time_min', 'whirlpool_temp_f', 'whirlpool_rest_min',
    'target_ko_temp_f', 'target_ko_volume_bbl', 'fermentation_days',
    'conditioning_days', 'fermentation_schedule'
  ]));
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Unsupported recipe patch field: %s', v_unknown_key);
  END IF;

  v_unknown_key := NULL;
  SELECT key INTO v_unknown_key
  FROM jsonb_object_keys(p_sections) AS keys(key)
  WHERE NOT (key = ANY (ARRAY[
    'recipe_malts', 'recipe_hops', 'recipe_adjuncts',
    'recipe_sugars', 'recipe_spices', 'recipe_fruits'
  ]));
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Unsupported recipe section: %s', v_unknown_key);
  END IF;

  SELECT version
    INTO v_current_version
    FROM recipes
   WHERE id = p_recipe_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = format('Recipe not found: %s', p_recipe_id);
  END IF;
  IF p_expected_version IS NULL OR v_current_version <> p_expected_version THEN
    -- PT409 is PostgREST's explicit conflict status. Do not use 40001 here:
    -- the HTTP transaction runner may retry serialization failures instead
    -- of returning the visible optimistic-lock conflict to the editor.
    RAISE EXCEPTION USING
      ERRCODE = 'PT409',
      MESSAGE = format(
        'Recipe version conflict: expected %s, found %s',
        COALESCE(p_expected_version::TEXT, 'null'),
        v_current_version
      );
  END IF;

  IF p_sections ? 'recipe_malts' THEN
    IF jsonb_typeof(p_sections -> 'recipe_malts') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_malts must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_malts') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, malt_id UUID, weight_lbs NUMERIC, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.malt_id IS NULL
         OR row_data.weight_lbs IS NULL OR row_data.weight_lbs < 0
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_malts row';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM recipe_malts existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_malts') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_malts row belongs to another recipe';
    END IF;

    INSERT INTO recipe_malts (
      id, recipe_id, malt_id, weight_lbs, color_lov, ppg, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.malt_id, row_data.weight_lbs,
           (SELECT malt.color_lovibond FROM malts malt WHERE malt.id = row_data.malt_id),
           (SELECT malt.potential_ppg::INTEGER FROM malts malt WHERE malt.id = row_data.malt_id),
           (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_malts')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, malt_id UUID, weight_lbs NUMERIC, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      malt_id = EXCLUDED.malt_id,
      weight_lbs = EXCLUDED.weight_lbs,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_malts.recipe_id = p_recipe_id;

    DELETE FROM recipe_malts existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_malts') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  IF p_sections ? 'recipe_hops' THEN
    IF jsonb_typeof(p_sections -> 'recipe_hops') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_hops must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_hops') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, hop_id UUID, weight_oz NUMERIC, timing TEXT,
        boil_time_min INTEGER, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.hop_id IS NULL
         OR row_data.weight_oz IS NULL OR row_data.weight_oz < 0
         OR row_data.timing IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_hops row';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM recipe_hops existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_hops') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_hops row belongs to another recipe';
    END IF;

    INSERT INTO recipe_hops (
      id, recipe_id, hop_id, weight_oz, alpha_acid, timing,
      boil_time_min, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.hop_id, row_data.weight_oz,
           (SELECT hop.alpha_acid_typical FROM hops hop WHERE hop.id = row_data.hop_id),
           row_data.timing, row_data.boil_time_min,
           (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_hops')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, hop_id UUID, weight_oz NUMERIC, timing TEXT,
      boil_time_min INTEGER, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      hop_id = EXCLUDED.hop_id,
      weight_oz = EXCLUDED.weight_oz,
      timing = EXCLUDED.timing,
      boil_time_min = EXCLUDED.boil_time_min,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_hops.recipe_id = p_recipe_id;

    DELETE FROM recipe_hops existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_hops') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  IF p_sections ? 'recipe_adjuncts' THEN
    IF jsonb_typeof(p_sections -> 'recipe_adjuncts') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_adjuncts must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_adjuncts') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, adjunct_id UUID, weight_lbs NUMERIC, timing TEXT, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.adjunct_id IS NULL
         OR row_data.weight_lbs IS NULL OR row_data.weight_lbs < 0
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_adjuncts row';
    END IF;
    IF EXISTS (
      SELECT 1 FROM recipe_adjuncts existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_adjuncts') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_adjuncts row belongs to another recipe';
    END IF;

    INSERT INTO recipe_adjuncts (
      id, recipe_id, adjunct_id, weight_lbs, timing, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.adjunct_id, row_data.weight_lbs,
           row_data.timing, (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_adjuncts')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, adjunct_id UUID, weight_lbs NUMERIC, timing TEXT, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      adjunct_id = EXCLUDED.adjunct_id,
      weight_lbs = EXCLUDED.weight_lbs,
      timing = EXCLUDED.timing,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_adjuncts.recipe_id = p_recipe_id;

    DELETE FROM recipe_adjuncts existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_adjuncts') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  IF p_sections ? 'recipe_sugars' THEN
    IF jsonb_typeof(p_sections -> 'recipe_sugars') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_sugars must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_sugars') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, sugar_id UUID, weight_lbs NUMERIC, timing TEXT, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.sugar_id IS NULL
         OR row_data.weight_lbs IS NULL OR row_data.weight_lbs < 0
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_sugars row';
    END IF;
    IF EXISTS (
      SELECT 1 FROM recipe_sugars existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_sugars') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_sugars row belongs to another recipe';
    END IF;

    INSERT INTO recipe_sugars (
      id, recipe_id, sugar_id, weight_lbs, timing, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.sugar_id, row_data.weight_lbs,
           row_data.timing, (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_sugars')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, sugar_id UUID, weight_lbs NUMERIC, timing TEXT, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      sugar_id = EXCLUDED.sugar_id,
      weight_lbs = EXCLUDED.weight_lbs,
      timing = EXCLUDED.timing,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_sugars.recipe_id = p_recipe_id;

    DELETE FROM recipe_sugars existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_sugars') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  IF p_sections ? 'recipe_spices' THEN
    IF jsonb_typeof(p_sections -> 'recipe_spices') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_spices must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_spices') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, spice_id UUID, amount NUMERIC, unit TEXT, timing TEXT,
        boil_time_min INTEGER, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.spice_id IS NULL
         OR row_data.amount IS NULL OR row_data.amount < 0
         OR row_data.unit IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_spices row';
    END IF;
    IF EXISTS (
      SELECT 1 FROM recipe_spices existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_spices') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_spices row belongs to another recipe';
    END IF;

    INSERT INTO recipe_spices (
      id, recipe_id, spice_id, amount, unit, timing, boil_time_min, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.spice_id, row_data.amount,
           row_data.unit, row_data.timing, row_data.boil_time_min,
           (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_spices')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, spice_id UUID, amount NUMERIC, unit TEXT, timing TEXT,
      boil_time_min INTEGER, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      spice_id = EXCLUDED.spice_id,
      amount = EXCLUDED.amount,
      unit = EXCLUDED.unit,
      timing = EXCLUDED.timing,
      boil_time_min = EXCLUDED.boil_time_min,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_spices.recipe_id = p_recipe_id;

    DELETE FROM recipe_spices existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_spices') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  IF p_sections ? 'recipe_fruits' THEN
    IF jsonb_typeof(p_sections -> 'recipe_fruits') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recipe_fruits must be an array';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sections -> 'recipe_fruits') AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID, fruit_id UUID, amount NUMERIC, unit TEXT, timing TEXT, notes TEXT
      )
      WHERE row_data.id IS NULL OR row_data.fruit_id IS NULL
         OR row_data.amount IS NULL OR row_data.amount < 0
         OR row_data.unit IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid recipe_fruits row';
    END IF;
    IF EXISTS (
      SELECT 1 FROM recipe_fruits existing
      JOIN jsonb_array_elements(p_sections -> 'recipe_fruits') AS element(item)
        ON existing.id = (element.item ->> 'id')::UUID
      WHERE existing.recipe_id <> p_recipe_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'recipe_fruits row belongs to another recipe';
    END IF;

    INSERT INTO recipe_fruits (
      id, recipe_id, fruit_id, amount, unit, timing, position, notes
    )
    SELECT row_data.id, p_recipe_id, row_data.fruit_id, row_data.amount,
           row_data.unit, row_data.timing,
           (element.ordinality - 1)::INTEGER, row_data.notes
    FROM jsonb_array_elements(p_sections -> 'recipe_fruits')
      WITH ORDINALITY AS element(item, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
      id UUID, fruit_id UUID, amount NUMERIC, unit TEXT, timing TEXT, notes TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      fruit_id = EXCLUDED.fruit_id,
      amount = EXCLUDED.amount,
      unit = EXCLUDED.unit,
      timing = EXCLUDED.timing,
      position = EXCLUDED.position,
      notes = EXCLUDED.notes
    WHERE recipe_fruits.recipe_id = p_recipe_id;

    DELETE FROM recipe_fruits existing
     WHERE existing.recipe_id = p_recipe_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_sections -> 'recipe_fruits') AS element(item)
          WHERE (element.item ->> 'id')::UUID = existing.id
       );
  END IF;

  UPDATE recipes
     SET name = CASE WHEN p_recipe_patch ? 'name' THEN p_recipe_patch ->> 'name' ELSE name END,
         batch_size_bbl = CASE WHEN p_recipe_patch ? 'batch_size_bbl' THEN (p_recipe_patch ->> 'batch_size_bbl')::NUMERIC ELSE batch_size_bbl END,
         boil_time_min = CASE WHEN p_recipe_patch ? 'boil_time_min' THEN (p_recipe_patch ->> 'boil_time_min')::INTEGER ELSE boil_time_min END,
         style_id = CASE WHEN p_recipe_patch ? 'style_id' THEN (p_recipe_patch ->> 'style_id')::UUID ELSE style_id END,
         brand_id = CASE WHEN p_recipe_patch ? 'brand_id' THEN (p_recipe_patch ->> 'brand_id')::UUID ELSE brand_id END,
         volume_bbl = CASE WHEN p_recipe_patch ? 'volume_bbl' THEN (p_recipe_patch ->> 'volume_bbl')::NUMERIC ELSE volume_bbl END,
         yeast_id = CASE WHEN p_recipe_patch ? 'yeast_id' THEN (p_recipe_patch ->> 'yeast_id')::UUID ELSE yeast_id END,
         target_attenuation = CASE WHEN p_recipe_patch ? 'target_attenuation' THEN (p_recipe_patch ->> 'target_attenuation')::NUMERIC ELSE target_attenuation END,
         target_pitching_rate = CASE WHEN p_recipe_patch ? 'target_pitching_rate' THEN (p_recipe_patch ->> 'target_pitching_rate')::NUMERIC ELSE target_pitching_rate END,
         water_profile_id = CASE WHEN p_recipe_patch ? 'water_profile_id' THEN (p_recipe_patch ->> 'water_profile_id')::UUID ELSE water_profile_id END,
         target_water_profile_id = CASE WHEN p_recipe_patch ? 'target_water_profile_id' THEN (p_recipe_patch ->> 'target_water_profile_id')::UUID ELSE target_water_profile_id END,
         mash_water_volume_gal = CASE WHEN p_recipe_patch ? 'mash_water_volume_gal' THEN (p_recipe_patch ->> 'mash_water_volume_gal')::NUMERIC ELSE mash_water_volume_gal END,
         sparge_water_volume_gal = CASE WHEN p_recipe_patch ? 'sparge_water_volume_gal' THEN (p_recipe_patch ->> 'sparge_water_volume_gal')::NUMERIC ELSE sparge_water_volume_gal END,
         preboil_volume_bbl = CASE WHEN p_recipe_patch ? 'preboil_volume_bbl' THEN (p_recipe_patch ->> 'preboil_volume_bbl')::NUMERIC ELSE preboil_volume_bbl END,
         mash_temp_f = CASE WHEN p_recipe_patch ? 'mash_temp_f' THEN (p_recipe_patch ->> 'mash_temp_f')::INTEGER ELSE mash_temp_f END,
         target_mash_ph = CASE WHEN p_recipe_patch ? 'target_mash_ph' THEN (p_recipe_patch ->> 'target_mash_ph')::NUMERIC ELSE target_mash_ph END,
         mash_efficiency = CASE WHEN p_recipe_patch ? 'mash_efficiency' THEN (p_recipe_patch ->> 'mash_efficiency')::NUMERIC ELSE mash_efficiency END,
         mash_schedule = CASE WHEN p_recipe_patch ? 'mash_schedule' THEN p_recipe_patch -> 'mash_schedule' ELSE mash_schedule END,
         whirlpool_time_min = CASE WHEN p_recipe_patch ? 'whirlpool_time_min' THEN (p_recipe_patch ->> 'whirlpool_time_min')::INTEGER ELSE whirlpool_time_min END,
         whirlpool_temp_f = CASE WHEN p_recipe_patch ? 'whirlpool_temp_f' THEN (p_recipe_patch ->> 'whirlpool_temp_f')::INTEGER ELSE whirlpool_temp_f END,
         whirlpool_rest_min = CASE WHEN p_recipe_patch ? 'whirlpool_rest_min' THEN (p_recipe_patch ->> 'whirlpool_rest_min')::INTEGER ELSE whirlpool_rest_min END,
         target_ko_temp_f = CASE WHEN p_recipe_patch ? 'target_ko_temp_f' THEN (p_recipe_patch ->> 'target_ko_temp_f')::INTEGER ELSE target_ko_temp_f END,
         target_ko_volume_bbl = CASE WHEN p_recipe_patch ? 'target_ko_volume_bbl' THEN (p_recipe_patch ->> 'target_ko_volume_bbl')::NUMERIC ELSE target_ko_volume_bbl END,
         fermentation_days = CASE WHEN p_recipe_patch ? 'fermentation_days' THEN (p_recipe_patch ->> 'fermentation_days')::INTEGER ELSE fermentation_days END,
         conditioning_days = CASE WHEN p_recipe_patch ? 'conditioning_days' THEN (p_recipe_patch ->> 'conditioning_days')::INTEGER ELSE conditioning_days END,
         fermentation_schedule = CASE WHEN p_recipe_patch ? 'fermentation_schedule' THEN p_recipe_patch -> 'fermentation_schedule' ELSE fermentation_schedule END,
         updated_at = NOW()
   WHERE id = p_recipe_id
   RETURNING version INTO v_committed_version;

  RETURN jsonb_build_object('version', v_committed_version);
END;
$function$;

COMMENT ON FUNCTION save_recipe_aggregate_atomic(UUID, INTEGER, JSONB, JSONB)
IS 'Atomically applies an allowlisted recipe patch and replacements for the six recipe ingredient child tables with optimistic concurrency control.';

REVOKE ALL ON FUNCTION save_recipe_aggregate_atomic(UUID, INTEGER, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_recipe_aggregate_atomic(UUID, INTEGER, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION save_recipe_aggregate_atomic(UUID, INTEGER, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION save_recipe_aggregate_atomic(UUID, INTEGER, JSONB, JSONB) TO service_role;
