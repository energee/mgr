-- Atomic, category-scoped replacement for recipe additions (#480).
--
-- The water-chemistry display and the non-water additions editor previously
-- sent DELETE and INSERT as separate PostgREST requests. Keep the replacement
-- boundary in Postgres so failure rolls back, concurrent writers conflict on
-- recipes.version, and one editor cannot replace the other category.

CREATE OR REPLACE FUNCTION replace_recipe_additions_atomic(
  p_recipe_id UUID,
  p_expected_version INTEGER,
  p_scope TEXT,
  p_items JSONB DEFAULT NULL
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
  v_invalid_additive UUID;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('water_chemistry', 'other') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Unsupported recipe additions scope: %s', COALESCE(p_scope, 'null'));
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
    RAISE EXCEPTION USING
      ERRCODE = 'PT409',
      MESSAGE = format(
        'Recipe version conflict: expected %s, found %s',
        COALESCE(p_expected_version::TEXT, 'null'),
        v_current_version
      );
  END IF;

  -- NULL means this category was omitted; [] below means explicitly clear it.
  IF p_items IS NULL THEN
    RETURN jsonb_build_object('version', v_current_version);
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Recipe additions items must be an array or null';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) AS element(item)
     WHERE jsonb_typeof(element.item) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Every recipe addition item must be an object';
  END IF;

  SELECT keys.key
    INTO v_unknown_key
    FROM jsonb_array_elements(p_items) AS element(item)
    CROSS JOIN LATERAL jsonb_object_keys(element.item) AS keys(key)
   WHERE NOT (keys.key = ANY (ARRAY[
     'id', 'additive_id', 'amount', 'unit', 'timing', 'target'
   ]))
   LIMIT 1;
  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Unsupported recipe addition field: %s', v_unknown_key);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
        id UUID,
        additive_id UUID,
        amount NUMERIC,
        unit TEXT,
        timing TEXT,
        target TEXT
      )
     WHERE row_data.additive_id IS NULL
        OR row_data.amount IS NULL
        OR row_data.amount < 0
        OR NULLIF(BTRIM(row_data.unit), '') IS NULL
        OR NULLIF(BTRIM(row_data.timing), '') IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid recipe addition item';
  END IF;

  SELECT row_data.additive_id
    INTO v_invalid_additive
    FROM jsonb_array_elements(p_items) AS element(item)
    CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(additive_id UUID)
    LEFT JOIN additives additive ON additive.id = row_data.additive_id
   WHERE additive.id IS NULL
      OR (p_scope = 'water_chemistry' AND additive.type NOT IN ('water_salt', 'acid'))
      OR (p_scope = 'other' AND additive.type IN ('water_salt', 'acid'))
   LIMIT 1;
  IF v_invalid_additive IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'Additive %s does not belong to scope %s',
        v_invalid_additive,
        p_scope
      );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) AS element(item)
      CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(id UUID)
      JOIN recipe_additions existing ON existing.id = row_data.id
     WHERE row_data.id IS NOT NULL
       AND existing.recipe_id IS DISTINCT FROM p_recipe_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Recipe addition row belongs to another owner';
  END IF;

  DELETE FROM recipe_additions existing
  USING additives additive
   WHERE existing.recipe_id = p_recipe_id
     AND additive.id = existing.additive_id
     AND (
       (p_scope = 'water_chemistry' AND additive.type IN ('water_salt', 'acid'))
       OR
       (p_scope = 'other' AND additive.type NOT IN ('water_salt', 'acid'))
     );

  INSERT INTO recipe_additions (
    id,
    recipe_id,
    additive_id,
    amount,
    unit,
    timing,
    target,
    position
  )
  SELECT
    COALESCE(row_data.id, gen_random_uuid()),
    p_recipe_id,
    row_data.additive_id,
    row_data.amount,
    BTRIM(row_data.unit),
    BTRIM(row_data.timing),
    NULLIF(BTRIM(row_data.target), ''),
    (element.ordinality - 1)::INTEGER
  FROM jsonb_array_elements(p_items)
    WITH ORDINALITY AS element(item, ordinality)
  CROSS JOIN LATERAL jsonb_to_record(element.item) AS row_data(
    id UUID,
    additive_id UUID,
    amount NUMERIC,
    unit TEXT,
    timing TEXT,
    target TEXT
  );

  -- The recipes_version_trigger increments version exactly once.
  UPDATE recipes
     SET updated_at = NOW()
   WHERE id = p_recipe_id
   RETURNING version INTO v_committed_version;

  RETURN jsonb_build_object('version', v_committed_version);
END;
$function$;

COMMENT ON FUNCTION replace_recipe_additions_atomic(UUID, INTEGER, TEXT, JSONB)
IS 'Atomically replaces one allowlisted recipe-additions category with optimistic concurrency control; NULL items omit and [] clears.';

REVOKE ALL ON FUNCTION replace_recipe_additions_atomic(UUID, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION replace_recipe_additions_atomic(UUID, INTEGER, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION replace_recipe_additions_atomic(UUID, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_recipe_additions_atomic(UUID, INTEGER, TEXT, JSONB) TO service_role;
