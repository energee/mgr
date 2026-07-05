-- Task 4 (RLS coverage-gap plan): tighten policies on four tables introduced
-- by migration 00162 with FOR ALL USING (true) WITH CHECK (true).
--
-- Tables and target policies:
--   brewery_shipping_defaults    — catalog (read any auth, write settings:manage)
--   customer_shipping_materials  — customers:read / customers:write
--   customer_pallet_configs      — customers:read / customers:write
--   order_materials              — orders:read / orders:write
--
-- order_materials was missed in the first plan draft (see audit addendum
-- line 406) and is included here.

-- ---------------------------------------------------------------------------
-- brewery_shipping_defaults — catalog pattern
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage brewery_shipping_defaults"
  ON brewery_shipping_defaults;

CREATE POLICY brewery_shipping_defaults_select ON brewery_shipping_defaults
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY brewery_shipping_defaults_write ON brewery_shipping_defaults
  FOR ALL
  USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- ---------------------------------------------------------------------------
-- customer_shipping_materials — customer domain
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage customer_shipping_materials"
  ON customer_shipping_materials;

CREATE POLICY customer_shipping_materials_select ON customer_shipping_materials
  FOR SELECT
  USING (user_has_permission('customers:read'));

CREATE POLICY customer_shipping_materials_write ON customer_shipping_materials
  FOR ALL
  USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

-- ---------------------------------------------------------------------------
-- customer_pallet_configs — customer domain
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage customer_pallet_configs"
  ON customer_pallet_configs;

CREATE POLICY customer_pallet_configs_select ON customer_pallet_configs
  FOR SELECT
  USING (user_has_permission('customers:read'));

CREATE POLICY customer_pallet_configs_write ON customer_pallet_configs
  FOR ALL
  USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

-- ---------------------------------------------------------------------------
-- order_materials — orders domain
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage order_materials"
  ON order_materials;

CREATE POLICY order_materials_select ON order_materials
  FOR SELECT
  USING (user_has_permission('orders:read'));

CREATE POLICY order_materials_write ON order_materials
  FOR ALL
  USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));
