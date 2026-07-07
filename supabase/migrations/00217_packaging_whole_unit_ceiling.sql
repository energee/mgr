-- 00217_packaging_whole_unit_ceiling.sql
-- Audit fix M7 + M8 (backlog #18): whole-unit material ceiling on packaging.
--
-- M7: revise_packaging_session (00184) computed the BOM material delta as
--     quantity_per_unit * delta_units with NO whole-unit ceiling, so revising a
--     session consumed fractional case/tray counts and drifted from the integer
--     amount the completion path (computeBomConsumption, per batch) actually
--     consumes. Ceiling a delta is wrong (ceiling is not linear), so the fix
--     consumes the DIFFERENCE of the ceiled requirement at the NEW vs OLD
--     quantity, via a new whole_unit_material_qty() helper that mirrors the TS
--     ceiling exactly (exact-ratio recovery + ceil). Bulk materials stay
--     proportional.
--
-- M8 (decided: per-batch ceiling is canonical): the completion path already
--     ceils per batch; the session-materials preview hook was ceiling per
--     session and is corrected to per-batch in the SAME PR (app change, no SQL).
--     This migration is the revise-RPC half.
--
-- Only the material-delta section of revise_packaging_session changes; the rest
-- of the function is reproduced byte-for-byte from 00184 (the sole definition,
-- unchanged on live) by a deterministic transform. Live-safe: pure function
-- create/replace, no data touched; verified against live in a self-rolling-back
-- DO block before push. Parity with the TS ceiling is pinned by a vitest test
-- (consumption-planning.test.ts) sharing the same (qpu, units) fixtures.

-- -----------------------------------------------------------------------------
-- 1. whole_unit_material_qty helper (SQL mirror of computeBomConsumption's
--    whole-unit branch)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whole_unit_material_qty(p_qpu numeric, p_units numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_den integer;
  v_num integer;
BEGIN
  IF p_qpu IS NULL OR p_qpu <= 0 OR p_units IS NULL OR p_units <= 0 THEN
    RETURN 0;
  END IF;

  -- Recover the clean integer ratio behind the 4-decimal stored quantity_per_unit
  -- (0.0417 -> 1/24) so the ceiling is not corrupted by decimal rounding
  -- (ceil(0.0417 * 24) = 2 vs the correct 1). Smallest denominator 1..100 whose
  -- rounded numerator/denominator is within 0.0005, matching ratioFromDecimal in
  -- src/domain/inventory-units.ts.
  FOR v_den IN 1..100 LOOP
    v_num := round(p_qpu * v_den)::integer;
    CONTINUE WHEN v_num < 1;
    IF abs(v_num::numeric / v_den - p_qpu) <= 0.0005 THEN
      RETURN ceil(p_units * v_num::numeric / v_den - 0.000000001);
    END IF;
  END LOOP;

  -- No clean ratio: ceil the raw product (computeBomConsumption's fallback).
  RETURN ceil(p_units * p_qpu - 0.000000001);
END;
$function$;

COMMENT ON FUNCTION public.whole_unit_material_qty(numeric, numeric) IS
  'Ceiled whole-unit (each/case) material count for p_units selling units at BOM quantity_per_unit p_qpu. SQL mirror of the whole-unit branch of computeBomConsumption (src/domain/consumption-planning.ts): recovers the exact integer ratio behind the stored decimal before ceiling. Used by revise_packaging_session to keep revision material deltas on whole-unit boundaries (audit M7).';

-- -----------------------------------------------------------------------------
-- 2. revise_packaging_session — material-delta section now ceils whole-unit
--    materials via whole_unit_material_qty (delta-of-ceils). Reproduced from
--    00184 with only that section changed.
-- -----------------------------------------------------------------------------
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
  'Transactional quantity correction for a completed packaging session: updates line-item actuals, syncs finished goods + batch allocations, applies BOM material-depletion deltas (consume more FEFO / reverse LIFO), records keg fill deltas, and flips status to revised. The only sanctioned path into the revised status (see packaging_session_before_update guard).';
