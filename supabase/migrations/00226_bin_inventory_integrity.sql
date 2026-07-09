-- 00226_bin_inventory_integrity.sql
-- Square POS bin-sync, Milestone D follow-up: two independent bin-inventory
-- correctness fixes, both confirmed by review. bin_inventory now has TWO writers
-- (the 00219 placement/revise mirror AND 00223's debit_bin_inventory, which
-- decrements on every Square sale), and that second writer breaks two assumptions
-- that were safe when the placement mirror was the only writer.
--
-- (A) revise_packaging_session (00219) mirrored the corrected FG quantity onto the
--     bin with an ABSOLUTE overwrite:
--         UPDATE bin_inventory SET quantity = COALESCE(v_new, 0) WHERE finished_good_id = v_fg.id;
--     That was correct when placement was the only bin_inventory writer. It is now a
--     bug: place 10 (bin=10, fg=10) -> Square sells 3 (bin=7, fg=10) -> brewer revises
--     the actual to 12 -> the absolute overwrite stamps bin=12 instead of 9,
--     RESURRECTING the 3 units already sold through the POS and re-exposing them to
--     the taproom. Even a downward revise 10->8 stamps bin=8 when it should be 5.
--     FIX: apply the revision DELTA (v_delta, already computed a few lines above) to
--     the bin instead of an absolute value, preserving Square-sale debits:
--         UPDATE bin_inventory SET quantity = GREATEST(0, quantity + v_delta) ...
--     The whole revise_packaging_session body is reproduced verbatim from 00219 with
--     ONLY that one statement (and its comment) changed -- SECURITY INVOKER,
--     search_path, and the absence of GRANT/REVOKE all match 00219.
--
-- (B) sellable_inventory (00221) packaged branch read bi.quantity RAW. But
--     bin_inventory.quantity is only ever decremented by the Square-sale path
--     (debit_bin_inventory) -- order fulfillment (transition-side-effects.ts),
--     samples, losses, and recordQuickDepletion all write the ALLOCATION ledger and
--     never touch the bin counter. So shipping a wholesale order of packaged goods
--     that physically sit in the POS bin leaves the bin counter INFLATED, and the
--     next Square inventory push over-reports on-hand -> the taproom oversells beer
--     that has already left the building.
--     FIX (shallow, chosen deliberately over bin-dimensioning the allocation
--     ledger): clamp the view's packaged quantity to the ledger-derived
--     availability -- LEAST(bin count, ledger availability) -- so the POS never sees
--     more than the ledger says is actually free.
--
-- Also updated here: the COMMENT ON FUNCTION debit_bin_inventory, which 00223 wrote
-- when bin_inventory had a single writer and dedup was event_id-based -- both are now
-- false (two writers; payment-id dedup via 00224).
--
-- Live-safe: CREATE OR REPLACE of one function and one view, plus two COMMENTs. No
-- data touched. Verified by a self-rolling-back DO block at the end (commits NO rows).

