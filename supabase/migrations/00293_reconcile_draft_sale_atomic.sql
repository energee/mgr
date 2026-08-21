-- 00293_reconcile_draft_sale_atomic.sql
--
-- Atomic exactly-once for Square draft-sale reconciliation (#834, from the
-- #822 write-atomicity audit).
--
-- The reconcile route plans a FIFO draw in the app, then previously issued
-- three separate PostgREST requests per sale: read existing idempotency keys,
-- insert the allocation rows, stamp square_draft_sales.reconciled_at. The
-- idempotency index (00215) is deliberately NON-unique (one key tags several
-- rows when a sale spans lots), so nothing DB-side stopped two CONCURRENT
-- runs from both passing the key read and double-allocating the same sale —
-- duplicate TTB removals whenever stock covered 2x the draw.
--
-- This function makes check-key + insert + stamp one transaction, serialized
-- per sale by an advisory xact lock (the 00257 `ingest_square_sale_atomic`
-- pattern; a lock taken in a separate PostgREST request would not help, since
-- every request is its own transaction). FIFO planning stays in the app —
-- guard_allocation_availability (00212) still validates every inserted row,
-- so a stale plan is rejected, never half-applied: a guard rejection on any
-- row RAISEs and rolls back the whole sale, leaving the key unclaimed and the
-- failure retryable.
--
-- Returns:
--   'inserted'      rows landed and the sale is stamped reconciled
--   'already_keyed' another run (or a pre-crash insert) already claimed the
--                   key; a missing reconciled_at stamp is repaired instead
--   'voided'        the sale was voided (refund webhook, 00241) after the
--                   caller read it; nothing is written — a refunded pour must
--                   never become a TTB removal

CREATE OR REPLACE FUNCTION reconcile_square_draft_sale_atomic(
  p_sale_id UUID,
  p_rows JSONB,
  p_reconciled_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key TEXT := 'square_draft_sale:' || p_sale_id;
  v_voided TIMESTAMPTZ;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'p_sale_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent reconciliations of the SAME sale; unrelated sales
  -- only collide on hash collision, which merely serializes them.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT voided_at INTO v_voided FROM square_draft_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'square_draft_sales row % not found', p_sale_id
      USING ERRCODE = '22023';
  END IF;
  IF v_voided IS NOT NULL THEN
    RETURN 'voided';
  END IF;

  -- The loser of a concurrent race lands here after the winner commits, as
  -- does the repair path for a pre-00293 crash between insert and stamp.
  -- voided_at IS NULL: re-stamping a row the refund path voided would be
  -- misleading — its allocations were already handled by the 00277 reversal.
  IF EXISTS (SELECT 1 FROM allocations WHERE idempotency_key = v_key) THEN
    UPDATE square_draft_sales
      SET reconciled_at = COALESCE(reconciled_at, p_reconciled_at)
      WHERE id = p_sale_id AND voided_at IS NULL;
    RETURN 'already_keyed';
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must contain at least one allocation row'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO allocations (
    source_type, source_id, destination_type, destination_id,
    quantity, volume_bbl, reason_code, status, completed_at, notes,
    idempotency_key
  )
  SELECT
    'finished_good', r.source_id, 'taproom_sale', NULL,
    r.quantity, r.volume_bbl, 'other', 'completed', r.completed_at, r.notes,
    v_key
  FROM jsonb_to_recordset(p_rows) AS r(
    source_id UUID,
    quantity NUMERIC,
    volume_bbl NUMERIC,
    completed_at TIMESTAMPTZ,
    notes TEXT
  );

  -- voided_at IS NULL again, as a PREDICATE this time: a concurrent full
  -- refund (00277) holds only the square_order advisory lock, so it can void
  -- this row between the SELECT above and here without blocking. Under READ
  -- COMMITTED a blocked UPDATE re-evaluates the predicate on the committed
  -- row version, so both interleavings are caught; the RAISE rolls the
  -- allocation insert back — a refunded pour must never become a TTB removal.
  -- (Deliberately NOT a FOR UPDATE on the initial SELECT: locking the draft
  -- row before finished_goods would invert 00277's lock order and create a
  -- reconcile<->refund deadlock pair.)
  UPDATE square_draft_sales SET reconciled_at = p_reconciled_at
    WHERE id = p_sale_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft sale % was voided mid-reconcile; allocations rolled back', p_sale_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN 'inserted';
END;
$$;

COMMENT ON FUNCTION reconcile_square_draft_sale_atomic(UUID, JSONB, TIMESTAMPTZ) IS
  'Atomically claims the square_draft_sale:<id> idempotency key, inserts the app-planned taproom_sale allocation rows, and stamps reconciled_at — one transaction serialized per sale by an advisory xact lock, so concurrent reconcile runs cannot double-allocate (#834). Returns inserted / already_keyed / voided. SECURITY INVOKER and service_role-only.';

REVOKE ALL ON FUNCTION reconcile_square_draft_sale_atomic(UUID, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reconcile_square_draft_sale_atomic(UUID, JSONB, TIMESTAMPTZ)
  TO service_role;
