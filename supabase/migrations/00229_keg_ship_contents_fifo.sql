-- =============================================================================
-- 00229 -- Ship legs carry contents, so keg_filled_contents decrements on ship
-- =============================================================================
-- THE BUG (documented, unfixed, in 00207 and again in 00220):
--   create_keg_ship_transactions_from_order (00183) inserts one ship leg per
--   (selling_format, keg_owner) with finished_good_id NULL. keg_filled_contents
--   filters BOTH its inflow and outflow legs on finished_good_id IS NOT NULL, so
--   the ship leg is invisible to it: filled kegs are counted when they are
--   packaged and never uncounted when they leave. The Square catalog inventory
--   sync reads that view, so Square over-reports every keg that has physically
--   shipped to a customer.
--
-- WHY IT WAS LEFT UNFIXED: order_items carries brand_id and selling_format_id but
-- no finished_good_id. Attributing a shipment to specific lots needs a selection
-- rule, which is a business decision, not a mechanical one.
--
-- THE RULE (chosen 2026-07-10):
--   FIFO by finished_goods.production_date NULLS LAST, then lot_number as the
--   deterministic tiebreak. Candidate lots are restricted to the order line's
--   brand_id when it has one (249 of 251 live order_items do); a NULL brand_id
--   line draws FIFO across every brand in that selling format. batch_id is NOT
--   used to narrow candidates -- zero live order_items populate it.
--
-- SHORTFALL: if an order fulfills more kegs of a brand than keg_filled_contents
-- has recorded as filled, this RAISEs and the fulfillment aborts. That case is
-- unrepresentable rather than merely awkward: keg_inventory's HAVING sum > 0
-- makes a negative group contribute ZERO, not its negative value, so
--   * emitting a contents-less leg for the shortfall inflates the fleet total
--     (the -N never subtracts, the +N shipped survives), and
--   * dropping the shortfall silently under-reports `shipped`, which is what
--     customer_keg_balances and deposit liability read.
-- Both corrupt an invariant. Aborting corrupts neither: a shortfall means a
-- packaging fill was never recorded, and recording it is the only write that
-- makes the data true. No existing order can reach this path -- all 251 live
-- order_items have selling_format_id NULL, so the keg JOIN below matches none.
--
-- LEG SHAPE: each ship leg copies finished_good_id, location_id and bin_id from
-- the keg_filled_contents row it draws down, into finished_good_id,
-- from_location_id and from_bin_id. Copying rather than deriving is what keeps
-- the netting sound: keg_filled_contents groups by (selling_format, location,
-- bin, finished_good, brand), so a leg built from one of its rows is guaranteed
-- to land in the group whose positive it must cancel. Hand-stamping a location
-- would reintroduce the stranded-negative defect 00228 removed from
-- keg_inventory's bin dimension -- 00227's fill writer leaves to_location_id
-- NULL, so a ship leg naming a real location would net against nothing.
--
-- keg_filled_contents has no keg_owner dimension, so contents are attributed
-- regardless of which owner's kegs hold them. Ownership stays on keg_inventory.
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
      -- what stops two groups from drawing down the same lot twice.
      FOR v_lot IN
        SELECT kfc.finished_good_id, kfc.location_id, kfc.bin_id, kfc.quantity
        FROM keg_filled_contents kfc
        JOIN finished_goods fg ON fg.id = kfc.finished_good_id
        WHERE kfc.selling_format_id = v_group.selling_format_id
          AND (v_line.brand_id IS NULL OR kfc.brand_id = v_line.brand_id)
        ORDER BY fg.production_date NULLS LAST, fg.lot_number
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
  'Creates ship keg_transactions for all keg-container order items when an order is fulfilled. Keg detection via selling_formats -> containers (type = keg). Since 00229 each leg names the lot it draws down: demand is allocated FIFO over keg_filled_contents by finished_goods.production_date NULLS LAST then lot_number, scoped to the order line brand_id when set, and the leg copies finished_good_id/location_id/bin_id from the drawn row so keg_filled_contents nets. RAISEs if an order ships more kegs of a brand than are recorded as filled. Returns the number of legs created (was: the number of (format, owner) groups).';

-- keg_filled_contents itself is unchanged -- the ship legs now satisfy its
-- existing finished_good_id IS NOT NULL outflow filter. Only the comment, which
-- has advertised the defect since 00207, is now false.
COMMENT ON VIEW keg_filled_contents IS
  'Filled kegs by (selling_format, location, bin, finished_good, brand), for the Square inventory sync. bin_id added in 00220 (NULL = off-premise); the Square per-bin sync reads it. Decremented on ship since 00229: create_keg_ship_transactions_from_order stamps finished_good_id/from_location_id/from_bin_id on each ship leg, drawing lots FIFO by production_date. Carries no keg_owner dimension -- contents are attributed regardless of whose kegs hold them.';

