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

-- The function is granted to PUBLIC and to `anon` by default, and PostgREST
-- exposes every public function as an RPC. Under invoker rights that was
-- harmless — an anonymous caller's RLS returned no rows, so it always answered
-- ORD-YYYY-001. Under definer rights it would answer with the brewery's true
-- year-to-date order count, giving anyone holding the (browser-shipped) anon
-- key an unauthenticated order-volume feed. Only inserting roles need it.
REVOKE EXECUTE ON FUNCTION public.generate_next_order_number() FROM PUBLIC, anon;

-- With the DEFAULT in place the portal client omits order_number entirely.
-- Staff forms keep prefilling it explicitly, so their behavior is unchanged.
-- The DEFAULT is evaluated as the inserting role, which retains EXECUTE.
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
    -- Fulfillment-side columns are staff-owned. delivery_id is included
    -- deliberately: customer_orders_select hands a customer the delivery_id of
    -- their own past orders, so without this an inserted draft could attach
    -- itself to a staff-scheduled delivery run and surface in
    -- deliveries_with_summary / pick_list_details before staff confirm it.
    AND scheduled_date IS NULL
    AND fulfilled_date IS NULL
    AND delivery_id IS NULL
    AND COALESCE(is_export, FALSE) = FALSE
    -- version seeds the optimistic lock (00141). increment_version() is an
    -- unguarded NEW.version := OLD.version + 1, so a row inserted at INT_MAX
    -- makes every later staff UPDATE — confirm, cancel, schedule — raise
    -- 22003 and strands the order beyond repair short of a DELETE.
    AND version = 1
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

-- =============================================================================
-- 3. ORDER-MATERIALS RECALCULATION MUST SURVIVE AN UNTRUSTED INSERTER
-- =============================================================================

-- trg_order_items_recalculate_materials fires on every order_items write and
-- runs recalculate_order_materials(), which upserts into order_materials and
-- reads brewery_shipping_defaults, customer_pallet_configs and
-- customer_shipping_materials. Until now the only role that could insert an
-- order_items row already held orders:write, so invoker rights were fine.
-- Opening the table to portal customers breaks that assumption two ways:
--
--   1. order_materials_write requires orders:write, so the upsert raises 42501
--      and aborts the customer's whole line-item insert. This is not
--      hypothetical — it reproduces the moment brewery_shipping_defaults has
--      any row, which is why it was invisible on an empty local database.
--   2. customer_pallet_configs and customer_shipping_materials require
--      customers:read on SELECT. A customer sees zero rows, so the LEFT JOIN
--      falls back to the generic pallet quantity and customer-specific
--      overrides are silently dropped — portal- and staff-created orders would
--      compute different materials from identical input. A silent divergence
--      is worse than the error above.
--
-- Promoting the trigger wrapper to definer rights fixes both: the nested
-- SECURITY INVOKER call to recalculate_order_materials() then also runs as the
-- owner. Trigger functions are not directly callable, so this adds no RPC
-- surface. Body is unchanged from 00159/00172 apart from the security clause.
-- security-definer: justified the order-materials estimate must be computed identically no matter who wrote the line item; a portal customer holds neither orders:write for the order_materials upsert nor customers:read for the pallet/shipping overrides, and the trigger is reachable only through a write that RLS has already authorised.
CREATE OR REPLACE FUNCTION recalculate_order_materials_after_item_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id
     AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
     AND OLD.selling_format_id IS NOT DISTINCT FROM NEW.selling_format_id THEN
    RETURN NEW;
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT order_id
    FROM unnest(
      CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.order_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.order_id]
        ELSE ARRAY[OLD.order_id, NEW.order_id]
      END
    ) AS affected(order_id)
    WHERE order_id IS NOT NULL
    ORDER BY order_id
  LOOP
    -- Cascading order deletion removes child rows after the parent is gone.
    IF EXISTS (SELECT 1 FROM orders WHERE id = v_order_id) THEN
      PERFORM recalculate_order_materials(v_order_id);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;
