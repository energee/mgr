# Permission-Based Roles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a full permission-based role system with multi-role support, enforced at both the API layer (`withPermission` middleware) and database layer (RLS with `user_has_permission()` function).

**Architecture:** Code-defined permission map in `src/lib/permissions.ts` maps roles to permission strings (`domain:action`). API routes use `withPermission("domain:action")` middleware. RLS policies use a Postgres `user_has_permission()` function that mirrors the TypeScript map. Users hold multiple roles (`roles TEXT[]`), permissions are additive.

**Tech Stack:** TypeScript, Next.js API routes, Supabase/PostgreSQL RLS, React Context

**Design doc:** `docs/plans/2026-02-12-permission-based-roles-design.md`

---

## Task 1: Create Permission Map Module

**Files:**
- Create: `src/lib/permissions.ts`

**Step 1: Create the permission map and helpers**

```typescript
// src/lib/permissions.ts

export const STAFF_ROLES = [
  "admin",
  "production_manager",
  "brewer",
  "sales",
  "viewer",
] as const;

export const ALL_ROLES = [...STAFF_ROLES, "customer"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

export type Permission =
  | "recipes:read" | "recipes:write"
  | "batches:read" | "batches:write"
  | "orders:read" | "orders:write"
  | "customers:read" | "customers:write"
  | "inventory:read" | "inventory:write"
  | "purchasing:read" | "purchasing:write"
  | "vessels:read" | "vessels:write"
  | "integrations:manage"
  | "settings:manage"
  | "users:manage";

/**
 * Permission map: which staff roles grant which permissions.
 * Customer role is hardcoded to portal-only — not in this map.
 * Permissions are additive across roles.
 */
export const PERMISSION_MAP: Record<Permission, readonly StaffRole[]> = {
  "recipes:read":       ["admin", "production_manager", "brewer", "sales", "viewer"],
  "recipes:write":      ["admin", "brewer"],
  "batches:read":       ["admin", "production_manager", "brewer", "sales", "viewer"],
  "batches:write":      ["admin", "production_manager", "brewer"],
  "orders:read":        ["admin", "production_manager", "sales", "viewer"],
  "orders:write":       ["admin", "sales"],
  "customers:read":     ["admin", "production_manager", "sales", "viewer"],
  "customers:write":    ["admin", "sales"],
  "inventory:read":     ["admin", "production_manager", "brewer", "sales", "viewer"],
  "inventory:write":    ["admin", "production_manager"],
  "purchasing:read":    ["admin", "production_manager", "viewer"],
  "purchasing:write":   ["admin", "production_manager"],
  "vessels:read":       ["admin", "production_manager", "brewer", "sales", "viewer"],
  "vessels:write":      ["admin", "production_manager", "brewer"],
  "integrations:manage": ["admin"],
  "settings:manage":    ["admin"],
  "users:manage":       ["admin"],
};

/** Check if a set of roles grants a specific permission. */
export function hasPermission(roles: UserRole[], permission: Permission): boolean {
  if (roles.includes("customer")) {
    // Customer role only has portal access, no staff permissions
    // If user ALSO has a staff role, that staff role's permissions apply
    const staffRoles = roles.filter((r): r is StaffRole => r !== "customer");
    if (staffRoles.length === 0) return false;
    return staffRoles.some((role) => PERMISSION_MAP[permission].includes(role));
  }
  return roles.some((role) =>
    PERMISSION_MAP[permission]?.includes(role as StaffRole)
  );
}

/** Get all permissions for a set of roles. */
export function getPermissions(roles: UserRole[]): Permission[] {
  return (Object.keys(PERMISSION_MAP) as Permission[]).filter((perm) =>
    hasPermission(roles, perm)
  );
}

/** Get all roles that grant a specific permission. */
export function getRolesForPermission(permission: Permission): StaffRole[] {
  return [...PERMISSION_MAP[permission]];
}
```

