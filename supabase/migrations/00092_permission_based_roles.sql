-- Migration: 00092_permission_based_roles.sql
-- Purpose: Multi-role user profiles, permission helper functions, and permission-based RLS policies
--
-- Changes:
-- 1. Alter user_profiles: single role TEXT -> roles TEXT[]
-- 2. Create permission helper functions (get_roles_for_permission, user_has_permission, user_has_role)
-- 3. Update create_user_profile trigger for roles array
-- 4. Recreate user_profiles_with_details view
-- 5. Replace RLS policies on all domain tables with permission-based policies
-- 6. Update schema registry and reload PostgREST

-- =============================================================================
-- SECTION 1: Alter user_profiles role -> roles[]
-- =============================================================================

-- Add the new roles array column
ALTER TABLE user_profiles ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{viewer}';

-- Migrate existing single role to array
UPDATE user_profiles SET roles = ARRAY[role];

-- Drop the old constraint and column
ALTER TABLE user_profiles DROP CONSTRAINT chk_user_role;
ALTER TABLE user_profiles DROP COLUMN role;

-- Drop the old index on the dropped column
DROP INDEX IF EXISTS idx_user_profiles_role;

-- Create a GIN index for array overlap queries
CREATE INDEX idx_user_profiles_roles ON user_profiles USING GIN (roles);

-- Validation function: ensures each element is a valid role and array is non-empty
CREATE OR REPLACE FUNCTION validate_user_roles(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_valid_roles TEXT[] := ARRAY['admin', 'production_manager', 'brewer', 'sales', 'viewer', 'customer'];
BEGIN
  IF array_length(p_roles, 1) IS NULL OR array_length(p_roles, 1) < 1 THEN
    RETURN false;
  END IF;
  FOREACH v_role IN ARRAY p_roles LOOP
    IF NOT (v_role = ANY(v_valid_roles)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE user_profiles ADD CONSTRAINT chk_user_roles
  CHECK (validate_user_roles(roles));

-- =============================================================================
-- SECTION 2: Permission helper functions
-- =============================================================================

-- Maps a permission string to the array of roles that have that permission
CREATE OR REPLACE FUNCTION get_roles_for_permission(p_permission TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_permission
    WHEN 'recipes:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'recipes:write'       THEN ARRAY['admin','brewer']
    WHEN 'batches:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'batches:write'       THEN ARRAY['admin','production_manager','brewer']
    WHEN 'orders:read'         THEN ARRAY['admin','production_manager','sales','viewer']
    WHEN 'orders:write'        THEN ARRAY['admin','sales']
    WHEN 'customers:read'      THEN ARRAY['admin','production_manager','sales','viewer']
    WHEN 'customers:write'     THEN ARRAY['admin','sales']
    WHEN 'inventory:read'      THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'inventory:write'     THEN ARRAY['admin','production_manager']
    WHEN 'purchasing:read'     THEN ARRAY['admin','production_manager','viewer']
    WHEN 'purchasing:write'    THEN ARRAY['admin','production_manager']
    WHEN 'vessels:read'        THEN ARRAY['admin','production_manager','brewer','sales','viewer']
    WHEN 'vessels:write'       THEN ARRAY['admin','production_manager','brewer']
    WHEN 'integrations:manage' THEN ARRAY['admin']
    WHEN 'settings:manage'     THEN ARRAY['admin']
    WHEN 'users:manage'        THEN ARRAY['admin']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- Checks if the current user has a specific permission
CREATE OR REPLACE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid())
    AND roles && get_roles_for_permission(p_permission)
  );
$$;

-- Checks if the current user has a specific role
CREATE OR REPLACE FUNCTION user_has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid())
    AND p_role = ANY(roles)
  );
$$;

-- Update the existing helper functions to use roles array
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT roles[1] FROM user_profiles WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_user_id AND 'admin' = ANY(roles)
  );
$$;

