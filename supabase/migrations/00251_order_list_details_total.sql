-- =============================================================================
-- 00251 — add total_amount to order_list_details view
-- =============================================================================
-- The orders list (/sales/orders) showed order #, customer, status and dates
-- but no monetary total. Orders have no stored total column — the value is the
-- sum of (quantity * unit_price) across order_items. This recreates the
-- order_list_details view (from 00185) with a computed total_amount so the
-- order entity can render a currency column without an extra per-row query.
--
-- unit_price is nullable on order_items; COALESCE treats missing prices as 0.
-- Types were hand-added to src/types/supabase.ts pending regeneration.
-- =============================================================================

CREATE OR REPLACE VIEW order_list_details
WITH (security_invoker = true)
AS
SELECT
  o.*,
  c.name AS customer_name,
  COALESCE(t.total_amount, 0) AS total_amount
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
  SELECT SUM(oi.quantity * COALESCE(oi.unit_price, 0)) AS total_amount
  FROM order_items oi
  WHERE oi.order_id = o.id
) t ON true;

COMMENT ON VIEW order_list_details IS
  'Orders with joined customer name and computed order total for list/kanban display. Read-only; writes go to the orders base table.';

-- Refresh PostgREST schema cache so the changed view is visible immediately.
NOTIFY pgrst, 'reload schema';
