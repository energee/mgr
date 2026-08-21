-- 00298_sync_status_preserving_upserts.sql
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
-- Duplicate conflict keys within one payload are deduplicated keeping the
-- LAST occurrence (mirroring the app's dedupeByConflictKey helper) because a
-- single INSERT ... ON CONFLICT DO UPDATE statement raises "cannot affect row
-- a second time" on intra-statement duplicates.

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

  WITH src AS (
    SELECT r.name, r.vessel_type, r.capacity_bbl, r.status, r.is_active, o.ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS o(elem, ord)
    CROSS JOIN LATERAL jsonb_to_record(o.elem) AS r(
      name TEXT,
      vessel_type TEXT,
      capacity_bbl NUMERIC,
      status TEXT,
      is_active BOOLEAN
    )
  ),
  deduped AS (
    -- Last occurrence wins, matching the app's dedupeByConflictKey.
    SELECT DISTINCT ON (name) name, vessel_type, capacity_bbl, status, is_active
    FROM src
    ORDER BY name, ord DESC
  )
  INSERT INTO vessels (name, vessel_type, capacity_bbl, status, is_active)
  SELECT
    name,
    vessel_type::vessel_type,
    capacity_bbl,
    status::vessel_status,
    is_active
  FROM deduped
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
  'MongoDB-sync vessel upsert that preserves live status durably: ON CONFLICT (name) updates every synced column EXCEPT status, so a concurrent live transition can never be clobbered by the frozen Mongo snapshot (#855, replaces the app-side TOCTOU read-modify-write from #839). Mongo still sets status on first insert. Dedups intra-payload duplicate names keeping the last occurrence. Returns rows written. SECURITY INVOKER and service_role-only.';

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

  WITH src AS (
    SELECT r.id, r.batch_code, r.name, r.status, r.planned_start_date,
           r.notes, r.recipe_id, r.volume_bbl, o.ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS o(elem, ord)
    CROSS JOIN LATERAL jsonb_to_record(o.elem) AS r(
      id UUID,
      batch_code TEXT,
      name TEXT,
      status TEXT,
      planned_start_date DATE,
      notes TEXT,
      recipe_id UUID,
      volume_bbl NUMERIC
    )
  ),
  deduped AS (
    -- Last occurrence wins, matching the app's dedupeByConflictKey.
    SELECT DISTINCT ON (id) id, batch_code, name, status, planned_start_date,
           notes, recipe_id, volume_bbl
    FROM src
    ORDER BY id, ord DESC
  )
  INSERT INTO batches (id, batch_code, name, status, planned_start_date,
                       notes, recipe_id, volume_bbl)
  SELECT id, batch_code, name, status, planned_start_date,
         notes, recipe_id, volume_bbl
  FROM deduped
  ON CONFLICT (id) DO UPDATE SET
    batch_code = EXCLUDED.batch_code,
    name = EXCLUDED.name,
    planned_start_date = EXCLUDED.planned_start_date,
    notes = EXCLUDED.notes,
    recipe_id = EXCLUDED.recipe_id,
    volume_bbl = EXCLUDED.volume_bbl;
    -- status DELIBERATELY omitted: existing rows keep their live status, and
    -- the 00205/00256 batch state machine never sees a regression attempt.

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION sync_upsert_batches(JSONB) IS
  'MongoDB-sync batch upsert that preserves live status durably: ON CONFLICT (id) updates every synced column EXCEPT status, so a concurrent live transition can never be clobbered by the frozen Mongo snapshot (#855, replaces the app-side TOCTOU read-modify-write from fd60d58). Mongo still sets status on first insert. Dedups intra-payload duplicate ids keeping the last occurrence. Returns rows written. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION sync_upsert_batches(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_upsert_batches(JSONB)
  TO service_role;