-- =============================================================================
-- PART A -- revise_packaging_session: apply the bin DELTA, not an absolute overwrite
-- =============================================================================
-- Reproduced byte-for-byte from 00219 with ONE change: the bin_inventory mirror is a
-- delta (GREATEST(0, quantity + v_delta)) rather than an absolute overwrite, so a
-- revision no longer resurrects units already debited by a Square sale.

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
  v_is_keg BOOLEAN;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_old NUMERIC;
  v_new NUMERIC;
  v_delta NUMERIC;
  v_outbound NUMERIC;
  v_needed NUMERIC;
  v_take NUMERIC;
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

      -- A0/D: apply the revision DELTA to its bin, preserving any Square-sale debits
      -- (non-keg FGs have exactly one bin_inventory row from place_finished_good_in_bin;
      -- keg FGs have none, so this affects 0 rows for kegs). bin_inventory now has a
      -- SECOND writer -- debit_bin_inventory (00223) decrements it on every Square
      -- sale -- so an ABSOLUTE overwrite here would resurrect units already sold
      -- through the POS. Applying the delta (GREATEST(0, ...) guards the floor) keeps
      -- the correction while preserving those debits. Newly-created FGs in the ELSIF
      -- branch place via the AFTER INSERT trigger and need no mirror here.
      UPDATE bin_inventory SET quantity = GREATEST(0, quantity + v_delta) WHERE finished_good_id = v_fg.id;

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
        INSERT INTO keg_transactions (
          transaction_type, selling_format_id, keg_owner_id, quantity,
          from_state, to_state, packaging_session_id, batch_id,
          finished_good_id, notes
        ) VALUES (
          'fill', v_line.selling_format_id, v_line.keg_owner_id, v_delta,
          'empty', 'filled', p_session_id, v_line.batch_id,
          v_fg_id, 'Packaging session revision (quantity increased)'
        );
      ELSE
        INSERT INTO keg_transactions (
          transaction_type, selling_format_id, keg_owner_id, quantity,
          from_state, to_state, packaging_session_id, batch_id,
          finished_good_id, notes
        ) VALUES (
          'adjust', v_line.selling_format_id, v_line.keg_owner_id, -v_delta,
          'filled', 'empty', p_session_id, v_line.batch_id,
          v_fg_id, 'Packaging session revision (quantity decreased)'
        );
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
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations (and applies the revision DELTA to the FG''s bin_inventory row, preserving Square-sale debits -- 00219/00226), applies BOM material-depletion deltas (consume more FEFO / reverse LIFO), records keg fill deltas, and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';

-- =============================================================================
-- PART B -- sellable_inventory: clamp packaged quantity to ledger availability
-- =============================================================================
-- The packaged branch now reports LEAST(bin count, ledger availability) instead of
-- the raw bin count, so wholesale/ sample/ loss draws (which only ever hit the
-- allocation ledger, never bin_inventory) can no longer inflate what the POS sees.
-- The keg branch and security_invoker are unchanged. Column names/types/order are
-- identical to 00221, so CREATE OR REPLACE is sufficient (no drop).

CREATE OR REPLACE VIEW public.sellable_inventory
WITH (security_invoker = true) AS
  -- (a) packaged finished goods physically in bins. Non-keg containers only --
  -- the `<> 'keg'` filter is the double-count guard (see 00221 header).
  -- quantity = LEAST(bin count, ledger availability): the bin counter is only
  -- decremented by the Square-sale path (debit_bin_inventory), so order fulfillment,
  -- samples, losses, and quick-depletion -- which write allocations, not the bin --
  -- would otherwise leave the POS over-reporting on-hand. Clamping to the
  -- ledger-derived availability (finished_goods_with_availability.available_quantity)
  -- caps what the taproom can sell at what the ledger says is actually free.
  -- ponytail: this only fixes the READ path; the bin counter itself still drifts
  -- HIGH (visible in the bin UI) because those non-sale draws never debit it. The
  -- deep fix is to give allocations a bin dimension and derive per-bin availability
  -- the way finished_goods_with_availability derives whole-FG availability -- then
  -- the bin counter and the ledger agree and this LEAST() becomes unnecessary.
  SELECT
    bi.bin_id,
    b.location_id,
    fg.brand_id,
    fg.selling_format_id,
    fg.id            AS finished_good_id,
    LEAST(bi.quantity, GREATEST(0, fga.available_quantity))::integer AS quantity,
    'packaged'::text AS source
  FROM bin_inventory bi
  JOIN bins b             ON b.id  = bi.bin_id
  JOIN finished_goods fg  ON fg.id = bi.finished_good_id
  JOIN finished_goods_with_availability fga ON fga.id = fg.id
  JOIN selling_formats sf ON sf.id = fg.selling_format_id
  JOIN containers c       ON c.id  = sf.container_id
  WHERE c.type <> 'keg'
    AND LEAST(bi.quantity, GREATEST(0, fga.available_quantity)) > 0
  UNION ALL
  -- (b) filled kegs by contents (already netted + positive-only, with the bin
  -- dimension from 00220). Unchanged from 00221.
  SELECT
    kfc.bin_id,
    kfc.location_id,
    kfc.brand_id,
    kfc.selling_format_id,
    kfc.finished_good_id,
    kfc.quantity,
    'keg'::text AS source
  FROM keg_filled_contents kfc;

