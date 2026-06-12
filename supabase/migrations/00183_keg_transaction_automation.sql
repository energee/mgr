-- =============================================================================
-- Migration: 00183_keg_transaction_automation
--
-- UX audit findings 23 + 39: keg movements require duplicate manual data
-- entry because both DB-layer automations from 00080_unify_packaging_formats
-- went stale after the selling-formats refactor:
--
--   1. create_finished_goods_from_packaging: the 00159 redesign rewrote the
--      function for batch_id/selling_format_id but DROPPED the keg-fill
--      keg_transactions insert that 00080 had added — so completing a
--      packaging session with keg lines no longer records the fills, the
--      keg_inventory view (calculated from transactions) goes stale, and the
--      fill can never be linked back to its packaging session
--      (keg_transactions.packaging_session_id is write-only in the UI).
--
--   2. create_keg_ship_transactions_from_order: the only committed body
--      (00080) still reads order_items.keg_type_id / keg_transactions
--      .keg_type_id — columns dropped by the (since renumbered/squashed)
--      drop-old-packaging migration. The on_order_fulfillment_keg_transactions
--      trigger still fires it on every order fulfillment. Same class of fix
--      as 00145/00168/00182 ("uses selling_format_id, not stale
--      keg_type_id/package_type_id"). Two empty remote_applied stubs
--      (20260416162155/20260417034027) mean the live body may have been
--      hotfixed; CREATE OR REPLACE converges both states.
--
-- Keg detection now goes through the unified schema:
--   selling_formats sf -> containers c ON c.id = sf.container_id
--   WHERE c.type = 'keg'
--
-- Preserved from the prior bodies: idempotency guards (re-running either
-- function never double-inserts), SECURITY INVOKER on the callable functions
-- with SECURITY DEFINER on the trigger wrapper, and the existing call sites
-- (00026 packaging-completion trigger; order-fulfillment trigger recreated
-- below).
--
-- Deliberately NOT done: no backfill of fill transactions for historical
-- completed keg sessions. Manual fills were the only working path while the
-- automation was broken, and those manual rows don't carry
-- packaging_session_id — a backfill could double-count keg inventory.
--
-- No new RPC/view: create_finished_goods_from_packaging and
-- create_keg_ship_transactions_from_order are already typed in
-- src/types/supabase.ts (signatures unchanged).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Restore keg-fill automation on packaging completion
--    (00159 body + the keg_transactions insert it dropped, now keyed on
--    selling_format_id and linked via packaging_session_id)
-- -----------------------------------------------------------------------------

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
        notes
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
        'Auto-created from packaging session completion'
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging IS
  'Creates finished goods and allocations from a completed packaging session, plus a fill keg_transaction (linked via packaging_session_id) for keg-container lines. Uses batch_id/selling_format_id. Skips line items with null/zero actual quantity.';

-- -----------------------------------------------------------------------------
-- 2. Rebuild ship automation on order fulfillment for the selling_formats
--    schema (replaces the stale keg_type_id body from 00080)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_keg_ship_transactions_from_order(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_count INTEGER := 0;
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

  -- One ship transaction per (selling_format, keg_owner) — grouped so two
  -- order lines of the same keg format aren't skipped by the idempotency
  -- guard after the first line inserts (a latent bug in the 00080 version,
  -- which looped per item).
  FOR v_item IN
    SELECT
      oi.selling_format_id,
      oi.keg_owner_id,
      SUM(oi.quantity) AS quantity
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
        AND kt.selling_format_id = v_item.selling_format_id
        AND COALESCE(kt.keg_owner_id, '00000000-0000-0000-0000-000000000000') =
            COALESCE(v_item.keg_owner_id, '00000000-0000-0000-0000-000000000000')
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO keg_transactions (
      transaction_type,
      selling_format_id,
      keg_owner_id,
      quantity,
      from_state,
      to_state,
      customer_id,
      order_id,
      notes
    ) VALUES (
      'ship',
      v_item.selling_format_id,
      v_item.keg_owner_id,
      v_item.quantity,
      'filled',
      'shipped',
      v_order.customer_id,
      v_order.id,
      'Auto-created from order ' || v_order.order_number || ' fulfillment'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_keg_ship_transactions_from_order IS
  'Creates ship keg_transactions for all keg-container order items when an order is fulfilled. Keg detection via selling_formats -> containers (type = keg).';

-- -----------------------------------------------------------------------------
-- 3. Recreate the order-fulfillment trigger wiring
--    (defensive: the live state is unknowable behind the empty remote_applied
--    stubs, so converge function + trigger explicitly)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_order_fulfillment_keg_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.status = 'fulfilled' AND (OLD.status IS NULL OR OLD.status != 'fulfilled') THEN
    v_count := create_keg_ship_transactions_from_order(NEW.id);
    IF v_count > 0 THEN
      RAISE NOTICE 'Created % keg ship transactions for order %', v_count, NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_fulfillment_keg_transactions ON orders;

CREATE TRIGGER on_order_fulfillment_keg_transactions
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_order_fulfillment_keg_transactions();

COMMENT ON TRIGGER on_order_fulfillment_keg_transactions ON orders IS
  'Auto-creates ship keg_transactions when an order is fulfilled.';

-- Refresh PostgREST schema cache so the replaced functions are picked up.
NOTIFY pgrst, 'reload schema';
