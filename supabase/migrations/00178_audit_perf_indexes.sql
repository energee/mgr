-- Audit finding F-143: dashboard "expiring lots" query filters
--   expiration_date IS NOT NULL AND expiration_date <= NOW() + INTERVAL '90 days' AND quantity > 0
-- order by expiration_date asc.
--
-- Existing indexes on inventory_lots:
--   idx_inventory_lots_item            (inventory_item_id)
--   idx_inventory_lots_expiration      (expiration_date) WHERE expiration_date IS NOT NULL
--   idx_inventory_lots_item_expiration (inventory_item_id, expiration_date)
--
-- None of those are selective for the dashboard predicate because they ignore
-- the quantity > 0 condition. Most rows in a long-lived brewery have quantity = 0
-- (depleted lots), so a partial index on the active set is dramatically smaller
-- and lets the planner skip the depleted majority entirely.

CREATE INDEX IF NOT EXISTS idx_inventory_lots_expiring_active
  ON inventory_lots (expiration_date)
  WHERE quantity > 0 AND expiration_date IS NOT NULL;

COMMENT ON INDEX idx_inventory_lots_expiring_active IS
  'Partial index supporting the dashboard "expiring lots" query (F-143). '
  'Filters to active lots only (quantity > 0) so depleted lots do not bloat the index.';
