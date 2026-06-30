-- =============================================================================
-- Migration: 00182_fix_generate_pick_list
--
-- UX audit finding 29: the "Generate Pick List" quick action
-- (order-quick-links.tsx -> rpc('generate_pick_list')) always errors because
-- the 00108 function body matches on columns dropped by the selling-formats
-- refactor:
--   - `oi.finished_good_id` never existed on order_items in any migration,
--     so the order-item cursor fails at runtime with 42703.
--   - `fga.package_type_id` no longer exists on finished_goods_with_availability
--     (the view exposes selling_format_id since the packaging unification).
--
-- This is a regression: the (since renumbered/squashed) drop-old-packaging
-- migration had already rebuilt the function for selling_format_id, but 00108
-- re-created it from the stale package_type_id body while adding allocation
-- inserts. Same class of fix as 00145 ("uses selling_format_id, not stale
-- package_type_id") and 00168.
--
-- Order entry writes brand_id + selling_format_id on order_items
-- (order-items-editor.tsx), so the cursor now reads those columns directly:
--   - drop `oi.finished_good_id AS specific_fg_id` and the
--     LEFT JOIN finished_goods entirely
--   - skip TBD line items (brand_id or selling_format_id IS NULL)
--   - match `fga.brand_id = oi.brand_id AND
--            fga.selling_format_id = oi.selling_format_id`
--
-- Preserved from 00108: duplicate-active-pick-list guard, FIFO ordering by
-- production_date, bin-derived location (dedup picks the fullest bin), and
-- allocation inserts linked via pick_list_item_id.
--
-- No type changes: the RPC signature (Args: p_order_id, Returns: uuid) is
-- unchanged and already present in src/types/supabase.ts.
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

  -- For each order item, find available finished goods using FIFO.
  -- Line items are matched by brand + selling format (the columns order entry
  -- actually writes). TBD lines (no brand or format yet) are skipped — they
  -- cannot be matched to inventory and remain for manual allocation.
  FOR v_order_item IN
    SELECT
      oi.id AS order_item_id,
      oi.quantity,
      oi.brand_id,
      oi.selling_format_id
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.brand_id IS NOT NULL
      AND oi.selling_format_id IS NOT NULL
    ORDER BY oi.created_at
  LOOP
    v_remaining := v_order_item.quantity;

    -- Find available finished goods (FIFO by production_date)
    -- Location derived from bin_inventory -> bins -> locations
    -- Subquery deduplicates FGs that appear in multiple bins (picks fullest bin)
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
          AND fga.brand_id = v_order_item.brand_id
          AND fga.selling_format_id = v_order_item.selling_format_id
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

COMMENT ON FUNCTION generate_pick_list IS 'Creates a pick list for an order using FIFO allocation from available finished goods, matching line items by brand_id + selling_format_id (TBD lines without both are skipped). Guards against duplicate active pick lists. Creates allocation records to reserve inventory.';

-- Make the corrected function visible to PostgREST immediately
NOTIFY pgrst, 'reload schema';
