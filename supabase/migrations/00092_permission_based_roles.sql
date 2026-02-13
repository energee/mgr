-- Migration: permission_based_roles
-- Multi-role user profiles, permission helpers, and permission-based RLS
--
-- Applied to production via Supabase MCP. Adapted from original plan to match
-- production schema (system_settings instead of settings, no customer_portal_users,
-- no order_change_requests, includes QBO/ingredient catalog tables).

-- =============================================================================
-- SECTION 0: Drop objects depending on user_profiles.role
-- =============================================================================
DROP VIEW IF EXISTS user_profiles_with_details;
DROP TRIGGER IF EXISTS validate_user_role ON user_profiles;
DROP POLICY IF EXISTS enum_values_insert ON enum_values;
DROP POLICY IF EXISTS enum_values_update ON enum_values;
DROP POLICY IF EXISTS enum_values_delete ON enum_values;

-- =============================================================================
-- SECTION 1: Alter user_profiles role -> roles[]
-- =============================================================================
ALTER TABLE user_profiles ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{viewer}';
UPDATE user_profiles SET roles = ARRAY[role];
ALTER TABLE user_profiles DROP CONSTRAINT chk_user_role;
ALTER TABLE user_profiles DROP COLUMN role;
DROP INDEX IF EXISTS idx_user_profiles_role;
CREATE INDEX idx_user_profiles_roles ON user_profiles USING GIN (roles);

CREATE OR REPLACE FUNCTION validate_user_roles(p_roles TEXT[])
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_role TEXT;
  v_valid TEXT[] := ARRAY['admin','production_manager','brewer','sales','viewer','customer'];
BEGIN
  IF array_length(p_roles, 1) IS NULL OR array_length(p_roles, 1) < 1 THEN RETURN false; END IF;
  FOREACH v_role IN ARRAY p_roles LOOP
    IF NOT (v_role = ANY(v_valid)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END; $$;

ALTER TABLE user_profiles ADD CONSTRAINT chk_user_roles CHECK (validate_user_roles(roles));

-- =============================================================================
-- SECTION 2: Permission helper functions
-- =============================================================================
CREATE OR REPLACE FUNCTION get_roles_for_permission(p_permission TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid()) AND roles && get_roles_for_permission(p_permission)
  );
$$;

CREATE OR REPLACE FUNCTION user_has_role(p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = (SELECT auth.uid()) AND p_role = ANY(roles)
  );
$$;

CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT roles[1] FROM user_profiles WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id AND 'admin' = ANY(roles));
$$;

CREATE OR REPLACE FUNCTION is_admin_rls(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id AND 'admin' = ANY(roles));
$$;

-- =============================================================================
-- SECTION 3: Update create_user_profile trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roles TEXT[] := ARRAY['viewer'];
  v_is_first BOOLEAN := false;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM user_profiles) INTO v_is_first;
  IF v_is_first THEN v_roles := ARRAY['admin']; END IF;

  INSERT INTO user_profiles (id, email, display_name, roles, status, created_at)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_roles, 'active', now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(user_profiles.display_name, EXCLUDED.display_name),
    updated_at = now();
  RETURN NEW;
END; $$;

-- =============================================================================
-- SECTION 4: Recreate user_profiles_with_details view
-- =============================================================================
CREATE VIEW user_profiles_with_details WITH (security_invoker = true) AS
SELECT up.*,
  INITCAP(REPLACE(up.roles[1], '_', ' ')) AS role_display,
  CASE up.status WHEN 'active' THEN 'Active' WHEN 'inactive' THEN 'Inactive' WHEN 'pending' THEN 'Pending' END AS status_display,
  inviter.display_name AS invited_by_name,
  CASE WHEN up.last_active_at IS NOT NULL THEN EXTRACT(DAY FROM now() - up.last_active_at)::INTEGER ELSE NULL END AS days_since_active
FROM user_profiles up
LEFT JOIN user_profiles inviter ON inviter.id = up.invited_by;

-- =============================================================================
-- SECTION 5a: Drop ALL old policies
-- =============================================================================

