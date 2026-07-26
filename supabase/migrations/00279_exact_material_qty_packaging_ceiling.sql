-- 00279_exact_material_qty_packaging_ceiling.sql
-- Issue #616: packaging completion over-drew whole-unit BOM materials by one
-- unit per (batch, inventory_item) group.
--
-- `selling_format_materials.quantity_per_unit` is DECIMAL(10,4), so the "1 per
-- 24" a user enters in the BOM editor persists as 0.0417 — strictly greater
-- than 1/24. 00256's packaging-depletion branch inside transition_entity_atomic
-- ceiled the product of that raw decimal:
--
--     CEIL(SUM(li.actual_quantity * sfm.quantity_per_unit) - 0.000000001)
--
-- so 240 cans computed CEIL(10.008) = 11 cases instead of 10, on every
-- completed session, contradicting the ratio-aware preview the operator had
-- just approved (use-material-planning.ts) and the TS contract that defines
-- the rule (computeBomConsumption, src/domain/consumption-planning.ts).
-- 00217 added whole_unit_material_qty() to fix exactly this class of error for
-- the revise RPC, but 00256 reimplemented the demand query inline and did not
-- call it. Ratios that truncate downward (1/3 -> 0.3333) under-draw instead at
-- large volumes (48000 units at 0.0208 -> 999 against a true 1000).
--
-- Fix, in three parts:
--   1. exact_material_qty(qpu, units) — 00217's ratio recovery WITHOUT the
--      final ceiling, so callers can sum exact per-line requirements first.
--   2. whole_unit_material_qty() becomes ceil(exact_material_qty(...) - 1e-9),
--      so the revise RPC and the completion path provably share one definition
--      and cannot drift again. Behavior is unchanged — pinned by the shared
--      fixture table in src/test/whole-unit-parity-fixtures.ts, asserted on the
--      TS side by consumption-planning.test.ts and on the SQL side by
--      src/__tests__/integration/packaging-material-consumption.test.ts.
--   3. transition_entity_atomic's whole-unit branch sums exact_material_qty and
--      ceils the (batch, inventory_item) group total ONCE — matching
--      computeBomConsumption's group-then-ceil order, so two selling formats
--      that share one inventory item in a batch book one ceiled total rather
--      than two independently ceiled line totals.
--
-- Live-safe: pure function create/replace, no data touched. Allocations already
-- written are keyed 'pkg_session:<id>' and are NOT recomputed — historical
-- over-draws need a separate correction pass or an accepted write-off (noted on
-- issue #616).
--
-- transition_entity_atomic is reproduced from 00256 (its sole definition) by a
-- deterministic transform: ONLY the whole-unit CASE arm of the demand query
-- changes; every other byte is identical.

-- -----------------------------------------------------------------------------
-- 1. exact_material_qty — ratio-exact, NON-ceiling material requirement
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exact_material_qty(p_qpu numeric, p_units numeric)
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

  -- Recover the clean integer ratio behind the 4-decimal stored
  -- quantity_per_unit (0.0417 -> 1/24) so a later ceiling is not corrupted by
  -- decimal rounding (240 * 0.0417 = 10.008 -> 11 vs the correct 10). Smallest
  -- denominator 1..100 whose rounded numerator/denominator is within 0.0005,
  -- matching ratioFromDecimal in src/domain/inventory-units.ts.
  FOR v_den IN 1..100 LOOP
    v_num := round(p_qpu * v_den)::integer;
    CONTINUE WHEN v_num < 1;
    IF abs(v_num::numeric / v_den - p_qpu) <= 0.0005 THEN
      RETURN p_units * v_num::numeric / v_den;
    END IF;
  END LOOP;

  -- No clean ratio: the raw product (computeBomConsumption's fallback).
  RETURN p_units * p_qpu;
END;
$function$;

COMMENT ON FUNCTION public.exact_material_qty(numeric, numeric) IS
  'Exact (unceiled) material requirement for p_units selling units at BOM quantity_per_unit p_qpu: recovers the clean integer ratio behind the 4-decimal stored decimal (0.0417 -> 1/24) before multiplying. Callers that consume whole units sum this across the group and ceil the total ONCE — see whole_unit_material_qty and transition_entity_atomic. Mirrors ratioFromDecimal + the required-quantity step of computeBomConsumption (issue #616).';

-- -----------------------------------------------------------------------------
-- 2. whole_unit_material_qty — now ceil(exact_material_qty(...)); one definition
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whole_unit_material_qty(p_qpu numeric, p_units numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ceil(exact_material_qty(p_qpu, p_units) - 0.000000001);
$function$;

COMMENT ON FUNCTION public.whole_unit_material_qty(numeric, numeric) IS
  'Ceiled whole-unit (each/case) material count for p_units selling units at BOM quantity_per_unit p_qpu. SQL mirror of the whole-unit branch of computeBomConsumption (src/domain/consumption-planning.ts). Since 00279 it is exactly ceil(exact_material_qty(...)), the same core transition_entity_atomic sums, so the revise RPC and the completion path cannot diverge (issue #616). Used by revise_packaging_session to keep revision material deltas on whole-unit boundaries (audit M7).';

-- -----------------------------------------------------------------------------
-- 3. transition_entity_atomic — whole-unit packaging demand now sums the exact
--    per-line requirement and ceils the (batch, item) group total once.
--    Reproduced from 00256 with only that CASE arm changed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transition_entity_atomic(
  p_table_name TEXT,
  p_id UUID,
  p_from_state TEXT,
  p_to_state TEXT,
  p_extra_fields JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_state TEXT;
  v_transitions JSONB;
  v_record JSONB;
  v_completed_allocations INTEGER := 0;
  v_reconciled_loss_bbl NUMERIC := 0;
  v_material_allocations INTEGER := 0;
  v_shortfalls INTEGER := 0;
  v_baseline NUMERIC;
  v_packaged NUMERIC;
  v_attributed NUMERIC;
  v_unattributed NUMERIC;
  v_has_open_sessions BOOLEAN;
  v_reconciled BOOLEAN;
  v_demand RECORD;
  v_lot RECORD;
  v_order_item RECORD;
  v_fg RECORD;
  v_remaining NUMERIC;
  v_draw NUMERIC;
  v_unit_volume NUMERIC;
  v_has_external_allocations BOOLEAN;
  v_linked_order RECORD;
BEGIN
  IF p_extra_fields IS NULL OR jsonb_typeof(p_extra_fields) <> 'object' THEN
    RAISE EXCEPTION 'Transition extra fields must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  v_transitions := get_state_transitions(p_table_name);
  IF v_transitions IS NULL THEN
    RAISE EXCEPTION 'Table % has no registered state machine', p_table_name
      USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE((v_transitions -> p_from_state) ? p_to_state, FALSE) THEN
    RAISE EXCEPTION 'Invalid state transition: % -> % (table: %)',
      p_from_state, p_to_state, p_table_name
      USING ERRCODE = '23514';
  END IF;

  -- Lock and compare the row before any side effect. Static table branches
  -- keep identifiers allowlisted and preserve RLS through SECURITY INVOKER.
  CASE p_table_name
    WHEN 'allocations' THEN SELECT status INTO v_current_state FROM allocations WHERE id = p_id FOR UPDATE;
    WHEN 'batches' THEN SELECT status INTO v_current_state FROM batches WHERE id = p_id FOR UPDATE;
    WHEN 'brew_logs' THEN SELECT status INTO v_current_state FROM brew_logs WHERE id = p_id FOR UPDATE;
    WHEN 'deliveries' THEN SELECT status INTO v_current_state FROM deliveries WHERE id = p_id FOR UPDATE;
    WHEN 'orders' THEN SELECT status INTO v_current_state FROM orders WHERE id = p_id FOR UPDATE;
    WHEN 'packaging_sessions' THEN SELECT status INTO v_current_state FROM packaging_sessions WHERE id = p_id FOR UPDATE;
    WHEN 'pick_lists' THEN SELECT status INTO v_current_state FROM pick_lists WHERE id = p_id FOR UPDATE;
    WHEN 'purchase_orders' THEN SELECT status INTO v_current_state FROM purchase_orders WHERE id = p_id FOR UPDATE;
    WHEN 'recipes' THEN SELECT status INTO v_current_state FROM recipes WHERE id = p_id FOR UPDATE;
    ELSE RAISE EXCEPTION 'Unsupported transition table: %', p_table_name USING ERRCODE = '22023';
  END CASE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transition record not found: %(%)', p_table_name, p_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_current_state IS DISTINCT FROM p_from_state THEN
    RAISE EXCEPTION 'State changed concurrently from % to %', p_from_state, v_current_state
      USING ERRCODE = '40001';
  END IF;

  -- Transition fields are intentionally allowlisted per table. The command
  -- cannot be repurposed as an arbitrary JSON patch endpoint.
  CASE p_table_name
    WHEN 'batches' THEN
      IF (p_extra_fields - ARRAY['actual_fg', 'actual_abv']) <> '{}'::JSONB THEN
        RAISE EXCEPTION 'Unsupported batch transition field(s): %', p_extra_fields
          USING ERRCODE = '22023';
      END IF;
      UPDATE batches
      SET status = p_to_state,
          actual_fg = CASE WHEN p_extra_fields ? 'actual_fg'
            THEN (p_extra_fields ->> 'actual_fg')::NUMERIC ELSE actual_fg END,
          actual_abv = CASE WHEN p_extra_fields ? 'actual_abv'
            THEN (p_extra_fields ->> 'actual_abv')::NUMERIC ELSE actual_abv END
      WHERE id = p_id;

    WHEN 'orders' THEN
      IF (p_extra_fields - ARRAY['scheduled_date']) <> '{}'::JSONB THEN
        RAISE EXCEPTION 'Unsupported order transition field(s): %', p_extra_fields
          USING ERRCODE = '22023';
      END IF;
      UPDATE orders
      SET status = p_to_state,
          scheduled_date = CASE WHEN p_extra_fields ? 'scheduled_date'
            THEN (p_extra_fields ->> 'scheduled_date')::DATE ELSE scheduled_date END
      WHERE id = p_id;

    WHEN 'pick_lists' THEN
      IF (p_extra_fields - ARRAY['assigned_to']) <> '{}'::JSONB THEN
        RAISE EXCEPTION 'Unsupported pick-list transition field(s): %', p_extra_fields
          USING ERRCODE = '22023';
      END IF;
      UPDATE pick_lists
      SET status = p_to_state,
          assigned_to = CASE WHEN p_extra_fields ? 'assigned_to'
            THEN NULLIF(p_extra_fields ->> 'assigned_to', '_none')::UUID ELSE assigned_to END
      WHERE id = p_id;

    WHEN 'packaging_sessions' THEN
      IF (p_extra_fields - ARRAY['notes']) <> '{}'::JSONB THEN
        RAISE EXCEPTION 'Unsupported packaging-session transition field(s): %', p_extra_fields
          USING ERRCODE = '22023';
      END IF;
      UPDATE packaging_sessions
      SET status = p_to_state,
          notes = CASE WHEN p_extra_fields ? 'notes' THEN p_extra_fields ->> 'notes' ELSE notes END
      WHERE id = p_id;

    WHEN 'allocations' THEN
      IF p_extra_fields <> '{}'::JSONB THEN RAISE EXCEPTION 'allocations has no transition fields' USING ERRCODE = '22023'; END IF;
      UPDATE allocations SET status = p_to_state WHERE id = p_id;
    WHEN 'brew_logs' THEN
      IF p_extra_fields <> '{}'::JSONB THEN RAISE EXCEPTION 'brew_logs has no transition fields' USING ERRCODE = '22023'; END IF;
      UPDATE brew_logs SET status = p_to_state WHERE id = p_id;
    WHEN 'deliveries' THEN
      IF p_extra_fields <> '{}'::JSONB THEN RAISE EXCEPTION 'deliveries has no transition fields' USING ERRCODE = '22023'; END IF;
      UPDATE deliveries SET status = p_to_state WHERE id = p_id;
    WHEN 'purchase_orders' THEN
      IF p_extra_fields <> '{}'::JSONB THEN RAISE EXCEPTION 'purchase_orders has no transition fields' USING ERRCODE = '22023'; END IF;
      UPDATE purchase_orders SET status = p_to_state WHERE id = p_id;
    WHEN 'recipes' THEN
      IF p_extra_fields <> '{}'::JSONB THEN RAISE EXCEPTION 'recipes has no transition fields' USING ERRCODE = '22023'; END IF;
      UPDATE recipes SET status = p_to_state WHERE id = p_id;
  END CASE;

  -- Batch completion: confirm ingredient allocations, reconcile unattributed
  -- wort loss, and release the vessel in this same transaction.
  IF p_table_name = 'batches' AND p_to_state = 'completed' THEN
    WITH changed AS (
      UPDATE allocations
      SET status = 'completed', completed_at = NOW()
      WHERE destination_type = 'batch'
        AND destination_id = p_id
        AND source_type = 'inventory_lot'
        AND status = 'planned'
      RETURNING id
    )
    SELECT COUNT(*) INTO v_completed_allocations FROM changed;

    SELECT
      COALESCE((SELECT SUM(volume_bbl) FROM brew_log_batches WHERE batch_id = p_id), 0)
        + COALESCE((SELECT SUM(volume_bbl) FROM batch_blends WHERE blend_batch_id = p_id), 0)
        - COALESCE((SELECT SUM(volume_bbl) FROM batch_blends WHERE source_batch_id = p_id), 0),
      COALESCE((
        SELECT SUM(
          li.actual_quantity * sf.unit_count *
          COALESCE(c.volume_bbl, c.volume_oz / 3968.0)
        )
        FROM session_line_items li
        JOIN packaging_sessions ps ON ps.id = li.session_id
        JOIN selling_formats sf ON sf.id = li.selling_format_id
        JOIN containers c ON c.id = sf.container_id
        WHERE li.batch_id = p_id
          AND ps.status IN ('completed', 'revised')
          AND li.actual_quantity IS NOT NULL
      ), 0),
      COALESCE((
        SELECT SUM(COALESCE(volume_bbl, 0))
        FROM allocations
        WHERE source_type = 'batch'
          AND source_id = p_id
          AND status = 'completed'
          AND destination_type <> 'finished_good'
      ), 0),
      EXISTS (
        SELECT 1
        FROM session_line_items li
        JOIN packaging_sessions ps ON ps.id = li.session_id
        WHERE li.batch_id = p_id AND ps.status IN ('planned', 'in_progress')
      ),
      EXISTS (
        SELECT 1 FROM allocations
        WHERE idempotency_key = 'batch_reconcile:' || p_id::TEXT
      )
    INTO v_baseline, v_packaged, v_attributed, v_has_open_sessions, v_reconciled;

    v_unattributed := v_baseline - v_packaged - v_attributed;
    IF v_baseline > 0
       AND NOT v_has_open_sessions
       AND NOT v_reconciled
       AND v_unattributed >= GREATEST(0.05, 0.005 * v_baseline) THEN
      INSERT INTO allocations (
        source_type, source_id, destination_type, destination_id,
        quantity, volume_bbl, status, completed_at, reason_code, notes,
        idempotency_key
      ) VALUES (
        'batch', p_id, 'loss', NULL,
        v_unattributed, v_unattributed, 'completed', NOW(), 'reconciliation',
        FORMAT(
          'Completion loss reconciliation — baseline %s bbl, packaged %s bbl, previously attributed %s bbl',
          ROUND(v_baseline, 3), ROUND(v_packaged, 3), ROUND(v_attributed, 3)
        ),
        'batch_reconcile:' || p_id::TEXT
      );
      v_reconciled_loss_bbl := v_unattributed;
    END IF;

    UPDATE vessels
    SET status = 'dirty', current_batch_id = NULL, updated_at = NOW()
    WHERE current_batch_id = p_id;
  END IF;

  -- Packaging completion: consume BOM materials FIFO. Shortfalls remain
  -- visible in the result, but every allocation that is written is part of
  -- the same commit as the session status and finished-goods trigger.
  IF p_table_name = 'packaging_sessions'
     AND p_to_state = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM allocations
       WHERE idempotency_key = 'pkg_session:' || p_id::TEXT
     ) THEN
    FOR v_demand IN
      SELECT
        li.batch_id,
        sfm.inventory_item_id,
        CASE WHEN ii.unit IN ('each', 'case')
          THEN CEIL(SUM(exact_material_qty(sfm.quantity_per_unit, li.actual_quantity)) - 0.000000001)
          ELSE SUM(li.actual_quantity * sfm.quantity_per_unit)
        END AS required_quantity
      FROM session_line_items li
      JOIN selling_format_materials sfm ON sfm.selling_format_id = li.selling_format_id
      JOIN inventory_items ii ON ii.id = sfm.inventory_item_id
      WHERE li.session_id = p_id
        AND li.actual_quantity > 0
      GROUP BY li.batch_id, sfm.inventory_item_id, ii.unit
      ORDER BY sfm.inventory_item_id, li.batch_id NULLS LAST
    LOOP
      v_remaining := v_demand.required_quantity;
      FOR v_lot IN
        SELECT
          lot.id,
          lot.lot_number,
          lot.unit_cost,
          GREATEST(
            lot.quantity - COALESCE((
              SELECT SUM(a.quantity)
              FROM allocations a
              WHERE a.source_type = 'inventory_lot'
                AND a.source_id = lot.id
                AND a.status IN ('planned', 'completed')
            ), 0),
            0
          ) AS available_quantity
        FROM inventory_lots lot
        WHERE lot.inventory_item_id = v_demand.inventory_item_id
        ORDER BY lot.expiration_date NULLS LAST, lot.received_date NULLS LAST, lot.id
        FOR UPDATE OF lot
      LOOP
        EXIT WHEN v_remaining <= 0.000000001;
        CONTINUE WHEN v_lot.available_quantity <= 0;
        v_draw := LEAST(v_remaining, v_lot.available_quantity);
        INSERT INTO allocations (
          source_type, source_id, destination_type, destination_id,
          quantity, unit_cost, status, completed_at, lot_number, notes,
          idempotency_key
        ) VALUES (
          'inventory_lot', v_lot.id, 'batch', v_demand.batch_id,
          v_draw, v_lot.unit_cost, 'completed', NOW(), v_lot.lot_number,
          'Packaging session ' || p_id::TEXT || ' material consumption',
          'pkg_session:' || p_id::TEXT
        );
        v_material_allocations := v_material_allocations + 1;
        v_remaining := v_remaining - v_draw;
      END LOOP;
      IF v_remaining > 0.000000001 THEN
        v_shortfalls := v_shortfalls + 1;
      END IF;
    END LOOP;
  END IF;

  -- Pick-list work advances the parent order only from the matching state.
  IF p_table_name = 'pick_lists' AND p_to_state = 'in_progress' THEN
    UPDATE orders
    SET status = 'picking'
    WHERE id = (SELECT order_id FROM pick_lists WHERE id = p_id)
      AND status = 'scheduled';
  ELSIF p_table_name = 'pick_lists' AND p_to_state = 'completed' THEN
    UPDATE orders
    SET status = 'packed'
    WHERE id = (SELECT order_id FROM pick_lists WHERE id = p_id)
      AND status = 'picking';
  END IF;

  -- Fulfillment completes planned reservations. Reservation-less orders get
  -- deterministic FIFO removal allocations; keg lines remain owned by the
  -- existing keg-transaction trigger, matching the prior service behavior.
  IF p_table_name = 'orders' AND p_to_state = 'fulfilled' THEN
    WITH changed AS (
      UPDATE allocations a
      SET status = 'completed',
          completed_at = NOW(),
          volume_bbl = a.quantity * (
            SELECT sf.unit_count * COALESCE(c.volume_bbl, c.volume_oz / 3968.0)
            FROM finished_goods fg
            JOIN selling_formats sf ON sf.id = fg.selling_format_id
            JOIN containers c ON c.id = sf.container_id
            WHERE fg.id = a.source_id
          )
      WHERE a.destination_type = 'order'
        AND a.destination_id = p_id
        AND a.source_type = 'finished_good'
        AND a.status = 'planned'
      RETURNING id
    )
    SELECT COUNT(*) INTO v_completed_allocations FROM changed;

    IF v_completed_allocations = 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM allocations
        WHERE destination_type = 'order'
          AND destination_id = p_id
          AND source_type = 'finished_good'
          AND status IN ('planned', 'completed')
          AND COALESCE(idempotency_key, '') NOT LIKE 'order_fulfill:%'
      ) INTO v_has_external_allocations;

      IF NOT v_has_external_allocations THEN
        FOR v_order_item IN
          SELECT oi.id, oi.order_id, oi.brand_id, oi.selling_format_id,
                 oi.quantity, sf.unit_count, c.type AS container_type,
                 COALESCE(c.volume_bbl, c.volume_oz / 3968.0) AS container_volume
          FROM order_items oi
          LEFT JOIN selling_formats sf ON sf.id = oi.selling_format_id
          LEFT JOIN containers c ON c.id = sf.container_id
          WHERE oi.order_id = p_id
            AND oi.quantity > 0
            AND oi.selling_format_id IS NOT NULL
            AND COALESCE(c.type, '') <> 'keg'
            AND NOT EXISTS (
              SELECT 1 FROM allocations a
              WHERE a.idempotency_key = 'order_fulfill:' || oi.order_id::TEXT || ':' || oi.id::TEXT
            )
          ORDER BY oi.brand_id NULLS LAST, oi.id
        LOOP
          v_remaining := v_order_item.quantity;
          v_unit_volume := v_order_item.unit_count * v_order_item.container_volume;
          FOR v_fg IN
            SELECT
              fg.id,
              fg.lot_number,
              GREATEST(
                fg.quantity - COALESCE((
                  SELECT SUM(a.quantity)
                  FROM allocations a
                  WHERE a.source_type = 'finished_good'
                    AND a.source_id = fg.id
                    AND a.status IN ('planned', 'completed')
                ), 0),
                0
              ) AS available_quantity
            FROM finished_goods fg
            WHERE fg.selling_format_id = v_order_item.selling_format_id
              AND (v_order_item.brand_id IS NULL OR fg.brand_id = v_order_item.brand_id)
            ORDER BY fg.production_date NULLS LAST, fg.lot_number NULLS LAST, fg.id
            FOR UPDATE OF fg
          LOOP
            EXIT WHEN v_remaining <= 0.000000001;
            CONTINUE WHEN v_fg.available_quantity <= 0;
            v_draw := LEAST(v_remaining, v_fg.available_quantity);
            INSERT INTO allocations (
              source_type, source_id, destination_type, destination_id,
              quantity, volume_bbl, status, completed_at, lot_number, notes,
              idempotency_key
            ) VALUES (
              'finished_good', v_fg.id, 'order', p_id,
              v_draw, v_unit_volume * v_draw, 'completed', NOW(), v_fg.lot_number,
              'Order fulfillment removal (synthesized from order line ' || v_order_item.id::TEXT || ')',
              'order_fulfill:' || p_id::TEXT || ':' || v_order_item.id::TEXT
            );
            v_completed_allocations := v_completed_allocations + 1;
            v_remaining := v_remaining - v_draw;
          END LOOP;
          IF v_remaining > 0.000000001 THEN
            v_shortfalls := v_shortfalls + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  ELSIF p_table_name = 'orders' AND p_to_state = 'cancelled' THEN
    UPDATE allocations
    SET status = 'cancelled'
    WHERE destination_type = 'order'
      AND destination_id = p_id
      AND source_type = 'finished_good'
      AND status = 'planned';
  END IF;

  -- A delivery is one record-level transaction: every packed linked order is
  -- fulfilled through this same command. Any order/ledger failure rolls the
  -- delivery back as well.
  IF p_table_name = 'deliveries' AND p_to_state = 'completed' THEN
    FOR v_linked_order IN
      SELECT id FROM orders
      WHERE delivery_id = p_id AND status = 'packed'
      ORDER BY id
    LOOP
      PERFORM transition_entity_atomic(
        'orders', v_linked_order.id, 'packed', 'fulfilled', '{}'::JSONB
      );
    END LOOP;
  END IF;

  CASE p_table_name
    WHEN 'allocations' THEN SELECT TO_JSONB(t) INTO v_record FROM allocations t WHERE id = p_id;
    WHEN 'batches' THEN SELECT TO_JSONB(t) INTO v_record FROM batches t WHERE id = p_id;
    WHEN 'brew_logs' THEN SELECT TO_JSONB(t) INTO v_record FROM brew_logs t WHERE id = p_id;
    WHEN 'deliveries' THEN SELECT TO_JSONB(t) INTO v_record FROM deliveries t WHERE id = p_id;
    WHEN 'orders' THEN SELECT TO_JSONB(t) INTO v_record FROM orders t WHERE id = p_id;
    WHEN 'packaging_sessions' THEN SELECT TO_JSONB(t) INTO v_record FROM packaging_sessions t WHERE id = p_id;
    WHEN 'pick_lists' THEN SELECT TO_JSONB(t) INTO v_record FROM pick_lists t WHERE id = p_id;
    WHEN 'purchase_orders' THEN SELECT TO_JSONB(t) INTO v_record FROM purchase_orders t WHERE id = p_id;
    WHEN 'recipes' THEN SELECT TO_JSONB(t) INTO v_record FROM recipes t WHERE id = p_id;
  END CASE;

  RETURN JSONB_BUILD_OBJECT(
    'record', v_record,
    'completed_allocations', v_completed_allocations,
    'reconciled_loss_bbl', v_reconciled_loss_bbl,
    'material_allocations', v_material_allocations,
    'shortfalls', v_shortfalls
  );
END;
$$;

COMMENT ON FUNCTION transition_entity_atomic(TEXT, UUID, TEXT, TEXT, JSONB) IS
  'Atomically applies one guarded entity state transition and its registered '
  'inventory, accounting, vessel, and order side effects. Bulk atomicity is '
  'per record; callers retry individual failures safely through state and '
  'idempotency guards.';

REVOKE ALL ON FUNCTION transition_entity_atomic(TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_entity_atomic(TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
