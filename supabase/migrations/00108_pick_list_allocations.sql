-- =============================================================================
-- Migration: 00108_pick_list_allocations
--
-- Creates allocation records when pick lists are generated to reserve finished
-- goods inventory. Also adds a trigger to cancel those allocations when a pick
-- list is cancelled.
--
-- Three parts:
--   1. Add pick_list_item_id column to allocations table
--   2. Update generate_pick_list to create allocation records alongside items
--   3. Trigger to cancel allocations when a pick list is cancelled
-- =============================================================================

-- =============================================================================
-- 1. Add pick_list_item_id to allocations table
-- =============================================================================

ALTER TABLE allocations
  ADD COLUMN IF NOT EXISTS pick_list_item_id UUID REFERENCES pick_list_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_allocations_pick_list_item
  ON allocations(pick_list_item_id)
  WHERE pick_list_item_id IS NOT NULL;

-- =============================================================================
-- 2. Update generate_pick_list to create allocation records
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_pick_list(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pick_list_id UUID;
  v_pick_list_item_id UUID;
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

      -- Insert the pick list item and capture its ID
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
      )
      RETURNING id INTO v_pick_list_item_id;

      -- Create a corresponding allocation to reserve the inventory
      INSERT INTO allocations (
        source_type, source_id,
        destination_type, destination_id,
        quantity, status, pick_list_item_id, notes
      ) VALUES (
        'finished_good', v_fg.finished_good_id,
        'order', p_order_id,
        v_alloc_qty,
        'planned',
        v_pick_list_item_id,
        'Reserved by pick list generation'
      );

      v_remaining := v_remaining - v_alloc_qty;
    END LOOP;
  END LOOP;

  RETURN v_pick_list_id;
END;
$$;

COMMENT ON FUNCTION generate_pick_list IS 'Creates a pick list for an order using FIFO allocation from available finished goods. Guards against duplicate active pick lists. Creates allocation records to reserve inventory.';

-- =============================================================================
-- 3. Trigger to cancel allocations when pick list is cancelled
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_pick_list_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE allocations
    SET status = 'cancelled'
    WHERE pick_list_item_id IN (
      SELECT id FROM pick_list_items WHERE pick_list_id = NEW.id
    )
    AND status IN ('planned', 'pending_approval');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cancel_pick_list_allocations IS 'Cancels planned/pending allocations tied to a pick list when the pick list is cancelled.';

CREATE TRIGGER trg_cancel_pick_list_allocations
  AFTER UPDATE ON pick_lists
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION cancel_pick_list_allocations();