-- Recipes domain
DROP POLICY IF EXISTS recipe_access ON recipes;
DROP POLICY IF EXISTS recipe_yeast_access ON recipe_yeasts;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variants" ON recipe_variants;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_hops" ON recipe_variant_hops;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_adjuncts" ON recipe_variant_adjuncts;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_fruits" ON recipe_variant_fruits;
DROP POLICY IF EXISTS "Authenticated users can manage recipe_variant_spices" ON recipe_variant_spices;
DROP POLICY IF EXISTS recipe_additions_access ON recipe_additions;
DROP POLICY IF EXISTS recipe_adjuncts_access ON recipe_adjuncts;
DROP POLICY IF EXISTS recipe_fruits_access ON recipe_fruits;
DROP POLICY IF EXISTS recipe_hops_access ON recipe_hops;
DROP POLICY IF EXISTS recipe_malts_access ON recipe_malts;
DROP POLICY IF EXISTS recipe_spices_access ON recipe_spices;
DROP POLICY IF EXISTS recipe_sugars_access ON recipe_sugars;
DROP POLICY IF EXISTS recipe_collaborators_access ON recipe_collaborators;

-- Batches domain
DROP POLICY IF EXISTS batch_access ON batches;
DROP POLICY IF EXISTS brew_log_access ON brew_logs;
DROP POLICY IF EXISTS brew_log_batch_access ON brew_log_batches;
DROP POLICY IF EXISTS "Authenticated users can manage batch_additions" ON batch_additions;
DROP POLICY IF EXISTS "Authenticated users can view batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can insert batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can update batch blends" ON batch_blends;
DROP POLICY IF EXISTS "Authenticated users can delete batch blends" ON batch_blends;
DROP POLICY IF EXISTS yeast_pitches_access ON yeast_pitches;
DROP POLICY IF EXISTS packaging_sessions_access ON packaging_sessions;
DROP POLICY IF EXISTS session_line_items_access ON session_line_items;
DROP POLICY IF EXISTS batch_log_access ON batch_logs;
DROP POLICY IF EXISTS package_access ON packages;

-- Orders domain
DROP POLICY IF EXISTS order_access ON orders;
DROP POLICY IF EXISTS order_item_access ON order_items;
DROP POLICY IF EXISTS "Users can view pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can insert pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can update pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can delete pick lists" ON pick_lists;
DROP POLICY IF EXISTS "Users can view pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can insert pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can update pick list items" ON pick_list_items;
DROP POLICY IF EXISTS "Users can delete pick list items" ON pick_list_items;
DROP POLICY IF EXISTS deliveries_access ON deliveries;

-- Customers domain
DROP POLICY IF EXISTS customer_access ON customers;

-- Inventory domain
DROP POLICY IF EXISTS inventory_item_access ON inventory_items;
DROP POLICY IF EXISTS inventory_lots_access ON inventory_lots;
DROP POLICY IF EXISTS finished_goods_access ON finished_goods;
DROP POLICY IF EXISTS allocations_access ON allocations;
DROP POLICY IF EXISTS bins_access ON bins;
DROP POLICY IF EXISTS bin_inventory_access ON bin_inventory;
DROP POLICY IF EXISTS bin_inventory_items_access ON bin_inventory_items;
DROP POLICY IF EXISTS keg_types_select ON keg_types;
DROP POLICY IF EXISTS keg_types_insert ON keg_types;
DROP POLICY IF EXISTS keg_types_update ON keg_types;
DROP POLICY IF EXISTS keg_types_delete ON keg_types;
DROP POLICY IF EXISTS "Authenticated users can view keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can insert keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can update keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can delete keg owners" ON keg_owners;
DROP POLICY IF EXISTS "Authenticated users can view keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can insert keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can update keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS "Authenticated users can delete keg owner deposits" ON keg_owner_deposits;
DROP POLICY IF EXISTS keg_transactions_select ON keg_transactions;
DROP POLICY IF EXISTS keg_transactions_insert ON keg_transactions;