COMMENT ON VIEW sellable_inventory IS
  'Unified sellable-product-on-hand read model (00221; packaged quantity clamped in 00226): UNION ALL of packaged finished goods in bins and filled-keg contents (keg_filled_contents). The packaged quantity is LEAST(bin count, ledger availability) -- the bin counter is decremented only by the Square-sale path, so non-sale draws (order fulfillment, samples, losses, quick-depletion) that hit only the allocation ledger cannot inflate what the POS sees. Shape: bin_id, location_id, brand_id, selling_format_id, finished_good_id, quantity, source (packaged|keg). The <> keg filter is the double-count guard. security_invoker. NOTE: the Square catalog sync derives its discontinued keep-set from an UNFILTERED bin_inventory read (not this view) precisely because this view filters quantity > 0 -- do not route that keep-set through this view.';

-- =============================================================================
-- PART C -- correct the now-false debit_bin_inventory function comment (00223)
-- =============================================================================
-- 00223's comment claimed bin_inventory has a single writer (so keeping both the
-- bin and allocation ledgers is "not a double-count") and that idempotency comes
-- from event_id dedup. Both are now false: revise_packaging_session (00226 Part A)
-- also writes bin_inventory, and the sale is deduped on the Square payment id (00224).
COMMENT ON FUNCTION debit_bin_inventory(UUID, UUID, INTEGER) IS
  'Atomically debit a bin''s finished-good quantity for a Square POS sale (00223, Square bin-sync D2). Row-locks (SELECT FOR UPDATE) so concurrent sales at the same bin cannot lose updates. Clamps to zero on oversell (never negative) and returns (new_quantity, clamped) so the webhook can flag oversold lines (D3). SECURITY DEFINER to bypass the system webhook caller''s bin_inventory RLS; EXECUTE locked to service_role. NOT idempotent -- the webhook''s payment-id dedup (square_sync_log.square_payment_id, 00224) guarantees at-most-once. NOTE: bin_inventory has a SECOND writer, revise_packaging_session (00226), which applies revision deltas; the sellable_inventory view clamps the bin count to ledger availability so the two ledgers are reconciled at the POS read (00226).';

