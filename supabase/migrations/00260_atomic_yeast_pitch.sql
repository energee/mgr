-- Atomic, balance-safe, idempotent yeast pitching (#447).
--
-- The dialog previously inserted yeast_pitch_events and then conditionally
-- updated yeast_pitches.status in a second PostgREST transaction. Its balance
-- check used a cached view, so concurrent brewers could both overdraw one
-- source, and retrying an ambiguous failure could duplicate the event.
--
-- The command below serializes on both the request id and source row. Defensive
-- table triggers preserve the same invariant for any remaining direct SQL or
-- PostgREST writer; the event id itself is the stable idempotency key.

DO $$
DECLARE
  v_invalid_event_count INTEGER;
  v_invalid_viability_count INTEGER;
  v_invalid_source_count INTEGER;
  v_overdrawn_count INTEGER;
  v_overdrawn_examples TEXT;
BEGIN
  SELECT COUNT(*)
    INTO v_invalid_event_count
  FROM yeast_pitch_events
  WHERE quantity_lbs <= 0;

  SELECT COUNT(*)
    INTO v_invalid_viability_count
  FROM yeast_pitch_events
  WHERE viability_at_pitch IS NOT NULL
    AND (viability_at_pitch < 0 OR viability_at_pitch > 100);

  SELECT COUNT(*)
    INTO v_invalid_source_count
  FROM yeast_pitches
  WHERE quantity_lbs < 0;

  WITH usage AS (
    SELECT pitch_id, SUM(quantity_lbs) AS used_quantity
    FROM yeast_pitch_events
    GROUP BY pitch_id
  )
  SELECT COUNT(*)
    INTO v_overdrawn_count
  FROM yeast_pitches yp
  JOIN usage u ON u.pitch_id = yp.id
  WHERE u.used_quantity > COALESCE(yp.quantity_lbs, 0);

  WITH usage AS (
    SELECT pitch_id, SUM(quantity_lbs) AS used_quantity
    FROM yeast_pitch_events
    GROUP BY pitch_id
  )
  SELECT string_agg(id::TEXT, ', ' ORDER BY id)
    INTO v_overdrawn_examples
  FROM (
    SELECT yp.id
    FROM yeast_pitches yp
    JOIN usage u ON u.pitch_id = yp.id
    WHERE u.used_quantity > COALESCE(yp.quantity_lbs, 0)
    ORDER BY yp.id
    LIMIT 10
  ) examples;

  IF v_invalid_event_count > 0
     OR v_invalid_viability_count > 0
     OR v_invalid_source_count > 0
     OR v_overdrawn_count > 0 THEN
    RAISE EXCEPTION
      'Cannot install yeast balance guards: % non-positive event(s), % invalid event viability value(s), % negative source(s), % overdrawn source(s); first ids: %',
      v_invalid_event_count,
      v_invalid_viability_count,
      v_invalid_source_count,
      v_overdrawn_count,
      COALESCE(v_overdrawn_examples, 'none');
  END IF;
END;
$$;

ALTER TABLE yeast_pitch_events
  ADD CONSTRAINT yeast_pitch_events_quantity_positive
  CHECK (quantity_lbs > 0),
  ADD CONSTRAINT yeast_pitch_events_viability_valid
  CHECK (
    viability_at_pitch IS NULL
    OR viability_at_pitch BETWEEN 0 AND 100
  );

ALTER TABLE yeast_pitches
  ADD CONSTRAINT yeast_pitches_quantity_nonnegative
  CHECK (quantity_lbs IS NULL OR quantity_lbs >= 0);

-- Keep the self-described transition metadata aligned with the entity state
-- machine: a single atomic pitch may consume an in-stock source completely.
UPDATE enum_values
SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{next_states}',
      '["in_use", "depleted", "discarded"]'::jsonb
    )
WHERE enum_type = 'yeast_pitch_status'
  AND value = 'in_stock';

COMMENT ON COLUMN yeast_pitch_events.id IS
  'Stable event UUID. pitch_yeast_atomic uses this as the caller-supplied idempotency key.';

CREATE OR REPLACE FUNCTION guard_yeast_pitch_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source_quantity NUMERIC;
  v_source_status TEXT;
  v_used_quantity NUMERIC;
