-- =============================================================================
-- Migration 00055: Landed Cost Calculation
-- =============================================================================
-- Adds a database function to calculate landed cost per unit on inventory lots
-- by allocating PO shipping cost across line items proportionally by value.
-- =============================================================================

-- =============================================================================
-- FUNCTION: calculate_landed_cost
-- =============================================================================
-- Allocates shipping cost from a PO across its line items by line value
-- (unit_price * quantity). Falls back to equal allocation if no prices exist.
-- Updates the landed_cost column on each inventory_lot linked via po_receives.
--
-- Formula per line item:
--   allocated_shipping = shipping_cost * (line_value / total_po_value)
--   landed_cost_per_unit = (unit_price + allocated_shipping / quantity)
--
-- If no unit_price on the line item, landed_cost = allocated_shipping / quantity

CREATE OR REPLACE FUNCTION calculate_landed_cost(p_po_id UUID)
RETURNS TABLE (
  lot_id UUID,
  line_item_id UUID,
  catalog_type TEXT,
  quantity DECIMAL,
  unit_price DECIMAL,
  allocated_shipping DECIMAL,
  landed_cost_per_unit DECIMAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shipping_cost DECIMAL(10,2);
  v_total_value DECIMAL;
  v_line_count INT;
BEGIN
  -- Get the PO shipping cost
  SELECT po.shipping_cost INTO v_shipping_cost
  FROM purchase_orders po
  WHERE po.id = p_po_id;

  -- If no shipping cost, just set landed_cost = unit_price on all lots
  IF v_shipping_cost IS NULL OR v_shipping_cost = 0 THEN
    -- Update lots to have landed_cost = unit_price from their line item
    UPDATE inventory_lots il
    SET landed_cost = pli.unit_price
    FROM po_receives pr
    JOIN po_line_items pli ON pli.id = pr.po_line_item_id
    WHERE il.po_receive_id = pr.id
      AND pli.po_id = p_po_id;

    -- Return the results
    RETURN QUERY
    SELECT
      il.id AS lot_id,
      pli.id AS line_item_id,
      pli.catalog_type,
      pli.quantity,
      pli.unit_price,
      0::DECIMAL AS allocated_shipping,
      COALESCE(pli.unit_price, 0::DECIMAL) AS landed_cost_per_unit
    FROM po_line_items pli
    LEFT JOIN po_receives pr ON pr.po_line_item_id = pli.id
    LEFT JOIN inventory_lots il ON il.po_receive_id = pr.id
    WHERE pli.po_id = p_po_id;
    RETURN;
  END IF;

  -- Calculate total value of all line items (for proportional allocation)
  SELECT COALESCE(SUM(pli.unit_price * pli.quantity), 0), COUNT(*)
  INTO v_total_value, v_line_count
  FROM po_line_items pli
  WHERE pli.po_id = p_po_id;

  -- Update each inventory lot with its landed cost
  IF v_total_value > 0 THEN
    -- Allocate shipping proportionally by line item value
    UPDATE inventory_lots il
    SET landed_cost = ROUND(
      COALESCE(pli.unit_price, 0)
      + (v_shipping_cost * (COALESCE(pli.unit_price, 0) * pli.quantity) / v_total_value) / pli.quantity,
      4
    )
    FROM po_receives pr
    JOIN po_line_items pli ON pli.id = pr.po_line_item_id
    WHERE il.po_receive_id = pr.id
      AND pli.po_id = p_po_id
      AND pli.quantity > 0;
  ELSE
    -- No prices available: allocate shipping equally across line items
    UPDATE inventory_lots il
    SET landed_cost = ROUND(
      COALESCE(pli.unit_price, 0)
      + (v_shipping_cost / v_line_count) / pli.quantity,
      4
    )
    FROM po_receives pr
    JOIN po_line_items pli ON pli.id = pr.po_line_item_id
    WHERE il.po_receive_id = pr.id
      AND pli.po_id = p_po_id
      AND pli.quantity > 0;
  END IF;

  -- Return the breakdown
  RETURN QUERY
  SELECT
    il.id AS lot_id,
    pli.id AS line_item_id,
    pli.catalog_type,
    pli.quantity,
    pli.unit_price,
    CASE
      WHEN v_total_value > 0 THEN
        ROUND(v_shipping_cost * (COALESCE(pli.unit_price, 0) * pli.quantity) / v_total_value, 4)
      ELSE
        ROUND(v_shipping_cost / v_line_count, 4)
    END AS allocated_shipping,
    COALESCE(il.landed_cost, 0::DECIMAL) AS landed_cost_per_unit
  FROM po_line_items pli
  LEFT JOIN po_receives pr ON pr.po_line_item_id = pli.id
  LEFT JOIN inventory_lots il ON il.po_receive_id = pr.id
  WHERE pli.po_id = p_po_id;
END;
$$;

COMMENT ON FUNCTION calculate_landed_cost(UUID) IS
  'Calculates and updates landed cost per unit on inventory lots by allocating PO shipping cost across line items proportionally by value.';

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES (
  'calculate_landed_cost',
  'Function that allocates PO shipping cost across line items and updates landed_cost on inventory_lots. Allocates by value (unit_price * quantity) or equally if no prices.',
  'purchasing',
  '["purchase_orders", "po_line_items", "po_receives", "inventory_lots"]'::jsonb
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships;
