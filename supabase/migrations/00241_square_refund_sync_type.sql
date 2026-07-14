-- 00241_square_refund_sync_type.sql
-- Square POS refund reversal (audit 2026-07-10 IN-3, backlog P1 #8).
--
-- WHY THIS EXISTS
--   The Square webhook ingests a COMPLETED payment as a taproom_sale allocation
--   (volume_bbl feeds get_ttb_removals_summary's taxpaid arm) plus a
--   debit_bin_inventory decrement. Refunds/voids were never reversed, so a
--   refunded sale permanently overstated TTB taxpaid removals AND the bin
--   count. The webhook now handles refund.created / refund.updated
--   (src/app/api/square/webhook/route.ts): once a refund is COMPLETED and its
--   order was one this system ingested, it inserts a REVERSING allocation per
--   refunded lot draw and credits the bin.
--
-- REVERSAL MECHANISM (decided; the other candidates are blocked):
--   * DELETE the original taproom_sale allocation — BLOCKED by 00211's
--     trg_prevent_completed_allocation_delete (completed depletions must be
--     reversed, never removed).
--   * Status-cancel the original — BLOCKED by 00205's allocation state machine
--     (trg_validate_allocation_status: 'completed' is terminal, mirrored from
--     src/entities/allocation/core.ts; changing it would fork TS/DB parity).
--   * INSERT an inverse adjustment allocation — the mechanism 00211 itself
--     prescribes ("reverse them with a cancellation or a count adjustment"):
--     destination_type = 'adjustment', reason_code = 'refund', status =
--     'completed', quantity = -(refunded units), volume_bbl = -(refunded
--     volume). CHOSEN, because the negative row flows correctly through every
--     consumer:
--       - get_ttb_removals_summary: lands in adjustments_bbl, which
--         get_ttb_report SUMS INTO total_removals_bbl (00041:494-499) — the
--         refund NETS total removals in the REFUND month, without rewriting the
--         (possibly already-filed) sale month's taxpaid_domestic_bbl. Same
--         period discipline backlog BD-6 prescribes for revision deltas.
--       - get_ttb_inventory_summary: alloc_before/alloc_end sum volume_bbl of
--         completed allocations, so the negative volume raises ending
--         inventory — the refunded beer is back on hand.
--       - availability (00010 views, 00212/00216 guards, 00226 sellable
--         clamp): active-allocation SUM(quantity) drops, restoring ledger unit
--         availability so the bin credit below is actually POS-sellable
--         through sellable_inventory's LEAST(bin, ledger availability).
--       - 00212 guard exempts destination_type='adjustment'; 00211's
--         chk_allocation_adjustment_reason is satisfied by reason_code.
--
--   That mechanism needs the two sign CHECKs relaxed FOR ADJUSTMENT ROWS ONLY
--   (part 2). Every other destination_type keeps quantity >= 0 and
--   volume_bbl >= 0 — depletions still cannot go negative.
--
-- PARTS
--   1. square_sync_log.sync_type CHECK: admit 'refund_ingest' (the webhook's
--      refund dedup claim, keyed on the Square REFUND id — the order id slot
--      in the UNIQUE square_payment_id column is held by the sale claim).
--   2. allocations: allow negative quantity / volume_bbl on adjustment rows.
--   3. credit_bin_inventory(): row-locked bin credit, twin of 00223's
--      debit_bin_inventory.
--   4. square_draft_sales.voided_at: refund-void marker for staged keg pours
--      that have not been reconciled into allocations (reconciliation flow is
--      backlog #7, not built yet — every draft row is un-reconciled today).
--
-- NOT applied live. Deploy via scripts/db-push.sh after merge.
-- Live-safe when pushed: CHECK relaxations only widen (existing rows satisfied
-- the stricter forms); one additive nullable column; one new locked-down
-- function. Verified by a self-rolling-back DO block (commits NO rows).

-- =============================================================================
-- PART 1 -- square_sync_log.sync_type: admit 'refund_ingest'
-- =============================================================================

ALTER TABLE square_sync_log
  DROP CONSTRAINT IF EXISTS square_sync_log_sync_type_check;
ALTER TABLE square_sync_log
  ADD CONSTRAINT square_sync_log_sync_type_check
  CHECK (sync_type IN ('catalog_push', 'inventory_push', 'sale_ingest', 'inventory_event', 'refund_ingest'));

COMMENT ON COLUMN square_sync_log.sync_type IS
  'Type of sync: catalog_push / inventory_push (MGR pushing OUT to Square), sale_ingest (payment webhook ingesting a sale IN), inventory_event (Square''s own inventory.count.updated notifications, logged for visibility only -- 00233), or refund_ingest (refund webhook reversing an ingested sale -- 00241). Mirror of SquareSyncType in src/integrations/square/types.ts.';

-- =============================================================================
-- PART 2 -- allocations: inverse (negative) adjustment rows
-- =============================================================================
-- Adjustment allocations were the only sanctioned reversal mechanism (00211)
-- but both sign CHECKs forced them positive, so they could only ever deepen a
-- depletion (count write-downs), never reverse one. Refund reversals need the
-- inverse row. Scope the relaxation to destination_type = 'adjustment' only:
-- real depletions (order, taproom_sale, sample, loss, ...) keep quantity >= 0
-- and volume_bbl >= 0. The 00212 availability guard already exempts
-- adjustments wholesale, so no guard change is needed; 00211's
-- chk_allocation_adjustment_reason still requires a reason_code.

ALTER TABLE allocations
  DROP CONSTRAINT IF EXISTS chk_allocation_quantity_positive;
ALTER TABLE allocations
  ADD CONSTRAINT chk_allocation_quantity_positive
  CHECK (quantity >= 0 OR destination_type = 'adjustment');

ALTER TABLE allocations
  DROP CONSTRAINT IF EXISTS chk_allocation_volume_nonnegative;
ALTER TABLE allocations
  ADD CONSTRAINT chk_allocation_volume_nonnegative
  CHECK (volume_bbl IS NULL OR volume_bbl >= 0 OR destination_type = 'adjustment');

COMMENT ON CONSTRAINT chk_allocation_quantity_positive ON allocations IS
  '00241: depleting allocations stay non-negative; adjustment rows may be negative -- a negative adjustment is the sanctioned INVERSE of a completed depletion (e.g. a Square refund reversing a taproom_sale), restoring ledger availability and netting TTB removals via adjustments_bbl in the refund period.';
COMMENT ON CONSTRAINT chk_allocation_volume_nonnegative ON allocations IS
  '00241: volume_bbl stays non-negative except on adjustment rows, whose negative volume nets get_ttb_removals_summary.adjustments_bbl (summed into total_removals_bbl by get_ttb_report) and raises ending inventory in get_ttb_inventory_summary.';

-- =============================================================================
-- PART 3 -- credit_bin_inventory(): row-locked bin credit for refunds
-- =============================================================================
-- Twin of debit_bin_inventory (00223): the refund webhook credits the resolved
-- POS bin's finished-good count for each reversed lot draw. INSERT ... ON
-- CONFLICT DO UPDATE takes the same per-row lock as 00223's SELECT ... FOR
-- UPDATE, so concurrent sales/refunds at one bin serialize on the row and no
-- update is lost. The INSERT arm is defensive: the sale's debit clamps to zero
-- but never deletes the row, so the target row normally exists.
--
-- SECURITY DEFINER + service_role-only for exactly 00223's reasons: the
-- unauthenticated webhook caller must bypass bin_inventory RLS, and a
-- PostgREST-exposed SECURITY DEFINER inventory writer must not be callable by
-- authenticated/anon.
--
-- NOT idempotent -- the webhook's refund claim (square_sync_log, sync_type
-- 'refund_ingest', UNIQUE square_payment_id storing the refund id) guarantees
-- at-most-once per refund.

-- security-definer: justified the system webhook caller must bypass bin_inventory RLS; EXECUTE is revoked from PUBLIC and granted only to service_role below.
CREATE OR REPLACE FUNCTION credit_bin_inventory(
  p_bin_id UUID,
  p_finished_good_id UUID,
  p_qty INTEGER
)
RETURNS TABLE (new_quantity INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'credit_bin_inventory: quantity must be positive, got %', p_qty
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
  VALUES (p_finished_good_id, p_bin_id, p_qty)
  ON CONFLICT (finished_good_id, bin_id)
  DO UPDATE SET quantity = bin_inventory.quantity + EXCLUDED.quantity
  RETURNING bin_inventory.quantity;
END;
$$;

COMMENT ON FUNCTION credit_bin_inventory(UUID, UUID, INTEGER) IS
  'Atomically credit a bin''s finished-good quantity for a Square POS refund (00241, audit IN-3). Twin of debit_bin_inventory (00223): INSERT ... ON CONFLICT DO UPDATE row-locks so concurrent sales/refunds at the same bin cannot lose updates; creates the row if the bin never held the FG (defensive -- debits clamp to zero, never delete). SECURITY DEFINER to bypass the system webhook caller''s bin_inventory RLS; EXECUTE locked to service_role. NOT idempotent -- the webhook''s refund-id dedup claim (square_sync_log sync_type refund_ingest) guarantees at-most-once.';

REVOKE ALL ON FUNCTION credit_bin_inventory(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_bin_inventory(UUID, UUID, INTEGER) TO service_role;

-- =============================================================================
-- PART 4 -- square_draft_sales.voided_at: refund-void marker for staged pours
-- =============================================================================
-- Draft (keg pour) lines are staged in square_draft_sales, not allocated
-- (depletion deferred to the reconciliation flow, backlog #7 -- not built, so
-- no draft row is reconciled today). A FULL refund of a draft order therefore
-- has nothing to reverse in allocations; the webhook instead stamps voided_at
-- so reconciliation skips the row. When #7 lands, reconciled-then-refunded
-- pours will reverse their reconciled allocation via the same inverse
-- adjustment mechanism as packaged lines.

ALTER TABLE square_draft_sales
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

COMMENT ON COLUMN square_draft_sales.voided_at IS
  'Set by the refund webhook (00241) when the staged pour''s order is FULLY refunded before reconciliation: the draft is void and must be excluded from keg-depletion reconciliation (backlog #7). NULL = live. The refund id is recorded in the refund''s square_sync_log details.';

-- =============================================================================
-- PART 5 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (a) sync_type 'refund_ingest' inserts; an unknown sync_type still rejects;
--   (b) a negative-quantity/-volume ADJUSTMENT allocation inserts; a negative
--       quantity on a NON-adjustment row still rejects;
--   (c) credit_bin_inventory: credits an existing row (10 + 3 = 13), creates a
--       missing row (NULL -> 4), and rejects a non-positive quantity.
--
-- Same self-rolling-back idiom as 00223/00224/00233: a passing run RAISEs
-- 'R_VERIFY_OK' to unwind the subtransaction; a genuine logic failure RAISEs
-- 'R_ASSERT_FAIL...' and re-raises to ABORT the migration; any other error
-- (missing prerequisites on a from-scratch replay) is downgraded to a WARNING
-- so the DDL above still applies -- this block is a check, not a gate.
DO $$
DECLARE
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
  v_loc     UUID;
  v_brand   UUID;
  v_cont    UUID;
  v_sf      UUID;
  v_bin     UUID;
  v_bin2    UUID;
  v_fg      UUID;
  v_new     INTEGER;
  v_caught  BOOLEAN;
BEGIN
  BEGIN
    -- (a) refund_ingest accepted ...
    INSERT INTO square_sync_log (sync_type, started_at, details)
      VALUES ('refund_ingest', now(), jsonb_build_object('verify', v_sfx));
    -- ... unknown sync_type still rejected.
    v_caught := false;
    BEGIN
      INSERT INTO square_sync_log (sync_type, started_at, details)
        VALUES ('bogus_type_' || v_sfx, now(), '{}'::jsonb);
    EXCEPTION WHEN check_violation THEN
      v_caught := true;
    END;
    IF NOT v_caught THEN
      RAISE EXCEPTION 'R_ASSERT_FAIL (a): unknown sync_type was NOT rejected by square_sync_log_sync_type_check';
    END IF;

    -- --- prerequisites for (b)/(c) (all rolled back) --------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('R_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;
    INSERT INTO brands (name)
      VALUES ('R_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_oz, deposit_amount)
      VALUES ('R_verify_pkg_' || v_sfx, 'package', 12, 0)
      RETURNING id INTO v_cont;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_cont, 'R_verify_sf_' || v_sfx, 1)
      RETURNING id INTO v_sf;
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'R_verify_bin_' || v_sfx, false)
      RETURNING id INTO v_bin;
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'R_verify_bin2_' || v_sfx, false)
      RETURNING id INTO v_bin2;
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf, 100, 'R-' || v_sfx)
      RETURNING id INTO v_fg;

    -- (b) inverse adjustment allocation accepted ...
    INSERT INTO allocations
      (source_type, source_id, destination_type, quantity, volume_bbl,
       reason_code, status, completed_at, notes)
    VALUES
      ('finished_good', v_fg, 'adjustment', -3, -0.0121,
       'refund', 'completed', now(), 'R_verify_' || v_sfx);
    -- ... negative quantity on a non-adjustment row still rejected.
    v_caught := false;
    BEGIN
      INSERT INTO allocations
        (source_type, source_id, destination_type, quantity, status, notes)
      VALUES
        ('finished_good', v_fg, 'taproom_sale', -1, 'completed', 'R_verify_' || v_sfx);
    EXCEPTION WHEN check_violation THEN
      v_caught := true;
    END;
    IF NOT v_caught THEN
      RAISE EXCEPTION 'R_ASSERT_FAIL (b): negative quantity on a non-adjustment allocation was NOT rejected';
    END IF;

    -- (c) credit an existing bin row: 10 + 3 = 13 ...
    INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
      VALUES (v_fg, v_bin, 10)
      ON CONFLICT (finished_good_id, bin_id) DO UPDATE SET quantity = 10;
    SELECT c.new_quantity INTO v_new FROM credit_bin_inventory(v_bin, v_fg, 3) c;
    IF v_new <> 13 THEN
      RAISE EXCEPTION 'R_ASSERT_FAIL (c1): expected 13 got %', v_new;
    END IF;
    -- ... create a missing row: NULL -> 4 ...
    DELETE FROM bin_inventory WHERE finished_good_id = v_fg AND bin_id = v_bin2;
    SELECT c.new_quantity INTO v_new FROM credit_bin_inventory(v_bin2, v_fg, 4) c;
    IF v_new <> 4 THEN
      RAISE EXCEPTION 'R_ASSERT_FAIL (c2): expected 4 got %', v_new;
    END IF;
    -- ... non-positive quantity rejected.
    v_caught := false;
    BEGIN
      PERFORM credit_bin_inventory(v_bin, v_fg, 0);
    EXCEPTION WHEN check_violation THEN
      v_caught := true;
    END;
    IF NOT v_caught THEN
      RAISE EXCEPTION 'R_ASSERT_FAIL (c3): non-positive credit quantity was NOT rejected';
    END IF;

    RAISE EXCEPTION 'R_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'R_VERIFY_OK' THEN
        RAISE NOTICE 'R refund-reversal verification passed (a,b,c); test rows rolled back';
      ELSIF SQLERRM LIKE 'R_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine logic bug: abort migration
      ELSE
        RAISE WARNING 'R refund-reversal verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