BEGIN
  -- Lock the inventory source before reading its event ledger. Every writer
  -- through this trigger therefore sees the usage committed by the prior one.
  SELECT quantity_lbs, status
    INTO v_source_quantity, v_source_status
  FROM yeast_pitches
  WHERE id = NEW.pitch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Yeast source % does not exist', NEW.pitch_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.quantity_lbs <= 0 THEN
    RAISE EXCEPTION 'Yeast pitch quantity must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF v_source_quantity IS NULL OR v_source_quantity <= 0 THEN
    RAISE EXCEPTION 'Yeast source % has no available quantity configured', NEW.pitch_id
      USING ERRCODE = 'PT409';
  END IF;

  IF v_source_status <> 'in_stock' THEN
    RAISE EXCEPTION 'Yeast source % is %, not in_stock', NEW.pitch_id, v_source_status
      USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(SUM(quantity_lbs), 0)
    INTO v_used_quantity
  FROM yeast_pitch_events
  WHERE pitch_id = NEW.pitch_id;

  IF v_used_quantity + NEW.quantity_lbs > v_source_quantity THEN
    RAISE EXCEPTION
      'Cannot pitch % lbs from yeast source %: only % lbs remain',
      NEW.quantity_lbs,
      NEW.pitch_id,
      GREATEST(v_source_quantity - v_used_quantity, 0)
      USING ERRCODE = 'PT409';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_yeast_pitch_event_insert
  BEFORE INSERT ON yeast_pitch_events
  FOR EACH ROW
  EXECUTE FUNCTION guard_yeast_pitch_event_insert();

CREATE OR REPLACE FUNCTION maintain_yeast_pitch_status_after_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source_quantity NUMERIC;
  v_used_quantity NUMERIC;
BEGIN
  -- guard_yeast_pitch_event_insert already holds this row lock. Re-read the
  -- ledger after the event is visible inside the transaction, then maintain
  -- status in the same commit as the event.
  SELECT quantity_lbs
    INTO v_source_quantity
  FROM yeast_pitches
  WHERE id = NEW.pitch_id
  FOR UPDATE;

  SELECT COALESCE(SUM(quantity_lbs), 0)
    INTO v_used_quantity
  FROM yeast_pitch_events
  WHERE pitch_id = NEW.pitch_id;

  IF v_used_quantity >= v_source_quantity THEN
    UPDATE yeast_pitches
    SET status = 'depleted'
    WHERE id = NEW.pitch_id
      AND status <> 'depleted';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER maintain_yeast_pitch_status_after_event
  AFTER INSERT ON yeast_pitch_events
  FOR EACH ROW
  EXECUTE FUNCTION maintain_yeast_pitch_status_after_event();

CREATE OR REPLACE FUNCTION reject_yeast_pitch_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Yeast pitch events are immutable; record a compensating event instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER reject_yeast_pitch_event_mutation
  BEFORE UPDATE OR DELETE ON yeast_pitch_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_yeast_pitch_event_mutation();

CREATE OR REPLACE FUNCTION guard_yeast_pitch_source_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_used_quantity NUMERIC;
BEGIN
  IF NEW.quantity_lbs IS NOT DISTINCT FROM OLD.quantity_lbs THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(quantity_lbs), 0)
    INTO v_used_quantity
  FROM yeast_pitch_events
  WHERE pitch_id = NEW.id;

  IF v_used_quantity > COALESCE(NEW.quantity_lbs, 0) THEN
    RAISE EXCEPTION
      'Cannot reduce yeast source % to % lbs: % lbs are already committed',
      NEW.id,
      NEW.quantity_lbs,
      v_used_quantity
      USING ERRCODE = 'PT409';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_yeast_pitch_source_quantity
  BEFORE UPDATE OF quantity_lbs ON yeast_pitches
  FOR EACH ROW
  EXECUTE FUNCTION guard_yeast_pitch_source_quantity();