-- Purchasing domain
DROP POLICY IF EXISTS suppliers_access ON suppliers;
DROP POLICY IF EXISTS supplier_catalog_access ON supplier_catalog;
DROP POLICY IF EXISTS purchase_orders_access ON purchase_orders;
DROP POLICY IF EXISTS po_line_items_access ON po_line_items;
DROP POLICY IF EXISTS po_receives_access ON po_receives;

-- Vessels domain
DROP POLICY IF EXISTS location_access ON locations;
DROP POLICY IF EXISTS vessel_access ON vessels;
DROP POLICY IF EXISTS vessel_transfer_access ON vessel_transfers;
DROP POLICY IF EXISTS vessel_cleaning_access ON vessel_cleanings;
DROP POLICY IF EXISTS location_transfers_access ON location_transfers;
DROP POLICY IF EXISTS transfer_lines_access ON transfer_lines;

-- Integrations (Square)
DROP POLICY IF EXISTS "Authenticated users can manage square_settings" ON square_settings;
DROP POLICY IF EXISTS "Authenticated users can manage square_catalog_map" ON square_catalog_map;
DROP POLICY IF EXISTS "Authenticated users can manage square_sync_log" ON square_sync_log;
DROP POLICY IF EXISTS "Authenticated users can manage square_draft_sales" ON square_draft_sales;

-- Integrations (Slack)
DROP POLICY IF EXISTS "Authenticated users can read slack settings" ON slack_settings;
DROP POLICY IF EXISTS "Authenticated users can update slack settings" ON slack_settings;
DROP POLICY IF EXISTS "Authenticated users can read slack log" ON slack_notification_log;
DROP POLICY IF EXISTS "Authenticated users can insert slack log" ON slack_notification_log;
DROP POLICY IF EXISTS "Authenticated users can update slack log" ON slack_notification_log;

-- Integrations (QBO)
DROP POLICY IF EXISTS qbo_account_mappings_select ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_insert ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_update ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_account_mappings_delete ON qbo_account_mappings;
DROP POLICY IF EXISTS qbo_sync_log_select ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_insert ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_update ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_log_delete ON qbo_sync_log;
DROP POLICY IF EXISTS qbo_sync_mappings_select ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_insert ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_update ON qbo_sync_mappings;
DROP POLICY IF EXISTS qbo_sync_mappings_delete ON qbo_sync_mappings;

-- System settings (keep system_settings_hide_sensitive RESTRICTIVE)
DROP POLICY IF EXISTS system_settings_select ON system_settings;
DROP POLICY IF EXISTS system_settings_insert ON system_settings;
DROP POLICY IF EXISTS system_settings_update ON system_settings;

-- Catalog/shared
DROP POLICY IF EXISTS brand_access ON brands;
DROP POLICY IF EXISTS enum_values_select ON enum_values;
DROP POLICY IF EXISTS package_type_access ON package_types;
DROP POLICY IF EXISTS sales_channels_access ON sales_channels;
DROP POLICY IF EXISTS pricing_tiers_access ON pricing_tiers;
DROP POLICY IF EXISTS pricing_tier_prices_access ON pricing_tier_prices;
DROP POLICY IF EXISTS pricing_history_access ON pricing_history;

-- Ingredient catalogs
DROP POLICY IF EXISTS hops_access ON hops;
DROP POLICY IF EXISTS malts_access ON malts;
DROP POLICY IF EXISTS adjuncts_access ON adjuncts;
DROP POLICY IF EXISTS fruits_access ON fruits;
DROP POLICY IF EXISTS spices_access ON spices;
DROP POLICY IF EXISTS sugars_access ON sugars;
DROP POLICY IF EXISTS yeasts_access ON yeasts;
DROP POLICY IF EXISTS additives_access ON additives;
DROP POLICY IF EXISTS water_profiles_access ON water_profiles;
DROP POLICY IF EXISTS beer_styles_access ON beer_styles;

-- Entity revisions
DROP POLICY IF EXISTS entity_revisions_select ON entity_revisions;
DROP POLICY IF EXISTS entity_revisions_insert ON entity_revisions;

-- Legacy
DROP POLICY IF EXISTS allocation_access ON allocations_legacy;

