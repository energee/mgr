# Authentication & Authorization

## Authentication

- Supabase Auth with email/password
- Magic link option for passwordless login (used by customer portal)
- Session management via Supabase

## Roles

Users hold one or more roles in `user_profiles.roles TEXT[]`. Permissions are additive across all assigned roles.

| Role | Description |
|------|-------------|
| **admin** | Full system access including setup, users, integrations |
| **production_manager** | Scheduling, packaging, inventory, purchasing, order review |
| **brewer** | Recipes, batches, brew logs, readings, additions, vessels |
| **sales** | Orders, customers, pricing, sales channels |
| **viewer** | Read-only access to all data |
| **customer** | Portal access only -- not part of the permission system (see [Customer Portal](#customer-portal)) |

Staff roles (`admin` through `viewer`) participate in the permission system. The `customer` role is hardcoded to portal-only access with its own RLS policies.

## Permissions

Permissions are strings in `resource:action` format. The source of truth is `src/lib/permissions.ts`.

### Permission Matrix

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

## Enforcement

Defense-in-depth: permissions are enforced at three layers.

### 1. API Layer (enforcement)

`withPermission("domain:action")` middleware in `src/lib/api/auth.ts` wraps route handlers. It loads `user_profiles.roles`, calls `hasPermission()`, and returns 403 if denied.

```typescript
// src/lib/api/auth.ts
export const GET = withPermission("recipes:read", async (request, context) => {
  // context.roles, context.permissions available
});
```

### 2. Database Layer (enforcement)

`user_has_permission(p_permission TEXT)` Postgres function is used in RLS policies. It checks `user_profiles.roles` against a SQL mirror of the permission map via `get_roles_for_permission()`.

```sql
-- RLS policy using permission function
CREATE POLICY "Permission-based access" ON batches
  FOR SELECT USING (user_has_permission('batches:read'));

-- The function (from migration 00092):
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
```

### 3. Frontend (cosmetic gating only)

`usePermissions()` hook from `src/contexts/permissions.tsx` provides `can()` and `hasRole()` for UI gating. This is convenience only -- not a security boundary.

```typescript
const { can } = usePermissions();

// Hide button if user lacks permission
{can("batches:write") && <Button>Create Batch</Button>}
```

## Customer Portal

The customer portal (`/portal`) provides a separate interface for brewery customers to view orders and request changes.

### Authentication Flow

1. Admin sends portal invite from customer detail page (Settings > Customers > [customer] > "Send Portal Invite")
2. Customer receives magic link email
3. Customer clicks link or enters OTP code at `/portal/login`
4. On first login, auto-links auth user to customer record by email match via `customer_portal_users` junction table

### Portal Features

- **Order list** (`/portal/orders`) -- all orders for linked customers
- **Order detail** (`/portal/orders/[id]`) -- items, totals, change request status
- **Change requests** (`/portal/orders/[id]/change-request/new`) -- add, modify, or remove items (subject to cutoff state)

### Many-to-Many User Mapping

Portal users are linked to customers via `customer_portal_users` (junction table):
- One user can access multiple customers' orders
- One customer can have multiple portal users

### Change Request Cutoff

Each sales channel has a `change_request_cutoff_state` (default: `confirmed`). Customers can only submit change requests on orders whose status is below the cutoff. Admins configure this at Settings > Sales Channels > [channel].

### Role Behavior

- Users with `customer` role are redirected from the admin app to `/portal`
- The `customer` role is auto-assigned when an auth user's email matches an existing customer record
- Brewery contact email (from Settings > System > `brewery_email`) is shown on the "No Account Linked" page
- Customer role does not participate in the `PERMISSION_MAP` -- portal access is governed by dedicated RLS policies on `customer_portal_users`

## How to Add a New Permission

1. **TypeScript**: Add the permission string to the `Permission` type and `PERMISSION_MAP` in `src/lib/permissions.ts`
2. **SQL**: Update `get_roles_for_permission()` in a new migration to mirror the TypeScript map
3. **RLS**: Add/update RLS policies on affected tables using `user_has_permission('new:permission')`
4. **API**: Wrap relevant route handlers with `withPermission("new:permission", handler)`
5. **Frontend** (optional): Use `can("new:permission")` in components for UI gating

## Related Documents

- [Architecture](./architecture.md) - DEC-005 (single-tenant), DEC-SEC-007 (permission-based roles)
- [Data Model: System](../data-model/system.md) - Full schema details
