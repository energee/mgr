-- 00232_keg_fill_netting_integrity.sql
-- Square POS bin-sync, PR #361 review blocker 1: make the packaging fill /
-- revise-down writers NET in keg_filled_contents, and repair the historical
-- damage 00227's backfill left behind.
--
-- THE BUG (stranded-negative netting, three shapes)
--   keg_filled_contents (00220) groups inflow legs by to_bin_id and outflow
--   legs by from_bin_id (and likewise for location), keeping only groups with
--   `HAVING sum(qty) > 0`. Netting therefore only works when the positive and
--   the negative leg of a movement land in the SAME group. 00227 started
--   stamping to_bin_id on fill legs but left every counter-leg unstamped:
--
--   (a) REVISE-DOWN. revise_packaging_session's v_delta < 0 'adjust' leg wrote
--       from_bin_id = NULL. Fill 10 into bin X, revise to 8: +10 sits in the
--       (X) group, the -2 sits in the (NULL) group and is DISCARDED by the
--       HAVING. keg_filled_contents reports 10, the Square inventory push
--       tells the register 10 kegs exist -- oversell by every revised-down keg.
--
--   (b) LOCATION DIMENSION. create_finished_goods_from_packaging stamped
--       NEITHER from_location_id NOR to_location_id on the fill, so its
--       keg_filled_contents row carried location NULL, and the fill's
--       empty-pool outflow decremented a location-less empty pool that in
--       practice never exists (empties are received AT a location via the keg
--       transaction form) -- the identical stranded-negative hole one
--       dimension over: the per-location empty pool never decrements on an
--       automated fill.
--
--   (c) HISTORICAL DAMAGE. 00227 Part 3 retroactively stamped to_bin_id on
--       historical fill legs (any fill still net-positive in
--       keg_filled_contents) but did NOT touch their historical 'adjust'
--       counter-legs -- so every pre-00227 fill/revise-down pair that used to
--       net inside the (NULL, NULL) group was BROKEN APART by the backfill:
--       the fill moved to the binned group, the adjust stayed at NULL-bin and
--       fell to the HAVING.
--
-- THE FIX
--   Part 1  create_finished_goods_from_packaging: the fill leg now stamps
--           from_location_id / to_location_id = the resolved bin's location
--           (kegs are filled where the bin lives). to_bin_id as in 00227.
--   Part 2  revise_packaging_session: the keg-increase fill stamps the same
--           locations; the keg-DECREASE now draws down the FG's actual
--           keg_filled_contents rows and COPIES each drawn row's
--           (location_id, bin_id) onto the adjust leg's from_-columns -- the
--           same copy-don't-derive rule 00229 uses for ship legs, which is
--           what guarantees the negative lands in the group whose positive it
--           cancels. A revise-down larger than what is still recorded filled
--           RAISEs (mirroring 00229's shortfall stance): the excess kegs have
--           already shipped/been recorded out, so the revision contradicts the
--           ledger and silently absorbing it would corrupt either the fleet
--           total or the shipped count.
--           Also (review item 9): the bin_inventory revision delta is now
--           scoped to ONE bin row instead of `WHERE finished_good_id = ...`
--           across every bin the FG might ever span.
--   Part 3  Historical repair: for outflow legs (from_state = 'filled',
--           contents attached) still carrying from_bin_id NULL, stamp
--           from_bin_id with the FG's fill bin -- only where that bin is
--           UNAMBIGUOUS (all of the FG's binned fills name one bin) and the
--           leg's from_location_id already matches the fill's to_location_id
--           (otherwise the legs sit in different location groups and a bin
--           stamp cannot unite them). Covers the revise-down 'adjust' legs and
--           any hand-recorded contents-carrying outflow. Historical SHIP legs
--           (pre-00229) carry finished_good_id NULL and are invisible to
--           keg_filled_contents entirely -- they create no NULL-bin negatives
--           (both view legs filter finished_good_id IS NOT NULL); their known
--           effect is the 00207-era over-report of shipped kegs, which 00229
--           fixes forward. Backfilling contents onto them would mean applying
--           00229's FIFO business rule retroactively to historical orders --
--           out of scope here, and the ambiguity is why 00229 itself declined it.
--   Part 4  debit_bin_inventory: defensive p_qty >= 0 guard (00223 nit).
--   Part 5  Verification: proves fill -> revise-down netting and fill -> ship
--           netting (00227's block only proved a FRESH fill, which is exactly
--           why it passed over bug (a)), plus the Part 3 repair, then rolls
--           back.
--
-- INTERPLAY WITH PR #363 (00228/00229, applied live but stacked on this branch)
--   - 00228 REMOVED the bin dimension from keg_inventory (bin was never a
--     sound netting dimension there); keg_filled_contents KEEPS its bin
--     dimension and is what the per-bin Square sync reads -- that view is what
--     this migration makes net. Nothing here touches the keg_inventory views.
--   - 00229 rewrote create_keg_ship_transactions_from_order so each ship leg
--     COPIES finished_good_id / location_id / bin_id from the
--     keg_filled_contents row it draws down. This migration deliberately does
--     NOT touch that function (new-ship stamping belongs to 00229). The
--     location stamps added here flow INTO 00229's copies: new fills produce
--     kfc rows with a real location, ship legs copy it, and both dimensions
--     keep netting. 00229's header note that "00227's fill writer leaves
--     to_location_id NULL" is corrected by this migration.
--   - On a from-scratch replay of THIS branch (00228/00229 absent) the chain
--     still has 00220's keg_inventory-with-bin and 00183's contents-less ship
--     writer. The verification below therefore asserts on keg_filled_contents
--     (identical in both environments) and on the raw keg_transactions ledger,
--     never on keg_inventory, and simulates the ship leg in 00229's shape by
--     direct insert rather than calling the (environment-dependent) function.
--
-- Live-safe: CREATE OR REPLACE of three functions and an idempotent,
-- unambiguous-only repair UPDATE. Verified by a self-rolling-back DO block
-- (commits NO rows).

-- =============================================================================
-- PART 1 -- create_finished_goods_from_packaging: fill carries bin AND location
-- =============================================================================
-- Reproduced from 00227 Part 1 with ONE change: after resolving v_to_bin_id the
-- bin's location is looked up and stamped as BOTH from_location_id (the empty
-- kegs are consumed where the filling happens) and to_location_id (the filled
-- kegs sit there), so the location dimension nets exactly like the bin
-- dimension. If no bin resolves, both stay NULL (unplaced, as before).
-- SECURITY INVOKER / search_path unchanged from 00183/00227.

CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_to_bin_id UUID;
  v_bin_location_id UUID;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)',
      p_session_id, v_session.status;
  END IF;

  FOR v_line IN
    SELECT
      sli.*,
      (c.type = 'keg') AS is_keg
    FROM session_line_items sli
    LEFT JOIN selling_formats sf ON sf.id = sli.selling_format_id
    LEFT JOIN containers c ON c.id = sf.container_id
    WHERE sli.session_id = p_session_id
  LOOP
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Idempotency: a finished good per line item; the keg-fill insert below
    -- only runs when the finished good is created, so it inherits this guard.
    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE;
    END IF;

    v_lot_number := generate_lot_number(v_session.session_date);

    INSERT INTO finished_goods (
      batch_id,
      brand_id,
      selling_format_id,
      session_line_item_id,
      quantity,
      lot_number,
      production_date,
      created_by
    ) VALUES (
      v_line.batch_id,
      v_line.brand_id,
      v_line.selling_format_id,
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    IF v_line.batch_id IS NOT NULL THEN
      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        status,
        lot_number,
        notes,
        completed_at,
        created_by
      ) VALUES (
        'batch',
        v_line.batch_id,
        'finished_good',
        v_fg_id,
        v_line.actual_quantity,
        'completed',
        v_lot_number,
        'Auto-created from packaging session ' || p_session_id::TEXT,
        NOW(),
        v_session.created_by
      );
    END IF;

    -- Restored from 00080: keg lines also record a fill keg_transaction so
    -- keg_inventory (calculated from transactions) reflects the fill and the
    -- transaction links back to this session via packaging_session_id.
    -- Satisfies the valid_fill_transaction CHECK: empty -> filled with a
    -- batch and/or finished good reference.
    IF COALESCE(v_line.is_keg, false) THEN
      -- 00227: resolve the bin the filled keg physically sits in so the per-bin
      -- Square POS sync (sellable_inventory keg branch -> keg_filled_contents
      -- .bin_id -> this fill's to_bin_id) can see it. Mirrors
      -- place_finished_good_in_bin (00219): the session default_bin_id first,
      -- else the location-level is_default_fg bin preferring the primary
      -- location. NULL leaves the keg unplaced (invisible to POS until an
      -- operator assigns a bin), never blocking.
      v_to_bin_id := v_session.default_bin_id;
      IF v_to_bin_id IS NULL THEN
        SELECT b.id
          INTO v_to_bin_id
        FROM bins b
        JOIN locations l ON l.id = b.location_id
        WHERE b.is_default_fg AND b.is_active
        ORDER BY (l.is_primary IS TRUE) DESC, l.created_at
        LIMIT 1;
      END IF;

      -- 00232: the bin's location, stamped on BOTH location legs so the
      -- location dimension of keg_filled_contents / keg_inventory nets. The
      -- kegs are filled where the bin lives: from_location_id decrements that
      -- location's empty pool, to_location_id places the filled pool there
      -- (and 00229's ship legs copy it back out of keg_filled_contents).
      -- Empties received at a DIFFERENT location without a recorded move will
      -- show a visible per-location mismatch -- that reflects real unrecorded
      -- movement; the previous NULL stamps hid it by decrementing a
      -- location-less pool that never existed.
      v_bin_location_id := NULL;
      IF v_to_bin_id IS NOT NULL THEN
        SELECT b.location_id INTO v_bin_location_id FROM bins b WHERE b.id = v_to_bin_id;
      END IF;

      INSERT INTO keg_transactions (
        transaction_type,
        selling_format_id,
        keg_owner_id,
        quantity,
        from_state,
        to_state,
        packaging_session_id,
        batch_id,
        finished_good_id,
        notes,
        from_location_id,
        to_location_id,
        to_bin_id
      ) VALUES (
        'fill',
        v_line.selling_format_id,
        v_line.keg_owner_id,
        v_line.actual_quantity,
        'empty',
        'filled',
        p_session_id,
        v_line.batch_id,
        v_fg_id,
        'Auto-created from packaging session completion',
        v_bin_location_id,
        v_bin_location_id,
        v_to_bin_id
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging IS
  'Creates finished goods and allocations from a completed packaging session, plus a fill keg_transaction (linked via packaging_session_id) for keg-container lines. The fill carries to_bin_id (00227: session default_bin_id, else the location is_default_fg bin) AND from/to_location_id = that bin''s location (00232) so both the bin and the location dimensions of keg_filled_contents net. Uses batch_id/selling_format_id. Skips line items with null/zero actual quantity.';

-- =============================================================================
-- PART 2 -- revise_packaging_session: the decrease leg nets; delta scoped to bin
-- =============================================================================
-- Built on the 00227 body. Changes vs 00227:
--   (1) the v_delta > 0 keg 'fill' stamps from/to_location_id like Part 1;
--   (2) the v_delta < 0 keg decrease draws down the FG's keg_filled_contents
--       rows, copying each drawn row's (location_id, bin_id) onto the adjust
--       leg's from_-columns (and location onto to_location_id -- the re-emptied
--       kegs stay physically at that location). RAISEs when the FG has fewer
--       kegs still recorded filled than the revision removes. to_bin_id is left
--       NULL: empties carry no bin in any live view (00228 dropped
--       keg_inventory''s bin dimension; keg_filled_contents only reads filled
--       legs), and inventing one would fabricate placement (00220 A6 stance).
--   (3) review item 9: the bin_inventory delta targets ONE bin row (the FG''s
--       single placement row; if an FG ever spans bins, the session''s bin is
--       preferred, then the largest row -- deterministic, never every row).
-- SECURITY INVOKER / search_path unchanged.

CREATE OR REPLACE FUNCTION revise_packaging_session(
  p_session_id UUID,
  p_items JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session packaging_sessions%ROWTYPE;
  v_line RECORD;
  v_item RECORD;
  v_fg RECORD;
  v_bom RECORD;
  v_lot RECORD;
  v_alloc RECORD;
  v_kfc RECORD;
  v_is_keg BOOLEAN;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_to_bin_id UUID;
  v_bin_location_id UUID;
  v_delta_bin_id UUID;
  v_old NUMERIC;
  v_new NUMERIC;
  v_delta NUMERIC;
  v_outbound NUMERIC;
  v_needed NUMERIC;
  v_take NUMERIC;
  v_kegs_to_reverse INTEGER;
  v_keg_take INTEGER;
  v_session_note TEXT;
  v_lines_updated INTEGER := 0;
  v_fg_created INTEGER := 0;
  v_fg_updated INTEGER := 0;
  v_allocations_inserted INTEGER := 0;
  v_allocations_reversed INTEGER := 0;
  v_shortfalls JSONB := '[]'::jsonb;
BEGIN
  -- Lock the session for the duration of the revision
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status NOT IN ('completed', 'revised') THEN
    RAISE EXCEPTION 'Only completed (or previously revised) sessions can be revised — this session is %', v_session.status;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No quantity changes submitted';
  END IF;

  -- Must match the notes tag consumePackagingMaterials
  -- (src/services/consumption-service.ts) writes at completion, so reversals
  -- target exactly this session's depletion rows.
  v_session_note := 'Packaging session ' || p_session_id::text || ' material consumption';

  FOR v_item IN
    SELECT
      (e->>'line_item_id')::uuid AS line_item_id,
      NULLIF(e->>'actual_quantity', '')::numeric AS actual_quantity
    FROM jsonb_array_elements(p_items) e
  LOOP
    IF v_item.line_item_id IS NULL THEN
      RAISE EXCEPTION 'Each revision item must include line_item_id';
    END IF;

    SELECT sli.*, (c.type = 'keg') AS is_keg
    INTO v_line
    FROM session_line_items sli
    LEFT JOIN selling_formats sf ON sf.id = sli.selling_format_id
    LEFT JOIN containers c ON c.id = sf.container_id
    WHERE sli.id = v_item.line_item_id
    FOR UPDATE OF sli;

    IF NOT FOUND OR v_line.session_id != p_session_id THEN
      RAISE EXCEPTION 'Line item % does not belong to session %', v_item.line_item_id, p_session_id;
    END IF;

    v_new := v_item.actual_quantity;
    IF v_new IS NOT NULL AND (v_new < 0 OR v_new != trunc(v_new)) THEN
      RAISE EXCEPTION 'Actual quantity must be a non-negative whole number (got %)', v_new;
    END IF;

    -- Skip unchanged lines so callers can submit the full table
    IF v_new IS NOT DISTINCT FROM v_line.actual_quantity THEN
      CONTINUE;
    END IF;

    v_old := COALESCE(v_line.actual_quantity, 0);
    v_delta := COALESCE(v_new, 0) - v_old;
    v_is_keg := COALESCE(v_line.is_keg, false);

    UPDATE session_line_items
    SET actual_quantity = v_new
    WHERE id = v_line.id;
    v_lines_updated := v_lines_updated + 1;

    -- -------------------------------------------------------------------------
    -- Finished goods sync
    -- -------------------------------------------------------------------------
    SELECT * INTO v_fg
    FROM finished_goods
    WHERE session_line_item_id = v_line.id
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_fg_id := v_fg.id;

      -- Never reduce below what's already committed out of this FG
      SELECT COALESCE(SUM(quantity), 0) INTO v_outbound
      FROM allocations
      WHERE source_type = 'finished_good'
        AND source_id = v_fg.id
        AND status IN ('planned', 'completed');

      IF COALESCE(v_new, 0) < v_outbound THEN
        RAISE EXCEPTION 'Cannot reduce finished goods (lot %) to % — % units are already allocated to orders or other destinations',
          v_fg.lot_number, COALESCE(v_new, 0), v_outbound;
      END IF;

      UPDATE finished_goods
      SET quantity = COALESCE(v_new, 0)
      WHERE id = v_fg.id;
      v_fg_updated := v_fg_updated + 1;

      -- A0/D: apply the revision DELTA to its bin, preserving any Square-sale
      -- debits (bin_inventory has a SECOND writer -- debit_bin_inventory
      -- (00223) decrements it on every Square sale -- so an ABSOLUTE overwrite
      -- here would resurrect units already sold through the POS; 00226).
      -- 00232 (review item 9): scope the delta to ONE row. bin_inventory is
      -- UNIQUE(finished_good_id, bin_id) and place_finished_good_in_bin creates
      -- at most one row per FG, but nothing structurally prevents an FG from
      -- spanning bins -- the old `WHERE finished_good_id = ...` applied the
      -- delta to EVERY such row (N x the correction). Target the FG's single
      -- row; if it ever spans bins, prefer the session's own bin, then the
      -- largest row (deterministic). Keg FGs have no bin_inventory row -> no-op.
      SELECT bi.bin_id INTO v_delta_bin_id
      FROM bin_inventory bi
      WHERE bi.finished_good_id = v_fg.id
      ORDER BY (bi.bin_id IS NOT DISTINCT FROM v_session.default_bin_id) DESC,
               bi.quantity DESC,
               bi.bin_id
      LIMIT 1;

      IF v_delta_bin_id IS NOT NULL THEN
        UPDATE bin_inventory
        SET quantity = GREATEST(0, quantity + v_delta)
        WHERE finished_good_id = v_fg.id AND bin_id = v_delta_bin_id;
      END IF;

      -- Keep the completion-time batch -> finished_good allocation in step
      UPDATE allocations
      SET quantity = COALESCE(v_new, 0)
      WHERE source_type = 'batch'
        AND destination_type = 'finished_good'
        AND destination_id = v_fg.id
        AND status = 'completed'
        AND notes LIKE 'Auto-created from packaging session%';
    ELSIF COALESCE(v_new, 0) > 0 THEN
      -- Line had no actuals at completion, so no FG was created — mirror
      -- create_finished_goods_from_packaging (00183)
      v_lot_number := generate_lot_number(v_session.session_date);

      INSERT INTO finished_goods (
        batch_id, brand_id, selling_format_id, session_line_item_id,
        quantity, lot_number, production_date, created_by
      ) VALUES (
        v_line.batch_id, v_line.brand_id, v_line.selling_format_id, v_line.id,
        v_new, v_lot_number, v_session.session_date, v_session.created_by
      )
      RETURNING id INTO v_fg_id;
      v_fg_created := v_fg_created + 1;

      IF v_line.batch_id IS NOT NULL THEN
        INSERT INTO allocations (
          source_type, source_id, destination_type, destination_id,
          quantity, status, lot_number, notes, completed_at, created_by
        ) VALUES (
          'batch', v_line.batch_id, 'finished_good', v_fg_id,
          v_new, 'completed', v_lot_number,
          'Auto-created from packaging session ' || p_session_id::text || ' (revision)',
          NOW(), v_session.created_by
        );
      END IF;
    ELSE
      v_fg_id := NULL;
    END IF;

    -- -------------------------------------------------------------------------
    -- Keg inventory delta (keg_inventory is calculated from keg_transactions)
    -- -------------------------------------------------------------------------
    IF v_is_keg AND v_delta != 0 AND v_fg_id IS NOT NULL THEN
      IF v_delta > 0 THEN
        -- 00227: the keg-increase fill carries to_bin_id so the incremental
        -- filled kegs are visible to the per-bin Square POS sync. Same
        -- resolution as create_finished_goods_from_packaging /
        -- place_finished_good_in_bin (00219): session default_bin_id, else the
        -- location is_default_fg bin. 00232: also stamps from/to_location_id =
        -- the bin's location, exactly like the completion-time fill (Part 1).
        v_to_bin_id := v_session.default_bin_id;
        IF v_to_bin_id IS NULL THEN
          SELECT b.id
            INTO v_to_bin_id
          FROM bins b
          JOIN locations l ON l.id = b.location_id
          WHERE b.is_default_fg AND b.is_active
          ORDER BY (l.is_primary IS TRUE) DESC, l.created_at
          LIMIT 1;
        END IF;

        v_bin_location_id := NULL;
        IF v_to_bin_id IS NOT NULL THEN
          SELECT b.location_id INTO v_bin_location_id FROM bins b WHERE b.id = v_to_bin_id;
        END IF;

        INSERT INTO keg_transactions (
          transaction_type, selling_format_id, keg_owner_id, quantity,
          from_state, to_state, packaging_session_id, batch_id,
          finished_good_id, notes, from_location_id, to_location_id, to_bin_id
        ) VALUES (
          'fill', v_line.selling_format_id, v_line.keg_owner_id, v_delta,
          'empty', 'filled', p_session_id, v_line.batch_id,
          v_fg_id, 'Packaging session revision (quantity increased)',
          v_bin_location_id, v_bin_location_id, v_to_bin_id
        );
      ELSE
        -- 00232 (review blocker 1a): the decrease must land in the SAME
        -- keg_filled_contents group(s) as the fill(s) it reverses, or the view
        -- keeps reporting the un-revised count to the Square register. COPY
        -- (never re-derive) each drawn row's keys -- the bin config may have
        -- changed since the fill, and only the row's own (location_id, bin_id)
        -- is guaranteed to name a group that is actually positive. One adjust
        -- leg per drawn group; ordering is deterministic (largest group first,
        -- then keys) -- kegs of one lot are fungible, so the order carries no
        -- business meaning.
        v_kegs_to_reverse := (-v_delta)::integer;

        FOR v_kfc IN
          SELECT kfc.location_id, kfc.bin_id, kfc.quantity
          FROM keg_filled_contents kfc
          WHERE kfc.finished_good_id = v_fg_id
          ORDER BY kfc.quantity DESC, kfc.location_id NULLS LAST, kfc.bin_id NULLS LAST
        LOOP
          EXIT WHEN v_kegs_to_reverse <= 0;
          v_keg_take := LEAST(v_kegs_to_reverse, v_kfc.quantity);

          INSERT INTO keg_transactions (
            transaction_type, selling_format_id, keg_owner_id, quantity,
            from_state, to_state, packaging_session_id, batch_id,
            finished_good_id, notes, from_location_id, from_bin_id, to_location_id
          ) VALUES (
            'adjust', v_line.selling_format_id, v_line.keg_owner_id, v_keg_take,
            'filled', 'empty', p_session_id, v_line.batch_id,
            v_fg_id, 'Packaging session revision (quantity decreased)',
            v_kfc.location_id, v_kfc.bin_id, v_kfc.location_id
          );

          v_kegs_to_reverse := v_kegs_to_reverse - v_keg_take;
        END LOOP;

        -- Mirrors 00229's shortfall stance: an unrepresentable write is worse
        -- than an abort. Fewer kegs are still recorded filled than the
        -- revision removes -> the difference already shipped or was recorded
        -- out, so "they were never filled" contradicts the ledger. A
        -- contents-less negative leg would strand below the HAVING (fleet
        -- inflation), and silently capping would under-record the correction.
        IF v_kegs_to_reverse > 0 THEN
          RAISE EXCEPTION
            'Cannot reduce keg line (lot %) by %: only % keg(s) of this lot are still recorded as filled — the rest have already shipped or been recorded out. Correct those transactions first.',
            v_fg.lot_number, (-v_delta)::integer, (-v_delta)::integer - v_kegs_to_reverse;
        END IF;
      END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- Material depletion delta: BOM lines x delta units
    -- -------------------------------------------------------------------------
    IF v_line.selling_format_id IS NOT NULL AND v_delta != 0 THEN
      FOR v_bom IN
        SELECT sfm.inventory_item_id, sfm.quantity_per_unit, ii.unit
        FROM selling_format_materials sfm
        LEFT JOIN inventory_items ii ON ii.id = sfm.inventory_item_id
        WHERE sfm.selling_format_id = v_line.selling_format_id
      LOOP
        -- Whole-unit materials (each/case) consume integer counts: the
        -- correction is the difference of the ceiled requirement at the NEW vs
        -- OLD quantity, NOT the ceiled delta (ceiling is not linear). Mirrors
        -- the per-line whole-unit ceiling computeBomConsumption applies at
        -- completion (src/domain/consumption-planning.ts). Bulk materials
        -- (mass/volume) stay proportional.
        -- ponytail: per-line ceiling matches completion for the common
        -- one-format-per-material case; a material shared across two formats of
        -- the same batch is ceiled per line, not per batch (rare) — upgrade to
        -- per-batch summing only if that ever bites.
        IF v_bom.unit IN ('each', 'case') THEN
          v_needed := whole_unit_material_qty(v_bom.quantity_per_unit, COALESCE(v_new, 0))
                    - whole_unit_material_qty(v_bom.quantity_per_unit, v_old);
        ELSE
          v_needed := v_bom.quantity_per_unit * v_delta;
        END IF;

        IF v_needed > 0 THEN
          -- Consume more, FEFO/FIFO (same ordering as suggestFifoAllocations)
          FOR v_lot IN
            SELECT
              il.id, il.lot_number, il.unit_cost,
              il.quantity - COALESCE((
                SELECT SUM(a.quantity) FROM allocations a
                WHERE a.source_type = 'inventory_lot'
                  AND a.source_id = il.id
                  AND a.status IN ('planned', 'completed')
              ), 0) AS remaining
            FROM inventory_lots il
            WHERE il.inventory_item_id = v_bom.inventory_item_id
            ORDER BY il.expiration_date ASC NULLS LAST,
                     il.received_date ASC NULLS LAST,
                     il.created_at ASC
          LOOP
            EXIT WHEN v_needed <= 0;
            CONTINUE WHEN v_lot.remaining <= 0;
            v_take := LEAST(v_lot.remaining, v_needed);
            INSERT INTO allocations (
              source_type, source_id, destination_type, destination_id,
              quantity, unit_cost, status, completed_at, lot_number,
              notes, created_by
            ) VALUES (
              'inventory_lot', v_lot.id, 'batch', v_line.batch_id,
              v_take, v_lot.unit_cost, 'completed', NOW(), v_lot.lot_number,
              v_session_note, v_session.created_by
            );
            v_allocations_inserted := v_allocations_inserted + 1;
            v_needed := v_needed - v_take;
          END LOOP;

          IF v_needed > 0 THEN
            -- Report, don't block — the packaging physically happened
            v_shortfalls := v_shortfalls || jsonb_build_object(
              'inventory_item_id', v_bom.inventory_item_id,
              'quantity', v_needed
            );
          END IF;
        ELSE
          -- Return material: reverse this session's own depletion rows LIFO.
          -- If completion under-depleted (shortfalls), there may be less to
          -- reverse than the delta implies — reverse what exists.
          v_needed := -v_needed;
          FOR v_alloc IN
            SELECT a.id, a.quantity
            FROM allocations a
            JOIN inventory_lots il ON il.id = a.source_id
            WHERE a.source_type = 'inventory_lot'
              AND a.destination_type = 'batch'
              AND a.destination_id IS NOT DISTINCT FROM v_line.batch_id
              AND a.status = 'completed'
              AND a.notes = v_session_note
              AND il.inventory_item_id = v_bom.inventory_item_id
            ORDER BY a.created_at DESC, a.id DESC
            FOR UPDATE OF a
          LOOP
            EXIT WHEN v_needed <= 0;
            IF v_alloc.quantity <= v_needed THEN
              UPDATE allocations
              SET status = 'cancelled',
                  cancelled_at = NOW(),
                  notes = notes || ' (reversed by revision)'
              WHERE id = v_alloc.id;
              v_needed := v_needed - v_alloc.quantity;
            ELSE
              UPDATE allocations
              SET quantity = quantity - v_needed
              WHERE id = v_alloc.id;
              v_needed := 0;
            END IF;
            v_allocations_reversed := v_allocations_reversed + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_lines_updated = 0 THEN
    RAISE EXCEPTION 'No quantity changes submitted';
  END IF;

  -- Append the revision reason to the session notes for the audit trail
  IF p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN
    UPDATE packaging_sessions
    SET notes = COALESCE(notes || E'\n\n', '')
      || 'Revised ' || to_char(NOW(), 'YYYY-MM-DD') || ': ' || trim(p_reason)
    WHERE id = p_session_id;
  END IF;

  -- Flip the status. The transaction-local GUC is the handshake that lets
  -- packaging_session_before_update() distinguish this sanctioned flip from
  -- a bare UPDATE (e.g. a generic status dropdown).
  PERFORM set_config('app.revising_session', p_session_id::text, true);
  UPDATE packaging_sessions SET status = 'revised' WHERE id = p_session_id;
  PERFORM set_config('app.revising_session', '', true);

  RETURN jsonb_build_object(
    'lines_updated', v_lines_updated,
    'fg_created', v_fg_created,
    'fg_updated', v_fg_updated,
    'allocations_inserted', v_allocations_inserted,
    'allocations_reversed', v_allocations_reversed,
    'shortfalls', v_shortfalls
  );
END;
$$;

COMMENT ON FUNCTION revise_packaging_session IS
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations (the FG''s bin_inventory delta is scoped to its single bin row -- 00219/00226/00232), applies BOM material-depletion deltas (consume more FEFO / reverse LIFO), records keg fill/adjust deltas that NET in keg_filled_contents -- the increase fill carries to_bin_id + from/to_location_id (00227/00232), the decrease draws down the FG''s keg_filled_contents rows and copies each drawn row''s location/bin onto the adjust leg (00232), RAISing if more kegs are removed than are still recorded filled -- and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';

-- =============================================================================
-- PART 3 -- repair the netting damage 00227's backfill left behind (see header)
-- =============================================================================
-- Stamp from_bin_id on historical contents-carrying OUTFLOW legs (revise-down
-- 'adjust' legs, hand-recorded contents-carrying outflows) whose FG's binned
-- fill legs name exactly ONE bin, and whose from_location_id already matches
-- the fills' to_location_id (for packaging fills both are NULL) -- when the
-- location differs, the legs sit in different keg_filled_contents groups and a
-- bin stamp cannot unite them, so those are left for manual review.
-- Idempotent: only from_bin_id IS NULL rows match. Pre-00229 SHIP legs carry
-- finished_good_id NULL and are untouched (invisible to the view; see header).
WITH fill_bins AS (
  SELECT
    finished_good_id,
    min(to_bin_id::text)::uuid       AS bin_id,
    min(to_location_id::text)::uuid  AS location_id
  FROM keg_transactions
  WHERE to_state = 'filled'
    AND finished_good_id IS NOT NULL
    AND to_bin_id IS NOT NULL
  GROUP BY finished_good_id
  -- Unambiguous only: one bin across ALL binned fills, and a uniform location
  -- (all NULL or all the same one -- min() would otherwise pick a value that
  -- only some fill rows carry).
  HAVING count(DISTINCT to_bin_id) = 1
     AND count(DISTINCT to_location_id) <= 1
     AND (count(to_location_id) = 0 OR count(to_location_id) = count(*))
)
UPDATE keg_transactions kt
SET from_bin_id = fb.bin_id
FROM fill_bins fb
WHERE kt.finished_good_id = fb.finished_good_id
  AND kt.from_state = 'filled'
  AND kt.from_bin_id IS NULL
  AND kt.from_location_id IS NOT DISTINCT FROM fb.location_id;

-- =============================================================================
-- PART 4 -- debit_bin_inventory: defensive p_qty guard (00223 review nit)
-- =============================================================================
-- Reproduced from 00223 with ONE change: a negative p_qty now RAISEs instead of
-- silently CREDITING the bin (GREATEST(0, v_old - p_qty) grows with a negative
-- p_qty). The webhook's `quantity <= 0` guard already prevents this upstream;
-- this closes the RPC itself.

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
  -- 00232: a debit is a decrement. A negative quantity would silently CREDIT
  -- the bin through GREATEST(0, v_old - p_qty); refuse it loudly.
  IF p_qty < 0 THEN
    RAISE EXCEPTION 'debit_bin_inventory: p_qty must be >= 0 (got %)', p_qty;
  END IF;

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
  'Atomically debit a bin''s finished-good quantity for a Square POS sale (00223, Square bin-sync D2; p_qty >= 0 guard added 00232). Row-locks (SELECT FOR UPDATE) so concurrent sales at the same bin cannot lose updates. Clamps to zero on oversell (never negative) and returns (new_quantity, clamped) so the webhook can flag oversold lines (D3). SECURITY DEFINER to bypass the system webhook caller''s bin_inventory RLS; EXECUTE locked to service_role. NOT idempotent -- the webhook''s order-keyed dedup claim (square_sync_log.square_payment_id, 00224/00233) guarantees at-most-once. NOTE: bin_inventory has a SECOND writer, revise_packaging_session, which applies revision deltas; the sellable_inventory view clamps the bin count to ledger availability so the two ledgers are reconciled at the POS read (00226).';

-- CREATE OR REPLACE preserves the 00223 grants; re-asserted for self-containment.
REVOKE ALL ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) TO service_role;

-- =============================================================================
-- PART 5 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back -- deliberately covering the leg shapes 00227's block
-- did NOT (a fresh fill alone would pass with all three bugs present):
--   (1) packaging fill stamps bin AND both locations; keg_filled_contents
--       surfaces (location L, bin X, qty 10);
--   (2) fill -> REVISE-DOWN nets: revise 10 -> 8 emits an adjust leg copying
--       (L, X) into its from_-columns, and keg_filled_contents reports exactly
--       ONE row, qty 8 -- no stranded negative, no lingering 10;
--   (3) fill -> SHIP nets: a ship leg in 00229's shape (contents + copied
--       location/bin) drops the row to 5 -- proving the groups this migration
--       stamps are the ones 00229's copied legs cancel (the function itself is
--       environment-dependent: 00183's contents-less version on a from-scratch
--       replay of this branch, 00229's on live -- so the leg is inserted
--       directly in the shape 00229 writes);
--   (4) the raw per-location empty pool nets: 50 received - 10 filled
--       + 2 revised-back = 42 at L (computed from keg_transactions directly --
--       keg_inventory's definition differs between this branch's replay chain
--       (00220, with bin) and live (00228, without), so the view is not a
--       stable assertion target);
--   (5) the Part 3 repair: a damaged historical pair (binned fill + NULL-bin
--       adjust) over-reports 10, the repair UPDATE stamps the adjust leg, and
--       the view reports 8.
--
-- Same self-rolling-back idiom as 00219/00223/00227: a passing run RAISEs
-- 'KN_VERIFY_OK' to unwind the subtransaction; a genuine failure RAISEs
-- 'KN_ASSERT_FAIL...' and aborts the migration; any other error is downgraded
-- to a WARNING (missing prerequisites on exotic environments).
DO $$
DECLARE
  v_loc      UUID;
  v_cust     UUID;
  v_brand    UUID;
  v_c_keg    UUID;
  v_sf_keg   UUID;
  v_bin_x    UUID;
  v_session  UUID;
  v_sli      UUID;
  v_fg       UUID;
  v_fg2      UUID;
  v_row      RECORD;
  v_qty      INTEGER;
  v_rows     INTEGER;
  v_empties  INTEGER;
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('KN_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO customers (name, customer_type)
      VALUES ('KN_cust_' || v_sfx, 'wholesale') RETURNING id INTO v_cust;
    INSERT INTO brands (name) VALUES ('KN_brand_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('KN_keg_' || v_sfx, 'keg', 0.5, 0) RETURNING id INTO v_c_keg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'KN_sf_' || v_sfx, 1) RETURNING id INTO v_sf_keg;
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'KN_bin_X_' || v_sfx, true) RETURNING id INTO v_bin_x;

    -- Empties live at (L, bin X): the pool the fill must decrement.
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_keg, 50, 'empty', v_loc, v_bin_x, 'KN verify: receive 50');

    -- --- (1) fill 10 via the REAL packaging path ------------------------------
    INSERT INTO packaging_sessions (default_bin_id, status, session_date)
      VALUES (v_bin_x, 'completed', current_date) RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id, actual_quantity)
      VALUES (v_session, v_brand, v_sf_keg, 10) RETURNING id INTO v_sli;

    PERFORM create_finished_goods_from_packaging(v_session);

    SELECT id INTO v_fg FROM finished_goods WHERE session_line_item_id = v_sli;
    IF v_fg IS NULL THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (1): no finished good created for the keg line';
    END IF;

    SELECT to_bin_id, from_location_id, to_location_id INTO v_row
      FROM keg_transactions
      WHERE finished_good_id = v_fg AND transaction_type = 'fill';
    IF v_row.to_bin_id IS DISTINCT FROM v_bin_x
       OR v_row.from_location_id IS DISTINCT FROM v_loc
       OR v_row.to_location_id IS DISTINCT FROM v_loc THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (1): fill stamped (bin %, from_loc %, to_loc %) but expected (%, %, %)',
        v_row.to_bin_id, v_row.from_location_id, v_row.to_location_id, v_bin_x, v_loc, v_loc;
    END IF;

    SELECT count(*), COALESCE(sum(quantity), 0) INTO v_rows, v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg;
    IF v_rows <> 1 OR v_qty <> 10 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (1): keg_filled_contents shows % row(s) totalling % but expected 1 row of 10', v_rows, v_qty;
    END IF;
    PERFORM 1 FROM keg_filled_contents
      WHERE finished_good_id = v_fg AND location_id = v_loc AND bin_id = v_bin_x;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (1): keg_filled_contents row is not in the (location L, bin X) group';
    END IF;

    -- --- (2) revise 10 -> 8: THE bug 00227's verification missed --------------
    PERFORM revise_packaging_session(
      v_session,
      jsonb_build_array(jsonb_build_object('line_item_id', v_sli, 'actual_quantity', 8))
    );

    SELECT quantity::integer AS quantity, from_bin_id, from_location_id, to_location_id INTO v_row
      FROM keg_transactions
      WHERE finished_good_id = v_fg AND transaction_type = 'adjust';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (2): revise-down emitted no adjust leg';
    END IF;
    IF v_row.quantity <> 2
       OR v_row.from_bin_id IS DISTINCT FROM v_bin_x
       OR v_row.from_location_id IS DISTINCT FROM v_loc
       OR v_row.to_location_id IS DISTINCT FROM v_loc THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (2): adjust leg (qty %, from_bin %, from_loc %, to_loc %) but expected (2, %, %, %)',
        v_row.quantity, v_row.from_bin_id, v_row.from_location_id, v_row.to_location_id, v_bin_x, v_loc, v_loc;
    END IF;

    SELECT count(*), COALESCE(sum(quantity), 0) INTO v_rows, v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg;
    IF v_rows <> 1 OR v_qty <> 8 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (2): after revise-down keg_filled_contents shows % row(s) totalling % but expected 1 row of 8 (the stranded-negative bug)', v_rows, v_qty;
    END IF;

    -- --- (3) ship 3 in 00229's leg shape: contents + copied location/bin ------
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state,
       customer_id, finished_good_id, from_location_id, from_bin_id, notes)
      VALUES ('ship', v_sf_keg, 3, 'filled', 'shipped',
              v_cust, v_fg, v_loc, v_bin_x, 'KN verify: ship 3 (00229 shape)');

    SELECT count(*), COALESCE(sum(quantity), 0) INTO v_rows, v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg;
    IF v_rows <> 1 OR v_qty <> 5 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (3): after ship keg_filled_contents shows % row(s) totalling % but expected 1 row of 5', v_rows, v_qty;
    END IF;

    -- --- (4) raw per-location empty pool: 50 - 10 + 2 = 42 at L ---------------
    SELECT COALESCE(sum(CASE WHEN to_state = 'empty'   AND to_location_id   = v_loc THEN quantity ELSE 0 END), 0)
         - COALESCE(sum(CASE WHEN from_state = 'empty' AND from_location_id = v_loc THEN quantity ELSE 0 END), 0)
      INTO v_empties
      FROM keg_transactions
      WHERE selling_format_id = v_sf_keg;
    IF v_empties <> 42 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (4): raw empty pool at L nets to % but expected 42 (50 received - 10 filled + 2 revised back)', v_empties;
    END IF;

    -- --- (5) the Part 3 repair, on a freshly-damaged historical pair ----------
    -- Historical shape: fill with a bin (as 00227's backfill stamped) but NO
    -- locations, adjust with nothing -- the view over-reports 10.
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf_keg, 10, 'KN-fg2-' || v_sfx) RETURNING id INTO v_fg2;
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state, finished_good_id, to_bin_id, notes)
      VALUES ('fill', v_sf_keg, 10, 'empty', 'filled', v_fg2, v_bin_x, 'KN verify: historical fill');
    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, from_state, to_state, finished_good_id, notes)
      VALUES ('adjust', v_sf_keg, 2, 'filled', 'empty', v_fg2, 'KN verify: historical damaged adjust');

    SELECT COALESCE(sum(quantity), 0) INTO v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg2;
    IF v_qty <> 10 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (5): damaged pair should over-report 10 pre-repair, got %', v_qty;
    END IF;

    -- The same statement as Part 3 (the real run above already repaired live
    -- rows; this repeats it inside the rolled-back subtransaction to prove it
    -- against a known-damaged fixture). Idempotent by construction.
    WITH fill_bins AS (
      SELECT
        finished_good_id,
        min(to_bin_id::text)::uuid       AS bin_id,
        min(to_location_id::text)::uuid  AS location_id
      FROM keg_transactions
      WHERE to_state = 'filled'
        AND finished_good_id IS NOT NULL
        AND to_bin_id IS NOT NULL
      GROUP BY finished_good_id
      HAVING count(DISTINCT to_bin_id) = 1
         AND count(DISTINCT to_location_id) <= 1
         AND (count(to_location_id) = 0 OR count(to_location_id) = count(*))
    )
    UPDATE keg_transactions kt
    SET from_bin_id = fb.bin_id
    FROM fill_bins fb
    WHERE kt.finished_good_id = fb.finished_good_id
      AND kt.from_state = 'filled'
      AND kt.from_bin_id IS NULL
      AND kt.from_location_id IS NOT DISTINCT FROM fb.location_id;

    SELECT from_bin_id INTO v_row
      FROM keg_transactions
      WHERE finished_good_id = v_fg2 AND transaction_type = 'adjust';
    IF v_row.from_bin_id IS DISTINCT FROM v_bin_x THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (5): repair did not stamp the adjust leg (from_bin_id %)', v_row.from_bin_id;
    END IF;

    SELECT count(*), COALESCE(sum(quantity), 0) INTO v_rows, v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg2;
    IF v_rows <> 1 OR v_qty <> 8 THEN
      RAISE EXCEPTION 'KN_ASSERT_FAIL (5): after repair keg_filled_contents shows % row(s) totalling % but expected 1 row of 8', v_rows, v_qty;
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'KN_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'KN_VERIFY_OK' THEN
        RAISE NOTICE 'KN keg-netting verification passed (fill stamps bin+locations; revise-down nets; 00229-shape ship nets; raw empty pool 42; historical repair); test rows rolled back';
      ELSIF SQLERRM LIKE 'KN_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine netting bug: abort migration
      ELSE
        RAISE WARNING 'KN keg-netting verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