**Step 2: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "feat: add permission map module with role-to-permission mapping"
```

---

## Task 2: Update Auth Middleware

**Files:**
- Modify: `src/lib/api/auth.ts`

**Step 1: Update types and add withPermission**

The current `withRoles` fetches `profile.role` (single TEXT). Update to:

1. Add `PermissionContext` type with `roles: UserRole[]` and `permissions: Permission[]`
2. Add `withPermission(permission, handler)` that:
   - Fetches `user_profiles.roles` (TEXT[])
   - Short-circuits `customer`-only users to 403 for non-portal routes
   - Checks `hasPermission(roles, permission)`
   - Passes `{ user, supabase, roles, permissions, params }` to handler
3. Keep `withAuth` unchanged (still just checks authentication)
4. Keep `withRoles` as deprecated wrapper for backward compat during migration

```typescript
// Add imports
import { type UserRole, type Permission, hasPermission, getPermissions } from "@/lib/permissions";

// New context type
export interface PermissionContext extends AuthContext {
  roles: UserRole[];
  permissions: Permission[];
}

// New handler type
type PermissionHandler = (
  request: NextRequest,
  context: PermissionContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

// New middleware
export function withPermission(permission: Permission, handler: PermissionHandler) {
  return withAuth(async (request, context) => {
    const { user, supabase } = context;

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("roles")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      throw new ApiError("FORBIDDEN", "Unable to determine user roles", 403);
    }

    const roles = (profile.roles ?? []) as UserRole[];

    if (!hasPermission(roles, permission)) {
      throw new ApiError(
        "FORBIDDEN",
        `This action requires the ${permission} permission`,
        403
      );
    }

    return handler(request, {
      ...context,
      roles,
      permissions: getPermissions(roles),
    });
  });
}
```

**Step 2: Run lint**

Run: `pnpm lint`

**Step 3: Commit**

```bash
git add src/lib/api/auth.ts
git commit -m "feat: add withPermission middleware for permission-based API auth"
```

---

## Task 3: Database Migration — Multi-Role & Permission Functions

**Files:**
- Create: `supabase/migrations/00092_permission_based_roles.sql`

This is the core migration. It must:
1. Alter `user_profiles.role` TEXT → `roles TEXT[]`
2. Migrate existing single role to array
3. Add permission helper functions for RLS
4. Update the `create_user_profile` trigger to use `roles`
5. Update the `user_profiles_with_details` view

**Step 1: Write the migration**

```sql
-- Permission-Based Roles Migration
--
-- Converts user_profiles from single role (TEXT) to multi-role (TEXT[]).
-- Adds Postgres permission functions mirroring the TypeScript permission map.
-- Updates RLS policies to use permission-based checks.

-- =============================================================================
-- 1. Alter user_profiles: role TEXT → roles TEXT[]
-- =============================================================================

-- Add new column
ALTER TABLE user_profiles ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{viewer}';

-- Migrate existing data
UPDATE user_profiles SET roles = ARRAY[role];

-- Drop old constraint and column
ALTER TABLE user_profiles DROP CONSTRAINT chk_user_role;
ALTER TABLE user_profiles DROP COLUMN role;

-- Add array element validation
CREATE FUNCTION validate_user_roles(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(roles) AS r
    WHERE r NOT IN ('admin', 'production_manager', 'brewer', 'sales', 'viewer', 'customer')
  )
  AND array_length(roles, 1) > 0;
$$;

ALTER TABLE user_profiles
  ADD CONSTRAINT chk_user_roles CHECK (validate_user_roles(roles));

-- =============================================================================
-- 2. Permission helper functions
-- =============================================================================

-- Returns which roles grant a specific permission.
-- Mirrors PERMISSION_MAP in src/lib/permissions.ts — keep in sync!
CREATE FUNCTION get_roles_for_permission(p_permission TEXT)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
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

-- Checks if current user has any role granting the given permission.
-- Use in RLS policies: USING (user_has_permission('recipes:read'))
CREATE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid())
    AND roles && get_roles_for_permission(p_permission)
  );
$$;

-- Checks if current user has any of the given roles.
-- Convenience for non-permission checks (e.g., customer gating).
CREATE FUNCTION user_has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = (SELECT auth.uid())
    AND p_role = ANY(roles)
  );
$$;

