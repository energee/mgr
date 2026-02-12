-- =============================================================================
-- Migration: apply_change_request() — atomic approval function
-- =============================================================================

CREATE OR REPLACE FUNCTION apply_change_request(
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
  v_cutoff_state TEXT;
  v_order_state_rank INTEGER;
  v_cutoff_rank INTEGER;
  v_item RECORD;
  v_format_id UUID;
  v_price DECIMAL(10,2);
  -- Order state ranking for cutoff comparison
  v_state_ranks CONSTANT TEXT[] := ARRAY['draft','confirmed','scheduled','picking','packed','fulfilled'];
BEGIN
  -- 1. Validate the change request
  SELECT * INTO v_request
  FROM order_change_requests
  WHERE id = p_change_request_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found or not pending';
  END IF;

  -- 2. Get the order and its customer's sales channel cutoff
  SELECT o.*, c.sales_channel_id INTO v_order
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = v_request.order_id;

  SELECT COALESCE(sc.change_request_cutoff_state, 'confirmed') INTO v_cutoff_state
  FROM sales_channels sc
  WHERE sc.id = v_order.sales_channel_id;

  -- Default cutoff if no sales channel
  IF v_cutoff_state IS NULL THEN
    v_cutoff_state := 'confirmed';
  END IF;

  -- 3. Check if order has passed the cutoff state
  v_order_state_rank := array_position(v_state_ranks, v_order.status);
  v_cutoff_rank := array_position(v_state_ranks, v_cutoff_state);

  IF v_order_state_rank IS NOT NULL AND v_cutoff_rank IS NOT NULL
     AND v_order_state_rank >= v_cutoff_rank THEN
    RAISE EXCEPTION 'Order has passed the change request cutoff state (%)' , v_cutoff_state;
  END IF;

  -- 4. Apply each item change
  FOR v_item IN
    SELECT * FROM order_change_request_items
    WHERE change_request_id = p_change_request_id
  LOOP
    CASE v_item.change_type
      WHEN 'modify' THEN
        UPDATE order_items
        SET quantity = v_item.quantity
        WHERE id = v_item.order_item_id;

      WHEN 'remove' THEN
        -- Cancel planned allocations for this item
        UPDATE allocations
        SET status = 'cancelled'
        WHERE destination_type = 'order'
          AND destination_id = v_request.order_id
          AND status = 'planned'
          AND source_id IN (
            SELECT fg.id FROM finished_goods fg
            JOIN order_items oi ON oi.id = v_item.order_item_id
            WHERE fg.brand_id = oi.brand_id
              AND (fg.package_type_id = oi.package_type_id OR fg.keg_type_id = oi.keg_type_id)
          );

        DELETE FROM order_items WHERE id = v_item.order_item_id;

      WHEN 'add' THEN
        -- Resolve format_id for pricing (use package_type_id or keg_type_id)
        v_format_id := COALESCE(v_item.package_type_id, v_item.keg_type_id);

        -- Get price from tier
        SELECT price INTO v_price
        FROM get_price_for_customer(
          v_order.customer_id,
          v_format_id,
          v_item.brand_id
        );

        INSERT INTO order_items (
          order_id, brand_id, package_type_id, keg_type_id, quantity, unit_price
        ) VALUES (
          v_request.order_id,
          v_item.brand_id,
          v_item.package_type_id,
          v_item.keg_type_id,
          v_item.quantity,
          v_price
        );
    END CASE;
  END LOOP;

  -- 5. Mark the request as approved
  UPDATE order_change_requests
  SET status = 'approved',
      reviewed_by = p_approved_by,
      reviewed_at = now()
  WHERE id = p_change_request_id;

  -- 6. Touch the order so entity_revisions trigger fires
  UPDATE orders
  SET updated_at = now()
  WHERE id = v_request.order_id;
END;
$$;

COMMENT ON FUNCTION apply_change_request(UUID, UUID) IS
  'Atomically applies an approved change request to an order. Validates cutoff state, applies item changes, resolves pricing, and cancels stale allocations.';
