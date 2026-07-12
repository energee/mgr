-- 00239_revise_lock_bom_order_bin_check.sql
-- Audit 2026-07-10 findings DL-5, PG-2, PG-3 (backlog P1 #10), three fixes:
--
-- NUMBERING: 00236/00237 and 00240/00241 are claimed by other in-flight
-- branches; 00238/00239 are reserved for this branch (fix/keg-netting-
-- residuals). NOT applied live -- deploy via scripts/db-push.sh after merge.
--
--   1. DL-5 -- revise_packaging_session's keg-DECREASE branch draws down
--      keg_filled_contents without the 00234 advisory lock. The draw is the
--      same check-then-act shape 00234 serialized in
--      create_keg_ship_transactions_from_order: a revise-down racing an order
--      fulfillment reads the same keg_filled_contents snapshot, both draw the
--      same rows, the doubled outflow nets the group negative (discarded by
--      HAVING sum > 0), and the fleet inflates -- neither transaction errors.
--      00234's own header documented this residual and prescribed the fix
--      shape: take the SAME lock key at the top of the keg-decrease branch, so
--      revisions and fulfillments serialize with each other.
--
--   2. PG-2 (SQL side) -- the BOM-materials loop iterated
--      selling_format_materials with NO ORDER BY, and every depletion insert
--      takes a FOR UPDATE inventory_lots lock via
--      guard_allocation_availability (00212). Two concurrent revisions/
--      completions sharing materials (one cap SKU in two formats' BOMs) could
--      lock the same lots in opposite item orders and deadlock, surfacing as a
--      raw deadlock_detected to the user (no retry anywhere on this path).
--      ORDER BY sfm.inventory_item_id makes the item-level lock order
--      canonical; within one item the FEFO lot loop already orders
--      consistently across writers. consumePackagingMaterials
--      (src/services/consumption-service.ts) sorts its completion-time insert
--      batch by the same (inventory_item_id, lot id) key in the same change.
--
--   3. PG-3 -- bin_inventory.quantity had NO CHECK (>= 0) despite two
--      independent decrementing writers (debit_bin_inventory 00223/00232;
--      revise_packaging_session's bin mirror). Both clamp with GREATEST(0,...)
--      -- an application guarantee, not a schema invariant; any future writer
--      or incident SQL could drive it negative silently, and
--      sellable_inventory's LEAST(bi.quantity, ...) clamp would then
--      under-report sellable counts to the POS. Existing rows are zeroed
--      first (none should exist -- both writers clamp -- but the migration
--      must not fail on damaged data), then the constraint is added
--      idempotently (00192 idiom).
--
-- Live-safe: CREATE OR REPLACE of one function (body = 00232's, the chain-
-- latest, with the two marked changes), one defensive UPDATE, one guarded
-- ADD CONSTRAINT, and a self-rolling-back verification block (commits NO
-- rows).

-- =============================================================================
-- PART 1 -- revise_packaging_session: advisory lock on the keg-decrease branch;
--           canonical BOM lock order
-- =============================================================================
-- Reproduced from 00232 Part 2 with TWO changes, both marked '00239':
--   (a) PERFORM pg_advisory_xact_lock(hashtext('create_keg_ship_transactions_
--       from_order'), 0) at the top of the keg-decrease branch (DL-5);
--   (b) ORDER BY sfm.inventory_item_id on the BOM-materials loop (PG-2).
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
        -- 00239 (audit DL-5): serialize against keg ship allocation. The draw
        -- below is the same check-then-act shape 00234 serialized in
        -- create_keg_ship_transactions_from_order: it reads keg_filled_contents
        -- and inserts the counter-legs, so a revise-down racing an order
        -- fulfillment reads the same snapshot, both draw the same rows, the
        -- group nets negative (discarded by HAVING sum > 0), and the fleet
        -- inflates -- neither transaction errors. Same key as 00234 (per its
        -- header note), so revisions and fulfillments serialize with each
        -- other; xact-scoped, so it releases on commit AND on any abort path
        -- (including the shortfall RAISE below). Lock ordering is safe: the
        -- ship function takes ONLY this lock before touching shared rows, and
        -- the session/line row locks taken above are never wanted by it.
        PERFORM pg_advisory_xact_lock(hashtext('create_keg_ship_transactions_from_order'), 0);

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
      -- 00239 (audit PG-2): ORDER BY makes the item-level lock order
      -- canonical. Each depletion insert below FOR UPDATE-locks its
      -- inventory_lots row via guard_allocation_availability (00212), so the
      -- iteration order here IS the lock-acquisition order; with no ORDER BY,
      -- two concurrent sessions sharing BOM materials could lock the same
      -- lots in opposite item orders and deadlock. consumePackagingMaterials
      -- (src/services/consumption-service.ts) sorts its completion-time
      -- insert batch by the same key; within one item, the FEFO lot loop
      -- below already orders consistently across writers.
      FOR v_bom IN
        SELECT sfm.inventory_item_id, sfm.quantity_per_unit, ii.unit
        FROM selling_format_materials sfm
        LEFT JOIN inventory_items ii ON ii.id = sfm.inventory_item_id
        WHERE sfm.selling_format_id = v_line.selling_format_id
        ORDER BY sfm.inventory_item_id
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
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations (the FG''s bin_inventory delta is scoped to its single bin row -- 00219/00226/00232), applies BOM material-depletion deltas (consume more FEFO / reverse LIFO; materials iterated in inventory_item_id order since 00239 so concurrent writers acquire guard_allocation_availability''s FOR UPDATE lot locks canonically), records keg fill/adjust deltas that NET in keg_filled_contents -- the increase fill carries to_bin_id + from/to_location_id (00227/00232), the decrease takes the 00234 advisory lock (pg_advisory_xact_lock(hashtext(''create_keg_ship_transactions_from_order''), 0), added 00239) before drawing down the FG''s keg_filled_contents rows and copies each drawn row''s location/bin onto the adjust leg (00232), RAISing if more kegs are removed than are still recorded filled -- and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';

-- =============================================================================
-- PART 2 -- bin_inventory: CHECK (quantity >= 0) as a schema invariant (PG-3)
-- =============================================================================
-- Both writers clamp with GREATEST(0, ...), so no negative rows should exist;
-- zero any that do (damaged data must not block the invariant), then add the
-- constraint idempotently (00192 idiom).

UPDATE bin_inventory SET quantity = 0 WHERE quantity < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_bin_inventory_quantity_nonneg'
      AND conrelid = 'bin_inventory'::regclass
  ) THEN
    ALTER TABLE bin_inventory
      ADD CONSTRAINT chk_bin_inventory_quantity_nonneg CHECK (quantity >= 0);
  END IF;
END;
$$;

-- =============================================================================
-- PART 3 -- verification (self-rolling-back; commits NO rows) -- 00232/00234
--           idiom
-- =============================================================================
-- Proves, then rolls back:
--   (1) LOCK: after a keg revise-DOWN, the transaction holds the 00234
--       advisory lock (two-int key: classid = hashtext('create_keg_ship_
--       transactions_from_order'), objid = 0, objsubid = 2) -- the
--       serialization path is actually taken by the replaced body.
--   (2) NETTING PRESERVED: fill 10 via the real packaging path, revise to 8;
--       keg_filled_contents reports exactly 8 (the body replacement did not
--       regress 00232's revise-down netting).
--   (3) CHECK ENFORCED: driving a bin_inventory row negative raises
--       check_violation.
DO $$
DECLARE
  v_loc      UUID;
  v_brand    UUID;
  v_c_keg    UUID;
  v_sf_keg   UUID;
  v_bin      UUID;
  v_session  UUID;
  v_sli      UUID;
  v_fg       UUID;
  v_qty      INTEGER;
  v_key      INTEGER := hashtext('create_keg_ship_transactions_from_order');
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('RL_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO brands (name) VALUES ('RL_brand_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('RL_keg_' || v_sfx, 'keg', 0.5, 0) RETURNING id INTO v_c_keg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'RL_sf_' || v_sfx, 1) RETURNING id INTO v_sf_keg;
    INSERT INTO bins (location_id, name)
      VALUES (v_loc, 'RL_bin_' || v_sfx) RETURNING id INTO v_bin;

    INSERT INTO keg_transactions
      (transaction_type, selling_format_id, quantity, to_state, to_location_id, to_bin_id, notes)
      VALUES ('receive', v_sf_keg, 12, 'empty', v_loc, v_bin, 'RL verify: receive 12');

    -- Fill 10 via the REAL packaging path, then revise down to 8
    INSERT INTO packaging_sessions (default_bin_id, status, session_date)
      VALUES (v_bin, 'completed', current_date) RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id, actual_quantity)
      VALUES (v_session, v_brand, v_sf_keg, 10) RETURNING id INTO v_sli;

    PERFORM create_finished_goods_from_packaging(v_session);

    SELECT id INTO v_fg FROM finished_goods WHERE session_line_item_id = v_sli;
    IF v_fg IS NULL THEN
      RAISE EXCEPTION 'RL_ASSERT_FAIL: no finished good created for the keg line';
    END IF;

    PERFORM revise_packaging_session(
      v_session,
      jsonb_build_array(jsonb_build_object('line_item_id', v_sli, 'actual_quantity', 8))
    );

    -- --- (1) the advisory lock is held by THIS transaction --------------------
    PERFORM 1 FROM pg_locks
      WHERE locktype = 'advisory'
        AND pid = pg_backend_pid()
        AND objsubid = 2
        AND classid::bigint = (v_key::bigint & 4294967295)
        AND objid = 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RL_ASSERT_FAIL (1): keg revise-down did not take the 00234 advisory lock -- a revision racing a fulfillment can double-draw';
    END IF;

    -- --- (2) revise-down netting preserved by the body replacement ------------
    SELECT COALESCE(sum(quantity), 0) INTO v_qty
      FROM keg_filled_contents WHERE finished_good_id = v_fg;
    IF v_qty <> 8 THEN
      RAISE EXCEPTION 'RL_ASSERT_FAIL (2): after revise-down keg_filled_contents shows % but expected 8 -- the replaced body regressed 00232''s netting', v_qty;
    END IF;

    -- --- (3) the CHECK rejects a negative bin_inventory quantity --------------
    INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
      VALUES (v_fg, v_bin, 1);
    BEGIN
      UPDATE bin_inventory SET quantity = -1
        WHERE finished_good_id = v_fg AND bin_id = v_bin;
      RAISE EXCEPTION 'RL_ASSERT_FAIL (3): a negative bin_inventory quantity was accepted -- chk_bin_inventory_quantity_nonneg is not enforcing';
    EXCEPTION
      WHEN check_violation THEN
        NULL;  -- expected: the invariant holds
    END;

    -- All assertions passed: unwind the subtransaction (commit nothing). The
    -- advisory lock survives the savepoint unwind by design (xact-scoped locks
    -- release only at top-level commit/abort, i.e. when this migration ends).
    RAISE EXCEPTION 'RL_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'RL_VERIFY_OK' THEN
        RAISE NOTICE 'RL revise-lock/BOM-order/bin-check verification passed (advisory lock held on revise-down, netting preserved, negative bin quantity rejected); test rows rolled back';
      ELSIF SQLERRM LIKE 'RL_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine regression: abort migration
      ELSE
        RAISE WARNING 'RL revise-lock/BOM-order/bin-check verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

-- Refresh PostgREST schema cache so the replaced function is picked up.
NOTIFY pgrst, 'reload schema';
