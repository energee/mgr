# Permission-Based Roles System

## Context

MGR currently has `withAuth` and `withRoles` middleware, 6 defined roles in the database, but only 3 of 20+ API routes enforce role checks. Integration management (QBO, Square, Slack, settings) is accessible to any authenticated user. A security review of the QBO integration identified that any authenticated user — including customer portal users — can overwrite OAuth tokens via direct PostgREST access due to missing RLS write restrictions.

This design introduces a permission-based role system with defense-in-depth enforcement at both the API and database layers.

## Decisions

- **Multi-role**: Users can hold multiple roles (`roles TEXT[]`). Permissions are additive (union of all role permissions).
- **Code-defined permission map**: Permission-to-role mapping lives in TypeScript (`src/lib/permissions.ts`), shared by API middleware and frontend. DB-stored customization deferred to a future iteration.
- **Defense in depth**: API routes enforce via `withPermission` middleware; RLS policies enforce via `user_has_permission()` Postgres function.
- **Static customer role**: Customer role is hardcoded to portal-only access. Not part of the configurable permission map.
- **Full role matrix**: All entity routes and tables get permission-based access control, not just integrations.

## Roles

| Role | Type | Description |
|------|------|-------------|
| `admin` | Staff | Full access. Manages integrations, users, settings. |
| `production_manager` | Staff | Scheduling, inventory, purchasing, order review. |
| `brewer` | Staff | Recipes, batches, vessels, brew logs. |
| `sales` | Staff | Orders, customers, pricing. |
| `viewer` | Staff | Read-only across all staff domains. |
| `customer` | Static | Portal only. Hardcoded to own orders + change requests. |

## Permissions

Permissions are strings in the form `domain:action`.

### Permission Map

| Permission | admin | production_manager | brewer | sales | viewer |
|---|---|---|---|---|---|
| `recipes:read` | x | x | x | x | x |
| `recipes:write` | x | | x | | |
| `batches:read` | x | x | x | x | x |
| `batches:write` | x | x | x | | |
| `orders:read` | x | x | | x | x |
| `orders:write` | x | | | x | |
| `customers:read` | x | x | | x | x |
| `customers:write` | x | | | x | |
| `inventory:read` | x | x | x | x | x |
| `inventory:write` | x | x | | | |
| `purchasing:read` | x | x | | | x |
| `purchasing:write` | x | x | | | |
| `vessels:read` | x | x | x | x | x |
| `vessels:write` | x | x | x | | |
| `integrations:manage` | x | | | | |
| `settings:manage` | x | | | | |
| `users:manage` | x | | | | |

## Enforcement Layers

### API Layer — `withPermission` middleware

```typescript
// src/lib/api/auth.ts
export function withPermission(permission: string, handler: AuthHandler) {
  return withAuth(async (context) => {
    const roles = context.user.roles; // TEXT[] from user_profiles
    if (context.user.role === 'customer') return forbidden();
    if (!hasPermission(roles, permission)) return forbidden();
    return handler(context);
  });
}

// Usage
export const POST = withPermission("integrations:manage", async ({ user, supabase }) => {
  // Only reachable if user has a role granting integrations:manage
});
```

### RLS Layer — Postgres permission functions

```sql
-- Returns which roles grant a given permission
CREATE FUNCTION get_roles_for_permission(p_permission TEXT)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ ... $$;

-- Checks if current user has any role granting the permission
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

-- Example RLS policy
CREATE POLICY recipes_update ON recipes
  FOR UPDATE USING (user_has_permission('recipes:write'));
```

### Frontend — Permission context

```typescript
const { can } = usePermissions();

{can("recipes:write") && <Button>Edit Recipe</Button>}
{can("integrations:manage") && <NavItem>Integrations</NavItem>}
```

- Permission map shared between API and frontend (same TypeScript module)
- UI gating is cosmetic — enforcement is API + RLS
- `EntityDetailUnified` auto-disables edit mode based on `entityName:write`

## Migration Path

### Database

1. **Alter `user_profiles.role` → `roles TEXT[]`**
   - Migrate existing single role to array: `'admin'` → `'{admin}'`
   - Update CHECK constraint to validate each array element
   - First user keeps `{admin}`

2. **Add permission helper functions** (`get_roles_for_permission`, `user_has_permission`)

3. **Update RLS policies on all entity tables**
   - Replace `USING ((SELECT auth.uid()) IS NOT NULL)` with permission-based checks
   - Separate SELECT and UPDATE/INSERT/DELETE policies per table

4. **Fix QBO security vulnerabilities**
   - Add RESTRICTIVE UPDATE/INSERT policies for sensitive `system_settings` keys
   - Add OAuth state validation to QBO callback
   - REVOKE execute on token RPC functions from PUBLIC

### Application

1. **`src/lib/permissions.ts`** — Permission map, `hasPermission()`, type definitions
2. **`src/lib/api/auth.ts`** — Add `withPermission`, update `withAuth` to fetch `roles[]`
3. **Update all API routes** — Replace `withAuth`/`withRoles` with `withPermission`
4. **Update `user_profiles` queries** — `role` → `roles` everywhere
5. **Frontend permission context** — `PermissionProvider`, `usePermissions` hook
6. **Admin user management** — Multi-select role checkboxes, permission preview

### Unchanged

- Portal routes (`customer_portal_users` RLS)
- Webhook routes (HMAC/secret auth, not user auth)
- `createAdminClient()` usage (service role bypasses RLS)
