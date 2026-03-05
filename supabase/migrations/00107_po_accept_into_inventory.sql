-- Migration: get_unaccepted_po_receives function
--
-- Returns all po_receives for a PO that don't yet have a linked inventory_lot.
-- Used by the "Accept into Inventory" dialog to show which received items
-- still need to be added to inventory tracking.

CREATE OR REPLACE FUNCTION get_unaccepted_po_receives(p_po_id UUID)
RETURNS TABLE (
  receive_id UUID,
  po_line_item_id UUID,
  catalog_type TEXT,
  catalog_id TEXT,
  quantity DECIMAL,
  unit TEXT,
  unit_price DECIMAL,
  lot_number TEXT,
  expiration_date DATE,
  received_date DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    pr.id AS receive_id,
    pr.po_line_item_id,
    pli.catalog_type,
    pli.catalog_id,
    pr.quantity,
    pli.unit,
    pli.unit_price,
    pr.lot_number,
    pr.expiration_date,
    pr.received_date
  FROM po_receives pr
  JOIN po_line_items pli ON pli.id = pr.po_line_item_id
  WHERE pli.po_id = p_po_id
    AND NOT EXISTS (
      SELECT 1 FROM inventory_lots il
      WHERE il.po_receive_id = pr.id
    );
$$;
