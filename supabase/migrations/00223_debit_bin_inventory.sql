-- 00223_debit_bin_inventory.sql
-- Square POS bin-sync, Milestone D2: atomically debit a bin's finished-good
-- quantity when a Square sale is ingested by the payment.completed webhook.
--
-- WHY AN RPC (not an inline read-modify-write in the route):
--   The webhook (src/app/api/square/webhook/route.ts) decrements the resolved
--   bin's finished-good count on every packaged sale. An inline
--   SELECT-then-UPDATE from the route would lose updates under concurrent sales
--   at the same bin (two webhooks read the same quantity, both subtract, one
--   write is lost). This function does the read-modify-write in a single call
--   under a row lock (SELECT ... FOR UPDATE), so concurrent sales serialize on
--   the row and no debit is lost.
--
-- CLAMP-TO-ZERO + FLAG (locked D3, mirrors 00216 / #357 outbound guard): a sale
--   of more units than the bin physically holds clamps the bin to 0 (never
--   negative) and returns clamped = true so the caller can flag the oversell in
--   square_sync_log. The physical count can't go negative; the taproom_sale
--   allocation the webhook also writes remains the audit/TTB record of what was
--   actually sold. The two ledgers are intentionally independent and are
--   reconciled at the POS read, not here.
--
--   SUPERSEDED BY 00226: this file originally argued "only this path writes
--   bin_inventory, so keeping both is not a double-count". True when written,
--   FALSE now. bin_inventory has a SECOND writer -- revise_packaging_session
--   (00219) mirrors corrected FG quantities onto the bin. 00226(A) changed that
--   mirror from an absolute overwrite to a delta, so it stops resurrecting units
--   already sold through the POS; 00226(B) clamps the sellable_inventory view to
--   LEAST(bin count, ledger availability) so the POS cannot over-report. Read
--   00226 before reasoning about bin_inventory writers.
--
-- SECURITY DEFINER: the debit must bypass the (system, unauthenticated) webhook
--   caller's bin_inventory RLS -- same rationale as place_finished_good_in_bin
--   (00219). Injection surface is nil: it only ever updates one bin_inventory row
--   keyed by (bin_id, finished_good_id).
--
-- LOCKED DOWN TO service_role: unlike the operational staff RPCs (which grant
--   EXECUTE to authenticated), this is a system-internal webhook helper with no
--   in-function permission check. Exposing a SECURITY DEFINER inventory-zeroing
--   function to authenticated/anon via PostgREST would let any caller wipe a bin,
--   so EXECUTE is revoked from PUBLIC and granted only to service_role (the role
--   the admin webhook client connects as).
--
-- Idempotency is handled upstream by the webhook's dedup claim -- this function
-- is NOT itself idempotent and must be called at most once per sale line.
-- SUPERSEDED BY 00224: that claim was originally keyed on event_id. Square emits
-- both payment.created and payment.updated for one payment, each with its own
-- event_id, so an event-keyed claim let a single sale debit the bin twice. The
-- webhook now claims on square_sync_log.square_payment_id (00224). event_id dedup
-- survives only for the non-payment inventory.count.updated path.
--
-- Live-safe: one new function. Verified by a self-rolling-back DO block at the
-- end of this file (commits no rows).

CREATE OR REPLACE FUNCTION debit_bin_inventory(
  p_bin_id UUID,
  p_finished_good_id UUID,
  p_qty INTEGER
)
RETURNS TABLE (new_quantity INTEGER, clamped BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old INTEGER;
  v_new INTEGER;
BEGIN
  -- Row-lock the bin's FG row so concurrent sales at the same bin serialize here
  -- (prevents lost updates on the read-modify-write).
  SELECT quantity INTO v_old
  FROM bin_inventory
  WHERE bin_id = p_bin_id AND finished_good_id = p_finished_good_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No bin row to debit (concurrent delete, or the caller passed an FG not in
    -- this bin). Nothing to decrement; report a full-quantity clamp so the caller
    -- can flag it. The webhook only calls this for a row it just read, so this is
    -- a defensive path.
    RETURN QUERY SELECT 0, (p_qty > 0);
    RETURN;
  END IF;

  v_new := GREATEST(0, v_old - p_qty);

  UPDATE bin_inventory
  SET quantity = v_new
  WHERE bin_id = p_bin_id AND finished_good_id = p_finished_good_id;

  -- clamped = true iff the sale exceeded the physical count (oversell). An exact
  -- sellout (v_old = p_qty) lands at 0 but is NOT a clamp.
  RETURN QUERY SELECT v_new, (v_old < p_qty);
END;
$$;

COMMENT ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) IS
  'Atomically debit a bin''s finished-good quantity for a Square POS sale (00223, Square bin-sync D2). Row-locks (SELECT FOR UPDATE) so concurrent sales at the same bin cannot lose updates. Clamps to zero on oversell (never negative) and returns (new_quantity, clamped) so the webhook can flag oversold lines (D3). SECURITY DEFINER to bypass the system webhook caller''s bin_inventory RLS; EXECUTE locked to service_role. NOT idempotent -- the webhook''s payment-id dedup (square_sync_log.square_payment_id, 00224) guarantees at-most-once. NOTE: bin_inventory has a SECOND writer, revise_packaging_session (00226), which applies revision deltas; the sellable_inventory view clamps the bin count to ledger availability so the two ledgers are reconciled at the POS read (00226).';

-- System-internal: only the service-role webhook client may call it.
REVOKE ALL ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) TO service_role;