-- Update the RLS-safe admin check (SECURITY DEFINER) for user_profiles self-referencing policies
CREATE OR REPLACE FUNCTION is_admin_rls(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_user_id AND 'admin' = ANY(roles)
  );
$$;

-- =============================================================================
-- SECTION 3: Update create_user_profile trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles TEXT[] := ARRAY['viewer'];
  v_customer RECORD;
  v_found BOOLEAN := false;
  v_is_first BOOLEAN := false;
BEGIN
  -- Check if this is the very first user
  SELECT NOT EXISTS (SELECT 1 FROM user_profiles) INTO v_is_first;

  IF v_is_first THEN
    v_roles := ARRAY['admin'];
  ELSE
    -- Link all matching customers via junction table
    FOR v_customer IN
      SELECT id FROM customers WHERE email = NEW.email
    LOOP
      INSERT INTO customer_portal_users (customer_id, user_id)
      VALUES (v_customer.id, NEW.id)
      ON CONFLICT DO NOTHING;
      v_found := true;
    END LOOP;

    IF v_found THEN
      v_roles := ARRAY['customer'];
    END IF;
  END IF;

  INSERT INTO user_profiles (
    id,
    email,
    display_name,
    roles,
    status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    v_roles,
    'active',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(user_profiles.display_name, EXCLUDED.display_name),
    updated_at = now();

  RETURN NEW;
END;
$$;

-- =============================================================================
-- SECTION 4: Update user_profiles_with_details view
-- =============================================================================

DROP VIEW IF EXISTS user_profiles_with_details;

CREATE VIEW user_profiles_with_details
WITH (security_invoker = true)
AS
SELECT
  up.*,
  -- Format first role for display
  INITCAP(REPLACE(up.roles[1], '_', ' ')) AS role_display,
  -- Status display
  CASE up.status
    WHEN 'active' THEN 'Active'
    WHEN 'inactive' THEN 'Inactive'
    WHEN 'pending' THEN 'Pending'
  END AS status_display,
  -- Invited by name (from profiles, not auth.users)
  inviter.display_name AS invited_by_name,
  -- Days since last active
  CASE
    WHEN up.last_active_at IS NOT NULL THEN
      EXTRACT(DAY FROM now() - up.last_active_at)::INTEGER
    ELSE NULL
  END AS days_since_active
FROM user_profiles up
LEFT JOIN user_profiles inviter ON inviter.id = up.invited_by;

-- =============================================================================
-- SECTION 5: Update RLS policies on domain tables
-- =============================================================================

-- -------------------------------------------------------------------------
-- 5a. Drop old policies from 00002_single_tenant.sql and 00013_rls_performance_fix.sql
-- -------------------------------------------------------------------------

-- From 00002/00013: core single-tenant policies
DROP POLICY IF EXISTS recipe_access ON recipes;
DROP POLICY IF EXISTS batch_access ON batches;
DROP POLICY IF EXISTS batch_log_access ON batch_logs;
DROP POLICY IF EXISTS inventory_item_access ON inventory_items;
DROP POLICY IF EXISTS allocation_access ON allocations;
DROP POLICY IF EXISTS package_type_access ON package_types;
DROP POLICY IF EXISTS package_access ON packages;
DROP POLICY IF EXISTS customer_access ON customers;
DROP POLICY IF EXISTS order_access ON orders;
DROP POLICY IF EXISTS order_item_access ON order_items;
DROP POLICY IF EXISTS settings_access ON settings;

-- From 00013: brands
DROP POLICY IF EXISTS brand_access ON brands;

-- From 00013: brew logs
DROP POLICY IF EXISTS brew_log_access ON brew_logs;
DROP POLICY IF EXISTS brew_log_batch_access ON brew_log_batches;

-- From 00013: vessels
DROP POLICY IF EXISTS location_access ON locations;
DROP POLICY IF EXISTS vessel_access ON vessels;
DROP POLICY IF EXISTS vessel_transfer_access ON vessel_transfers;
DROP POLICY IF EXISTS vessel_cleaning_access ON vessel_cleanings;

-- From 00013/00010: purchasing
DROP POLICY IF EXISTS suppliers_access ON suppliers;
DROP POLICY IF EXISTS supplier_catalog_access ON supplier_catalog;
DROP POLICY IF EXISTS purchase_orders_access ON purchase_orders;
DROP POLICY IF EXISTS po_line_items_access ON po_line_items;
DROP POLICY IF EXISTS po_receives_access ON po_receives;

-- From 00013/00010: inventory
DROP POLICY IF EXISTS inventory_lots_access ON inventory_lots;
DROP POLICY IF EXISTS packaging_sessions_access ON packaging_sessions;
DROP POLICY IF EXISTS session_line_items_access ON session_line_items;
DROP POLICY IF EXISTS finished_goods_access ON finished_goods;
DROP POLICY IF EXISTS bins_access ON bins;
DROP POLICY IF EXISTS bin_inventory_access ON bin_inventory;
DROP POLICY IF EXISTS allocations_access ON allocations;

-- From 00013/00010: location transfers
DROP POLICY IF EXISTS location_transfers_access ON location_transfers;
DROP POLICY IF EXISTS transfer_lines_access ON transfer_lines;

-- From 00016: recipe_yeasts
DROP POLICY IF EXISTS recipe_yeast_access ON recipe_yeasts;

-- From 00035/00059: yeast_pitches
DROP POLICY IF EXISTS yeast_pitches_access ON yeast_pitches;

-- From 00055/00062: batch_blends
DROP POLICY IF EXISTS "Authenticated users can view batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can insert batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can update batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can delete batch blends" ON batch_blends;

-- From 00057/00062: pick_lists and pick_list_items
DROP POLICY IF EXISTS "Users can view pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can insert pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can update pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can delete pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can view pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can insert pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can update pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can delete pick list items" ON pick_list_items;

-- From 00073: bin_inventory_items and deliveries
DROP POLICY IF EXISTS bin_inventory_items_access ON bin_inventory_items;
DROP POLICY IF EXISTS deliveries_access ON deliveries;

-- From 00077: pricing
DROP POLICY IF EXISTS pricing_tiers_access ON pricing_tiers;
DROP POLICY IF EXISTS pricing_tier_prices_access ON pricing_tier_prices;
DROP POLICY IF EXISTS pricing_history_access ON pricing_history;

-- From 00059: sales_channels (price_tiers and tier_prices were dropped in 00077)
DROP POLICY IF EXISTS sales_channels_access ON sales_channels;

-- From 00079: keg_owners and keg_owner_deposits
DROP POLICY IF EXISTS "Authenticated users can view keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can insert keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can update keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can delete keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can view keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can insert keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can update keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can delete keg owner deposits" ON keg_owner_deposits;

-- From 00082_recipe_variants: recipe variant tables
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variants" ON recipe_variants;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_hops" ON recipe_variant_hops;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_adjuncts" ON recipe_variant_adjuncts;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_fruits" ON recipe_variant_fruits;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_spices" ON recipe_variant_spices;

-- From 00083: batch_additions
DROP POLICY IF EXISTS "Authenticated users can manage batch_additions" ON batch_additions;

-- From 00029/00058: keg_types
DROP POLICY IF EXISTS "keg_types_select" ON keg_types;
DROP POLICY IF EXISTS "keg_types_insert" ON keg_types;
DROP POLICY IF EXISTS "keg_types_update" ON keg_types;
DROP POLICY IF EXISTS "keg_types_delete" ON keg_types;

-- From 00031/00058: keg_inventory
DROP POLICY IF EXISTS "keg_inventory_select" ON keg_inventory;
DROP POLICY IF EXISTS "keg_inventory_insert" ON keg_inventory;
DROP POLICY IF EXISTS "keg_inventory_update" ON keg_inventory;
DROP POLICY IF EXISTS "keg_inventory_delete" ON keg_inventory;

-- From 00088_square_integration
DROP POLICY IF EXISTS "Authenticated users can manage square_settings" ON square_settings;
DROP POLICY IF EXISTS "Authenticated users can manage square_catalog_map" ON square_catalog_map;
DROP POLICY IF EXISTS "Authenticated users can manage square_sync_log" ON square_sync_log;
DROP POLICY IF EXISTS "Authenticated users can manage square_draft_sales" ON square_draft_sales;

-- From 00088_slack_integration / 00089_fix_slack_rls_policies
DROP POLICY IF EXISTS "Authenticated users can read slack settings" ON slack_settings;
DROP POLICY IF EXISTS "Authenticated users can update slack settings" ON slack_settings;
DROP POLICY IF EXISTS "Authenticated users can read slack log" ON slack_notification_log;
DROP POLICY IF EXISTS "Authenticated users can insert slack log" ON slack_notification_log;
DROP POLICY IF EXISTS "Authenticated users can update slack log" ON slack_notification_log;

-- From 00089_change_request_tables: staff policies (customer policies kept)
DROP POLICY IF EXISTS change_requests_staff_select ON order_change_requests;
DROP POLICY IF EXISTS change_requests_staff_insert ON order_change_requests;
DROP POLICY IF EXISTS change_requests_staff_update ON order_change_requests;
DROP POLICY IF EXISTS change_requests_customer_select ON order_change_requests;
-- Note: change_requests_customer_insert was re-created in 00091; drop the current one
DROP POLICY IF EXISTS change_requests_customer_insert ON order_change_requests;

DROP POLICY IF EXISTS change_request_items_staff_select ON order_change_request_items;
DROP POLICY IF EXISTS change_request_items_staff_insert ON order_change_request_items;
DROP POLICY IF EXISTS change_request_items_customer_select ON order_change_request_items;
DROP POLICY IF EXISTS change_request_items_customer_insert ON order_change_request_items;

-- From 00089/00091: customer portal order policies
DROP POLICY IF EXISTS customer_orders_select ON orders;
DROP POLICY IF EXISTS customer_order_items_select ON order_items;

-- From 00059: enum_values
DROP POLICY IF EXISTS enum_values_select ON enum_values;
DROP POLICY IF EXISTS enum_values_insert ON enum_values;
DROP POLICY IF EXISTS enum_values_update ON enum_values;
DROP POLICY IF EXISTS enum_values_delete ON enum_values;

-- -------------------------------------------------------------------------
-- 5b. RECIPES domain (recipes:read / recipes:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'recipes', 'recipe_yeasts', 'recipe_variants',
    'recipe_variant_hops', 'recipe_variant_adjuncts',
    'recipe_variant_fruits', 'recipe_variant_spices'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''recipes:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''recipes:write'')) WITH CHECK (user_has_permission(''recipes:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5c. BATCHES domain (batches:read / batches:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'batches', 'brew_logs', 'brew_log_batches', 'batch_additions',
    'batch_blends', 'yeast_pitches', 'packaging_sessions', 'session_line_items',
    'batch_logs', 'packages'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''batches:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''batches:write'')) WITH CHECK (user_has_permission(''batches:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5d. ORDERS domain (orders:read / orders:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'orders', 'order_items', 'order_change_requests',
    'order_change_request_items', 'pick_lists', 'pick_list_items', 'deliveries'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''orders:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''orders:write'')) WITH CHECK (user_has_permission(''orders:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- Restore customer portal policies on orders (additive to the staff policies above)
CREATE POLICY customer_orders_select ON orders
  FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY customer_order_items_select ON order_items
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- Restore customer portal policies on change requests
CREATE POLICY change_requests_customer_select ON order_change_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
  );

CREATE POLICY change_requests_customer_insert ON order_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT customer_id FROM customer_portal_users WHERE user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY change_request_items_customer_select ON order_change_request_items
  FOR SELECT TO authenticated
  USING (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid())
    )
  );

CREATE POLICY change_request_items_customer_insert ON order_change_request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    change_request_id IN (
      SELECT id FROM order_change_requests
      WHERE requested_by = (SELECT auth.uid()) AND status = 'pending'
    )
  );

