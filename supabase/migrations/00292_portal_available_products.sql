-- Let portal customers see what they are allowed to order (Phase 4, node C2).
--
-- 00290 gave portal customers a narrow INSERT path onto `orders` /
-- `order_items`, and 00291 hardened the order-number half of it. Both are
-- write-side. Nothing audited the *read* side, and the read side is broken:
--
--   `finished_goods_with_availability` is SECURITY INVOKER (correctly — it is
--   a public-schema view, and db-security.md requires it), and the underlying
--   `finished_goods_select` policy is `user_has_permission('inventory:read')`.
--   The 'customer' role does not hold `inventory:read`, so a portal customer
--   selects **zero** rows. Measured, not inferred: as the seeded portal user
--   the view returns 0 rows where the service role returns 1.
--
-- The consequence is that the order builder's product picker is empty for
-- every real customer, and so is the "Add Item" list in the already-shipped
-- change-request builder (`src/components/portal/change-request-builder.tsx`)
-- — that surface has had this defect since it landed; it was invisible because
-- no test drove it as a portal customer.
--
-- Widening `finished_goods_select` is the wrong fix: it would hand customers
-- every lot, batch link, expiration date and internal note on the table. What
-- a customer legitimately needs is far narrower — which (brand, format) pairs
-- are orderable, and roughly how many are free — so this exposes exactly that
-- through a definer-rights function and nothing else.
--
-- The function returns only brand/format identity and an availability count —
-- never lot numbers, batch links, dates or notes — and returns nothing at all
-- unless the caller is a non-revoked portal user.
--
-- security-definer: justified a portal customer must not hold `inventory:read` (that is a staff permission) but must still learn which finished goods are orderable; this exposes only brand/format identity and a count, and only to non-revoked portal users.
CREATE OR REPLACE FUNCTION get_portal_available_products()
RETURNS TABLE (
  brand_id UUID,
  brand_name TEXT,
  selling_format_id UUID,
  selling_format_name TEXT,
  available_quantity BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    fga.brand_id,
    fga.brand_name,
    fga.selling_format_id,
    fga.selling_format_name,
    SUM(fga.available_quantity)::BIGINT AS available_quantity
  FROM finished_goods_with_availability fga
  WHERE fga.available_quantity > 0
    -- Identity gate: staff read finished goods through their own
    -- `inventory:read` path, so this returns rows only to portal customers.
    -- Without it the function would be a stock feed for anyone holding the
    -- browser-shipped anon key.
    AND EXISTS (
      SELECT 1 FROM customer_portal_users cpu
      WHERE cpu.user_id = (SELECT auth.uid())
        AND cpu.revoked_at IS NULL
    )
  -- Availability is per-lot in the view; a customer orders a product, not a
  -- lot, so collapse lots into one orderable row per (brand, format).
  GROUP BY fga.brand_id, fga.brand_name, fga.selling_format_id,
           fga.selling_format_name
  HAVING SUM(fga.available_quantity) > 0;
$$;

COMMENT ON FUNCTION get_portal_available_products IS
  'Orderable (brand, selling format) pairs with free stock, for portal customers only. SECURITY DEFINER because customers lack inventory:read; returns identity and a count, never lot detail (00292).';

-- PostgREST exposes every public function as an RPC and grants EXECUTE to
-- PUBLIC by default. Only signed-in callers should reach this; the EXISTS
-- guard above then narrows it to portal customers.
REVOKE EXECUTE ON FUNCTION public.get_portal_available_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_portal_available_products() TO authenticated;