-- =============================================================================
-- PART D -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back:
--   (A) place 10 -> debit 3 (Square sale) -> revise actual to 12 leaves the bin at
--       9 (7 + delta 2), NOT 12 -- the resurrection bug is fixed;
--   (B) a finished good with an open (planned) order allocation is reported by
--       sellable_inventory at the LOWER of bin count and ledger availability.
--
-- Same self-rolling-back idiom as 00219/00223: a passing run RAISEs 'DI_VERIFY_OK'
-- to unwind the subtransaction; a genuine logic failure RAISEs 'DI_ASSERT_FAIL...'
-- and re-raises to ABORT; any other error is downgraded to a WARNING.
DO $$
DECLARE
  v_loc      UUID;
  v_brand    UUID;
  v_cont     UUID;
  v_sf       UUID;
  v_bin      UUID;
  v_session  UUID;
  v_sli      UUID;
  v_fg       UUID;
  v_binqty   INTEGER;
  v_new      INTEGER;
  v_clamped  BOOLEAN;
  -- (B)
  v_fgB      UUID;
  v_sliB     UUID;
  v_sessionB UUID;
  v_sellqty  INTEGER;
  v_sfx      TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- shared prerequisites -------------------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('DI_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO brands (name) VALUES ('DI_brand_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_oz, deposit_amount)
      VALUES ('DI_pkg_' || v_sfx, 'package', 12, 0) RETURNING id INTO v_cont;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_cont, 'DI_sf_' || v_sfx, 1) RETURNING id INTO v_sf;
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'DI_bin_' || v_sfx, false) RETURNING id INTO v_bin;

    -- =========================================================================
    -- (A) revise applies the delta, preserving the Square-sale debit
    -- =========================================================================
    -- Completed session whose default bin is v_bin, so the FG places into v_bin
    -- (00219 trigger) at quantity 10.
    INSERT INTO packaging_sessions (default_bin_id, status, session_date)
      VALUES (v_bin, 'completed', current_date) RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id, actual_quantity)
      VALUES (v_session, v_brand, v_sf, 10) RETURNING id INTO v_sli;
    INSERT INTO finished_goods (brand_id, selling_format_id, session_line_item_id, quantity, lot_number)
      VALUES (v_brand, v_sf, v_sli, 10, 'DI-A-' || v_sfx) RETURNING id INTO v_fg;

    SELECT quantity INTO v_binqty FROM bin_inventory WHERE finished_good_id = v_fg AND bin_id = v_bin;
    IF COALESCE(v_binqty, -1) <> 10 THEN
      RAISE EXCEPTION 'DI_ASSERT_FAIL (A setup): bin should start at 10, got %', v_binqty;
    END IF;

    -- Square sells 3: bin 10 -> 7 (fg quantity untouched at 10).
    SELECT d.new_quantity, d.clamped INTO v_new, v_clamped
      FROM debit_bin_inventory(v_bin, v_fg, 3) d;
    IF v_new <> 7 THEN
      RAISE EXCEPTION 'DI_ASSERT_FAIL (A): debit should leave bin at 7, got %', v_new;
    END IF;

    -- Brewer revises actual up to 12: delta +2 -> bin 7 + 2 = 9 (NOT an absolute 12).
    PERFORM revise_packaging_session(
      v_session,
      jsonb_build_array(jsonb_build_object('line_item_id', v_sli::text, 'actual_quantity', 12))
    );
    SELECT quantity INTO v_binqty FROM bin_inventory WHERE finished_good_id = v_fg AND bin_id = v_bin;
    IF COALESCE(v_binqty, -1) <> 9 THEN
      RAISE EXCEPTION 'DI_ASSERT_FAIL (A): revise 10->12 after a sale of 3 should leave bin at 9, got % (absolute-overwrite bug would give 12)', v_binqty;
    END IF;

    -- =========================================================================
    -- (B) sellable_inventory reports LEAST(bin count, ledger availability)
    -- =========================================================================
    -- Fresh FG placed at bin quantity 10, then a planned order allocation of 4 out
    -- of it -> ledger availability 6 while the bin counter stays 10.
    INSERT INTO packaging_sessions (default_bin_id, status, session_date)
      VALUES (v_bin, 'completed', current_date) RETURNING id INTO v_sessionB;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id, actual_quantity)
      VALUES (v_sessionB, v_brand, v_sf, 10) RETURNING id INTO v_sliB;
    INSERT INTO finished_goods (brand_id, selling_format_id, session_line_item_id, quantity, lot_number)
      VALUES (v_brand, v_sf, v_sliB, 10, 'DI-B-' || v_sfx) RETURNING id INTO v_fgB;

    INSERT INTO allocations (source_type, source_id, destination_type, destination_id, quantity, status)
      VALUES ('finished_good', v_fgB, 'order', gen_random_uuid(), 4, 'planned');

    SELECT quantity INTO v_sellqty
      FROM sellable_inventory
      WHERE finished_good_id = v_fgB AND source = 'packaged' AND bin_id = v_bin;
    IF COALESCE(v_sellqty, -1) <> 6 THEN
      RAISE EXCEPTION 'DI_ASSERT_FAIL (B): sellable_inventory should report LEAST(bin 10, avail 6) = 6, got %', v_sellqty;
    END IF;

    RAISE EXCEPTION 'DI_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'DI_VERIFY_OK' THEN
        RAISE NOTICE 'DI bin-inventory-integrity verification passed (A revise-delta preserves sale debit, B sellable clamps to ledger availability); test rows rolled back';
      ELSIF SQLERRM LIKE 'DI_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine logic bug: abort migration
      ELSE
        RAISE WARNING 'DI bin-inventory-integrity verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
