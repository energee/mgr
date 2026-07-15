-- Issue #476: rebuild order change-request approval against the canonical
-- selling_formats schema. The 00094 body survived after package_type_id and
-- keg_type_id were removed, so add/remove approvals failed at runtime.

-- An order change must not rewrite fulfillment history. This narrow predicate
-- can inspect the inventory/pick-list domains for an orders:write caller while
-- exposing only whether approval must stop. The main mutation remains invoker
-- rights and never bypasses order/request/item RLS.
-- security-definer: justified exposes one boolean about fulfillment artifacts for an order the active caller is authorized to write; it performs no writes and prevents cross-domain history mutation.
CREATE OR REPLACE FUNCTION order_change_has_fulfillment_artifacts(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_has_permission('orders:write') THEN
    RAISE EXCEPTION 'Insufficient permission to approve order changes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM allocations
    WHERE destination_type = 'order'
      AND destination_id = p_order_id
      AND source_type = 'finished_good'
      AND status IN ('planned', 'pending_approval', 'completed')
  ) OR EXISTS (
    SELECT 1
    FROM pick_lists
    WHERE order_id = p_order_id
      AND status <> 'cancelled'
  );
END;
$$;

COMMENT ON FUNCTION order_change_has_fulfillment_artifacts(UUID) IS
  'Returns whether an orders:write caller must cancel/regenerate fulfillment artifacts before applying a line-item change. SECURITY DEFINER is limited to this boolean cross-domain read.';

REVOKE ALL ON FUNCTION order_change_has_fulfillment_artifacts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION order_change_has_fulfillment_artifacts(UUID) TO authenticated;

-- Remove the caller-spoofable legacy signature. The replacement accepts the
-- route order id as an additional ownership boundary and still records the
-- authenticated reviewer supplied by the permission wrapper.
DROP FUNCTION IF EXISTS apply_change_request(UUID, UUID);

