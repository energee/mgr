-- =============================================================================
-- 00288 — Fix MongoDB historical-sync replay failures
-- =============================================================================
-- Four failure classes surfaced by a full sync run against production Mongo
-- (all captured in mongodb_sync_log error_details, 2026-08-12):
--
-- 1. recipes / brew_logs: "duplicate key … recipe_yeasts_recipe_id_yeast_id_key"
--    and "… brew_log_batches_brew_log_id_batch_id_key". The adoption paths in
--    00258 (match recipe by name, brew log by brew_number) adopt parents that
--    already have child rows from pre-mapping syncs. Those children have no
--    mongodb_sync_mappings entry, so the reconciler inserts new deterministic-id
--    children beside them and collides on the natural-key unique constraints.
--    Fix: a mapped parent owns its children wholesale — delete the parent's
--    child rows and reinsert from source inside the same transaction. (These
--    child tables have no inbound FKs, verified against the catalog.)
--
-- 2. packaging_sessions: 'invalid input syntax for type integer: "70.5"'.
--    Mongo line quantities are fractional (half-barrels, partial cases) but
--    session_line_items.planned/actual_quantity were INTEGER. Fix: NUMERIC
--    columns + NUMERIC casts. Also adopt colliding lines by their natural key
--    (uq_session_line_items_batch_format) instead of failing — lines can be
--    referenced by finished_goods, so they are adopted, never deleted here.
--
-- 3. vessel_transfers: every historical transfer hit handle_vessel_transfer's
--    occupancy guard ("destination vessel already holds a different batch") —
--    correct for live operations, wrong for replaying years of history. Fix:
--    a transaction-local flag (mgr.mongodb_sync) set only inside the new
--    reconcile_mongodb_transfers RPC; the trigger returns early under it and
--    leaves live vessel state untouched (vessels are owned by the live app,
--    not by replayed history).
--
-- 4. batches "Invalid state transition: completed -> fermenting" is fixed
--    app-side (sync keeps the existing PG status for already-known batches);
--    no schema change needed.
--
-- Security note on the flag: it is only settable in-transaction via the
-- reconcile RPC (PostgREST exposes no raw set_config), the RPC is SECURITY
-- INVOKER so RLS still applies to every write, and grants mirror the other
-- reconcile_mongodb_* functions from 00258.

-- =============================================================================
-- PART 1 — session_line_items quantities are fractional in the real world
-- =============================================================================

-- packaging_sessions_with_summary aggregates these columns, so it must be
-- dropped for the ALTER and recreated identically (body from 00278; the SUM
-- outputs simply become NUMERIC instead of BIGINT).
DROP VIEW IF EXISTS packaging_sessions_with_summary;

ALTER TABLE session_line_items
  ALTER COLUMN planned_quantity TYPE NUMERIC USING planned_quantity::NUMERIC,
  ALTER COLUMN actual_quantity TYPE NUMERIC USING actual_quantity::NUMERIC;

CREATE VIEW packaging_sessions_with_summary
WITH (security_invoker = true)
AS
SELECT
  ps.*,
  COALESCE(agg.line_count, 0) AS line_count,
  agg.brands,
  COALESCE(agg.total_planned, 0) AS total_planned,
  COALESCE(agg.total_actual, 0) AS total_actual,
  (COALESCE(agg.total_actual, 0) - COALESCE(agg.total_planned, 0)) AS total_variance
FROM packaging_sessions ps
LEFT JOIN (
  SELECT
    sli.session_id,
    COUNT(*) AS line_count,
    STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS brands,
    SUM(sli.planned_quantity) AS total_planned,
    SUM(sli.actual_quantity) AS total_actual
  FROM session_line_items sli
  JOIN brands b ON b.id = sli.brand_id
  GROUP BY sli.session_id
) agg ON agg.session_id = ps.id;

COMMENT ON VIEW packaging_sessions_with_summary
  IS 'Packaging sessions with aggregated line item counts, brand names, quantity totals, and variance. Recreated in 00288 (identical body to 00278) around the planned/actual_quantity INTEGER->NUMERIC change.';

COMMENT ON COLUMN session_line_items.planned_quantity IS
  'Planned units for this line. NUMERIC since 00288: MongoDB-era sessions carry fractional quantities (e.g. 70.5 cases, 3.33 kegs).';
COMMENT ON COLUMN session_line_items.actual_quantity IS
  'Actually-packaged units for this line. NUMERIC since 00288 (see planned_quantity).';

-- =============================================================================
-- PART 2 — recipe aggregate: children are owned wholesale by a mapped parent
-- =============================================================================

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

  -- 00288: a MongoDB-owned recipe owns its ingredient list wholesale. Replace
  -- children by parent id rather than diffing against mappings: pre-mapping
  -- child rows (including those brought in by name-adoption above) have no
  -- mapping entry, and leaving them beside freshly-inserted deterministic-id
  -- rows both double-counts ingredients and violates the natural-key unique
  -- constraints (recipe_yeasts_recipe_id_yeast_id_key — the 2026-08-12 sync
  -- failure). Delete is safe: no table references recipe_malts/hops/yeasts.
  DELETE FROM recipe_malts WHERE recipe_id = v_recipe_id;
  DELETE FROM recipe_hops WHERE recipe_id = v_recipe_id;
  DELETE FROM recipe_yeasts WHERE recipe_id = v_recipe_id;

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

  -- GC mappings for children that no longer exist in the source document.
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