-- =============================================================================
-- SECTION 5b: RECIPES domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'recipes','recipe_yeasts','recipe_variants','recipe_variant_hops',
    'recipe_variant_adjuncts','recipe_variant_fruits','recipe_variant_spices',
    'recipe_additions','recipe_adjuncts','recipe_fruits','recipe_hops',
    'recipe_malts','recipe_spices','recipe_sugars','recipe_collaborators'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''recipes:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''recipes:write'')) WITH CHECK (user_has_permission(''recipes:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5c: BATCHES domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'batches','brew_logs','brew_log_batches','batch_additions',
    'batch_blends','yeast_pitches','packaging_sessions','session_line_items',
    'batch_logs','packages'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''batches:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''batches:write'')) WITH CHECK (user_has_permission(''batches:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5d: ORDERS domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'orders','order_items','pick_lists','pick_list_items','deliveries'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''orders:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''orders:write'')) WITH CHECK (user_has_permission(''orders:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5e: CUSTOMERS domain
-- =============================================================================
CREATE POLICY customers_select ON customers FOR SELECT USING (user_has_permission('customers:read'));
CREATE POLICY customers_write ON customers FOR ALL USING (user_has_permission('customers:write')) WITH CHECK (user_has_permission('customers:write'));

-- =============================================================================
-- SECTION 5f: INVENTORY domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'inventory_items','inventory_lots','finished_goods','allocations',
    'bins','bin_inventory','bin_inventory_items',
    'keg_types','keg_owners','keg_owner_deposits','keg_transactions'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''inventory:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''inventory:write'')) WITH CHECK (user_has_permission(''inventory:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5g: PURCHASING domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'suppliers','supplier_catalog','purchase_orders','po_line_items','po_receives'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''purchasing:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''purchasing:write'')) WITH CHECK (user_has_permission(''purchasing:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5h: VESSELS domain
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'locations','vessels','vessel_transfers','vessel_cleanings',
    'location_transfers','transfer_lines'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''vessels:read''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''vessels:write'')) WITH CHECK (user_has_permission(''vessels:write''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5i: INTEGRATIONS (admin only)
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'square_settings','square_catalog_map','square_sync_log','square_draft_sales',
    'slack_settings','slack_notification_log',
    'qbo_account_mappings','qbo_sync_log','qbo_sync_mappings'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_has_permission(''integrations:manage''))', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''integrations:manage'')) WITH CHECK (user_has_permission(''integrations:manage''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5j: SYSTEM SETTINGS (all staff read, admin write)
-- Keep system_settings_hide_sensitive RESTRICTIVE policy (hides QBO tokens)
-- =============================================================================
CREATE POLICY system_settings_select ON system_settings
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY system_settings_write ON system_settings
  FOR ALL USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- =============================================================================
-- SECTION 5k: CATALOG/SHARED (all staff read, admin write)
-- =============================================================================
DO $$ DECLARE _tbl TEXT; BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'brands','enum_values','package_types','sales_channels',
    'pricing_tiers','pricing_tier_prices','pricing_history',
    'hops','malts','adjuncts','fruits','spices','sugars',
    'yeasts','additives','water_profiles','beer_styles'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)', _tbl||'_select', _tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_has_permission(''settings:manage'')) WITH CHECK (user_has_permission(''settings:manage''))', _tbl||'_write', _tbl);
  END LOOP;
END $$;

-- =============================================================================
-- SECTION 5l: ENTITY REVISIONS + LEGACY (all authenticated)
-- =============================================================================
CREATE POLICY entity_revisions_select ON entity_revisions FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY entity_revisions_insert ON entity_revisions FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY allocations_legacy_select ON allocations_legacy FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- SECTION 6: Schema registry update + reload
-- =============================================================================
UPDATE _schema_registry SET
  description = 'User profiles with multi-role array and activity tracking. Roles: admin, production_manager, brewer, sales, viewer, customer.',
  key_fields = '["display_name", "email", "roles", "status", "last_active_at"]'::jsonb,
  ai_context = '"Multi-role system using roles TEXT[]. Permission-based access via user_has_permission()."'::jsonb
WHERE table_name = 'user_profiles';

NOTIFY pgrst, 'reload schema';