CREATE FUNCTION apply_change_request(
  p_order_id UUID,
  p_change_request_id UUID,
  p_approved_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_order RECORD;
  v_item RECORD;
  v_order_item RECORD;
  v_price DECIMAL(10,2);
  v_cutoff_state TEXT;
  v_order_state_rank INTEGER;
  v_cutoff_rank INTEGER;
  v_state_ranks CONSTANT TEXT[] := ARRAY[
    'draft', 'confirmed', 'scheduled', 'picking', 'packed', 'fulfilled'
  ];
BEGIN
  IF NOT user_has_permission('orders:write') THEN
    RAISE EXCEPTION 'Insufficient permission to approve order changes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approved_by IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Approval reviewer must match the authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read only the parent id first, then lock the order before the request. This
  -- is the same parent-first lock order used by other aggregate commands.
  SELECT order_id
  INTO v_request
  FROM order_change_requests
  WHERE id = p_change_request_id;

  IF NOT FOUND OR v_request.order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'Change request not found for this order'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT
    o.id,
    o.customer_id,
    o.status,
    COALESCE(sc.change_request_cutoff_state, 'confirmed') AS cutoff_state
  INTO v_order
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN sales_channels sc ON sc.id = c.sales_channel_id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT *
  INTO v_request
  FROM order_change_requests
  WHERE id = p_change_request_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found for this order'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- A successful retry is a no-op. Other terminal states are conflicts.
  IF v_request.status = 'approved' THEN
    RETURN;
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Change request is no longer pending'
      USING ERRCODE = 'serialization_failure';
  END IF;

  v_cutoff_state := v_order.cutoff_state;
  v_order_state_rank := array_position(v_state_ranks, v_order.status);
  v_cutoff_rank := array_position(v_state_ranks, v_cutoff_state);

  -- Changes are allowed up to and including the cutoff state; only orders that
  -- have advanced strictly past it are locked. With the default cutoff
  -- 'confirmed', a confirmed order is still editable and a scheduled/later one
  -- is not.
  IF v_order_state_rank IS NULL
     OR v_cutoff_rank IS NULL
     OR v_order_state_rank > v_cutoff_rank THEN
    RAISE EXCEPTION 'Order has passed the change request cutoff state (%)',
      v_cutoff_state
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF order_change_has_fulfillment_artifacts(p_order_id) THEN
    RAISE EXCEPTION 'Cancel active allocations or pick lists before approving this change request'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM order_change_request_items
    WHERE change_request_id = p_change_request_id
  ) THEN
    RAISE EXCEPTION 'Change request has no item changes'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_item IN
    SELECT *
    FROM order_change_request_items
    WHERE change_request_id = p_change_request_id
    ORDER BY id
  LOOP
    CASE v_item.change_type
      WHEN 'add' THEN
        IF v_item.order_item_id IS NOT NULL
           OR v_item.brand_id IS NULL
           OR v_item.selling_format_id IS NULL
           OR v_item.quantity IS NULL
           OR v_item.quantity <= 0 THEN
          RAISE EXCEPTION 'Invalid add change-request item %', v_item.id
            USING ERRCODE = 'check_violation';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM selling_formats
          WHERE id = v_item.selling_format_id
            AND is_active
        ) THEN
          RAISE EXCEPTION 'Selling format is missing or inactive for item %', v_item.id
            USING ERRCODE = 'check_violation';
        END IF;

        SELECT price
        INTO v_price
        FROM get_price_for_customer(
          v_order.customer_id,
          v_item.selling_format_id,
          v_item.brand_id
        );

        -- get_price_for_customer returns no row when no tier price resolves.
        -- unit_price is nullable, so without this guard the approval would
        -- silently insert a price-less line and corrupt the order total.
        IF v_price IS NULL THEN
          RAISE EXCEPTION
            'No active price for selling format % (brand %); configure pricing before approving change-request item %',
            v_item.selling_format_id, v_item.brand_id, v_item.id
            USING ERRCODE = 'check_violation';
        END IF;

        INSERT INTO order_items (
          order_id,
          brand_id,
          selling_format_id,
          quantity,
          unit_price
        ) VALUES (
          p_order_id,
          v_item.brand_id,
          v_item.selling_format_id,
          v_item.quantity,
          v_price
        );

      WHEN 'modify', 'remove' THEN
        IF v_item.order_item_id IS NULL
           OR v_item.original_quantity IS NULL
           OR (v_item.change_type = 'modify'
               AND (v_item.quantity IS NULL OR v_item.quantity <= 0)) THEN
          RAISE EXCEPTION 'Invalid % change-request item %',
            v_item.change_type, v_item.id
            USING ERRCODE = 'check_violation';
        END IF;

        SELECT id, brand_id, selling_format_id, quantity
        INTO v_order_item
        FROM order_items
        WHERE id = v_item.order_item_id
          AND order_id = p_order_id
        FOR UPDATE;

        IF NOT FOUND
           OR v_order_item.quantity IS DISTINCT FROM v_item.original_quantity
           OR v_order_item.brand_id IS DISTINCT FROM v_item.brand_id
           OR v_order_item.selling_format_id IS DISTINCT FROM v_item.selling_format_id THEN
          RAISE EXCEPTION 'Order item changed after this request was submitted (%)',
            v_item.order_item_id
            USING ERRCODE = 'serialization_failure';
        END IF;

        IF v_item.change_type = 'modify' THEN
          UPDATE order_items
          SET quantity = v_item.quantity
          WHERE id = v_item.order_item_id
            AND order_id = p_order_id;
        ELSE
          DELETE FROM order_items
          WHERE id = v_item.order_item_id
            AND order_id = p_order_id;
        END IF;

      ELSE
        RAISE EXCEPTION 'Unsupported change type: %', v_item.change_type
          USING ERRCODE = 'check_violation';
    END CASE;

  END LOOP;

  UPDATE order_change_requests
  SET status = 'approved',
      reviewed_by = p_approved_by,
      reviewed_at = NOW()
  WHERE id = p_change_request_id
    AND order_id = p_order_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request was reviewed concurrently'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- One parent touch produces one version increment and one revision after all
  -- line changes succeed. A failure anywhere above rolls the aggregate back.
  UPDATE orders
  SET updated_at = NOW()
  WHERE id = p_order_id;
END;
$$;

COMMENT ON FUNCTION apply_change_request(UUID, UUID, UUID) IS
  'Atomically applies a pending order change request using selling_format_id. Validates route ownership, reviewer identity, cutoff, stale line snapshots, and absence of fulfillment artifacts before mutating order lines.';

REVOKE ALL ON FUNCTION apply_change_request(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_change_request(UUID, UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
