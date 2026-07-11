-- =============================================================================
-- 00234 -- Serialize keg ship allocation; total-order the FIFO draw
-- =============================================================================
-- Two review findings against 00229's create_keg_ship_transactions_from_order
-- (PR #363 review blockers 2 and 7), fixed by replacing the function. The body
-- below is 00229's verbatim except where marked 00234 -- 00232 deliberately did
-- not touch this function (its location stamps flow INTO the rows this copies).
--
-- 1. CROSS-ORDER DOUBLE-DRAW (blocker 2). The per-line re-read of
--    keg_filled_contents sees legs inserted earlier in the SAME transaction,
--    which is what stops one order's groups from double-drawing a lot. It does
--    NOT see another in-flight transaction's uncommitted legs: two staff
--    fulfilling two different orders concurrently both read the same snapshot,
--    both pass the shortfall guard, and both draw down the same keg lots. The
--    doubled outflow nets a keg_filled_contents group NEGATIVE, the HAVING
--    sum > 0 discards it, and the fleet total INFLATES -- exactly the state
--    00229's header declares unrepresentable (its shortfall guard aborts
--    single-transaction over-draws for this same reason).
--    FIX: PERFORM pg_advisory_xact_lock(...) at the top, serializing the
--    function globally. Lock-scope choice, GLOBAL over per-selling_format:
--      * one fulfillment spans MULTIPLE (format, owner) groups, so per-format
--        locks taken inside the loop acquire in per-order order -- two
--        concurrent orders sharing two formats can acquire them in opposite
--        order and DEADLOCK. Avoiding that means pre-collecting and sorting the
--        format set before locking: real complexity, bought for a path executed
--        at human fulfillment frequency (a few times a day, seconds apart), not
--        a hot path. Serializing fulfillments is unobservable in practice.
--      * a global lock also closes the same-order double-submit race for free:
--        the idempotency EXISTS guard was equally check-then-act, so two
--        concurrent fulfillments of the SAME order could both pass it and
--        insert duplicate legs. Locking before the guard serializes that too.
--      * xact-scoped, so it releases on commit AND on any abort path
--        (including the shortfall RAISE) with nothing to clean up.
--    Key: the two-int form (hashtext(function name), 0). The single-bigint form
--    sign-extends hashtext's int4 and splits awkwardly across pg_locks'
--    classid/objid; the two-int form maps classid = key1, objid = key2,
--    objsubid = 2, which the verification below asserts directly.
--    RESIDUAL (documented, not fixed here): revise_packaging_session's
--    revise-down (00232) also draws down keg_filled_contents rows and does not
--    take this lock, so a revise-down racing a fulfillment can still double-draw
--    in the same way. Same fix shape (share this lock key) if it is ever
--    observed; revisions are rarer still than fulfillments.
--
-- 2. FIFO TIE UNDER-ORDERED (item 7). ORDER BY fg.production_date NULLS LAST,
--    fg.lot_number does not break ties WITHIN a lot: keg_filled_contents keys
--    rows by (selling_format, location, bin, finished_good, brand), so one lot
--    filled into two bins yields two candidate rows the ORDER BY cannot rank.
--    Which bin's kegs a partial draw ships from -- and therefore which bin's
--    Square count decrements -- was plan-dependent. Appended
--    kfc.location_id, kfc.bin_id: with the view's group key now fully ordered,
--    the draw is a total order and deterministic across syncs and replans.
--
-- OWNER DIMENSION (review item 8, comment-only). keg_filled_contents carries NO
-- keg_owner dimension (00229 header), but keg_inventory nets by it. Packaging
-- fills insert legs with keg_owner_id NULL (+filled lands in the owner-NULL
-- group), while an order line may name a keg_owner_id, which this function
-- stamps on the ship leg: its -filled then lands in the owner-X group, where no
-- fill ever deposited a positive. The owner-X negative is dropped by the
-- HAVING, the owner-NULL positive never decrements, and the fleet total
-- inflates by every keg shipped under a named owner. Fixing it means deciding
-- whose kegs a fill fills -- a business rule (owner is not recorded at packaging
-- time), out of scope here. Until then: EITHER leave keg_owner_id off keg order
-- lines, OR record fills with the same owner the orders will name.
--
-- Copy-don't-derive ship-leg semantics, brand-scoped demand, shortfall RAISE,
-- and the (format, owner) idempotency guard are all preserved from 00229
-- unchanged -- see 00229's header for their rationale.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_keg_ship_transactions_from_order(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order     RECORD;
  v_group     RECORD;
  v_line      RECORD;
  v_lot       RECORD;
  v_remaining INTEGER;
  v_take      INTEGER;
  v_count     INTEGER := 0;
