-- =============================================================================
-- 00185 — order_list_details view (orders list with customer name)
-- =============================================================================
-- The orders index/kanban only showed order #, status and dates — never the
-- customer — and global search was order-number only because the base orders
-- table stores just customer_id (UUID), making customer-name search
-- structurally impossible against the base table.
--
-- This view joins customers onto orders (mirroring pick_list_details from
-- migration 00057) so the order entity can read from it (viewTable) for a
-- sortable Customer column, server-side ilike search on customer_name, and
-- customer name on kanban cards. Writes are unaffected: the entity framework
-- always writes to the base orders table.
--
-- Types were hand-added to src/types/supabase.ts pending regeneration.
-- =============================================================================

CREATE VIEW order_list_details
WITH (security_invoker = true)
AS
SELECT
  o.*,
  c.name AS customer_name
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id;

COMMENT ON VIEW order_list_details IS
  'Orders with joined customer name for list/kanban display and customer-name search. Read-only; writes go to the orders base table.';

-- Refresh PostgREST schema cache so the new view is visible immediately.
NOTIFY pgrst, 'reload schema';
