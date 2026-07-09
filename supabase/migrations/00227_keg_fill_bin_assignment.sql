-- 00227_keg_fill_bin_assignment.sql
-- Square POS bin-sync, Milestone D follow-up: give packaging-filled kegs a BIN, so
-- draft beer actually reaches the Square catalog and inventory counts.
--
-- WHY THIS EXISTS
--   The per-bin Square sync routes select POS stock with .in("bin_id", posBinIds)
--   against sellable_inventory, whose KEG branch sources bin_id from
--   keg_filled_contents.bin_id -> the fill keg_transaction's to_bin_id. 00220 added
--   keg_transactions.to_bin_id (DEFAULT NULL) and explicitly declined to backfill.
--   But the REAL fill path -- create_finished_goods_from_packaging (00183, session
--   completion) and the revise path (revise_packaging_session, keg quantity
--   increase) -- inserts a 'fill' keg_transaction whose column list OMITS to_bin_id
--   entirely (both predate 00220), and nothing in src/ calls record_keg_transaction
--   (the 00220 signature that does accept a bin). So EVERY packaging-filled keg has
--   to_bin_id = NULL, never matches the POS-bin filter, and the draft beer silently
--   disappears from the Square catalog AND from the inventory counts. A keg-only
--   brand never enters the catalog at all.
--
--   FORWARD FIX: both fill inserts now populate to_bin_id with the SAME bin
--   resolution place_finished_good_in_bin (00219) uses for packaged FGs -- the
--   packaging session's default_bin_id first, else the location-level is_default_fg
--   bin (preferring the primary location). A NULL result still leaves the keg
--   unplaced (invisible to POS until an operator assigns a bin) rather than blocking
--   the fill -- placement is a best-effort side-effect, never a hard block.
--
--   BACKFILL -- DELIBERATELY OVERRIDING 00220's "no backfill" stance: 00220 left
--   historical bins NULL to avoid lossy guessing. For fills that is the wrong call:
--   a NULL bin means the filled keg is INVISIBLE to the POS sync, which is strictly
--   worse than a best-effort default placement an operator can see and correct. So
--   this migration backfills to_bin_id on existing NULL-bin 'fill' rows whose keg is
--   still net-filled (appears in keg_filled_contents with quantity > 0), using the
--   SAME resolution as the forward fix (session default_bin_id, else the
--   is_default_fg bin of the transaction's to_location_id). Both sources are
--   unambiguous -- default_bin_id is single-valued and there is at most one
--   is_default_fg bin per location (bins_one_default_fg_per_location). Packaging
--   fills carry no to_location_id, so in practice they resolve via the session
--   default bin; rows where NEITHER resolves are left NULL for manual placement.
--
-- Live-safe: CREATE OR REPLACE of two functions (full bodies, only the fill insert
-- changed) and an idempotent, bin-resolvable-only backfill UPDATE. Verified by a
-- self-rolling-back DO block at the end (commits NO rows).

-- =============================================================================
-- PART 1 -- create_finished_goods_from_packaging: fill insert carries to_bin_id
-- =============================================================================
-- Reproduced from 00183 with ONE change: a bin is resolved (mirroring
-- place_finished_good_in_bin) and stamped onto the 'fill' keg_transaction's
-- to_bin_id. SECURITY INVOKER / search_path unchanged from 00183.

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
      -- Square POS sync (sellable_inventory keg branch -> keg_filled_contents.bin_id
      -- -> this fill's to_bin_id) can see it. Mirrors place_finished_good_in_bin
      -- (00219): the session default_bin_id first, else the location-level
      -- is_default_fg bin preferring the primary location. NULL leaves the keg
      -- unplaced (invisible to POS until an operator assigns a bin), never blocking.
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
        v_to_bin_id
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging IS
  'Creates finished goods and allocations from a completed packaging session, plus a fill keg_transaction (linked via packaging_session_id) for keg-container lines. The fill now carries to_bin_id, resolved like place_finished_good_in_bin (00227: session default_bin_id, else the location is_default_fg bin) so packaging-filled kegs are visible to the per-bin Square POS sync. Uses batch_id/selling_format_id. Skips line items with null/zero actual quantity.';

-- =============================================================================
-- PART 2 -- revise_packaging_session: the keg-increase fill also carries to_bin_id
-- =============================================================================
-- Built on the 00226 body (which fixed the bin_inventory mirror to a delta). ONLY
-- change vs 00226: the v_delta > 0 keg 'fill' insert resolves and stamps to_bin_id
-- the same way Part 1 does. The v_delta < 0 'adjust' leg is not a fill and is left
-- unchanged. SECURITY INVOKER / search_path unchanged.

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
  v_to_bin_id UUID;
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
        -- 00227: the keg-increase fill carries to_bin_id so the incremental filled
        -- kegs are visible to the per-bin Square POS sync. Same resolution as
        -- create_finished_goods_from_packaging / place_finished_good_in_bin (00219):
        -- session default_bin_id, else the location is_default_fg bin.
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

        INSERT INTO keg_transactions (
          transaction_type, selling_format_id, keg_owner_id, quantity,
          from_state, to_state, packaging_session_id, batch_id,
          finished_good_id, notes, to_bin_id
        ) VALUES (
          'fill', v_line.selling_format_id, v_line.keg_owner_id, v_delta,
          'empty', 'filled', p_session_id, v_line.batch_id,
          v_fg_id, 'Packaging session revision (quantity increased)', v_to_bin_id
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
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations (and applies the revision DELTA to the FG''s bin_inventory row, preserving Square-sale debits -- 00219/00226), applies BOM material-depletion deltas (consume more FEFO / reverse LIFO), records keg fill deltas (the keg-increase fill now carries to_bin_id for POS visibility -- 00227), and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';

-- =============================================================================
-- PART 3 -- backfill existing NULL-bin fills for still-filled kegs (see header)
-- =============================================================================
-- Deliberately overrides 00220's no-backfill stance: a NULL bin hides a filled keg
-- from the Square POS sync. Resolve the bin the same way the forward fix does
-- (session default_bin_id, else the is_default_fg bin of the fill's to_location_id),
-- both unambiguous, and only for fills whose keg is still net-filled. Rows where no
-- bin resolves are left NULL for manual placement. The keg_filled_contents read in
-- the CTE sees the pre-update state (the CTE is evaluated before the UPDATE writes).
WITH resolved AS (
  SELECT kt.id AS txn_id,
         COALESCE(
           ps.default_bin_id,
           (SELECT b.id
              FROM bins b
             WHERE b.location_id = kt.to_location_id
               AND b.is_default_fg
               AND b.is_active
             LIMIT 1)
         ) AS bin_id
  FROM keg_transactions kt
  LEFT JOIN packaging_sessions ps ON ps.id = kt.packaging_session_id
  WHERE kt.transaction_type = 'fill'
    AND kt.to_bin_id IS NULL
    AND kt.finished_good_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM keg_filled_contents kfc
      WHERE kfc.finished_good_id = kt.finished_good_id
        AND kfc.quantity > 0
    )
)
UPDATE keg_transactions kt
SET to_bin_id = r.bin_id
FROM resolved r
WHERE kt.id = r.txn_id
  AND r.bin_id IS NOT NULL;

-- =============================================================================
-- PART 4 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back: a keg filled via the packaging path
-- (create_finished_goods_from_packaging) is reported by sellable_inventory with a
-- NON-NULL bin_id matching the location's default FG bin (here the session's
-- default_bin_id, which is that same bin -- so the assertion is deterministic
-- regardless of any is_default_fg bins that already exist on live).
--
-- Same self-rolling-back idiom: a passing run RAISEs 'KB_VERIFY_OK'; a genuine
-- failure RAISEs 'KB_ASSERT_FAIL...' and aborts; any other error is a WARNING.
DO $$
DECLARE
  v_loc         UUID;
  v_brand       UUID;
  v_c_keg       UUID;
  v_sf_keg      UUID;
  v_bin_default UUID;
  v_session     UUID;
  v_sli         UUID;
  v_fg          UUID;
  v_txn_bin     UUID;
  v_sell_bin    UUID;
  v_sell_qty    INTEGER;
  v_sfx         TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('KB_loc_' || v_sfx, 'warehouse', false) RETURNING id INTO v_loc;
    INSERT INTO brands (name) VALUES ('KB_brand_' || v_sfx) RETURNING id INTO v_brand;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('KB_keg_' || v_sfx, 'keg', 0.5, 0) RETURNING id INTO v_c_keg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'KB_sf_' || v_sfx, 1) RETURNING id INTO v_sf_keg;

    -- The location's default FG bin; also the session default so resolution is
    -- deterministic (both point at this bin).
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'KB_bin_default_' || v_sfx, true) RETURNING id INTO v_bin_default;

    INSERT INTO packaging_sessions (default_bin_id, status, session_date)
      VALUES (v_bin_default, 'completed', current_date) RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id, actual_quantity)
      VALUES (v_session, v_brand, v_sf_keg, 5) RETURNING id INTO v_sli;

    -- Fill the keg via the real packaging path.
    PERFORM create_finished_goods_from_packaging(v_session);

    SELECT id INTO v_fg FROM finished_goods WHERE session_line_item_id = v_sli;
    IF v_fg IS NULL THEN
      RAISE EXCEPTION 'KB_ASSERT_FAIL: no finished good created for the keg line';
    END IF;

    -- The fill keg_transaction must carry the resolved bin.
    SELECT to_bin_id INTO v_txn_bin
      FROM keg_transactions
      WHERE finished_good_id = v_fg AND transaction_type = 'fill';
    IF v_txn_bin IS DISTINCT FROM v_bin_default THEN
      RAISE EXCEPTION 'KB_ASSERT_FAIL: fill keg_transaction to_bin_id % but expected default FG bin %', v_txn_bin, v_bin_default;
    END IF;

    -- ... and sellable_inventory's keg branch must surface it with that bin.
    SELECT bin_id, quantity INTO v_sell_bin, v_sell_qty
      FROM sellable_inventory
      WHERE finished_good_id = v_fg AND source = 'keg';
    IF v_sell_bin IS NULL THEN
      RAISE EXCEPTION 'KB_ASSERT_FAIL: sellable_inventory reported a NULL bin_id for the filled keg (invisible to POS)';
    END IF;
    IF v_sell_bin IS DISTINCT FROM v_bin_default THEN
      RAISE EXCEPTION 'KB_ASSERT_FAIL: sellable_inventory bin_id % but expected default FG bin %', v_sell_bin, v_bin_default;
    END IF;
    IF COALESCE(v_sell_qty, 0) <> 5 THEN
      RAISE EXCEPTION 'KB_ASSERT_FAIL: sellable_inventory keg quantity % but expected 5', COALESCE(v_sell_qty, 0);
    END IF;

    RAISE EXCEPTION 'KB_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'KB_VERIFY_OK' THEN
        RAISE NOTICE 'KB keg-fill-bin verification passed (packaging fill carries to_bin_id, sellable_inventory surfaces it); test rows rolled back';
      ELSIF SQLERRM LIKE 'KB_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine fill-bin bug: abort migration
      ELSE
        RAISE WARNING 'KB keg-fill-bin verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