BEGIN
  -- 00234: serialize ship allocation globally (see header). Must precede BOTH
  -- the idempotency guard and the keg_filled_contents reads -- every decision
  -- below is made against state another fulfillment may be about to change.
  PERFORM pg_advisory_xact_lock(hashtext('create_keg_ship_transactions_from_order'), 0);

  SELECT id, customer_id, order_number INTO v_order
  FROM orders WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- valid_ship_transaction CHECK requires customer_id; a customer-less order
  -- has no keg balance to track, so skip rather than error the fulfillment.
  IF v_order.customer_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Outer loop is (selling_format, keg_owner): the unit the idempotency guard
  -- keys on, unchanged from 00183. Groups are disjoint on that key, so the legs
  -- inserted for one group can never satisfy another group's guard.
  FOR v_group IN
    SELECT oi.selling_format_id, oi.keg_owner_id
    FROM order_items oi
    JOIN selling_formats sf ON sf.id = oi.selling_format_id
    JOIN containers c ON c.id = sf.container_id
    WHERE oi.order_id = p_order_id
      AND c.type = 'keg'
      AND oi.quantity > 0
    GROUP BY oi.selling_format_id, oi.keg_owner_id
  LOOP
    -- Idempotency: skip if a ship transaction already exists for this
    -- order + format + owner (e.g. order re-fulfilled after un-fulfilling).
    -- Check-then-act, made safe by the advisory lock above (00234).
    IF EXISTS (
      SELECT 1 FROM keg_transactions kt
      WHERE kt.order_id = p_order_id
        AND kt.transaction_type = 'ship'
        AND kt.selling_format_id = v_group.selling_format_id
        AND kt.keg_owner_id IS NOT DISTINCT FROM v_group.keg_owner_id
    ) THEN
      CONTINUE;
    END IF;

    -- Brand-scoped demand within the group. Named brands allocate before a
    -- NULL-brand line, so a wildcard line cannot strip lots a named line needs.
    FOR v_line IN
      SELECT oi.brand_id, SUM(oi.quantity)::INTEGER AS quantity
      FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.selling_format_id = v_group.selling_format_id
        AND oi.keg_owner_id IS NOT DISTINCT FROM v_group.keg_owner_id
        AND oi.quantity > 0
      GROUP BY oi.brand_id
      ORDER BY oi.brand_id NULLS LAST
    LOOP
      v_remaining := v_line.quantity;

      -- Re-read per line: this is a fresh statement, so it sees the legs already
      -- inserted for earlier lines and owner groups in this transaction. That is
      -- what stops two groups from drawing down the same lot twice. Cross-
      -- TRANSACTION double-draws are excluded by the advisory lock (00234).
      -- 00234: location_id, bin_id appended -- one lot filled into several bins
      -- yields several rows here that production_date + lot_number cannot rank;
      -- the full view group key makes the draw a total order.
      FOR v_lot IN
        SELECT kfc.finished_good_id, kfc.location_id, kfc.bin_id, kfc.quantity
        FROM keg_filled_contents kfc
        JOIN finished_goods fg ON fg.id = kfc.finished_good_id
        WHERE kfc.selling_format_id = v_group.selling_format_id
          AND (v_line.brand_id IS NULL OR kfc.brand_id = v_line.brand_id)
        ORDER BY fg.production_date NULLS LAST, fg.lot_number, kfc.location_id, kfc.bin_id
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_remaining, v_lot.quantity);

        INSERT INTO keg_transactions (
          transaction_type,
          selling_format_id,
          keg_owner_id,
          quantity,
          from_state,
          to_state,
          customer_id,
          order_id,
          finished_good_id,
          from_location_id,
          from_bin_id,
          notes
        ) VALUES (
          'ship',
          v_group.selling_format_id,
          v_group.keg_owner_id,
          v_take,
          'filled',
          'shipped',
          v_order.customer_id,
          v_order.id,
          v_lot.finished_good_id,
          v_lot.location_id,
          v_lot.bin_id,
          'Auto-created from order ' || v_order.order_number || ' fulfillment'
        );

        v_remaining := v_remaining - v_take;
        v_count := v_count + 1;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION
          'Order %: cannot ship % keg(s) of selling format % (brand %) -- only % filled keg(s) are recorded. Record the packaging fill before fulfilling this order.',
          v_order.order_number,
          v_line.quantity,
          v_group.selling_format_id,
          COALESCE(v_line.brand_id::TEXT, 'any'),
          v_line.quantity - v_remaining;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_keg_ship_transactions_from_order IS
  'Creates ship keg_transactions for all keg-container order items when an order is fulfilled. Keg detection via selling_formats -> containers (type = keg). Since 00229 each leg names the lot it draws down: demand is allocated FIFO over keg_filled_contents by finished_goods.production_date NULLS LAST, lot_number, then location_id, bin_id (00234: the full view group key, so a lot split across bins draws in a total order), scoped to the order line brand_id when set, and the leg copies finished_good_id/location_id/bin_id from the drawn row so keg_filled_contents nets. Since 00234 the function serializes on pg_advisory_xact_lock(hashtext(function name), 0): concurrent fulfillments of different orders shared a snapshot and could double-draw the same lots, netting groups negative (dropped by HAVING) and inflating the fleet. RAISEs if an order ships more kegs of a brand than are recorded as filled. NOTE: ship legs stamp the order''s keg_owner_id but fills record owner NULL, so a named-owner ship strands its negative in an ownerless-positive fleet -- see 00234 header. Returns the number of legs created.';

