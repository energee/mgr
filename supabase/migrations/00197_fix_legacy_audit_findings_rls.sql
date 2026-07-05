-- Task 6 (RLS coverage-gap plan): close the residual findings from the
-- original 2026-02-26 audit that were never addressed.
--
-- Tables and severities:
--   water_addition_profiles    (CRITICAL-1) USING (true) / WITH CHECK (true)
--     → catalog pattern (read any auth, write settings:manage)
--   customer_portal_users      (MEDIUM-1)   staff side too permissive
--     → tighten staff side; preserve customer self-access
--   order_change_requests      (MEDIUM-2)   staff side too permissive
--     → tighten staff side; preserve customer self-access
--   order_change_request_items (MEDIUM-2)   same as above
--
-- keg_inventory (original audit CRITICAL-2) needs no policy work: it has been
-- a VIEW since 00032 (recreated in 00079, drift-captured in 00191 with
-- security_invoker = true), so RLS on the underlying kegs/keg_transactions
-- tables applies. Views cannot carry policies.
--
-- For customer-portal tables we add a staff-side gate via
-- user_has_permission(); the existing customer-side policies (own-row
-- access via customer_portal_users link) are preserved by NOT dropping them.

-- ---------------------------------------------------------------------------
-- water_addition_profiles — catalog pattern
--
-- Guarded: this table exists only in the live database (created out-of-band;
-- no CREATE TABLE in any migration), so a fresh `supabase db reset` /
-- CI-from-migrations database does not have it. The DO block makes the
-- migration a no-op there while still tightening the live database.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.water_addition_profiles') IS NOT NULL THEN
    EXECUTE $sql$DROP POLICY IF EXISTS water_addition_profiles_select ON water_addition_profiles$sql$;
    EXECUTE $sql$DROP POLICY IF EXISTS water_addition_profiles_write ON water_addition_profiles$sql$;
    EXECUTE $sql$DROP POLICY IF EXISTS "Authenticated users can manage water_addition_profiles" ON water_addition_profiles$sql$;
    EXECUTE $sql$DROP POLICY IF EXISTS water_addition_profiles_authenticated ON water_addition_profiles$sql$;

    EXECUTE $sql$
      CREATE POLICY water_addition_profiles_select ON water_addition_profiles
        FOR SELECT
        USING ((SELECT auth.uid()) IS NOT NULL)
    $sql$;

    EXECUTE $sql$
      CREATE POLICY water_addition_profiles_write ON water_addition_profiles
        FOR ALL
        USING (user_has_permission('settings:manage'))
        WITH CHECK (user_has_permission('settings:manage'))
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- customer_portal_users — tighten staff side
--
-- Drops the legacy "staff: profile exists" policies but leaves customer
-- self-access policies in place (named with "customer_" prefix; we touch
-- only the staff-named ones below).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS customer_portal_users_staff_select ON customer_portal_users;
DROP POLICY IF EXISTS customer_portal_users_staff_write ON customer_portal_users;
DROP POLICY IF EXISTS "Staff can view all customer portal users" ON customer_portal_users;
DROP POLICY IF EXISTS "Staff can manage customer portal users" ON customer_portal_users;

CREATE POLICY customer_portal_users_staff_select ON customer_portal_users
  FOR SELECT
  USING (user_has_permission('customers:read'));

CREATE POLICY customer_portal_users_staff_write ON customer_portal_users
  FOR ALL
  USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

-- ---------------------------------------------------------------------------
-- order_change_requests — tighten staff side
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS order_change_requests_staff_select ON order_change_requests;
DROP POLICY IF EXISTS order_change_requests_staff_write ON order_change_requests;
DROP POLICY IF EXISTS "Staff can view all order change requests" ON order_change_requests;
DROP POLICY IF EXISTS "Staff can manage order change requests" ON order_change_requests;

CREATE POLICY order_change_requests_staff_select ON order_change_requests
  FOR SELECT
  USING (user_has_permission('orders:read'));

CREATE POLICY order_change_requests_staff_write ON order_change_requests
  FOR ALL
  USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- ---------------------------------------------------------------------------
-- order_change_request_items — tighten staff side
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS order_change_request_items_staff_select ON order_change_request_items;
DROP POLICY IF EXISTS order_change_request_items_staff_write ON order_change_request_items;
DROP POLICY IF EXISTS "Staff can view all order change request items" ON order_change_request_items;
DROP POLICY IF EXISTS "Staff can manage order change request items" ON order_change_request_items;

CREATE POLICY order_change_request_items_staff_select ON order_change_request_items
  FOR SELECT
  USING (user_has_permission('orders:read'));

CREATE POLICY order_change_request_items_staff_write ON order_change_request_items
  FOR ALL
  USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));
