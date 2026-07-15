-- Make MongoDB-owned aggregate reconciliation atomic and idempotent.
--
-- Each function is one PostgreSQL transaction. Stable source mappings identify
-- rows owned by MongoDB, so retries update in place and stale cleanup cannot
-- delete manually-created rows. The shared advisory lock serializes sync calls
-- from entity, phase, and sync-all entry points.

CREATE OR REPLACE FUNCTION reconcile_mongodb_recipe_aggregate(
  p_mongo_id TEXT,
  p_recipe JSONB,
  p_malts JSONB DEFAULT '[]'::JSONB,
  p_hops JSONB DEFAULT '[]'::JSONB,
  p_yeasts JSONB DEFAULT '[]'::JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_candidate_id UUID;
  v_existing_count INTEGER;
  v_child JSONB;
  v_child_id UUID;
  v_child_mongo_id TEXT;
  v_malt_ids UUID[] := ARRAY[]::UUID[];
  v_hop_ids UUID[] := ARRAY[]::UUID[];
  v_yeast_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF COALESCE(p_mongo_id, '') = '' OR jsonb_typeof(p_recipe) <> 'object'
     OR jsonb_typeof(p_malts) <> 'array' OR jsonb_typeof(p_hops) <> 'array'
     OR jsonb_typeof(p_yeasts) <> 'array' THEN
    RAISE EXCEPTION 'Invalid MongoDB recipe aggregate payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mongodb-aggregate-sync', 0));

  SELECT pg_id INTO v_recipe_id
  FROM mongodb_sync_mappings
  WHERE entity_type = 'recipes' AND mongo_id = p_mongo_id;

  IF v_recipe_id IS NULL THEN
    -- First-run adoption: pre-migration syncs wrote recipes with random UUIDs and
    -- no ownership mapping, so on the initial run of this reconciler the only way
    -- to update those rows in place (instead of duplicating every recipe) is to
    -- match by unique name. The tradeoff: a manually created recipe that shares an
    -- exact name is adopted and becomes MongoDB-owned. We only adopt an unambiguous
    -- single match; 0 or >1 matches fall through to the source/generated id. The
    -- brew-log reconciler below adopts by brew_number for the same reason.
    SELECT count(*) INTO v_existing_count
      FROM recipes WHERE name = p_recipe->>'name';
    IF v_existing_count = 1 THEN
      SELECT id INTO v_recipe_id FROM recipes WHERE name = p_recipe->>'name';
    ELSE
      v_candidate_id := NULLIF(p_recipe->>'id', '')::UUID;
      v_recipe_id := COALESCE(v_candidate_id, gen_random_uuid());
    END IF;
  END IF;

  INSERT INTO recipes (
    id, name, boil_time_min, mash_temp_f, batch_size_bbl,
    target_attenuation, status, is_active, style_id, brand_id,
    created_at, updated_at
  ) VALUES (
    v_recipe_id,
    p_recipe->>'name',
    NULLIF(p_recipe->>'boil_time_min', '')::INTEGER,
    NULLIF(p_recipe->>'mash_temp_f', '')::INTEGER,
    NULLIF(p_recipe->>'batch_size_bbl', '')::NUMERIC,
    NULLIF(p_recipe->>'target_attenuation', '')::NUMERIC,
    COALESCE(p_recipe->>'status', 'complete'),
    COALESCE((p_recipe->>'is_active')::BOOLEAN, TRUE),
    NULLIF(p_recipe->>'style_id', '')::UUID,
    NULLIF(p_recipe->>'brand_id', '')::UUID,
    COALESCE(NULLIF(p_recipe->>'created_at', '')::TIMESTAMPTZ, NOW()),
    COALESCE(NULLIF(p_recipe->>'updated_at', '')::TIMESTAMPTZ, NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    boil_time_min = EXCLUDED.boil_time_min,
    mash_temp_f = EXCLUDED.mash_temp_f,
    batch_size_bbl = EXCLUDED.batch_size_bbl,
    target_attenuation = EXCLUDED.target_attenuation,
    status = EXCLUDED.status,
    is_active = EXCLUDED.is_active,
    style_id = EXCLUDED.style_id,
    brand_id = EXCLUDED.brand_id,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
  VALUES ('recipes', p_mongo_id, v_recipe_id)
  ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_malts)
  LOOP
    v_child_mongo_id := v_child->>'mongo_id';
    SELECT pg_id INTO v_child_id FROM mongodb_sync_mappings
      WHERE entity_type = 'recipe_malts' AND mongo_id = v_child_mongo_id;
    v_child_id := COALESCE(v_child_id, NULLIF(v_child->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO recipe_malts (id, recipe_id, malt_id, weight_lbs, position)
    VALUES (v_child_id, v_recipe_id, (v_child->>'malt_id')::UUID,
            (v_child->>'weight_lbs')::NUMERIC, COALESCE((v_child->>'position')::INTEGER, 0))
    ON CONFLICT (id) DO UPDATE SET malt_id = EXCLUDED.malt_id,
      weight_lbs = EXCLUDED.weight_lbs, position = EXCLUDED.position;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('recipe_malts', v_child_mongo_id, v_child_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_malt_ids := array_append(v_malt_ids, v_child_id);
  END LOOP;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_hops)
  LOOP
    v_child_mongo_id := v_child->>'mongo_id';
    SELECT pg_id INTO v_child_id FROM mongodb_sync_mappings
      WHERE entity_type = 'recipe_hops' AND mongo_id = v_child_mongo_id;
    v_child_id := COALESCE(v_child_id, NULLIF(v_child->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO recipe_hops (
      id, recipe_id, hop_id, weight_oz, timing, boil_time_min, position
    ) VALUES (
      v_child_id, v_recipe_id, (v_child->>'hop_id')::UUID,
      (v_child->>'weight_oz')::NUMERIC, COALESCE(v_child->>'timing', 'boil'),
      NULLIF(v_child->>'boil_time_min', '')::INTEGER,
      COALESCE((v_child->>'position')::INTEGER, 0)
    )
    ON CONFLICT (id) DO UPDATE SET hop_id = EXCLUDED.hop_id,
      weight_oz = EXCLUDED.weight_oz, timing = EXCLUDED.timing,
      boil_time_min = EXCLUDED.boil_time_min, position = EXCLUDED.position;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('recipe_hops', v_child_mongo_id, v_child_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_hop_ids := array_append(v_hop_ids, v_child_id);
  END LOOP;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_yeasts)
  LOOP
    v_child_mongo_id := v_child->>'mongo_id';
    SELECT pg_id INTO v_child_id FROM mongodb_sync_mappings
      WHERE entity_type = 'recipe_yeasts' AND mongo_id = v_child_mongo_id;
    v_child_id := COALESCE(v_child_id, NULLIF(v_child->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO recipe_yeasts (id, recipe_id, yeast_id, is_primary, position)
    VALUES (v_child_id, v_recipe_id, (v_child->>'yeast_id')::UUID,
            COALESCE((v_child->>'is_primary')::BOOLEAN, TRUE),
            COALESCE((v_child->>'position')::INTEGER, 0))
    ON CONFLICT (id) DO UPDATE SET yeast_id = EXCLUDED.yeast_id,
      is_primary = EXCLUDED.is_primary, position = EXCLUDED.position;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('recipe_yeasts', v_child_mongo_id, v_child_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_yeast_ids := array_append(v_yeast_ids, v_child_id);
  END LOOP;

  DELETE FROM recipe_malts row
   USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'recipe_malts'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_malt_ids));
  DELETE FROM recipe_hops row
   USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'recipe_hops'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_hop_ids));
  DELETE FROM recipe_yeasts row
   USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'recipe_yeasts'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_yeast_ids));

  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'recipe_malts' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_malt_ids));
  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'recipe_hops' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_hop_ids));
  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'recipe_yeasts' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_yeast_ids));

  RETURN 1 + jsonb_array_length(p_malts) + jsonb_array_length(p_hops) + jsonb_array_length(p_yeasts);
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_mongodb_brew_aggregate(
  p_mongo_id TEXT,
  p_brew_log JSONB,
  p_batches JSONB DEFAULT '[]'::JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_brew_id UUID;
  v_child JSONB;
  v_child_id UUID;
  v_child_mongo_id TEXT;
  v_child_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF COALESCE(p_mongo_id, '') = '' OR jsonb_typeof(p_brew_log) <> 'object'
     OR jsonb_typeof(p_batches) <> 'array' THEN
    RAISE EXCEPTION 'Invalid MongoDB brew aggregate payload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mongodb-aggregate-sync', 0));

  SELECT pg_id INTO v_brew_id FROM mongodb_sync_mappings
   WHERE entity_type = 'brew_logs' AND mongo_id = p_mongo_id;
  IF v_brew_id IS NULL THEN
    SELECT id INTO v_brew_id FROM brew_logs WHERE brew_number = p_brew_log->>'brew_number';
  END IF;
  v_brew_id := COALESCE(v_brew_id, NULLIF(p_brew_log->>'id', '')::UUID, gen_random_uuid());

  INSERT INTO brew_logs (id, brew_number, brew_date, status, events, legacy_data, notes)
  VALUES (v_brew_id, p_brew_log->>'brew_number', (p_brew_log->>'brew_date')::DATE,
          COALESCE(p_brew_log->>'status', 'completed'), COALESCE(p_brew_log->'events', '[]'::JSONB),
          p_brew_log->'legacy_data', p_brew_log->>'notes')
  ON CONFLICT (id) DO UPDATE SET brew_number = EXCLUDED.brew_number,
    brew_date = EXCLUDED.brew_date, status = EXCLUDED.status, events = EXCLUDED.events,
    legacy_data = EXCLUDED.legacy_data, notes = EXCLUDED.notes, updated_at = NOW();
  INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
  VALUES ('brew_logs', p_mongo_id, v_brew_id)
  ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_batches)
  LOOP
    v_child_mongo_id := v_child->>'mongo_id';
    SELECT pg_id INTO v_child_id FROM mongodb_sync_mappings
      WHERE entity_type = 'brew_log_batches' AND mongo_id = v_child_mongo_id;
    v_child_id := COALESCE(v_child_id, NULLIF(v_child->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO brew_log_batches (id, brew_log_id, batch_id, volume_bbl, notes)
    VALUES (v_child_id, v_brew_id, (v_child->>'batch_id')::UUID,
            (v_child->>'volume_bbl')::NUMERIC, v_child->>'notes')
    ON CONFLICT (id) DO UPDATE SET batch_id = EXCLUDED.batch_id,
      volume_bbl = EXCLUDED.volume_bbl, notes = EXCLUDED.notes;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('brew_log_batches', v_child_mongo_id, v_child_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_child_ids := array_append(v_child_ids, v_child_id);
  END LOOP;

  DELETE FROM brew_log_batches row USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'brew_log_batches'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_child_ids));
  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'brew_log_batches' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_child_ids));
  RETURN 1 + jsonb_array_length(p_batches);
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_mongodb_batch_reading_aggregate(
  p_mongo_id TEXT,
  p_readings JSONB DEFAULT '[]'::JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reading JSONB;
  v_reading_id UUID;
  v_reading_mongo_id TEXT;
  v_reading_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF COALESCE(p_mongo_id, '') = '' OR jsonb_typeof(p_readings) <> 'array' THEN
    RAISE EXCEPTION 'Invalid MongoDB reading aggregate payload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mongodb-aggregate-sync', 0));

  FOR v_reading IN SELECT value FROM jsonb_array_elements(p_readings)
  LOOP
    v_reading_mongo_id := v_reading->>'mongo_id';
    SELECT pg_id INTO v_reading_id FROM mongodb_sync_mappings
      WHERE entity_type = 'batch_logs' AND mongo_id = v_reading_mongo_id;
    v_reading_id := COALESCE(v_reading_id, NULLIF(v_reading->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO batch_logs (id, batch_id, log_type, data, created_at)
    VALUES (v_reading_id, (v_reading->>'batch_id')::UUID,
            COALESCE(v_reading->>'log_type', 'measurement'), v_reading->'data',
            COALESCE(NULLIF(v_reading->>'created_at', '')::TIMESTAMPTZ, NOW()))
    -- Preserve the original created_at on retry: the source rarely carries one,
    -- so re-running the same payload would otherwise reset it to NOW() each time.
    ON CONFLICT (id) DO UPDATE SET batch_id = EXCLUDED.batch_id,
      log_type = EXCLUDED.log_type, data = EXCLUDED.data;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('batch_logs', v_reading_mongo_id, v_reading_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_reading_ids := array_append(v_reading_ids, v_reading_id);
  END LOOP;

  DELETE FROM batch_logs row USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'batch_logs'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_reading_ids));
  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'batch_logs' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_reading_ids));
  RETURN jsonb_array_length(p_readings);
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_mongodb_packaging_aggregate(
  p_mongo_id TEXT,
  p_session JSONB,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_target_status TEXT;
  v_line JSONB;
  v_line_id UUID;
  v_line_mongo_id TEXT;
  v_line_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF COALESCE(p_mongo_id, '') = '' OR jsonb_typeof(p_session) <> 'object'
     OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Invalid MongoDB packaging aggregate payload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mongodb-aggregate-sync', 0));

  SELECT pg_id INTO v_session_id FROM mongodb_sync_mappings
   WHERE entity_type = 'packaging_sessions' AND mongo_id = p_mongo_id;
  v_session_id := COALESCE(v_session_id, NULLIF(p_session->>'id', '')::UUID, gen_random_uuid());
  v_target_status := COALESCE(p_session->>'status', 'planned');

  INSERT INTO packaging_sessions (id, session_date, status, notes, created_at, updated_at)
  VALUES (
    v_session_id, NULLIF(p_session->>'session_date', '')::DATE,
    CASE WHEN v_target_status = 'completed' THEN 'in_progress' ELSE v_target_status END,
    p_session->>'notes',
    COALESCE(NULLIF(p_session->>'created_at', '')::TIMESTAMPTZ, NOW()),
    COALESCE(NULLIF(p_session->>'updated_at', '')::TIMESTAMPTZ, NOW())
  )
  ON CONFLICT (id) DO UPDATE SET
    session_date = EXCLUDED.session_date,
    status = CASE
      WHEN v_target_status = 'completed' AND packaging_sessions.status = 'completed' THEN 'completed'
      WHEN v_target_status = 'completed' THEN 'in_progress'
      ELSE v_target_status
    END,
    notes = EXCLUDED.notes,
    updated_at = EXCLUDED.updated_at;
  INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
  VALUES ('packaging_sessions', p_mongo_id, v_session_id)
  ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_mongo_id := v_line->>'mongo_id';
    SELECT pg_id INTO v_line_id FROM mongodb_sync_mappings
      WHERE entity_type = 'session_line_items' AND mongo_id = v_line_mongo_id;
    v_line_id := COALESCE(v_line_id, NULLIF(v_line->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO session_line_items (
      id, session_id, brand_id, selling_format_id, batch_id,
      planned_quantity, actual_quantity
    ) VALUES (
      v_line_id, v_session_id, (v_line->>'brand_id')::UUID,
      NULLIF(v_line->>'selling_format_id', '')::UUID,
      NULLIF(v_line->>'batch_id', '')::UUID,
      NULLIF(v_line->>'planned_quantity', '')::INTEGER,
      NULLIF(v_line->>'actual_quantity', '')::INTEGER
    )
    ON CONFLICT (id) DO UPDATE SET brand_id = EXCLUDED.brand_id,
      selling_format_id = EXCLUDED.selling_format_id, batch_id = EXCLUDED.batch_id,
      planned_quantity = EXCLUDED.planned_quantity, actual_quantity = EXCLUDED.actual_quantity;
    INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
    VALUES ('session_line_items', v_line_mongo_id, v_line_id)
    ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;
    v_line_ids := array_append(v_line_ids, v_line_id);
  END LOOP;

  DELETE FROM session_line_items row USING mongodb_sync_mappings mapping
   WHERE mapping.entity_type = 'session_line_items'
     AND starts_with(mapping.mongo_id, p_mongo_id || ':')
     AND row.id = mapping.pg_id AND NOT (row.id = ANY(v_line_ids));
  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'session_line_items' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_line_ids));

  IF v_target_status = 'completed' THEN
    UPDATE packaging_sessions SET status = 'completed' WHERE id = v_session_id;
    IF NULLIF(p_session->>'completed_at', '') IS NOT NULL THEN
      UPDATE packaging_sessions SET completed_at = (p_session->>'completed_at')::TIMESTAMPTZ
       WHERE id = v_session_id;
    END IF;
  END IF;
  RETURN 1 + jsonb_array_length(p_lines);
END;
$$;

COMMENT ON FUNCTION reconcile_mongodb_recipe_aggregate(TEXT, JSONB, JSONB, JSONB, JSONB)
  IS 'Atomically reconciles one MongoDB-owned recipe and its source-owned ingredient rows.';
COMMENT ON FUNCTION reconcile_mongodb_brew_aggregate(TEXT, JSONB, JSONB)
  IS 'Atomically reconciles one MongoDB-owned brew log and its source-owned batch links.';
COMMENT ON FUNCTION reconcile_mongodb_batch_reading_aggregate(TEXT, JSONB)
  IS 'Atomically reconciles one MongoDB test document into source-owned batch readings.';
COMMENT ON FUNCTION reconcile_mongodb_packaging_aggregate(TEXT, JSONB, JSONB)
  IS 'Atomically reconciles one MongoDB-owned packaging session and its source-owned lines.';

REVOKE ALL ON FUNCTION reconcile_mongodb_recipe_aggregate(TEXT, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reconcile_mongodb_brew_aggregate(TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reconcile_mongodb_batch_reading_aggregate(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reconcile_mongodb_packaging_aggregate(TEXT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reconcile_mongodb_recipe_aggregate(TEXT, JSONB, JSONB, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_mongodb_brew_aggregate(TEXT, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_mongodb_batch_reading_aggregate(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_mongodb_packaging_aggregate(TEXT, JSONB, JSONB) TO authenticated, service_role;

UPDATE _schema_registry
SET description = 'Audit trail and ownership registry mapping MongoDB source records and aggregate children to stable PostgreSQL UUIDs',
    ai_context = '["MongoDB reconciliation RPCs use entity_type + mongo_id ownership mappings for idempotent, source-scoped cleanup"]'::JSONB,
    updated_at = NOW()
WHERE table_name = 'mongodb_sync_mappings';

NOTIFY pgrst, 'reload schema';