-- =============================================================================
-- PART 3 — brew aggregate: same wholesale child ownership for brew_log_batches
-- =============================================================================

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
  -- 00288: keep the existing status on update — brew_logs is state-machined
  -- (validate_state_transition), and forcing the source's status onto a row
  -- the live app has moved on rejects the whole reconcile (same class as the
  -- batches "completed -> fermenting" failure; PG owns current state, the
  -- source still sets status on first insert).
  ON CONFLICT (id) DO UPDATE SET brew_number = EXCLUDED.brew_number,
    brew_date = EXCLUDED.brew_date, status = brew_logs.status, events = EXCLUDED.events,
    legacy_data = EXCLUDED.legacy_data, notes = EXCLUDED.notes, updated_at = NOW();
  INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
  VALUES ('brew_logs', p_mongo_id, v_brew_id)
  ON CONFLICT (entity_type, mongo_id) DO UPDATE SET pg_id = EXCLUDED.pg_id;

  -- 00288: replace children wholesale (see recipe reconciler). Pre-mapping rows
  -- adopted via brew_number collide on brew_log_batches_brew_log_id_batch_id_key
  -- otherwise. No table references brew_log_batches.
  DELETE FROM brew_log_batches WHERE brew_log_id = v_brew_id;

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

  DELETE FROM mongodb_sync_mappings
   WHERE entity_type = 'brew_log_batches' AND starts_with(mongo_id, p_mongo_id || ':')
     AND NOT (pg_id = ANY(v_child_ids));
  RETURN 1 + jsonb_array_length(p_batches);
END;
$$;

