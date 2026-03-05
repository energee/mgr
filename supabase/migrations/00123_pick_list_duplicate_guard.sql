-- =============================================================================
-- Migration: 00099_pick_list_duplicate_guard
--
-- Adds a duplicate guard to generate_pick_list() so that only one active
-- (non-cancelled) pick list can exist per order. Prevents accidental
-- double-generation from the UI.
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_pick_list(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pick_list_id UUID;
  v_order_item RECORD;
  v_fg RECORD;
  v_remaining NUMERIC;
  v_alloc_qty NUMERIC;
  v_sort INTEGER := 0;
BEGIN
  -- Guard: prevent duplicate active pick lists for the same order
  IF EXISTS (SELECT 1 FROM pick_lists WHERE order_id = p_order_id AND status NOT IN ('cancelled')) THEN
    RAISE EXCEPTION 'Active pick list already exists for this order';
  END IF;

  -- Create the pick list
  INSERT INTO pick_lists (order_id, status)
  VALUES (p_order_id, 'draft')
  RETURNING id INTO v_pick_list_id;

  -- For each order item, find available finished goods using FIFO
  FOR v_order_item IN
    SELECT
      oi.id AS order_item_id,
      oi.quantity,
      oi.finished_good_id AS specific_fg_id,
      fg.brand_id,
      fg.package_type_id
    FROM order_items oi
    LEFT JOIN finished_goods fg ON fg.id = oi.finished_good_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.created_at
  LOOP
    v_remaining := v_order_item.quantity;

    -- Find available finished goods (FIFO by production_date)
    -- Location derived from bin_inventory -> bins -> locations
    -- Subquery deduplicates FGs that appear in multiple bins (picks first bin)
    FOR v_fg IN
      SELECT
        fg_loc.finished_good_id,
        fg_loc.available_quantity,
        fg_loc.production_date,
        fg_loc.location_id
      FROM (
        SELECT DISTINCT ON (fga.id)
          fga.id AS finished_good_id,
          fga.available_quantity,
          fga.production_date,
          l.id AS location_id
        FROM finished_goods_with_availability fga
        LEFT JOIN bin_inventory bi ON bi.finished_good_id = fga.id
        LEFT JOIN bins b ON b.id = bi.bin_id
        LEFT JOIN locations l ON l.id = b.location_id
        WHERE fga.available_quantity > 0
          AND (
            fga.id = v_order_item.specific_fg_id
            OR (
              v_order_item.specific_fg_id IS NULL
              AND fga.brand_id = v_order_item.brand_id
              AND fga.package_type_id = v_order_item.package_type_id
            )
          )
        ORDER BY fga.id, bi.quantity DESC NULLS LAST
      ) fg_loc
      ORDER BY fg_loc.production_date ASC NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_alloc_qty := LEAST(v_remaining, v_fg.available_quantity);
      v_sort := v_sort + 1;

      INSERT INTO pick_list_items (
        pick_list_id,
        order_item_id,
        finished_good_id,
        location_id,
        quantity_requested,
        sort_order
      ) VALUES (
        v_pick_list_id,
        v_order_item.order_item_id,
        v_fg.finished_good_id,
        v_fg.location_id,
        v_alloc_qty,
        v_sort
      );

      v_remaining := v_remaining - v_alloc_qty;
    END LOOP;
  END LOOP;

  RETURN v_pick_list_id;
END;
$$;

COMMENT ON FUNCTION generate_pick_list IS 'Creates a pick list for an order using FIFO allocation from available finished goods. Guards against duplicate active pick lists.';
