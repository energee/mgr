-- Add item_name to inventory_lots_with_quantities view
-- so the Lots list page shows human-readable item names instead of raw UUIDs.

DROP VIEW IF EXISTS inventory_lots_with_quantities CASCADE;

CREATE VIEW inventory_lots_with_quantities
WITH (security_invoker = true)
AS
SELECT
  il.*,
  ii.name as item_name,
  il.quantity as received_quantity,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  il.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as remaining_quantity
FROM inventory_lots il
JOIN inventory_items ii ON ii.id = il.inventory_item_id
LEFT JOIN allocations a
  ON a.source_type = 'inventory_lot' AND a.source_id = il.id
GROUP BY il.id, ii.name;

COMMENT ON VIEW inventory_lots_with_quantities IS 'Inventory lots with calculated available quantities and item names';