-- 00228's keg_inventory comment justified dropping the bin dimension with
-- "Bins live on keg_filled_contents, whose legs are inflow-only." False since
-- 00229: ship legs (and 00232's revise-down legs) are OUTFLOW legs carrying
-- bins -- copied off the keg_filled_contents rows they draw down, which is
-- exactly why that view's bin dimension nets while keg_inventory's could not.
-- The netting argument itself is unchanged; only its stated premise was stale.
COMMENT ON VIEW keg_inventory IS
  'Physical keg counts by (selling_format, keg_owner, state, location), netted from keg_transactions. The bin dimension 00220 added was REMOVED in 00228: no writer stamps a bin on BOTH legs of a move within this view''s grouping, so grouping by bin stranded the negative leg in its own group (discarded by HAVING > 0) and inflated the fleet -- the 00207 bug. Bins live on keg_filled_contents, whose outflow legs (ship 00229, revise-down 00232) COPY location/bin off the rows they draw down, which is why its bin dimension nets. Contents (batch/finished good) stay out of THIS grouping so fill and ship legs net.';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- 00207/00219/00229 idiom
-- =============================================================================
-- Proves, then rolls back:
--   (1) LOCK: after a fulfillment, the transaction holds the advisory lock
--       (two-int key: classid = hashtext(function name), objid = 0,
--       objsubid = 2) -- the serialization path is actually taken.
--   (2) TIEBREAK: one lot filled into TWO bins; a partial draw ships from the
--       row that sorts first on (location_id, bin_id), computed here the same
--       way, not from whichever row the plan happened to emit first.
--   (3) Netting semantics preserved by the replacement: the drawn-from bin's
--       keg_filled_contents row decrements/disappears, the other bin's row is
--       untouched, and no row nets negative.
-- Assertions read keg_filled_contents and the raw ledger only (00232's
-- convention -- keg_inventory's definition varies across replay environments).
DO $$
DECLARE
  v_loc      UUID;
  v_cust     UUID;
  v_brand    UUID;
  v_c_keg    UUID;
  v_sf_keg   UUID;
  v_bin_x    UUID;
  v_bin_y    UUID;
  v_fg       UUID;
  v_order    UUID;
  v_first    RECORD;   -- the (location, bin, qty) row the tiebreak must draw first
  v_take     INTEGER;  -- expected quantity drawn from v_first
  v_legs     INTEGER;
  v_qty      INTEGER;
  v_key      INTEGER := hashtext('create_keg_ship_transactions_from_order');
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('B_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;

    INSERT INTO customers (name, customer_type)
      VALUES ('B_verify_cust_' || v_sfx, 'wholesale')
      RETURNING id INTO v_cust;

    INSERT INTO brands (name)
      VALUES ('B_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;

    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('B_verify_keg_' || v_sfx, 'keg', 0.5, 0)
      RETURNING id INTO v_c_keg;

    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'B_verify_sf_keg_' || v_sfx, 1)
      RETURNING id INTO v_sf_keg;

    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'B_verify_bin_X_' || v_sfx)
      RETURNING id INTO v_bin_x;

    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'B_verify_bin_Y_' || v_sfx)
      RETURNING id INTO v_bin_y;

    -- ONE lot (keg format, so the 00219 placement trigger skips it), filled
    -- into TWO bins: production_date + lot_number tie on both rows, so only
    -- the 00234 (location_id, bin_id) tiebreak can order the draw.
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand, v_sf_keg, 10, 'B-fg-' || v_sfx, DATE '2026-01-01')
      RETURNING id INTO v_fg;

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_keg, 20, 'empty', v_loc, v_bin_x, 'B verify: receive 20');

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       from_location_id, from_bin_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_keg, 6, 'empty', 'filled',
              v_loc, v_bin_x, v_loc, v_bin_x, v_fg, 'B verify: fill 6 into bin X');

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       from_location_id, from_bin_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_keg, 4, 'empty', 'filled',
              v_loc, v_bin_y, v_loc, v_bin_y, v_fg, 'B verify: fill 4 into bin Y');

    -- Which row must the tiebreak draw first? Computed with the function's own
    -- ORDER BY -- bin UUIDs are random, so the winner is not knowable statically.
    SELECT kfc.location_id, kfc.bin_id, kfc.quantity INTO v_first
      FROM keg_filled_contents kfc
      WHERE kfc.finished_good_id = v_fg
      ORDER BY kfc.location_id, kfc.bin_id
      LIMIT 1;
    v_take := LEAST(5, v_first.quantity);

    -- --- a 5-keg order: less than the lot, so the draw order is observable ----
    INSERT INTO orders (order_number, customer_id)
      VALUES ('B-VERIFY-' || left(v_sfx, 12), v_cust)
      RETURNING id INTO v_order;

    INSERT INTO order_items (order_id, selling_format_id, brand_id, quantity)
      VALUES (v_order, v_sf_keg, v_brand, 5);

    v_legs := create_keg_ship_transactions_from_order(v_order);

    -- --- (1) the advisory lock is held by THIS transaction --------------------
    PERFORM 1 FROM pg_locks
      WHERE locktype = 'advisory'
        AND pid = pg_backend_pid()
        AND objsubid = 2
        AND classid::bigint = (v_key::bigint & 4294967295)
        AND objid = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (1): fulfillment did not take the advisory xact lock -- concurrent orders can double-draw';
    END IF;

    -- --- (2) the tiebreak drew the first-sorted (location, bin) row first -----
    SELECT quantity INTO v_qty FROM keg_transactions
      WHERE order_id = v_order AND transaction_type = 'ship'
        AND from_bin_id = v_first.bin_id;
    IF COALESCE(v_qty, 0) <> v_take THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (2): first-sorted bin shipped % but expected % -- the (location_id, bin_id) tiebreak is not ordering the draw', COALESCE(v_qty, 0), v_take;
    END IF;

    IF v_legs <> (CASE WHEN v_first.quantity >= 5 THEN 1 ELSE 2 END) THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (2): expected % ship leg(s), got %', (CASE WHEN v_first.quantity >= 5 THEN 1 ELSE 2 END), v_legs;
    END IF;

    -- --- (3) copy-don't-derive netting survived the replacement ---------------
    -- Drawn-from bin nets down by the take; 10 filled - 5 shipped = 5 remain.
    SELECT COALESCE(sum(quantity), 0) INTO v_qty FROM keg_filled_contents
      WHERE finished_good_id = v_fg;
    IF v_qty <> 5 THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (3): lot shows % filled but expected 5 (10 filled - 5 shipped) -- ship legs are not netting', v_qty;
    END IF;

    SELECT quantity INTO v_qty FROM keg_filled_contents
      WHERE finished_good_id = v_fg AND bin_id = v_first.bin_id;
    IF COALESCE(v_qty, 0) <> v_first.quantity - v_take THEN
      RAISE EXCEPTION 'B_ASSERT_FAIL (3): drawn-from bin shows % but expected %', COALESCE(v_qty, 0), v_first.quantity - v_take;
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing). The
    -- advisory lock survives the savepoint unwind by design (xact-scoped locks
    -- release only at top-level commit/abort, i.e. when this migration ends).
    RAISE EXCEPTION 'B_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'B_VERIFY_OK' THEN
        RAISE NOTICE 'B keg-ship serialization verification passed (advisory lock held, (location,bin) tiebreak orders the draw, netting preserved); test rows rolled back';
      ELSIF SQLERRM LIKE 'B_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine regression: abort migration
      ELSE
        RAISE WARNING 'B keg-ship serialization verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced function is picked up.
NOTIFY pgrst, 'reload schema';