-- =============================================================================
-- Verification (self-rolling-back; commits NO rows) -- matches 00207/00219/00220
-- =============================================================================
-- Proves, then rolls back:
--   (1) FIFO: a 12-keg order drains the older lot (5) before the newer one (7).
--   (2) Ship legs copy finished_good_id + from_location_id + from_bin_id.
--   (3) keg_filled_contents decrements: older lot's row disappears (netted to 0),
--       newer lot drops 10 -> 3. This is the bug 00229 exists to fix.
--   (4) keg_inventory still nets: 35 empty + 3 filled + 12 shipped = 50 received,
--       i.e. the new from_location_id/from_bin_id stamps strand no negative leg.
--   (5) Shortfall RAISEs rather than writing a fleet-inflating contents-less leg.
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION = savepoint).
-- A passing run RAISEs the sentinel 'A_VERIFY_OK' to unwind the subtransaction so
-- nothing commits. A genuine failure RAISEs 'A_ASSERT_FAIL...' and is re-raised to
-- ABORT the migration. Any other error (missing prerequisites on a from-scratch
-- replay, etc.) is downgraded to a WARNING so the DDL above still applies.
DO $$
DECLARE
  v_loc     UUID;
  v_cust    UUID;
  v_brand   UUID;
  v_c_keg   UUID;
  v_sf_keg  UUID;
  v_bin_x   UUID;
  v_fg_old  UUID;
  v_fg_new  UUID;
  v_order   UUID;
  v_order2  UUID;
  v_legs    INTEGER;
  v_qty     INTEGER;
  v_total   INTEGER;
  v_loc_got UUID;
  v_bin_got UUID;
  v_raised  BOOLEAN := false;
  v_sfx     TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('A_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;

    -- Ship legs require a customer_id (valid_ship_transaction CHECK, 00032).
    INSERT INTO customers (name, customer_type)
      VALUES ('A_verify_cust_' || v_sfx, 'wholesale')
      RETURNING id INTO v_cust;

    INSERT INTO brands (name)
      VALUES ('A_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;

    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('A_verify_keg_' || v_sfx, 'keg', 0.5, 0)
      RETURNING id INTO v_c_keg;

    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'A_verify_sf_keg_' || v_sfx, 1)
      RETURNING id INTO v_sf_keg;

    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'A_verify_bin_X_' || v_sfx)
      RETURNING id INTO v_bin_x;

    -- Two lots of the same brand+format. The FIFO rule must pick v_fg_old first
    -- even though it holds fewer kegs -- production_date, not insertion order or
    -- quantity, decides. selling_format is a keg, so the 00219 placement trigger
    -- skips both -> no bin_inventory pollution.
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand, v_sf_keg, 5, 'A-fg-old-' || v_sfx, DATE '2026-01-01')
      RETURNING id INTO v_fg_old;

    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
      VALUES (v_brand, v_sf_keg, 10, 'A-fg-new-' || v_sfx, DATE '2026-06-01')
      RETURNING id INTO v_fg_new;

    -- --- fixtures: receive 50 empty into bin X, then fill 5 + 10 --------------
    -- set_keg_transaction_states (00190) overrides from_state/to_state on INSERT
    -- and touches no location or bin column, so the stamps below survive.
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_keg, 50, 'empty', v_loc, v_bin_x, 'A verify: receive 50');

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       from_location_id, from_bin_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_keg, 5, 'empty', 'filled',
              v_loc, v_bin_x, v_loc, v_bin_x, v_fg_old, 'A verify: fill 5 of the older lot');

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       from_location_id, from_bin_id, to_location_id, to_bin_id, finished_good_id, notes)
      VALUES ('fill', v_sf_keg, 10, 'empty', 'filled',
              v_loc, v_bin_x, v_loc, v_bin_x, v_fg_new, 'A verify: fill 10 of the newer lot');

    -- --- the order: 12 kegs, more than the older lot alone can cover ----------
    INSERT INTO orders (order_number, customer_id)
      VALUES ('A-VERIFY-' || left(v_sfx, 12), v_cust)
      RETURNING id INTO v_order;

    INSERT INTO order_items (order_id, selling_format_id, brand_id, quantity)
      VALUES (v_order, v_sf_keg, v_brand, 12);

    v_legs := create_keg_ship_transactions_from_order(v_order);

    -- --- (1) FIFO: 5 off the older lot, 7 off the newer ----------------------
    IF v_legs <> 2 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): expected 2 ship legs, got %', v_legs;
    END IF;

    SELECT quantity INTO v_qty FROM keg_transactions
      WHERE order_id = v_order AND transaction_type = 'ship' AND finished_good_id = v_fg_old;
    IF COALESCE(v_qty, 0) <> 5 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): older lot shipped % but expected 5 (FIFO drains it first)', COALESCE(v_qty, 0);
    END IF;

    SELECT quantity INTO v_qty FROM keg_transactions
      WHERE order_id = v_order AND transaction_type = 'ship' AND finished_good_id = v_fg_new;
    IF COALESCE(v_qty, 0) <> 7 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (1): newer lot shipped % but expected 7', COALESCE(v_qty, 0);
    END IF;

    -- --- (2) legs copy the drawn row's location + bin -------------------------
    SELECT from_location_id, from_bin_id INTO v_loc_got, v_bin_got
      FROM keg_transactions
      WHERE order_id = v_order AND transaction_type = 'ship' AND finished_good_id = v_fg_old;
    IF v_loc_got IS DISTINCT FROM v_loc THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): ship leg from_location_id % but expected %', v_loc_got, v_loc;
    END IF;
    IF v_bin_got IS DISTINCT FROM v_bin_x THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (2): ship leg from_bin_id % but expected bin X %', v_bin_got, v_bin_x;
    END IF;

    -- --- (3) keg_filled_contents decrements (THE BUG) -------------------------
    PERFORM 1 FROM keg_filled_contents
      WHERE selling_format_id = v_sf_keg AND finished_good_id = v_fg_old;
    IF FOUND THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): older lot still filled after shipping all 5 -- ship legs are not netting';
    END IF;

    SELECT quantity INTO v_qty FROM keg_filled_contents
      WHERE selling_format_id = v_sf_keg AND finished_good_id = v_fg_new;
    IF COALESCE(v_qty, 0) <> 3 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (3): newer lot shows % filled but expected 3 (10 filled - 7 shipped)', COALESCE(v_qty, 0);
    END IF;

    -- --- (4) keg_inventory still nets to the 50 received ----------------------
    SELECT COALESCE(sum(quantity), 0) INTO v_total
      FROM keg_inventory WHERE selling_format_id = v_sf_keg;
    IF v_total <> 50 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (4): fleet total % but expected 50 -- a ship leg stranded its negative', v_total;
    END IF;

    SELECT quantity INTO v_qty FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'shipped'::keg_state;
    IF COALESCE(v_qty, 0) <> 12 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (4): expected 12 shipped, got %', COALESCE(v_qty, 0);
    END IF;

    SELECT quantity INTO v_qty FROM keg_inventory
      WHERE selling_format_id = v_sf_keg AND state = 'filled'::keg_state AND location_id = v_loc;
    IF COALESCE(v_qty, 0) <> 3 THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (4): expected 3 filled left at the location, got %', COALESCE(v_qty, 0);
    END IF;

    -- --- (5) shortfall aborts instead of inflating the fleet ------------------
    -- Only 3 filled kegs remain; ordering 5 must RAISE.
    INSERT INTO orders (order_number, customer_id)
      VALUES ('A-VERIFY2-' || left(v_sfx, 11), v_cust)
      RETURNING id INTO v_order2;

    INSERT INTO order_items (order_id, selling_format_id, brand_id, quantity)
      VALUES (v_order2, v_sf_keg, v_brand, 5);

    BEGIN
      PERFORM create_keg_ship_transactions_from_order(v_order2);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%only 3 filled keg(s) are recorded%' THEN
          v_raised := true;
        ELSE
          RAISE EXCEPTION 'A_ASSERT_FAIL (5): shortfall raised the wrong error: %', SQLERRM;
        END IF;
    END;

    IF NOT v_raised THEN
      RAISE EXCEPTION 'A_ASSERT_FAIL (5): shipping 5 kegs against 3 filled did not RAISE';
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'A_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'A_VERIFY_OK' THEN
        RAISE NOTICE 'A keg-ship-contents verification passed (FIFO draw, legs carry contents+location+bin, keg_filled_contents decrements, fleet nets to 50, shortfall aborts); test rows rolled back';
      ELSIF SQLERRM LIKE 'A_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine contents-netting bug: abort migration
      ELSE
        RAISE WARNING 'A keg-ship-contents verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced function is picked up.
NOTIFY pgrst, 'reload schema';
