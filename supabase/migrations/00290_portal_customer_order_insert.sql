-- Portal customers may place their own orders (Phase 4, node C1).
--
-- Until now the portal was read + lock only: a customer could read their own
-- orders (00276) and amend a *staff-created* one through
-- submit_order_change_request() (00264), but could not create one. This adds
-- the narrowest INSERT path that makes self-service ordering possible.
--
-- Shape decision: three were considered — an atomic staff-confirm RPC
-- mirroring 00264, a scoped customer INSERT policy, and a separate
-- order_requests entity. The operator chose the INSERT policy (2026-08-12).
-- That widens the portal's write surface against a core sales table, so the
-- policy below is deliberately over-constrained rather than merely correct:
--
--   1. WITH CHECK binds customer_id to the caller's own customer through the
--      same revocation-aware customer_portal_users join used by
--      customer_orders_select, so a customer cannot insert for another.
--   2. status is pinned to 'draft' — the staff-confirm state. draft is the
--      initial state of orderStateMachine (src/entities/order/core.ts) and
--      only staff can move it to 'confirmed'. Enforced here, not just in the
--      UI, because the portal writes through PostgREST with the user's own
--      JWT; there is no server route in between.
--   3. Fulfillment-side columns are pinned to their unset values, and
--      order_items.unit_price must be NULL: pricing is resolved server-side
--      via get_price_for_customer (00214, wrapped by
--      src/services/pricing-service.ts) and applied by staff at confirm time.
--      A customer-supplied price is rejected, so the portal cannot become a
--      price-setting surface.
--   4. orders_customer_lock (UPDATE, 00276) keeps WITH CHECK (false), so no
--      composition of the two policies lets a customer modify a row after
--      insert — including via INSERT ... ON CONFLICT DO UPDATE, which
--      requires the UPDATE policy's WITH CHECK to pass.
--
-- Residual, accepted: order_number is not constrained by the policy. It gains
-- a DEFAULT below so the portal never supplies one; a customer who supplies
-- an arbitrary string can still do so, but orders_order_number_key (UNIQUE,
-- 00002) prevents collisions and staff see the number before confirming.

-- =============================================================================
-- 1. ORDER NUMBER: generate under RLS
-- =============================================================================

-- generate_next_number() (00142) scans the target table to find the current
-- max in a series. It is SECURITY INVOKER, so under portal-customer RLS it
-- would see only that customer's own orders and hand back a number already
-- taken by someone else's — a UNIQUE violation on nearly every portal order.
--
-- Promote the sales-order wrapper to SECURITY DEFINER so the series is
-- computed over all orders regardless of caller. It takes no arguments and
-- returns only a generated string, so it leaks nothing about other customers'
-- orders beyond the sequence position. search_path is pinned, per
-- docs/agents/db-security.md.
--
-- Takes no arguments and returns only the generated string, so the sole
-- information crossing the trust boundary is the sequence position — which the
-- caller learns anyway from the order it is about to create.
-- security-definer: justified the ORD- series must be computed over all orders, but portal-customer RLS hides other customers' rows, so an invoker-rights scan returns an already-taken number and the insert fails on orders_order_number_key.
CREATE OR REPLACE FUNCTION generate_next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN generate_next_number(
    'orders',
    'order_number',
    'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-'
  );
END;
$$;

COMMENT ON FUNCTION generate_next_order_number IS
  'Generates the next sales order number in ORD-YYYY-NNN format, safe under concurrency. SECURITY DEFINER so portal customers, whose RLS hides other customers orders, still advance the shared series (00290).';

-- With the DEFAULT in place the portal client omits order_number entirely.
-- Staff forms keep prefilling it explicitly, so their behavior is unchanged.
ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT generate_next_order_number();

-- =============================================================================
-- 2. RLS: customer-scoped INSERT
-- =============================================================================

DROP POLICY IF EXISTS orders_customer_insert ON public.orders;
CREATE POLICY orders_customer_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT customer_id FROM public.customer_portal_users
      WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    )
    -- Staff-confirm state only. Never confirmed/scheduled/fulfillable.
    AND status = 'draft'
    -- Fulfillment-side columns are staff-owned.
    AND scheduled_date IS NULL
    AND fulfilled_date IS NULL
    AND COALESCE(is_export, FALSE) = FALSE
  );

COMMENT ON POLICY orders_customer_insert ON public.orders IS
  'Portal customers may create draft orders for their own customer only. Pricing, scheduling and confirmation stay staff-owned (00290).';

DROP POLICY IF EXISTS order_items_customer_insert ON public.order_items;
CREATE POLICY order_items_customer_insert ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Pricing is resolved server-side at staff confirm, never customer-supplied.
    unit_price IS NULL
    AND quantity > 0
    -- The order must be one of the caller's own, and still a draft: items
    -- cannot be appended to an order staff has already confirmed.
    AND order_id IN (
      SELECT id FROM public.orders
      WHERE status = 'draft'
        AND customer_id IN (
          SELECT customer_id FROM public.customer_portal_users
          WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
        )
    )
  );

COMMENT ON POLICY order_items_customer_insert ON public.order_items IS
  'Portal customers may add line items to their own draft orders. unit_price must be NULL — staff price the order at confirm time (00290).';
