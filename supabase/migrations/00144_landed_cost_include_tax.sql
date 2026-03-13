-- =============================================================================
-- Migration 00143: Include Tax in Landed Cost Calculation
-- =============================================================================
-- Updates the calculate_landed_cost function to include PO tax in the
-- landed cost per unit, alongside shipping cost. Tax is allocated
-- proportionally by line item value, the same way shipping is.
--
-- Formula per line item (when both shipping and tax exist):
--   total_overhead = shipping_cost + tax
--   allocated_overhead = total_overhead * (line_value / total_po_value)
--   landed_cost_per_unit = unit_price + (allocated_overhead / quantity)
-- =============================================================================

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
  v_tax DECIMAL(10,2);
  v_total_overhead DECIMAL(10,2);
  v_total_value DECIMAL;
  v_line_count INT;
BEGIN
  -- Get the PO shipping cost and tax
  SELECT COALESCE(po.shipping_cost, 0), COALESCE(po.tax, 0)
  INTO v_shipping_cost, v_tax
  FROM purchase_orders po
  WHERE po.id = p_po_id;

  -- Total overhead = shipping + tax
  v_total_overhead := v_shipping_cost + v_tax;

  -- If no overhead costs, just set landed_cost = unit_price on all lots
  IF v_total_overhead = 0 THEN
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

  -- Update each inventory lot with its landed cost (shipping + tax allocated)
  IF v_total_value > 0 THEN
    -- Allocate overhead proportionally by line item value
    UPDATE inventory_lots il
    SET landed_cost = ROUND(
      COALESCE(pli.unit_price, 0)
      + (v_total_overhead * (COALESCE(pli.unit_price, 0) * pli.quantity) / v_total_value) / pli.quantity,
      4
    )
    FROM po_receives pr
    JOIN po_line_items pli ON pli.id = pr.po_line_item_id
    WHERE il.po_receive_id = pr.id
      AND pli.po_id = p_po_id
      AND pli.quantity > 0;
  ELSE
    -- No prices available: allocate overhead equally across line items
    UPDATE inventory_lots il
    SET landed_cost = ROUND(
      COALESCE(pli.unit_price, 0)
      + (v_total_overhead / v_line_count) / pli.quantity,
      4
    )
    FROM po_receives pr
    JOIN po_line_items pli ON pli.id = pr.po_line_item_id
    WHERE il.po_receive_id = pr.id
      AND pli.po_id = p_po_id
      AND pli.quantity > 0;
  END IF;

  -- Return the breakdown (allocated_shipping now includes tax share)
  RETURN QUERY
  SELECT
    il.id AS lot_id,
    pli.id AS line_item_id,
    pli.catalog_type,
    pli.quantity,
    pli.unit_price,
    CASE
      WHEN v_total_value > 0 THEN
        ROUND(v_total_overhead * (COALESCE(pli.unit_price, 0) * pli.quantity) / v_total_value, 4)
      ELSE
        ROUND(v_total_overhead / v_line_count, 4)
    END AS allocated_shipping,
    COALESCE(il.landed_cost, 0::DECIMAL) AS landed_cost_per_unit
  FROM po_line_items pli
  LEFT JOIN po_receives pr ON pr.po_line_item_id = pli.id
  LEFT JOIN inventory_lots il ON il.po_receive_id = pr.id
  WHERE pli.po_id = p_po_id;
END;
$$;

COMMENT ON FUNCTION calculate_landed_cost(UUID) IS
  'Calculates and updates landed cost per unit on inventory lots by allocating PO shipping cost and tax across line items proportionally by value.';
