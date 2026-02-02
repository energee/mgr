-- =============================================================================
-- Migration: 00057_pick_list_tables
--
-- Formal pick list tables for warehouse operations.
-- Replaces client-side FIFO suggestion with proper database-backed workflow.
--
-- Tables:
--   pick_lists - Warehouse pick lists for order fulfillment
--   pick_list_items - Individual items on a pick list with FIFO allocation
--
-- Views:
--   pick_list_details - Pick list with order info and progress counts
-- =============================================================================

-- =============================================================================
-- 1. PICK LISTS TABLE
-- =============================================================================

CREATE TABLE pick_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'assigned', 'in_progress', 'completed', 'cancelled')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid()
);

-- =============================================================================
-- 2. PICK LIST ITEMS TABLE
-- =============================================================================

CREATE TABLE pick_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id UUID NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  finished_good_id UUID NOT NULL REFERENCES finished_goods(id),
  location_id UUID REFERENCES locations(id),
  quantity_requested NUMERIC(10,2) NOT NULL CHECK (quantity_requested > 0),
  quantity_picked NUMERIC(10,2) DEFAULT 0 CHECK (quantity_picked >= 0),
  picked_at TIMESTAMPTZ,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE pick_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pick_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pick lists"
  ON pick_lists FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert pick lists"
  ON pick_lists FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update pick lists"
  ON pick_lists FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete pick lists"
  ON pick_lists FOR DELETE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view pick list items"
  ON pick_list_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert pick list items"
  ON pick_list_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update pick list items"
  ON pick_list_items FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete pick list items"
  ON pick_list_items FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 4. SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('pick_lists', 'Warehouse pick lists for order fulfillment', 'sales',
    '[{"table": "orders", "type": "many-to-one", "column": "order_id"}]'::jsonb),
  ('pick_list_items', 'Individual items on a pick list with FIFO allocation', 'sales',
    '[{"table": "pick_lists", "type": "many-to-one", "column": "pick_list_id"},
      {"table": "order_items", "type": "many-to-one", "column": "order_item_id"},
      {"table": "finished_goods", "type": "many-to-one", "column": "finished_good_id"},
      {"table": "locations", "type": "many-to-one", "column": "location_id"}]'::jsonb);

-- =============================================================================
-- 5. PICK LIST DETAILS VIEW
-- =============================================================================

CREATE VIEW pick_list_details
WITH (security_invoker = true)
AS
SELECT
  pl.*,
  o.order_number,
  c.name AS customer_name,
  COUNT(pli.id) AS total_items,
  COUNT(pli.id) FILTER (WHERE pli.quantity_picked >= pli.quantity_requested) AS items_picked,
  up.display_name AS assigned_to_name
FROM pick_lists pl
JOIN orders o ON o.id = pl.order_id
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN pick_list_items pli ON pli.pick_list_id = pl.id
LEFT JOIN user_profiles up ON up.id = pl.assigned_to
GROUP BY pl.id, o.order_number, c.name, up.display_name;

-- =============================================================================
-- 6. INDEXES
-- =============================================================================

CREATE INDEX idx_pick_lists_order_id ON pick_lists(order_id);
CREATE INDEX idx_pick_lists_status ON pick_lists(status);
CREATE INDEX idx_pick_lists_assigned_to ON pick_lists(assigned_to);
CREATE INDEX idx_pick_list_items_pick_list_id ON pick_list_items(pick_list_id);
CREATE INDEX idx_pick_list_items_finished_good_id ON pick_list_items(finished_good_id);
CREATE INDEX idx_pick_list_items_order_item_id ON pick_list_items(order_item_id);

-- =============================================================================
-- 7. GENERATE PICK LIST FUNCTION (FIFO)
-- =============================================================================
-- Creates a pick list for an order, allocating finished goods using FIFO
-- (oldest production_date first).

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
    -- Location derived from bin_inventory → bins → locations
    FOR v_fg IN
      SELECT
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
      ORDER BY fga.production_date ASC NULLS LAST
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

COMMENT ON FUNCTION generate_pick_list IS 'Creates a pick list for an order using FIFO allocation from available finished goods.';