-- =============================================================================
-- 3. Update create_user_profile trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_first_user BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM user_profiles) INTO _is_first_user;

  INSERT INTO user_profiles (id, email, display_name, roles, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN _is_first_user THEN ARRAY['admin'] ELSE ARRAY['viewer'] END,
    'active'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 4. Update user_profiles_with_details view
-- =============================================================================

DROP VIEW IF EXISTS user_profiles_with_details;
CREATE VIEW user_profiles_with_details
WITH (security_invoker = true)
AS
SELECT
  up.*,
  -- Format roles for display (first role as primary display)
  INITCAP(REPLACE(roles[1], '_', ' ')) AS role_display,
  INITCAP(REPLACE(up.status, '_', ' ')) AS status_display,
  inviter.display_name AS invited_by_name,
  CASE
    WHEN up.last_active_at IS NULL THEN NULL
    ELSE EXTRACT(DAY FROM NOW() - up.last_active_at)::INTEGER
  END AS days_since_active
FROM user_profiles up
LEFT JOIN user_profiles inviter ON up.invited_by = inviter.id;

-- =============================================================================
-- 5. Update RLS policies — entity tables
-- =============================================================================

-- Helper: Drop a policy if it exists (avoids errors)
-- We'll drop the old FOR ALL policies and replace with separate SELECT/WRITE policies.

-- --- RECIPES ---
DROP POLICY IF EXISTS recipe_access ON recipes;
CREATE POLICY recipes_select ON recipes
  FOR SELECT USING (user_has_permission('recipes:read'));
CREATE POLICY recipes_write ON recipes
  FOR ALL USING (user_has_permission('recipes:write'))
  WITH CHECK (user_has_permission('recipes:write'));

-- recipe_yeasts
DROP POLICY IF EXISTS recipe_yeasts_access ON recipe_yeasts;
CREATE POLICY recipe_yeasts_select ON recipe_yeasts
  FOR SELECT USING (user_has_permission('recipes:read'));
CREATE POLICY recipe_yeasts_write ON recipe_yeasts
  FOR ALL USING (user_has_permission('recipes:write'))
  WITH CHECK (user_has_permission('recipes:write'));

-- recipe_variants and sub-tables
DROP POLICY IF EXISTS recipe_variants_access ON recipe_variants;
CREATE POLICY recipe_variants_select ON recipe_variants
  FOR SELECT USING (user_has_permission('recipes:read'));
CREATE POLICY recipe_variants_write ON recipe_variants
  FOR ALL USING (user_has_permission('recipes:write'))
  WITH CHECK (user_has_permission('recipes:write'));

DO $$ BEGIN
  -- recipe_variant sub-tables
  FOR _tbl IN SELECT unnest(ARRAY[
    'recipe_variant_hops', 'recipe_variant_adjuncts',
    'recipe_variant_fruits', 'recipe_variant_spices'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''recipes:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''recipes:write'')) WITH CHECK (user_has_permission(''recipes:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- BATCHES ---
DROP POLICY IF EXISTS batch_access ON batches;
CREATE POLICY batches_select ON batches
  FOR SELECT USING (user_has_permission('batches:read'));
CREATE POLICY batches_write ON batches
  FOR ALL USING (user_has_permission('batches:write'))
  WITH CHECK (user_has_permission('batches:write'));

-- brew_logs, brew_log_batches, batch_additions, batch_blends, yeast_pitches
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'brew_logs', 'brew_log_batches', 'batch_additions',
    'batch_blends', 'yeast_pitches'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS batch_log_access ON %I', _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''batches:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''batches:write'')) WITH CHECK (user_has_permission(''batches:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- ORDERS ---
DROP POLICY IF EXISTS order_access ON orders;
DROP POLICY IF EXISTS order_item_access ON order_items;
CREATE POLICY orders_select ON orders
  FOR SELECT USING (user_has_permission('orders:read'));
CREATE POLICY orders_write ON orders
  FOR ALL USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));
CREATE POLICY order_items_select ON order_items
  FOR SELECT USING (user_has_permission('orders:read'));
CREATE POLICY order_items_write ON order_items
  FOR ALL USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- order_change_requests — portal users can read their own, staff per permission
DROP POLICY IF EXISTS order_change_requests_access ON order_change_requests;
DROP POLICY IF EXISTS order_change_requests_portal_select ON order_change_requests;
CREATE POLICY ocr_staff_select ON order_change_requests
  FOR SELECT USING (user_has_permission('orders:read'));
CREATE POLICY ocr_staff_write ON order_change_requests
  FOR ALL USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- order_change_request_items
DROP POLICY IF EXISTS order_change_request_items_access ON order_change_request_items;
CREATE POLICY ocri_staff_select ON order_change_request_items
  FOR SELECT USING (user_has_permission('orders:read'));
CREATE POLICY ocri_staff_write ON order_change_request_items
  FOR ALL USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- --- CUSTOMERS ---
DROP POLICY IF EXISTS customer_access ON customers;
CREATE POLICY customers_select ON customers
  FOR SELECT USING (user_has_permission('customers:read'));
CREATE POLICY customers_write ON customers
  FOR ALL USING (user_has_permission('customers:write'))
  WITH CHECK (user_has_permission('customers:write'));

-- --- INVENTORY ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'inventory_items', 'inventory_lots', 'finished_goods',
    'allocations', 'bins', 'bin_inventory', 'bin_inventory_items',
    'keg_inventory', 'keg_types', 'keg_owners', 'keg_owner_deposits'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS inventory_item_access ON %I', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS allocation_access ON %I', _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''inventory:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''inventory:write'')) WITH CHECK (user_has_permission(''inventory:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- PURCHASING ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'suppliers', 'supplier_catalog', 'purchase_orders',
    'po_line_items', 'po_receives'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''purchasing:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''purchasing:write'')) WITH CHECK (user_has_permission(''purchasing:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- VESSELS ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'locations', 'vessels', 'vessel_transfers', 'vessel_cleanings',
    'location_transfers', 'transfer_lines'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''vessels:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''vessels:write'')) WITH CHECK (user_has_permission(''vessels:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- INTEGRATIONS (admin only) ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'square_settings', 'square_catalog_map', 'square_sync_log',
    'square_draft_sales', 'slack_settings', 'slack_notification_log'
  ]) LOOP
    -- Drop all existing policies by known names
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can manage %I" ON %I', _tbl, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can read %I" ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''integrations:manage''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''integrations:manage'')) WITH CHECK (user_has_permission(''integrations:manage''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- SETTINGS (admin only for writes, all staff for reads) ---
-- system_settings already has complex policies from 00058/00064; leave those
-- settings singleton
DROP POLICY IF EXISTS settings_access ON settings;
CREATE POLICY settings_select ON settings
  FOR SELECT USING (user_has_permission('settings:manage'));
CREATE POLICY settings_write ON settings
  FOR ALL USING (user_has_permission('settings:manage'))
  WITH CHECK (user_has_permission('settings:manage'));

-- --- USER PROFILES ---
-- Keep existing policies (users can read all, update own, admin updates any)
-- Add: only admin can INSERT (invite) — already exists from 00036

-- --- SHARED/CATALOG TABLES (all staff read, admin write) ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'brands', 'enum_values', 'package_types',
    'sales_channels', 'pricing_tiers', 'pricing_tier_prices', 'pricing_history'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS package_type_access ON %I', _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''settings:manage'')) WITH CHECK (user_has_permission(''settings:manage''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- PACKAGING (batches:write for now, since it's production-adjacent) ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY[
    'packaging_sessions', 'session_line_items'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''batches:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''batches:write'')) WITH CHECK (user_has_permission(''batches:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- PICK LISTS (orders-adjacent) ---
DO $$ BEGIN
  FOR _tbl IN SELECT unnest(ARRAY['pick_lists', 'pick_list_items']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_access ON %I', _tbl, _tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (user_has_permission(''orders:read''))',
      _tbl, _tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_write ON %I FOR ALL USING (user_has_permission(''orders:write'')) WITH CHECK (user_has_permission(''orders:write''))',
      _tbl, _tbl
    );
  END LOOP;
END $$;

-- --- DELIVERIES (orders-adjacent) ---
DROP POLICY IF EXISTS deliveries_access ON deliveries;
CREATE POLICY deliveries_select ON deliveries
  FOR SELECT USING (user_has_permission('orders:read'));
CREATE POLICY deliveries_write ON deliveries
  FOR ALL USING (user_has_permission('orders:write'))
  WITH CHECK (user_has_permission('orders:write'));

-- --- NOTIFICATIONS (user's own) ---
-- Keep existing per-user policies unchanged

-- --- ENTITY REVISIONS (all staff read) ---
DROP POLICY IF EXISTS entity_revisions_access ON entity_revisions;
CREATE POLICY entity_revisions_select ON entity_revisions
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY entity_revisions_write ON entity_revisions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- --- SCHEMA REGISTRY (read-only for all) ---
-- Already has schema_registry_read, keep it

-- =============================================================================
-- 6. Update schema registry for user_profiles
-- =============================================================================

UPDATE _schema_registry
SET description = 'User profiles with multi-role support (roles TEXT[]). Roles: admin, production_manager, brewer, sales, viewer, customer.'
WHERE table_name = 'user_profiles';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
```

**Step 2: Apply migration to dev project**

Apply via Supabase MCP or `supabase db push`. Verify with:
```sql
SELECT id, email, roles FROM user_profiles LIMIT 5;
SELECT user_has_permission('recipes:read');
```

**Step 3: Commit**

```bash
git add supabase/migrations/00092_permission_based_roles.sql
git commit -m "feat: multi-role user profiles and permission-based RLS policies"
```

---

## Task 4: Update API Routes

**Files:**
- Modify: All API route files under `src/app/api/`

Replace `withAuth` with `withPermission` on routes that need access control. Replace `withRoles` with `withPermission`.

**Route → Permission mapping:**

| Route | Current | New |
|-------|---------|-----|
| `/api/batches` GET | `withAuth` | `withPermission("batches:read")` |
| `/api/batches` POST | `withAuth` | `withPermission("batches:write")` |
| `/api/batches/[id]` GET | `withAuth` | `withPermission("batches:read")` |
| `/api/batches/[id]` PATCH | `withAuth` | `withPermission("batches:write")` |
| `/api/batches/[id]` DELETE | `withAuth` | `withPermission("batches:write")` |
| `/api/batches/[id]/transfer` POST | `withAuth` | `withPermission("batches:write")` |
| `/api/recipes` GET | `withAuth` | `withPermission("recipes:read")` |
| `/api/recipes` POST | `withAuth` | `withPermission("recipes:write")` |
| `/api/recipes/[id]` GET | `withAuth` | `withPermission("recipes:read")` |
| `/api/recipes/[id]` PATCH | `withAuth` | `withPermission("recipes:write")` |
| `/api/recipes/[id]` DELETE | `withAuth` | `withPermission("recipes:write")` |
| `/api/customers/[id]/invite` POST | `withRoles(["admin"])` | `withPermission("customers:write")` |
| `/api/orders/.../approve` POST | `withRoles(["admin","sales"])` | `withPermission("orders:write")` |
| `/api/orders/.../reject` POST | `withRoles(["admin","sales"])` | `withPermission("orders:write")` |
| `/api/users/[id]` DELETE | `withRoles(["admin"])` | `withPermission("users:manage")` |
| `/api/settings/api-key` GET/POST | Manual auth | `withPermission("settings:manage")` |
| `/api/slack/settings` GET/PUT | Manual auth | `withPermission("integrations:manage")` |
| `/api/slack/test` POST | `withAuth` | `withPermission("integrations:manage")` |
| `/api/square/sync` POST | `withAuth` | `withPermission("integrations:manage")` |
| `/api/square/sync/catalog` POST | `withAuth` | `withPermission("integrations:manage")` |
| `/api/square/sync/inventory` POST | `withAuth` | `withPermission("integrations:manage")` |
| `/api/square/sync/status` GET | `withAuth` | `withPermission("integrations:manage")` |
| `/api/square/sync/status` POST | `withAuth` | `withPermission("integrations:manage")` |
| `/api/chat` | `withAuth` | Keep `withAuth` (all staff) |

**Step 1: Update each route file**

For each route, change the import and wrapper. Example pattern:

```typescript
// Before
import { withAuth } from "@/lib/api/auth";
export const GET = withAuth(async (request, { user, supabase, params }) => {

// After
import { withPermission } from "@/lib/api/auth";
export const GET = withPermission("batches:read", async (request, { user, supabase, params }) => {
```

For routes with manual auth (settings/api-key, slack/settings), refactor to use `withPermission` wrapper instead of inline auth checks.

**Step 2: Run lint**

Run: `pnpm lint`

**Step 3: Commit**

```bash
git add src/app/api/
git commit -m "feat: replace withAuth/withRoles with withPermission on all API routes"
```

---

## Task 5: Frontend Permission Context

**Files:**
- Create: `src/contexts/permissions.tsx`
- Modify: `src/components/domain/app-providers.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/query-keys.ts`

**Step 1: Add permission query key**

In `src/lib/query-keys.ts`, add:
```typescript
export const permissionKeys = {
  all: () => ["permissions"] as const,
  current: () => ["permissions", "current"] as const,
};
```

**Step 2: Create permission context**

```typescript
// src/contexts/permissions.tsx
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  type UserRole,
  type Permission,
  hasPermission as checkPermission,
  getPermissions,
} from "@/lib/permissions";

interface PermissionContextValue {
  roles: UserRole[];
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

interface PermissionProviderProps {
  roles: UserRole[];
  children: ReactNode;
}

export function PermissionProvider({ roles, children }: PermissionProviderProps) {
  const value = useMemo(() => {
    const permissions = getPermissions(roles);
    return {
      roles,
      permissions,
      can: (permission: Permission) => checkPermission(roles, permission),
      hasRole: (role: UserRole) => roles.includes(role),
    };
  }, [roles]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error("usePermissions must be used within PermissionProvider");
  }
  return context;
}
```

**Step 3: Update app layout to fetch roles[]**

In `src/app/(app)/layout.tsx`, change:
```typescript
// Before (line 30-34)
const { data: profile } = await supabase
  .from("user_profiles")
  .select("role")
  .eq("id", user.id)
  .single();

if (profile?.role === "customer") {
  redirect("/portal/orders");
}

// After
const { data: profile } = await supabase
  .from("user_profiles")
  .select("roles")
  .eq("id", user.id)
  .single();

const roles = (profile?.roles ?? ["viewer"]) as UserRole[];

if (roles.length === 1 && roles[0] === "customer") {
  redirect("/portal/orders");
}
```

Pass `roles` to `AppProviders`:
```tsx
<AppProviders roles={roles}>
```

**Step 4: Update AppProviders to include PermissionProvider**

In `src/components/domain/app-providers.tsx`:
```typescript
import { PermissionProvider } from "@/contexts/permissions";
import type { UserRole } from "@/lib/permissions";

interface AppProvidersProps {
  roles: UserRole[];
  children: ReactNode;
}

export function AppProviders({ roles, children }: AppProvidersProps) {
  // ... existing useEffect ...
  return (
    <PermissionProvider roles={roles}>
      <NotificationsProvider>
        <KeyboardShortcutsProvider>
          <ChatProvider>{children}</ChatProvider>
        </KeyboardShortcutsProvider>
      </NotificationsProvider>
    </PermissionProvider>
  );
}
```

**Step 5: Run lint**

Run: `pnpm lint`

**Step 6: Commit**

```bash
git add src/contexts/permissions.tsx src/components/domain/app-providers.tsx \
  src/app/\(app\)/layout.tsx src/lib/query-keys.ts
git commit -m "feat: add PermissionProvider context and usePermissions hook"
```

---

## Task 6: Update User Profile Entity for Multi-Role

**Files:**
- Modify: `src/entities/user-profile.tsx`

**Step 1: Update types, schema, and form fields**

Key changes:
1. `role: UserRole` → `roles: UserRole[]`
2. Zod schema: `role: z.enum(...)` → `roles: z.array(z.enum(...)).min(1)`
3. Form field: single select → multi-select checkboxes
4. List column: show primary role badge + count indicator

```typescript
// Type change
interface UserProfile {
  // ...
  roles: UserRole[];  // was: role: UserRole
  // ...
}

// Schema change
export const userProfileSchema = z.object({
  display_name: z.string().min(1, "Display name is required"),
  roles: z.array(
    z.enum(["admin", "production_manager", "brewer", "sales", "viewer", "customer"])
  ).min(1, "At least one role is required"),
  status: z.enum(["active", "inactive", "pending"]).default("active"),
  avatar_url: z.string().url().nullable().optional(),
});

// Form field change
{
  name: "roles",
  label: "Roles",
  type: "multiselect",  // New field type needed, or use checkboxes
  options: ROLE_OPTIONS,
  required: true,
  colSpan: 12,
  description: "Select one or more roles. Permissions are additive across roles.",
},

// List column change — show badges for each role
{
  accessorKey: "roles",
  header: "Roles",
  sortable: false,
  render: (value) => {
    const roles = (value as string[]) || [];
    return (
      <div className="flex flex-wrap gap-1">
        {roles.map((r) => (
          <StatusBadge key={r} status={r} config={ROLE_DISPLAY} />
        ))}
      </div>
    );
  },
},
```

**Step 2: Update detail sections**

Change `role_display` → `roles` in detail view with appropriate formatting.

**Step 3: Run lint**

Run: `pnpm lint`

**Step 4: Commit**

```bash
git add src/entities/user-profile.tsx
git commit -m "feat: update user profile entity for multi-role support"
```

---

## Task 7: UI Permission Gating

**Files:**
- Modify: `src/components/domain/app-sidebar.tsx` — hide nav sections by permission
- Modify: `src/components/universal/entity-detail-unified.tsx` — disable edit when no write permission

**Step 1: Gate sidebar navigation**

In `app-sidebar.tsx`, use `usePermissions` to conditionally render nav sections:

```typescript
import { usePermissions } from "@/contexts/permissions";

// Inside component:
const { can } = usePermissions();

// Hide integrations section if user lacks integrations:manage
{can("integrations:manage") && (
  <SidebarGroup>
    <SidebarGroupLabel>Integrations</SidebarGroupLabel>
    {/* Square, Slack, QBO links */}
  </SidebarGroup>
)}

// Hide settings section items based on permissions
{can("settings:manage") && <SidebarMenuItem>Settings</SidebarMenuItem>}
{can("users:manage") && <SidebarMenuItem>Users</SidebarMenuItem>}
```

**Step 2: Gate entity edit mode**

In `entity-detail-unified.tsx`, derive write permission from entity domain:

```typescript
import { usePermissions } from "@/contexts/permissions";

// Map entity domain to write permission
const domainToPermission: Record<string, Permission> = {
  production: "batches:write",
  inventory: "inventory:write",
  sales: "orders:write",
  purchasing: "purchasing:write",
  system: "settings:manage",
};

const { can } = usePermissions();
const writePermission = domainToPermission[entity.domain];
const canEdit = writePermission ? can(writePermission) : false;

// Disable edit toggle if user can't write
{canEdit && <Button onClick={toggleEdit}>Edit</Button>}
```

**Note:** This is cosmetic gating — the real enforcement is at API + RLS layers.

**Step 3: Run lint**

Run: `pnpm lint`

**Step 4: Commit**

```bash
git add src/components/domain/app-sidebar.tsx src/components/universal/entity-detail-unified.tsx
git commit -m "feat: gate sidebar navigation and edit mode by user permissions"
```

---

## Task 8: Update Auth Spec Documentation

**Files:**
- Modify: `docs/spec/auth.md`
- Modify: `docs/spec/architecture.md`

**Step 1: Update auth.md**

Rewrite to reflect the new permission-based system:
- Multi-role model (roles TEXT[])
- Permission map (reference `src/lib/permissions.ts`)
- Enforcement layers (API withPermission + RLS user_has_permission)
- Customer role as static/hardcoded
- How to add new permissions

**Step 2: Update architecture.md**

Add decision entry for the permission system (e.g., DEC-SEC-007).

**Step 3: Commit**

```bash
git add docs/spec/auth.md docs/spec/architecture.md
git commit -m "docs: update auth spec and architecture for permission-based roles"
```

---

## Task 9: Regenerate TypeScript Types

**Files:**
- Modify: `src/types/supabase.ts`

**Step 1: Regenerate types**

Use Supabase MCP `generate_typescript_types` to regenerate types after the migration. The `user_profiles` table type should now show `roles: string[]` instead of `role: string`.

**Step 2: Fix any type errors**

Run: `pnpm lint`

Any references to `profile.role` need updating to `profile.roles`. Grep for `.role` accesses on user profile objects.

**Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore: regenerate Supabase types for multi-role user profiles"
```

---

## Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Permission map module | — |
| 2 | Auth middleware (withPermission) | Task 1 |
| 3 | Database migration (roles[], RLS) | — |
| 4 | Update API routes | Tasks 1, 2 |
| 5 | Frontend permission context | Task 1 |
| 6 | User profile entity (multi-role) | Task 3 |
| 7 | UI permission gating | Task 5 |
| 8 | Documentation | All above |
| 9 | Regenerate TypeScript types | Task 3 |

Tasks 1 and 3 can be done in parallel. Tasks 2 and 5 can be done in parallel. Task 4 depends on 1+2. Tasks 6, 7, 9 depend on 3.