CREATE OR REPLACE FUNCTION pitch_yeast_atomic(
  p_request_id UUID,
  p_pitch_id UUID,
  p_batch_id UUID,
  p_quantity_lbs NUMERIC,
  p_viability_at_pitch NUMERIC,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source yeast_pitches%ROWTYPE;
  v_existing yeast_pitch_events%ROWTYPE;
  v_used_quantity NUMERIC;
  v_remaining_quantity NUMERIC;
  v_cells_pitched NUMERIC;
  v_status TEXT;
BEGIN
  IF p_request_id IS NULL OR p_pitch_id IS NULL OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Request id, yeast source, and batch are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_quantity_lbs IS NULL
     OR p_quantity_lbs <= 0
     OR p_quantity_lbs > 99999999.99
     OR ROUND(p_quantity_lbs, 2) <> p_quantity_lbs THEN
    RAISE EXCEPTION 'Yeast pitch quantity must be positive with at most two decimal places'
      USING ERRCODE = '22023';
  END IF;

  IF p_viability_at_pitch IS NOT NULL
     AND (p_viability_at_pitch < 0
       OR p_viability_at_pitch > 100
       OR ROUND(p_viability_at_pitch, 2) <> p_viability_at_pitch) THEN
    RAISE EXCEPTION 'Yeast viability must be between 0 and 100 with at most two decimal places'
      USING ERRCODE = '22023';
  END IF;

  IF current_user = 'authenticated'
     AND NOT user_has_permission('batches:write') THEN
    RAISE EXCEPTION 'batches:write permission is required to pitch yeast'
      USING ERRCODE = '42501';
  END IF;

  -- A request lock makes concurrent retries deterministic even if a malformed
  -- caller reuses one request id for different source rows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('yeast_pitch_request:' || p_request_id::TEXT, 0)
  );

  -- This is the inventory serialization boundary. It is acquired before the
  -- committed event ledger is summed and held until commit/rollback.
  SELECT *
    INTO v_source
  FROM yeast_pitches
  WHERE id = p_pitch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Yeast source % does not exist', p_pitch_id
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_existing
  FROM yeast_pitch_events
  WHERE id = p_request_id;

  IF FOUND THEN
    IF v_existing.pitch_id <> p_pitch_id
       OR v_existing.batch_id <> p_batch_id
       OR v_existing.quantity_lbs <> p_quantity_lbs
       OR v_existing.viability_at_pitch IS DISTINCT FROM p_viability_at_pitch
       OR v_existing.notes IS DISTINCT FROM NULLIF(p_notes, '') THEN
      RAISE EXCEPTION 'Yeast pitch request % was already used with different input', p_request_id
        USING ERRCODE = 'PT409';
    END IF;

    SELECT COALESCE(SUM(quantity_lbs), 0)
      INTO v_used_quantity
    FROM yeast_pitch_events
    WHERE pitch_id = p_pitch_id;

    RETURN jsonb_build_object(
      'kind', 'duplicate',
      'event_id', v_existing.id,
      'remaining_quantity_lbs', GREATEST(COALESCE(v_source.quantity_lbs, 0) - v_used_quantity, 0),
      'status', v_source.status
    );
  END IF;

  IF v_source.quantity_lbs IS NULL OR v_source.quantity_lbs <= 0 THEN
    RAISE EXCEPTION 'Yeast source % has no available quantity configured', p_pitch_id
      USING ERRCODE = 'PT409';
  END IF;

  IF v_source.status <> 'in_stock' THEN
    RAISE EXCEPTION 'Yeast source % is %, not in_stock', p_pitch_id, v_source.status
      USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(SUM(quantity_lbs), 0)
    INTO v_used_quantity
  FROM yeast_pitch_events
  WHERE pitch_id = p_pitch_id;

  v_remaining_quantity := v_source.quantity_lbs - v_used_quantity;
  IF p_quantity_lbs > v_remaining_quantity THEN
    RAISE EXCEPTION
      'Cannot pitch % lbs from yeast source %: only % lbs remain',
      p_quantity_lbs,
      p_pitch_id,
      GREATEST(v_remaining_quantity, 0)
      USING ERRCODE = 'PT409';
  END IF;

  v_cells_pitched := CASE
    WHEN v_source.cell_density_thousand IS NOT NULL
      AND p_viability_at_pitch IS NOT NULL
    THEN ROUND(
      p_quantity_lbs
        * v_source.cell_density_thousand
        * (p_viability_at_pitch / 100),
      2
    )
    ELSE NULL
  END;

  INSERT INTO yeast_pitch_events (
    id,
    pitch_id,
    batch_id,
    quantity_lbs,
    cells_pitched_thousand,
    viability_at_pitch,
    pitched_at,
    notes,
    created_by
  ) VALUES (
    p_request_id,
    p_pitch_id,
    p_batch_id,
    p_quantity_lbs,
    v_cells_pitched,
    p_viability_at_pitch,
    NOW(),
    NULLIF(p_notes, ''),
    auth.uid()
  );

  -- The AFTER INSERT trigger maintains the source status in this transaction.
  SELECT status
    INTO v_status
  FROM yeast_pitches
  WHERE id = p_pitch_id;

  RETURN jsonb_build_object(
    'kind', 'created',
    'event_id', p_request_id,
    'remaining_quantity_lbs', v_remaining_quantity - p_quantity_lbs,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION pitch_yeast_atomic(UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION pitch_yeast_atomic(UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION pitch_yeast_atomic(UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION pitch_yeast_atomic(UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT) IS
  'Atomically pitch yeast into a batch. Uses p_request_id as the immutable event id/idempotency key, serializes on the source row, rejects overdraw, and returns created or duplicate.';

UPDATE _schema_registry
SET description =
      'Immutable yeast pitch events. Positive quantities and source balance are enforced under a source-row lock; pitch_yeast_atomic records events idempotently and maintains source status in the same transaction.',
    key_fields =
      '["id (idempotency key)", "pitch_id", "batch_id", "quantity_lbs", "pitched_at"]'::jsonb,
    updated_at = NOW()
WHERE table_name = 'yeast_pitch_events';
