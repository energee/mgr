-- 00300_sync_status_preserving_upserts.sql
--
-- DB-side status-preserving upserts for the MongoDB legacy sync (#855).
--
-- The sync previously preserved live statuses app-side: read current PG
-- statuses (`preserveExistingStatuses` in src/integrations/mongodb/sync.ts),
-- rewrite the frozen Mongo snapshot's status with the live value, then upsert.
-- That read-modify-write is a TOCTOU race — a live transition committed
-- between the read and the upsert gets clobbered back to the stale value the
-- read saw. For batches the server-side state machine (00205/00256) happens
-- to reject most regressions; vessels (#839) have no such trigger, so a
-- re-sync could silently mark an in-use vessel "ready_for_use".
--
-- These functions make preservation durable by construction: the ON CONFLICT
-- update simply OMITS the status column, so an existing row's live status is
-- never written to at all — there is no window. Mongo still sets status on
-- the first insert of a row PG has never seen.
--
-- Duplicate conflict keys within one payload are NOT handled here: the caller
-- dedups app-side (dedupeByConflictKey in sync.ts, last occurrence wins —
-- the one canonical last-wins rule, shared with the plain-upsert path). A
-- duplicate that slips through fails the statement loudly ("ON CONFLICT DO
-- UPDATE command cannot affect row a second time") — acceptable for the
-- single service_role sync caller, and better than a second, subtly different
-- dedup rule living in SQL.
--
-- The column lists below mirror the transform output shapes in
-- src/integrations/mongodb/transformers.ts (transformVessel/transformBatch);
-- a column added there must be added here or it is silently dropped —
-- sync.test.ts pins both column sets against this file.

-- ---------------------------------------------------------------------------
-- Vessels: keyed by UNIQUE(name) (00006). vessel_type / status are enums, so
-- the TEXT recordset values are cast explicitly.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_upsert_vessels(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO vessels (name, vessel_type, capacity_bbl, status, is_active)
  SELECT
    r.name,
    r.vessel_type::vessel_type,
    -- A legacy Mongo doc with no capacity serializes without the key →
    -- recordset NULL. capacity_bbl is NOT NULL, and Postgres checks that on
    -- the CANDIDATE row before ON CONFLICT arbitration, so the fallback must
    -- happen here at insert time (a COALESCE in DO UPDATE never runs) —
    -- borrow the existing row's value via the join. A truly new vessel with
    -- no capacity still fails the constraint, exactly as the old PostgREST
    -- insert did; an existing one keeps its stored capacity, matching the old
    -- per-row retry that only wrote present columns.
    COALESCE(r.capacity_bbl, v.capacity_bbl),
    r.status::vessel_status,
    r.is_active
  FROM jsonb_to_recordset(p_rows) AS r(
    name TEXT,
    vessel_type TEXT,
    capacity_bbl NUMERIC,
    status TEXT,
    is_active BOOLEAN
  )
  LEFT JOIN vessels v ON v.name = r.name
  ON CONFLICT (name) DO UPDATE SET
    vessel_type = EXCLUDED.vessel_type,
    capacity_bbl = EXCLUDED.capacity_bbl,
    is_active = EXCLUDED.is_active;
    -- status DELIBERATELY omitted: existing rows keep their live status.

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION sync_upsert_vessels(JSONB) IS
  'MongoDB-sync vessel upsert that preserves live status durably: ON CONFLICT (name) updates every synced column EXCEPT status, so a concurrent live transition can never be clobbered by the frozen Mongo snapshot (#855, replaces the app-side TOCTOU read-modify-write from #839). Mongo still sets status on first insert. Caller dedups intra-payload duplicate names (last wins). Returns rows written. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION sync_upsert_vessels(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_upsert_vessels(JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Batches: keyed by PK id (deterministic UUIDv5 from the Mongo ObjectId).
-- recipe_id / volume_bbl are included because syncBatches resolves them
-- app-side (recipe name lookup) and writes them with the same upsert.
-- batch_code stays writable on conflict — the app dedups codes and the
-- generate_batch_code trigger (00155) owns the canonical value.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_upsert_batches(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO batches (id, batch_code, name, status, planned_start_date,
                       notes, recipe_id, volume_bbl)
  SELECT r.id, r.batch_code, r.name, r.status, r.planned_start_date,
         r.notes, r.recipe_id, r.volume_bbl
  FROM jsonb_to_recordset(p_rows) AS r(
    id UUID,
    batch_code TEXT,
    name TEXT,
    status TEXT,
    planned_start_date DATE,
    notes TEXT,
    recipe_id UUID,
    volume_bbl NUMERIC
  )
  ON CONFLICT (id) DO UPDATE SET
    batch_code = EXCLUDED.batch_code,
    name = EXCLUDED.name,
    planned_start_date = EXCLUDED.planned_start_date,
    notes = EXCLUDED.notes,
    -- syncBatches only adds recipe_id/volume_bbl keys when the Mongo recipe
    -- resolves to a PG recipe; jsonb_to_recordset turns an ABSENT key into
    -- NULL, and a bare `= EXCLUDED.recipe_id` would then clobber a live value
    -- to NULL (the old PostgREST per-row upsert only wrote present columns).
    -- The payload never sends an explicit JSON null for these keys, so
    -- COALESCE keeps the existing value whenever the sync has nothing better
    -- — matching origin/main behavior. Not expressible in the app-side unit
    -- tests (mock DB), hence documented and enforced here.
    recipe_id = COALESCE(EXCLUDED.recipe_id, batches.recipe_id),
    volume_bbl = COALESCE(EXCLUDED.volume_bbl, batches.volume_bbl);
    -- status DELIBERATELY omitted: existing rows keep their live status, and
    -- the 00205/00256 batch state machine never sees a regression attempt.

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION sync_upsert_batches(JSONB) IS
  'MongoDB-sync batch upsert that preserves live status durably: ON CONFLICT (id) updates every synced column EXCEPT status, so a concurrent live transition can never be clobbered by the frozen Mongo snapshot (#855, replaces the app-side TOCTOU read-modify-write from fd60d58). recipe_id/volume_bbl COALESCE to the existing value because the sync payload omits them when unresolved. Mongo still sets status on first insert. Caller dedups intra-payload duplicate ids (last wins). Returns rows written. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION sync_upsert_batches(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_upsert_batches(JSONB)
  TO service_role;