-- -------------------------------------------------------------------------
-- 5e. CUSTOMERS domain (customers:read / customers:write)
-- -------------------------------------------------------------------------
CREATE POLICY customers_select ON customers
  FOR SELECT USING (user_has_permission('customers:read'));

CREATE POLICY customers_write ON customers
  FOR ALL USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

-- -------------------------------------------------------------------------
-- 5f. INVENTORY domain (inventory:read / inventory:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'inventory_items', 'inventory_lots', 'finished_goods', 'allocations',
    'bins', 'bin_inventory', 'bin_inventory_items',
    'keg_inventory', 'keg_types', 'keg_owners', 'keg_owner_deposits'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''inventory:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''inventory:write'')) WITH CHECK (user_has_permission(''inventory:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5g. PURCHASING domain (purchasing:read / purchasing:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'suppliers', 'supplier_catalog', 'purchase_orders', 'po_line_items', 'po_receives'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''purchasing:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''purchasing:write'')) WITH CHECK (user_has_permission(''purchasing:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5h. VESSELS domain (vessels:read / vessels:write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'locations', 'vessels', 'vessel_transfers', 'vessel_cleanings',
    'location_transfers', 'transfer_lines'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''vessels:read''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''vessels:write'')) WITH CHECK (user_has_permission(''vessels:write''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5i. INTEGRATIONS (integrations:manage for both read and write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'square_settings', 'square_catalog_map', 'square_sync_log', 'square_draft_sales',
    'slack_settings', 'slack_notification_log'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''integrations:manage''))',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''integrations:manage'')) WITH CHECK (user_has_permission(''integrations:manage''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5j. SETTINGS (settings:manage)
-- -------------------------------------------------------------------------
CREATE POLICY settings_select ON settings
  FOR SELECT USING (user_has_permission('settings:manage'));

CREATE POLICY settings_write ON settings
  FOR ALL USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- -------------------------------------------------------------------------
-- 5k. CATALOG/SHARED tables (all authenticated SELECT, settings:manage for write)
-- -------------------------------------------------------------------------
DO $$
DECLARE _tbl TEXT;
BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'brands', 'enum_values', 'package_types', 'sales_channels',
    'pricing_tiers', 'pricing_tier_prices', 'pricing_history'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)',
      _tbl || '_select', _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''settings:manage'')) WITH CHECK (user_has_permission(''settings:manage''))',
      _tbl || '_write', _tbl
    );
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- 5l. ENTITY REVISIONS (all authenticated read/write)
-- -------------------------------------------------------------------------
-- Drop existing policies first
DROP POLICY IF EXISTS entity_revisions_select ON entity_revisions;
DROP POLICY IF EXISTS entity_revisions_insert ON entity_revisions;
DROP POLICY IF EXISTS "entity_revisions_insert" ON entity_revisions;

CREATE POLICY entity_revisions_select ON entity_revisions
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY entity_revisions_insert ON entity_revisions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- SECTION 6: Schema registry update + reload
-- =============================================================================

UPDATE _schema_registry
SET
  description = 'User profiles with multi-role array and activity tracking. Caches auth.users info per security guidelines. Roles: admin, production_manager, brewer, sales, viewer, customer.',
  key_fields = '["display_name", "email", "roles", "status", "last_active_at"]'::jsonb,
  ai_context = '"User management entity. Contains cached auth info (email, name) to avoid joining auth.users directly. Multi-role system using roles TEXT[] array. Permission-based access control via user_has_permission() function."'::jsonb
WHERE table_name = 'user_profiles';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