-- =============================================================================
-- PART 2 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back, four debit behaviors:
--   (a) normal debit   qty 10, sell 3  -> new 7, clamped false
--   (b) exact sellout  qty  5, sell 5  -> new 0, clamped false
--   (c) oversell       qty  2, sell 5  -> new 0, clamped true
--   (d) missing row    (bogus keys)    -> new 0, clamped true
--
-- Same self-rolling-back idiom as 00219: a passing run RAISEs 'D2_VERIFY_OK' to
-- unwind the subtransaction (commits nothing); a genuine logic failure RAISEs
-- 'D2_ASSERT_FAIL...' and re-raises to ABORT the migration; any other error
-- (missing prerequisites on a from-scratch replay) is downgraded to a WARNING so
-- the function DDL above still applies -- this block is a check, not a gate.
DO $$
DECLARE
  v_loc     UUID;
  v_brand   UUID;
  v_cont    UUID;
  v_sf      UUID;
  v_bin     UUID;
  v_fg      UUID;
  v_new     INTEGER;
  v_clamped BOOLEAN;
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('D2_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;
    INSERT INTO brands (name)
      VALUES ('D2_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_oz, deposit_amount)
      VALUES ('D2_verify_pkg_' || v_sfx, 'package', 12, 0)
      RETURNING id INTO v_cont;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_cont, 'D2_verify_sf_' || v_sfx, 1)
      RETURNING id INTO v_sf;
    -- Non-default bin so the 00219 placement trigger leaves the FG unplaced and
    -- we control bin_inventory quantity directly.
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'D2_verify_bin_' || v_sfx, false)
      RETURNING id INTO v_bin;
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf, 100, 'D2-' || v_sfx)
      RETURNING id INTO v_fg;
    INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
      VALUES (v_fg, v_bin, 10)
      ON CONFLICT (finished_good_id, bin_id) DO UPDATE SET quantity = 10;

    -- --- (a) normal debit: 10 - 3 = 7, not clamped ---------------------------
    SELECT d.new_quantity, d.clamped INTO v_new, v_clamped
      FROM debit_bin_inventory(v_bin, v_fg, 3) d;
    IF v_new <> 7 OR v_clamped THEN
      RAISE EXCEPTION 'D2_ASSERT_FAIL (a): expected (7,false) got (%,%)', v_new, v_clamped;
    END IF;

    -- --- (b) exact sellout: 7 - 7 = 0, not clamped ---------------------------
    SELECT d.new_quantity, d.clamped INTO v_new, v_clamped
      FROM debit_bin_inventory(v_bin, v_fg, 7) d;
    IF v_new <> 0 OR v_clamped THEN
      RAISE EXCEPTION 'D2_ASSERT_FAIL (b): expected (0,false) got (%,%)', v_new, v_clamped;
    END IF;

    -- --- (c) oversell: refill to 2, sell 5 -> 0, clamped ----------------------
    UPDATE bin_inventory SET quantity = 2 WHERE finished_good_id = v_fg AND bin_id = v_bin;
    SELECT d.new_quantity, d.clamped INTO v_new, v_clamped
      FROM debit_bin_inventory(v_bin, v_fg, 5) d;
    IF v_new <> 0 OR NOT v_clamped THEN
      RAISE EXCEPTION 'D2_ASSERT_FAIL (c): expected (0,true) got (%,%)', v_new, v_clamped;
    END IF;

    -- --- (d) missing row: bogus keys -> 0, clamped ---------------------------
    SELECT d.new_quantity, d.clamped INTO v_new, v_clamped
      FROM debit_bin_inventory(gen_random_uuid(), gen_random_uuid(), 4) d;
    IF v_new <> 0 OR NOT v_clamped THEN
      RAISE EXCEPTION 'D2_ASSERT_FAIL (d): expected (0,true) got (%,%)', v_new, v_clamped;
    END IF;

    RAISE EXCEPTION 'D2_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'D2_VERIFY_OK' THEN
        RAISE NOTICE 'D2 debit_bin_inventory verification passed (a,b,c,d); test rows rolled back';
      ELSIF SQLERRM LIKE 'D2_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine logic bug: abort migration
      ELSE
        RAISE WARNING 'D2 debit_bin_inventory verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