-- =============================================================================
-- PART 4 — packaging aggregate: NUMERIC quantities + natural-key line adoption
-- =============================================================================

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
    -- 00288: adopt an unmapped line occupying this line's natural key
    -- (uq_session_line_items_batch_format) instead of colliding with it.
    -- Lines can be referenced by finished_goods, so unlike recipe/brew
    -- children they are adopted in place, never deleted and reinserted.
    IF v_line_id IS NULL AND NULLIF(v_line->>'batch_id', '') IS NOT NULL THEN
      SELECT id INTO v_line_id FROM session_line_items
       WHERE session_id = v_session_id
         AND batch_id = (v_line->>'batch_id')::UUID
         AND selling_format_id IS NOT DISTINCT FROM NULLIF(v_line->>'selling_format_id', '')::UUID;
    END IF;
    v_line_id := COALESCE(v_line_id, NULLIF(v_line->>'id', '')::UUID, gen_random_uuid());
    INSERT INTO session_line_items (
      id, session_id, brand_id, selling_format_id, batch_id,
      planned_quantity, actual_quantity
    ) VALUES (
      v_line_id, v_session_id, (v_line->>'brand_id')::UUID,
      NULLIF(v_line->>'selling_format_id', '')::UUID,
      NULLIF(v_line->>'batch_id', '')::UUID,
      NULLIF(v_line->>'planned_quantity', '')::NUMERIC,
      NULLIF(v_line->>'actual_quantity', '')::NUMERIC
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

-- =============================================================================
-- PART 5 — vessel transfers: replay history without touching live vessel state
-- =============================================================================
-- handle_vessel_transfer (00228/00235) claims the destination vessel and frees
-- the source per transfer — the right behavior for a live operation, and the
-- wrong one for replaying years of history where every vessel legitimately
-- held many batches over time. Under the transaction-local mgr.mongodb_sync
-- flag (set only by reconcile_mongodb_transfers below) the trigger records the
-- transfer row and leaves vessels alone: live vessel occupancy is owned by the
-- live app, not by replayed history.

CREATE OR REPLACE FUNCTION public.handle_vessel_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_in      numeric;
  v_out     numeric;
  v_gap     numeric;
  v_alloc   numeric;
  v_empties boolean;
BEGIN
  -- 00288: historical replay from MongoDB — record the row, skip live vessel
  -- claim/free entirely (see migration header).
  IF current_setting('mgr.mongodb_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- M4: claim the destination atomically. The WHERE re-asserts the precondition,
  -- so under READ COMMITTED a concurrent transfer that got there first makes
  -- this UPDATE match zero rows instead of silently overwriting it. An empty
  -- vessel, or one already holding this same batch (idempotent re-transfer /
  -- consolidation), is allowed.
  -- (Opposite-direction concurrent transfers can deadlock on the two vessel
  -- rows; Postgres aborts one -- no corruption. See header.)
  UPDATE vessels
  SET status = 'in_use',
      current_batch_id = NEW.batch_id,
      updated_at = NOW()
  WHERE id = NEW.to_vessel_id
    AND (current_batch_id IS NULL OR current_batch_id = NEW.batch_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The destination vessel already holds a different batch — refresh and choose an empty vessel.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- M5: free the source only on a full move, proven by the transfer ledger.
  -- The ledger is authoritative only up to its own completeness: additions and
  -- allocations (losses/samples/pours) change volume without a transfer row,
  -- and concurrent outbound transfers are invisible to this read -- all of
  -- which bias v_empties toward FALSE, i.e. toward NOT freeing (benign).
  -- NULL from_vessel_id = knockout from kettle (no source vessel to free).
  IF NEW.from_vessel_id IS NOT NULL THEN
    SELECT COALESCE(sum(volume_bbl), 0) INTO v_in
    FROM vessel_transfers
    WHERE batch_id = NEW.batch_id
      AND to_vessel_id = NEW.from_vessel_id
      AND id <> NEW.id;

    SELECT COALESCE(sum(volume_bbl), 0) INTO v_out
    FROM vessel_transfers
    WHERE batch_id = NEW.batch_id
      AND from_vessel_id = NEW.from_vessel_id
      AND id <> NEW.id;

    IF v_in > 0 THEN
      -- 0.0001 bbl ~= 0.4 fl oz: absorbs decimal noise, far below any real pour.
      v_gap := v_in - (v_out + NEW.volume_bbl);
      v_empties := v_gap <= 0.0001;
    ELSE
      -- No inbound transfer recorded (the batch started in this vessel), so the
      -- ledger cannot tell us its fill volume. Trust the caller's claim.
      v_gap := 0;
      v_empties := NEW.empties_source;
    END IF;

    IF v_empties THEN
      -- Ledger-proven (or unprovable-and-claimed): keep the stored flag honest,
      -- correcting a stale-client FALSE upward to match the proof.
      IF NOT NEW.empties_source THEN
        UPDATE vessel_transfers SET empties_source = true WHERE id = NEW.id;
      END IF;

      UPDATE vessels
      SET status = 'dirty',
          current_batch_id = NULL,
          updated_at = NOW()
      WHERE id = NEW.from_vessel_id;

    ELSIF NEW.empties_source THEN
      -- Caller claims a full move the ledger cannot prove. Volume also leaves
      -- vessels as batch-sourced ALLOCATIONS (loss/sample/pour/destruction),
      -- which carry no vessel id, so they can justify KEEPING the operator's
      -- flag but never justify FREEING this particular vessel (the loss may
      -- have happened in another vessel of the batch -- see header).
      SELECT COALESCE(sum(volume_bbl), 0) INTO v_alloc
      FROM allocations
      WHERE source_type = 'batch'
        AND source_id = NEW.batch_id
        AND status = 'completed';

      IF v_alloc >= v_gap - 0.0001 THEN
        -- Plausibly truthful (00235): recorded batch outflow covers the gap.
        -- Do NOT falsify the audit flag; do NOT free the vessel. Escape hatch:
        -- correct the vessel record directly (see function comment).
        RAISE NOTICE 'Vessel % left occupied: transfer claims it emptied and % bbl of recorded batch allocations plausibly cover the % bbl ledger gap, but allocations carry no vessel id so the ledger cannot prove THIS vessel emptied. Flag kept; free the vessel manually if it is in fact empty.',
          NEW.from_vessel_id, v_alloc, v_gap;
      ELSE
        -- Even batch-wide recorded outflow cannot explain the shortfall: the
        -- claim is contradicted by every record we have. Correct it (00228).
        UPDATE vessel_transfers SET empties_source = false WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION reconcile_mongodb_transfers(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Invalid MongoDB transfer payload';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mongodb-aggregate-sync', 0));

  -- Transaction-local: handle_vessel_transfer skips vessel claim/free under
  -- this flag so historical transfers replay without fighting live occupancy.
  PERFORM set_config('mgr.mongodb_sync', 'on', true);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO vessel_transfers (
      id, batch_id, from_vessel_id, to_vessel_id,
      volume_bbl, transferred_at, notes, empties_source
    ) VALUES (
      (v_row->>'id')::UUID,
      (v_row->>'batch_id')::UUID,
      NULLIF(v_row->>'from_vessel_id', '')::UUID,
      (v_row->>'to_vessel_id')::UUID,
      (v_row->>'volume_bbl')::NUMERIC,
      (v_row->>'transferred_at')::TIMESTAMPTZ,
      v_row->>'notes',
      COALESCE((v_row->>'empties_source')::BOOLEAN, FALSE)
    )
    ON CONFLICT (id) DO UPDATE SET
      batch_id = EXCLUDED.batch_id,
      from_vessel_id = EXCLUDED.from_vessel_id,
      to_vessel_id = EXCLUDED.to_vessel_id,
      volume_bbl = EXCLUDED.volume_bbl,
      transferred_at = EXCLUDED.transferred_at,
      notes = EXCLUDED.notes;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION reconcile_mongodb_transfers(JSONB)
  IS 'Bulk-upserts MongoDB-owned historical vessel transfers with the live occupancy trigger suppressed (mgr.mongodb_sync).';

REVOKE ALL ON FUNCTION reconcile_mongodb_transfers(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reconcile_mongodb_transfers(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
