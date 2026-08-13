-- Prevent portal customers from choosing the shared sales-order sequence.
--
-- 00290 gave portal customers a narrow INSERT policy and a server-generated
-- order_number DEFAULT. RLS evaluates the completed row, however, so a caller
-- could still explicitly supply any unique order number. generate_next_number()
-- derives the next suffix by casting the current maximum to INTEGER; inserting
-- ORD-YYYY-2147483647 would therefore make every later generated order number
-- overflow.
--
-- The policy now accepts only the number the advisory-locked generator would
-- produce for the current shared series. When the caller omits order_number,
-- the DEFAULT and this check run in the same transaction under the same
-- transaction-scoped advisory lock and resolve to the same value. Supplying
-- that exact value explicitly is harmless; supplying a gap, collision, or
-- overflow sentinel is rejected. Staff retain their separate orders_write
-- policy and may continue entering explicit order numbers.

DROP POLICY IF EXISTS orders_customer_insert ON public.orders;
CREATE POLICY orders_customer_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT customer_id FROM public.customer_portal_users
      WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    )
    AND status = 'draft'
    AND scheduled_date IS NULL
    AND fulfilled_date IS NULL
    AND delivery_id IS NULL
    AND COALESCE(is_export, FALSE) = FALSE
    AND version = 1
    -- Portal callers cannot advance or poison the brewery-wide ORD sequence.
    AND order_number = public.generate_next_order_number()
  );

COMMENT ON POLICY orders_customer_insert ON public.orders IS
  'Portal customers may create draft orders for their own customer only. The order number must match the next server-generated shared-series value; pricing, scheduling and confirmation stay staff-owned (00290, hardened by 00291).';
