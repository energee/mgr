-- Durable customer-portal access revocation (issue #605).
--
-- Revoking a portal user used to hard-delete the customer_portal_users row,
-- which left no record of the staff decision. The portal layout's service-role
-- auto-link reads "no row" as "first login, not yet provisioned" and therefore
-- re-created the link on the revoked user's next page load whenever their auth
-- email matched customers.email — the default for a customer's primary contact,
-- because the invite dialog pre-fills that address. RLS then honored the
-- restored row and handed back order reads and change-request inserts.
--
-- Access becomes a tombstone: the row survives with revoked_at stamped, so
-- "never linked" and "deliberately unlinked" are distinct states. Every reader
-- — application code and RLS alike — treats a stamped row as no access, and
-- POST /api/customers/[id]/invite is the only path that clears it.
--
-- Safe at every intermediate state: existing rows default to revoked_at IS
-- NULL, i.e. access unchanged, so the policies below and the pre-deploy
-- application code agree while the rollout is in flight.

ALTER TABLE public.customer_portal_users
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_portal_users.revoked_at IS
  'When staff revoked this portal link. NULL = access granted. Rows are stamped, never deleted, so the portal auto-link can tell a revoked user from a first-time one (issue #605).';

COMMENT ON TABLE public.customer_portal_users IS
  'Many-to-many portal access links. A customer may have multiple login users, and one login may access multiple customers. Revocation stamps revoked_at rather than deleting the row.';

-- Every hot read is "active links for this user".
CREATE INDEX IF NOT EXISTS idx_customer_portal_users_user_active
  ON public.customer_portal_users(user_id)
  WHERE revoked_at IS NULL;

-- =============================================================================
-- RLS: every policy that derives customer access from the junction must skip
-- tombstoned rows, so revocation holds even if an application path is missed.
-- =============================================================================

-- A revoked user cannot see their own tombstone. This is also what keeps the
-- SECURITY INVOKER submit_order_change_request() (00264) closed: its
-- `JOIN customer_portal_users cpu` runs under the caller's RLS, so no separate
-- predicate is needed inside that function.
DROP POLICY IF EXISTS customer_portal_users_customer_select
  ON public.customer_portal_users;
CREATE POLICY customer_portal_users_customer_select
  ON public.customer_portal_users
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND revoked_at IS NULL);

-- Orders: 00095 shape plus the revocation predicate.
DROP POLICY IF EXISTS customer_orders_select ON public.orders;
CREATE POLICY customer_orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM public.customer_portal_users
      WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    )
  );

-- Order items: 00095 shape plus the revocation predicate.
DROP POLICY IF EXISTS customer_order_items_select ON public.order_items;
CREATE POLICY customer_order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders WHERE customer_id IN (
        SELECT customer_id FROM public.customer_portal_users
        WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
      )
    )
  );

-- Change-request INSERT: 00095/00236 shape plus the revocation predicate.
DROP POLICY IF EXISTS change_requests_customer_insert
  ON public.order_change_requests;
CREATE POLICY change_requests_customer_insert ON public.order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM public.orders WHERE customer_id IN (
        SELECT customer_id FROM public.customer_portal_users
        WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
      )
    )
  );

-- Customer record (sales channel for the cutoff check): 00264 shape plus the
-- revocation predicate.
DROP POLICY IF EXISTS customers_customer_select ON public.customers;
CREATE POLICY customers_customer_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT customer_id FROM public.customer_portal_users
      WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    )
  );

-- Order lock-only UPDATE used by submit_order_change_request(): 00264 shape
-- plus the revocation predicate. WITH CHECK (false) is unchanged.
DROP POLICY IF EXISTS orders_customer_lock ON public.orders;
CREATE POLICY orders_customer_lock ON public.orders
  FOR UPDATE TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM public.customer_portal_users
      WHERE user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    )
  )
  WITH CHECK (false);

UPDATE public._schema_registry
SET description =
      'Many-to-many junction linking customers to portal auth users. Access to customer-scoped orders and change requests is derived from these links; revoked_at tombstones a revoked link instead of deleting it.',
    key_fields = '["customer_id", "user_id", "revoked_at"]'::jsonb
WHERE table_name = 'customer_portal_users';
