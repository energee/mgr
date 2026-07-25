# Authentication & Authorization

## Authentication

- Supabase Auth with email/password
- Magic link option for passwordless login (used by customer portal)
- Password recovery via emailed reset link (see [Password Recovery](#password-recovery))
- Session management via Supabase

## Password Recovery

Staff users who forget their password reset it through a Supabase recovery email rather than direct admin intervention.

### Flow

1. User clicks "Forgot password?" on `/login` and enters their email at `/forgot-password`
2. The form calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/api/auth/callback?type=recovery\` })` — Supabase requires an absolute URL that matches the project's allow-listed Redirect URLs
3. Supabase emails a one-time recovery link
4. Clicking the link hits `/api/auth/callback?type=recovery&code=...`, which exchanges the code for a recovery session and forwards to `/update-password`
5. `/update-password` is a server component that confirms a session exists and renders a password-set form; submission calls `supabase.auth.updateUser({ password })` and redirects home

### Routing

- `/forgot-password` lives in the `(auth)` route group (same split-screen shell as login/signup, redirects already-authenticated users away)
- `/update-password` is **outside** the `(auth)` group on purpose — recovery callbacks land with a fresh session and must NOT be bounced. It uses its own layout that reuses the shared `AuthShell` component but skips the redirect.
- `/api/auth/callback` distinguishes recovery from magic-link/OAuth via the `type` query param (`AUTH_CALLBACK_TYPE_RECOVERY` constant in `src/lib/auth-utils.ts`). The `type=recovery` branch forwards to `/update-password`; absent or other `type` values follow the existing `redirect` param logic (allow-list-validated by `isValidRedirect`).

### Deliverability prerequisites

For the recovery email to actually deliver, the Supabase project must have:

- The active origin (e.g., `https://app.example.com/**`, `http://localhost:3000/**`) listed under **Authentication → URL Configuration → Redirect URLs** — otherwise Supabase silently strips the `redirectTo`
- A custom SMTP provider configured under **Project Settings → Auth → SMTP Settings** — the built-in service is rate-limited (~2 emails/hour) and unreliable

### Files

- `src/app/(auth)/forgot-password/page.tsx` + `forgot-password-form.tsx`
- `src/app/update-password/layout.tsx` + `page.tsx` + `update-password-form.tsx`
- `src/app/api/auth/callback/route.ts` — recovery branch
- `src/components/auth/auth-shell.tsx` — shared split-screen wrapper
- `src/lib/auth-utils.ts` — `AUTH_CALLBACK_TYPE_RECOVERY`, `rememberEmail`, `readRememberedEmail`

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

Defense-in-depth: permissions are enforced at three layers. At every enforcing
layer, a valid session and an authorized role are insufficient unless the
caller's matching `user_profiles` row exists with `status = 'active'`.
`pending`, `inactive`, missing, and unreadable profiles fail closed.

### 1. API Layer (enforcement)

`withPermission("domain:action")` middleware in `src/lib/api/auth.ts` wraps route handlers. It loads `user_profiles.roles` and `status`, requires `active`, calls `hasPermission()`, and returns 403 if either prerequisite is denied. `withAuth()` applies the same active-profile check to authenticated routes that do not require a granular permission.

```typescript
// src/lib/api/auth.ts
export const GET = withPermission("recipes:read", async (request, context) => {
  // context.roles, context.permissions available
});
```

### 2. Database Layer (enforcement)

`user_has_permission(p_permission TEXT)` Postgres function is used in RLS policies. It first applies `current_user_is_enabled()`, then checks `user_profiles.roles` against a SQL mirror of the permission map via `get_roles_for_permission()`. A restrictive `current_user_enabled` policy on every public RLS table composes with permissive staff/customer policies, so an old valid JWT cannot bypass deactivation.

```sql
-- RLS policy using permission function
CREATE POLICY "Permission-based access" ON batches
  FOR SELECT USING (user_has_permission('batches:read'));

-- Current helper contract (migration 00255):
CREATE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT current_user_is_enabled()
    AND EXISTS (
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

## Account Status Changes

`roles` and `status` are authorization fields. Users may update ordinary
profile data but cannot change their own roles or status. Active admins may
change another user's roles, but even an admin cannot write status directly.

The dedicated `POST /api/users/:id/status` command coordinates PostgreSQL and
Supabase Auth under a durable per-user operation fence:

- **Deactivate:** claim the user and persist `inactive` in one transaction,
  then ban the Auth user, then release the matching claim. Old JWTs lose RLS
  access before the external Auth call.
- **Reactivate:** claim the user without opening RLS, unban Auth, then persist
  `active` and release the matching claim in one transaction. A failed enable
  re-bans Auth before a known-safe claim release.
- Concurrent or duplicate commands fail with `409` before touching Auth. A
  crashed/unknown attempt remains fenced rather than expiring and allowing a
  stale process to overwrite a newer command.

Self-deactivation is rejected to prevent an administrator from removing their
own recovery path. Pending accounts have no protected access and may be either
approved through Reactivate or declined through Deactivate.

## Customer Portal

The customer portal (`/portal`) provides a separate interface for brewery customers to view orders and request changes.

### Authentication Flow

1. Staff with `customers:write` opens **Sales > Customers > [customer] > Portal Access** and enters a contact email
2. The server provisions the auth identity without sending mail, assigns the portal-only `customer` role, and creates the `customer_portal_users` link
3. Only after the role and link exist, the route adds the configured `brewery_name` to the auth user's portal-email metadata and Supabase sends the contact a portal-specific magic-link/OTP email
4. The customer clicks the token-hash link, which `/api/auth/confirm` exchanges for a cookie-backed session before redirecting to `/portal/orders`; entering the OTP code at `/portal/login` remains available as a fallback

The ordering in steps 2–3 is security-sensitive: an additional contact's email
does not necessarily match `customers.email`, so the auth-profile trigger may
initially apply the default `viewer` role. The invite route replaces that role
and persists the customer link before sending usable credentials.

The hosted Supabase **Magic Link** subject and HTML must match
`supabase/templates/magic-link-subject.txt` and
`supabase/templates/magic-link.html`. The template deliberately uses
`TokenHash` instead of `ConfirmationURL`: Supabase's default implicit-flow URL
returns the session in a fragment that a server callback cannot read, while
`/api/auth/confirm` verifies the token hash and writes the SSR session cookies.
`RedirectTo` is treated only as a same-origin destination.
Deploy `/api/auth/confirm` before updating the hosted template; reversing that
order would break existing magic links.

### Portal Features

- **Order list** (`/portal/orders`) -- all orders for linked customers
- **Order detail** (`/portal/orders/[id]`) -- items, totals, change request status
- **Change requests** (`/portal/orders/[id]/change-request/new`) -- add, modify, or remove items (subject to cutoff state)

### Many-to-Many User Mapping

Portal users are linked to customers via `customer_portal_users` (junction table):
- One user can access multiple customers' orders
- One customer can have multiple portal users
- Staff can invite, resend, and remove individual contacts from the customer's **Portal Access** section
- Removing one link leaves that user's links to other customers unchanged
- Removing access stamps `revoked_at` instead of deleting the row (migration `00276`, issue #605). The tombstone is what distinguishes "never linked" from "deliberately unlinked": the portal layout auto-links a matching email only when NO row exists for that customer/user pair, and every RLS policy derived from the junction requires `revoked_at IS NULL`
- The auto-link ignores customers with `is_active = false`, matching the invite route's 409
- Re-granting through the invite route clears `revoked_at`; it is the only path that does

### Change Request Cutoff

Each sales channel has a `change_request_cutoff_state` (default: `confirmed`). Customers can only submit change requests on orders whose status is below the cutoff. Admins configure this at Settings > Sales Channels > [channel].

### Role Behavior

- Users with `customer` role are redirected from the admin app to `/portal`
- The `customer` role is auto-assigned when an auth user's email matches an existing customer record; the invite route explicitly enforces it for additional contacts
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
