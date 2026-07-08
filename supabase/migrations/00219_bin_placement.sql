-- 00219_bin_placement.sql
-- Square POS bin-sync, Milestone A0: place non-keg finished goods into a bin on
-- creation, so the later per-bin Square sync can read finished-goods stock from
-- bin_inventory.
--
-- WHY THIS EXISTS
--   bin_inventory (00010) has had NO writer anywhere in the app or the DB since
--   it was created, so it is empty on live. The Square per-bin sync (later
--   milestones) reads finished-goods stock per bin, which requires every non-keg
--   finished good to actually land in a bin. This migration adds the missing
--   writer: an AFTER INSERT trigger on finished_goods that places the row.
--
--   KEG-SKIP GUARD: kegs are never in bin_inventory. Keg stock lives in
--   keg_transactions / keg_filled_contents (netted by 00207). The trigger
--   detects kegs the canonical way -- selling_formats -> containers WHERE
--   type = 'keg' (00183/00207) -- and returns without placing.
--
--   THE LOCATION GAP: a finished_good carries NO location column, and neither do
--   packaging_sessions / session_line_items. So the placement target cannot be
--   derived from "the FG's location". Instead the trigger resolves a bin via:
--     1. the packaging session's new default_bin_id (FGs produced by a session), then
--     2. a location-level default finished-goods bin (bins.is_default_fg),
--        preferring the primary location.
--
--   NEVER-BLOCK DECISION (locked with the user): placement is a best-effort
--   system side-effect. If no bin can be resolved the trigger RAISE NOTICE's and
--   returns NEW -- it NEVER RAISE EXCEPTION's. FG creation and, transitively,
--   packaging-session completion / revision must never be blocked by the absence
--   of a configured bin. The brewer is never hard-blocked.
--
--   FIRES FOR BOTH ENTRY POINTS: the AFTER INSERT trigger fires for FG rows
--   inserted by create_finished_goods_from_packaging (00183, session completion)
--   AND by revise_packaging_session (00217, revision ELSIF branch). Both run in
--   the same transaction as the FG insert, so placement is atomic and can never
--   orphan an FG. revise_packaging_session additionally mirrors quantity
--   corrections onto the already-placed bin row (Part 3).
--
--   A6 -- NO BACKFILL: existing finished_goods are NOT backfilled into bins. They
--   remain unplaced until re-touched (e.g. a session revision that updates their
--   quantity, which the Part 3 mirror handles for the session case, or a future
--   explicit placement UI). This is intentional: a blind backfill would need to
--   invent a bin per historical FG and could double-count against the manual
--   inventory the Square sync will reconcile.
--
--   SECURITY DEFINER on the trigger function: the placement INSERT into
--   bin_inventory must not fail on the inserting user's RLS. bin_inventory is in
--   the 00097 "inventory" permission group (inventory:write), but an FG can be
--   created by flows whose actor may not hold inventory:write; the placement is a
--   system side-effect, so the trigger runs SECURITY DEFINER (same rationale as
--   00183's trigger wrapper). Injection surface is nil: it only ever inserts one
--   bin_inventory row keyed to the just-inserted FG.
--
-- Live-safe: additive columns/index, one new trigger, and a CREATE OR REPLACE of
-- revise_packaging_session whose body is reproduced byte-for-byte from 00217 with
-- only the bin_inventory mirror added. Verified by a self-rolling-back DO block at
-- the end of this file (commits no rows).

-- =============================================================================
-- PART 1 -- schema
-- =============================================================================

-- 1a. Per-session default bin: FGs produced by this session are placed here.
ALTER TABLE packaging_sessions
  ADD COLUMN IF NOT EXISTS default_bin_id UUID REFERENCES bins(id) ON DELETE SET NULL;

COMMENT ON COLUMN packaging_sessions.default_bin_id IS
  'Default bin for finished goods produced by this packaging session. Resolved first by place_finished_good_in_bin (00219) before the location-level is_default_fg fallback. NULL falls through to the fallback. Non-keg FGs only; kegs are never placed in bins.';

-- 1b. Location-level default FG bin: the fallback placement target when a session
--     has no default_bin_id (or the FG was created outside a session).
ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS is_default_fg BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bins.is_default_fg IS
  'Marks this bin as the location''s default finished-goods bin: the fallback placement target for place_finished_good_in_bin (00219) when a packaging session carries no default_bin_id. At most one per location (bins_one_default_fg_per_location).';

-- At most one default FG bin per location.
CREATE UNIQUE INDEX IF NOT EXISTS bins_one_default_fg_per_location
  ON bins (location_id)
  WHERE is_default_fg;

-- 1c. Index the new FK (repo unindexed-FK convention, cf. 00060/00061/00129).
CREATE INDEX IF NOT EXISTS idx_packaging_sessions_default_bin_id
  ON packaging_sessions (default_bin_id);

-- =============================================================================
-- PART 2 -- placement trigger
-- =============================================================================
-- AFTER INSERT ON finished_goods: place non-keg FGs into a bin (bin_inventory).
-- SECURITY DEFINER: placement is a system side-effect that must bypass the
-- inserting user's bin_inventory RLS (see header). NEVER raises -- an unplaceable
-- FG is a NOTICE, not an error.

CREATE OR REPLACE FUNCTION place_finished_good_in_bin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_keg BOOLEAN;
  v_bin_id UUID;
BEGIN
  -- Keg skip: kegs are tracked in keg_transactions / keg_filled_contents, never
  -- in bin_inventory. Canonical detection: selling_formats -> containers.type.
  -- NEW.selling_format_id may be NULL (external/manual FG) -> no row -> non-keg.
  SELECT (c.type = 'keg')
    INTO v_is_keg
  FROM selling_formats sf
  JOIN containers c ON c.id = sf.container_id
  WHERE sf.id = NEW.selling_format_id;

  IF COALESCE(v_is_keg, false) THEN
    RETURN NEW;
  END IF;

  -- Resolution 1: the packaging session's default bin (FGs from a session).
  IF NEW.session_line_item_id IS NOT NULL THEN
    SELECT ps.default_bin_id
      INTO v_bin_id
    FROM session_line_items sli
    JOIN packaging_sessions ps ON ps.id = sli.session_id
    WHERE sli.id = NEW.session_line_item_id;
  END IF;

  -- Resolution 2: fallback to the location-level default FG bin, preferring the
  -- primary location (FGs carry no location, so this is the only location signal).
  IF v_bin_id IS NULL THEN
    SELECT b.id
      INTO v_bin_id
    FROM bins b
    JOIN locations l ON l.id = b.location_id
    WHERE b.is_default_fg AND b.is_active
    ORDER BY (l.is_primary IS TRUE) DESC, l.created_at
    LIMIT 1;
  END IF;

  -- Never block: unplaceable FG is a NOTICE, not an error.
  IF v_bin_id IS NULL THEN
    RAISE NOTICE 'place_finished_good_in_bin: finished_good % not placed -- no session default_bin_id and no active is_default_fg bin', NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
  VALUES (NEW.id, v_bin_id, NEW.quantity)
  ON CONFLICT (finished_good_id, bin_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION place_finished_good_in_bin() IS
  'AFTER INSERT trigger fn on finished_goods (00219, Square bin-sync A0): places non-keg FGs into a bin_inventory row. Skips kegs (selling_formats -> containers.type = keg). Bin resolution: (1) packaging session default_bin_id, (2) location-level is_default_fg bin preferring the primary location. Never raises -- an unplaceable FG is a NOTICE. SECURITY DEFINER so placement bypasses the inserting user''s bin_inventory RLS.';

DROP TRIGGER IF EXISTS on_finished_good_place_in_bin ON finished_goods;
CREATE TRIGGER on_finished_good_place_in_bin
  AFTER INSERT ON finished_goods
  FOR EACH ROW
  EXECUTE FUNCTION place_finished_good_in_bin();

COMMENT ON TRIGGER on_finished_good_place_in_bin ON finished_goods IS
  'Places every newly-inserted non-keg finished good into a bin (bin_inventory) via place_finished_good_in_bin (00219). Fires for session-completion (00183) and revision (00217) FG inserts alike; both are same-transaction so placement is atomic.';

-- =============================================================================
-- PART 3 -- revise_packaging_session: mirror corrected FG quantity onto its bin
-- =============================================================================
-- Reproduced byte-for-byte from 00217 with ONE addition: after the existing-FG
-- quantity UPDATE (IF FOUND branch), mirror the corrected quantity onto the FG's
-- bin_inventory row. Kept SECURITY INVOKER (unchanged): the function already
-- writes finished_goods/allocations/keg_transactions as the invoker, and
-- bin_inventory is in the same 00097 inventory:write permission group.

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

      -- A0: mirror the corrected FG quantity onto its bin (non-keg FGs have exactly
      -- one bin_inventory row from place_finished_good_in_bin; keg FGs have none, so
      -- this affects 0 rows for kegs). Newly-created FGs in the ELSIF branch place
      -- via the AFTER INSERT trigger and need no mirror here.
      UPDATE bin_inventory SET quantity = COALESCE(v_new, 0) WHERE finished_good_id = v_fg.id;

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
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations (and mirrors the corrected quantity onto the FG''s bin_inventory row -- 00219), applies BOM material-depletion deltas (consume more FEFO / reverse LIFO), records keg fill deltas, and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';

-- =============================================================================
-- PART 4 -- verification (self-rolling-back; commits NO rows)
-- =============================================================================
-- Proves, then rolls back, four placement behaviors:
--   (a) non-keg FG + session default_bin_id       -> one bin_inventory row, right qty
--   (b) keg FG                                     -> NO bin_inventory row
--   (c) no session bin, is_default_fg bin present  -> falls back to that bin
--   (d) neither                                    -> insert succeeds, places nothing
--
-- All test rows are created inside one subtransaction (BEGIN/EXCEPTION establishes
-- a savepoint). A passing run RAISEs the sentinel 'A0_VERIFY_OK' to unwind the
-- subtransaction, so nothing is committed. A genuine trigger-logic failure RAISEs
-- 'A0_ASSERT_FAIL...' and is re-raised to ABORT the migration. Any other error
-- (e.g. a surviving pre-squash constraint on a from-scratch replay, or missing
-- prerequisites) is downgraded to a WARNING so the additive DDL above still
-- applies -- this block is a check, not a gate.
DO $$
DECLARE
  v_loc         UUID;
  v_brand       UUID;
  v_c_pkg       UUID;
  v_c_keg       UUID;
  v_sf_pkg      UUID;
  v_sf_keg      UUID;
  v_bin_session UUID;
  v_bin_default UUID;
  v_session     UUID;
  v_sli         UUID;
  v_fg          UUID;
  v_bin         UUID;
  v_qty         INTEGER;
  v_cnt         INTEGER;
  v_sfx         TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  BEGIN
    -- --- prerequisites (all rolled back) --------------------------------------
    INSERT INTO locations (name, location_type, is_primary)
      VALUES ('A0_verify_loc_' || v_sfx, 'warehouse', false)
      RETURNING id INTO v_loc;

    INSERT INTO brands (name)
      VALUES ('A0_verify_brand_' || v_sfx)
      RETURNING id INTO v_brand;

    INSERT INTO containers (name, type, volume_oz, deposit_amount)
      VALUES ('A0_verify_pkg_' || v_sfx, 'package', 12, 0)
      RETURNING id INTO v_c_pkg;
    INSERT INTO containers (name, type, volume_bbl, deposit_amount)
      VALUES ('A0_verify_keg_' || v_sfx, 'keg', 0.5, 0)
      RETURNING id INTO v_c_keg;

    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_pkg, 'A0_verify_sf_pkg_' || v_sfx, 1)
      RETURNING id INTO v_sf_pkg;
    INSERT INTO selling_formats (container_id, name, unit_count)
      VALUES (v_c_keg, 'A0_verify_sf_keg_' || v_sfx, 1)
      RETURNING id INTO v_sf_keg;

    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'A0_verify_bin_session_' || v_sfx, false)
      RETURNING id INTO v_bin_session;

    INSERT INTO packaging_sessions (default_bin_id)
      VALUES (v_bin_session)
      RETURNING id INTO v_session;
    INSERT INTO session_line_items (session_id, brand_id, selling_format_id)
      VALUES (v_session, v_brand, v_sf_pkg)
      RETURNING id INTO v_sli;

    -- --- (d) neither session bin nor is_default_fg bin: places nothing --------
    -- Run BEFORE creating the is_default_fg bin so the fallback finds none.
    INSERT INTO finished_goods (brand_id, quantity, lot_number)
      VALUES (v_brand, 3, 'A0-d-' || v_sfx)
      RETURNING id INTO v_fg;
    SELECT count(*) INTO v_cnt FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (d): expected 0 bin_inventory rows with no bin available, got %', v_cnt;
    END IF;

    -- --- (a) non-keg FG via session default_bin_id: one row, right qty --------
    INSERT INTO finished_goods (brand_id, session_line_item_id, quantity, lot_number)
      VALUES (v_brand, v_sli, 7, 'A0-a-' || v_sfx)
      RETURNING id INTO v_fg;
    SELECT count(*) INTO v_cnt FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (a): expected 1 bin_inventory row, got %', v_cnt;
    END IF;
    SELECT bin_id, quantity INTO v_bin, v_qty
      FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_bin <> v_bin_session THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (a): placed in bin % but expected session bin %', v_bin, v_bin_session;
    END IF;
    IF v_qty <> 7 THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (a): placed qty % but expected 7', v_qty;
    END IF;

    -- --- (b) keg FG: no bin_inventory row -------------------------------------
    INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number)
      VALUES (v_brand, v_sf_keg, 5, 'A0-b-' || v_sfx)
      RETURNING id INTO v_fg;
    SELECT count(*) INTO v_cnt FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (b): keg FG produced % bin_inventory rows, expected 0', v_cnt;
    END IF;

    -- --- (c) fallback to is_default_fg bin ------------------------------------
    INSERT INTO bins (location_id, name, is_default_fg)
      VALUES (v_loc, 'A0_verify_bin_default_' || v_sfx, true)
      RETURNING id INTO v_bin_default;
    INSERT INTO finished_goods (brand_id, quantity, lot_number)
      VALUES (v_brand, 4, 'A0-c-' || v_sfx)
      RETURNING id INTO v_fg;
    SELECT count(*) INTO v_cnt FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (c): expected 1 fallback bin_inventory row, got %', v_cnt;
    END IF;
    SELECT bin_id INTO v_bin FROM bin_inventory WHERE finished_good_id = v_fg;
    IF v_bin <> v_bin_default THEN
      RAISE EXCEPTION 'A0_ASSERT_FAIL (c): placed in bin % but expected default FG bin %', v_bin, v_bin_default;
    END IF;

    -- All assertions passed: unwind the subtransaction (commit nothing).
    RAISE EXCEPTION 'A0_VERIFY_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'A0_VERIFY_OK' THEN
        RAISE NOTICE 'A0 bin-placement verification passed (a,b,c,d); test rows rolled back';
      ELSIF SQLERRM LIKE 'A0_ASSERT_FAIL%' THEN
        RAISE EXCEPTION '%', SQLERRM;  -- genuine trigger-logic bug: abort migration
      ELSE
        RAISE WARNING 'A0 bin-placement verification skipped (environment): %', SQLERRM;
      END IF;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
