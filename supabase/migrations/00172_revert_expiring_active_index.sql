-- =============================================================================
-- Revert 00171_audit_perf_indexes.sql
-- =============================================================================
-- 00171 added a partial index `idx_inventory_lots_expiring_active` with the
-- predicate `WHERE quantity > 0 AND expiration_date IS NOT NULL`, on the
-- premise that `inventory_lots.quantity` is decremented as inventory is
-- consumed and that most long-lived rows have `quantity = 0`. That premise
-- is wrong.
--
-- Reality: `inventory_lots.quantity` is the *received* quantity. It is set
-- at insert and is never decremented by consumption — only the landed-cost
-- migrations (00056 / 00144 / 00146) touch this table post-insert, and only
-- to set `landed_cost`. Depletion is tracked through the `allocations` table.
-- The consumption-aware quantity is exposed by the view
-- `inventory_lots_with_quantities.remaining_quantity` (00014).
--
-- Therefore the predicate `quantity > 0` is true for ~100% of rows, and the
-- new index ends up functionally identical to the existing
-- `idx_inventory_lots_expiration` (also a partial index, on
-- `expiration_date IS NOT NULL`). It costs write amplification with no read
-- benefit, so drop it.
--
-- The dashboard query that motivated 00171 was also silently wrong (it
-- filtered the base table on `quantity > 0`, treating it as a remaining-
-- quantity filter). It now routes through `inventoryService.getExpiringLots`
-- which already queries the view on `remaining_quantity > 0`. See
-- src/app/(app)/dashboard/inventory/page.tsx and src/app/api/chat/tools.ts.

DROP INDEX IF EXISTS idx_inventory_lots_expiring_active;

COMMENT ON COLUMN inventory_lots.quantity IS
  'Received quantity, set at insert. Never decremented for consumption — only the landed-cost migrations may overwrite landed_cost on this row. '
  'For remaining-after-allocations, query the view inventory_lots_with_quantities.remaining_quantity.';
