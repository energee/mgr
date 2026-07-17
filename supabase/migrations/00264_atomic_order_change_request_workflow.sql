-- Migration: Atomic order change-request submission and rejection
--
-- A change request is one aggregate: its parent row is invalid without at
-- least one child. Keep aggregate creation in one PostgreSQL statement and
-- serialize child writes with review so a reviewed request cannot gain items.

-- Portal users need the sales channel on their own customer record to enforce
-- the configured cutoff inside the invoker-rights submission function. This
-- also makes the existing portal cutoff query honor non-default channels.
DROP POLICY IF EXISTS customers_customer_select ON customers;
CREATE POLICY customers_customer_select ON customers
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT customer_id
      FROM customer_portal_users
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- SELECT ... FOR UPDATE evaluates UPDATE policies. Let customers lock their
-- own request so the child guard can serialize with staff review, while an
-- always-false WITH CHECK continues to prohibit every customer update.
DROP POLICY IF EXISTS change_requests_customer_lock
  ON order_change_requests;
CREATE POLICY change_requests_customer_lock ON order_change_requests
  FOR UPDATE TO authenticated
  USING (requested_by = (SELECT auth.uid()))
  WITH CHECK (false);

-- Same lock-only pattern on orders: submission takes the order row lock so the
-- cutoff check serializes with staff status transitions (mirrors
-- apply_change_request in 00261). WITH CHECK (false) keeps customers unable to
-- actually update the order.
DROP POLICY IF EXISTS orders_customer_lock ON orders;
CREATE POLICY orders_customer_lock ON orders
  FOR UPDATE TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id
      FROM customer_portal_users
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION guard_order_change_request_item_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status
  INTO v_status
  FROM order_change_requests
  WHERE id = NEW.change_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Reviewed change requests cannot be modified'
      USING ERRCODE = 'PT409';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_order_change_request_item_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION guard_order_change_request_item_write() TO authenticated;

DROP TRIGGER IF EXISTS trg_guard_order_change_request_item_write
  ON order_change_request_items;
CREATE TRIGGER trg_guard_order_change_request_item_write
  BEFORE INSERT OR UPDATE ON order_change_request_items
  FOR EACH ROW
  EXECUTE FUNCTION guard_order_change_request_item_write();

CREATE OR REPLACE FUNCTION submit_order_change_request(
  p_order_id UUID,
  p_notes TEXT,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_status TEXT;
  v_cutoff_state TEXT;
  v_order_rank INTEGER;
  v_cutoff_rank INTEGER;
  v_request_id UUID;
  v_item JSONB;
  v_change_type TEXT;
  v_order_item_id UUID;
  v_brand_id UUID;
  v_selling_format_id UUID;
  v_quantity INTEGER;
  v_original_quantity INTEGER;
  v_existing_item RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one change-request item is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    o.status,
    COALESCE(sc.change_request_cutoff_state, 'confirmed')
  INTO v_order_status, v_cutoff_state
  FROM orders o
  JOIN customer_portal_users cpu
    ON cpu.customer_id = o.customer_id
   AND cpu.user_id = v_user_id
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN sales_channels sc ON sc.id = c.sales_channel_id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or unavailable to this portal user'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT sort_order
  INTO v_order_rank
  FROM enum_values
  WHERE enum_type = 'order_status'
    AND value = v_order_status
    AND is_active = true;

  SELECT sort_order
  INTO v_cutoff_rank
  FROM enum_values
  WHERE enum_type = 'order_status'
    AND value = v_cutoff_state
    AND is_active = true;

  IF v_order_rank IS NULL OR v_cutoff_rank IS NULL THEN
    RAISE EXCEPTION 'Order or cutoff state is not configured'
      USING ERRCODE = '22023';
  END IF;

  IF v_order_rank >= v_cutoff_rank THEN
    RAISE EXCEPTION 'Order has reached the change-request cutoff state (%)',
      v_cutoff_state
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO order_change_requests (order_id, requested_by, notes)
  VALUES (p_order_id, v_user_id, NULLIF(BTRIM(p_notes), ''))
  RETURNING id INTO v_request_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Every change-request item must be an object'
        USING ERRCODE = '22023';
    END IF;

    v_change_type := v_item ->> 'change_type';
    IF v_change_type NOT IN ('add', 'modify', 'remove') THEN
      RAISE EXCEPTION 'Invalid change-request item type: %',
        COALESCE(v_change_type, '<null>')
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_order_item_id := NULLIF(v_item ->> 'order_item_id', '')::UUID;
      v_quantity := NULLIF(v_item ->> 'quantity', '')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid order-item identifier or quantity'
          USING ERRCODE = '22023';
    END;

    IF v_change_type IN ('modify', 'remove') THEN
      IF v_order_item_id IS NULL THEN
        RAISE EXCEPTION '% changes require an order item', v_change_type
          USING ERRCODE = '22023';
      END IF;

      SELECT brand_id, selling_format_id, quantity
      INTO v_existing_item
      FROM order_items
      WHERE id = v_order_item_id
        AND order_id = p_order_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Order item not found on this order'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_change_type = 'modify' AND (v_quantity IS NULL OR v_quantity <= 0) THEN
        RAISE EXCEPTION 'Modified quantity must be positive'
          USING ERRCODE = '22023';
      END IF;

      v_brand_id := v_existing_item.brand_id;
      v_selling_format_id := v_existing_item.selling_format_id;
      v_original_quantity := v_existing_item.quantity;
      IF v_change_type = 'remove' THEN
        v_quantity := 0;
      END IF;
    ELSE
      IF v_order_item_id IS NOT NULL THEN
        RAISE EXCEPTION 'Added items cannot reference an existing order item'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_brand_id := NULLIF(v_item ->> 'brand_id', '')::UUID;
        v_selling_format_id :=
          NULLIF(v_item ->> 'selling_format_id', '')::UUID;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'Invalid brand or selling-format identifier'
            USING ERRCODE = '22023';
      END;

      IF v_brand_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Added items require a brand and positive quantity'
          USING ERRCODE = '22023';
      END IF;
      v_original_quantity := NULL;
    END IF;

    INSERT INTO order_change_request_items (
      change_request_id,
      change_type,
      order_item_id,
      brand_id,
      selling_format_id,
      quantity,
      original_quantity
    ) VALUES (
      v_request_id,
      v_change_type,
      v_order_item_id,
      v_brand_id,
      v_selling_format_id,
      v_quantity,
      v_original_quantity
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION submit_order_change_request(UUID, TEXT, JSONB) IS
  'Atomically creates a customer-owned pending order change request and all of its validated items.';

REVOKE ALL ON FUNCTION submit_order_change_request(UUID, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_order_change_request(UUID, TEXT, JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION reject_order_change_request(
  p_order_id UUID,
  p_change_request_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_reviewer_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
  IF v_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT status
  INTO v_status
  FROM order_change_requests
  WHERE id = p_change_request_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found for this order'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Change request is not pending'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE order_change_requests
  SET status = 'rejected',
      reviewed_by = v_reviewer_id,
      reviewed_at = now(),
      rejection_reason = v_reason
  WHERE id = p_change_request_id
    AND order_id = p_order_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request is not pending'
      USING ERRCODE = 'PT409';
  END IF;

  RETURN p_change_request_id;
END;
$$;

COMMENT ON FUNCTION reject_order_change_request(UUID, UUID, TEXT) IS
  'Rejects one pending change request scoped to its order and returns a conflict for stale state.';

REVOKE ALL ON FUNCTION reject_order_change_request(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_order_change_request(UUID, UUID, TEXT)
  TO authenticated;
