-- Migration: Recalculate order shipping materials with every line mutation
--
-- The staff editor previously committed order_items first, then rebuilt
-- order_materials through a five-query browser hook. Change-request approval
-- runs entirely in PostgreSQL and bypassed that hook. Put the derivation on
-- the order-item write boundary so both paths commit or roll back together.

CREATE OR REPLACE FUNCTION recalculate_order_materials(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_total_pallets NUMERIC := 0;
  v_inventory_item_id UUID;
  v_resolved_item_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- This is also the serialization boundary for direct staff writes. The
  -- BEFORE trigger takes the same lock before changing a child row, while the
  -- approval RPC already locks the order before applying its item changes.
  SELECT customer_id
  INTO v_customer_id
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(item_pallets), 0)
  INTO v_total_pallets
  FROM (
    SELECT CEIL(
      oi.quantity::NUMERIC /
      NULLIF(
        CASE
          WHEN cpc.layers IS NOT NULL
               AND sf.units_per_layer IS NOT NULL
            THEN cpc.layers * sf.units_per_layer
          ELSE sf.pallet_quantity
        END,
        0
      )
    ) AS item_pallets
    FROM order_items oi
    JOIN selling_formats sf ON sf.id = oi.selling_format_id
    LEFT JOIN customer_pallet_configs cpc
      ON cpc.customer_id = v_customer_id
     AND cpc.selling_format_id = oi.selling_format_id
    WHERE oi.order_id = p_order_id
  ) pallet_counts
  WHERE item_pallets IS NOT NULL;

  -- Resolve one material per role. Customer rows override brewery defaults;
  -- roles that exist only at either level remain included.
  FOR v_inventory_item_id IN
    WITH customer_materials AS (
      SELECT material_role, inventory_item_id
      FROM customer_shipping_materials
      WHERE customer_id = v_customer_id
    )
    SELECT DISTINCT COALESCE(
      customer_materials.inventory_item_id,
      brewery_shipping_defaults.inventory_item_id
    )
    FROM brewery_shipping_defaults
    FULL OUTER JOIN customer_materials USING (material_role)
    WHERE COALESCE(
      customer_materials.inventory_item_id,
      brewery_shipping_defaults.inventory_item_id
    ) IS NOT NULL
  LOOP
    v_resolved_item_ids := array_append(
      v_resolved_item_ids,
      v_inventory_item_id
    );

    INSERT INTO order_materials (
      order_id,
      inventory_item_id,
      estimated_qty
    ) VALUES (
      p_order_id,
      v_inventory_item_id,
      v_total_pallets
    )
    ON CONFLICT (order_id, inventory_item_id) DO UPDATE
    SET estimated_qty = EXCLUDED.estimated_qty
    WHERE order_materials.estimated_qty IS DISTINCT FROM EXCLUDED.estimated_qty;
  END LOOP;

  -- order_materials is auto-generated. Remove rows whose configured material
  -- disappeared — unless staff manually recorded an actual_qty on them: that
  -- is an operational fact about what was really used, and a config change
  -- must not silently destroy it. Such rows keep their last estimate.
  DELETE FROM order_materials
  WHERE order_id = p_order_id
    AND NOT (inventory_item_id = ANY(v_resolved_item_ids))
    AND actual_qty IS NULL;
END;
$$;

COMMENT ON FUNCTION recalculate_order_materials(UUID) IS
  'Rebuilds estimated order shipping-material quantities from current line items, customer pallet overrides, and customer/brewery material defaults. Rows with a manual actual_qty are never deleted, even when their material falls out of the configured set.';

REVOKE ALL ON FUNCTION recalculate_order_materials(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION recalculate_order_materials(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION lock_order_for_material_recalculation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_ids UUID[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id
     AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
     AND OLD.selling_format_id IS NOT DISTINCT FROM NEW.selling_format_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_order_ids := ARRAY[NEW.order_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_order_ids := ARRAY[OLD.order_id];
  ELSE
    v_order_ids := ARRAY[OLD.order_id, NEW.order_id];
  END IF;

  -- Canonical ordering prevents two cross-order moves from deadlocking.
  PERFORM id
  FROM orders
  WHERE id = ANY(v_order_ids)
  ORDER BY id
  FOR UPDATE;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION lock_order_for_material_recalculation()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION recalculate_order_materials_after_item_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id
     AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
     AND OLD.selling_format_id IS NOT DISTINCT FROM NEW.selling_format_id THEN
    RETURN NEW;
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT order_id
    FROM unnest(
      CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.order_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.order_id]
        ELSE ARRAY[OLD.order_id, NEW.order_id]
      END
    ) AS affected(order_id)
    WHERE order_id IS NOT NULL
    ORDER BY order_id
  LOOP
    -- Cascading order deletion removes child rows after the parent is gone.
    IF EXISTS (SELECT 1 FROM orders WHERE id = v_order_id) THEN
      PERFORM recalculate_order_materials(v_order_id);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION recalculate_order_materials_after_item_write()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_items_lock_material_recalculation
  ON order_items;
CREATE TRIGGER trg_order_items_lock_material_recalculation
  BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION lock_order_for_material_recalculation();

DROP TRIGGER IF EXISTS trg_order_items_recalculate_materials
  ON order_items;
CREATE TRIGGER trg_order_items_recalculate_materials
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_order_materials_after_item_write();
