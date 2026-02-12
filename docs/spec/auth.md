# Authentication & Authorization

## Authentication

- Supabase Auth with email/password
- Magic link option for passwordless login
- Session management via Supabase

## Roles

| Role | Description |
|------|-------------|
| **Admin** | Full system access including setup, users, integrations |
| **Production Manager** | Scheduling, packaging, inventory, purchasing, order review |
| **Brewer** | Recipes, batches, brew logs, readings, additions, vessels |
| **Sales** | Orders, customers, pricing, sales channels |
| **Viewer** | Read-only access to all data |
| **Customer** | Portal access only — view own orders, submit change requests |

## Role Capabilities Matrix

| Capability | Admin | Prod Mgr | Brewer | Sales |
|------------|-------|----------|--------|-------|
| **System Setup** |
| Manage locations | ✓ | | | |
| Manage formats | ✓ | | | |
| Manage keg types | ✓ | | | |
| Manage users | ✓ | | | |
| Manage integrations | ✓ | | | |
| System settings | ✓ | | | |
| **Production** |
| Create/edit recipes | ✓ | ✓ | ✓ | |
| Create/edit batches | ✓ | ✓ | ✓ | |
| Record brew logs | ✓ | ✓ | ✓ | |
| Record batch readings | ✓ | ✓ | ✓ | |
| Add batch additions | ✓ | ✓ | ✓ | |
| Manage vessels | ✓ | ✓ | ✓ | |
| Schedule batches | ✓ | ✓ | | |
| **Packaging & Inventory** |
| Manage packaging sessions | ✓ | ✓ | | |
| Manage finished goods | ✓ | ✓ | | |
| Manage bins | ✓ | ✓ | | |
| Create transfers | ✓ | ✓ | | |
| **Purchasing** |
| Create purchase orders | ✓ | ✓ | | |
| Receive inventory | ✓ | ✓ | | |
| Manage suppliers | ✓ | ✓ | | |
| Manage ingredients | ✓ | ✓ | | |
| **Sales** |
| Create/edit orders | ✓ | | | ✓ |
| Review orders | ✓ | ✓ | | ✓ |
| Manage customers | ✓ | | | ✓ |
| Manage price tiers | ✓ | | | ✓ |
| Manage sales channels | ✓ | | | ✓ |
| **Reporting** |
| View all reports | ✓ | ✓ | | |
| View production reports | ✓ | ✓ | ✓ | |
| View sales reports | ✓ | | | ✓ |

## Multi-Role Support

- Users can have multiple roles assigned
- Permissions are additive (union of all role capabilities)
- Roles stored in `users.roles` array field

## Row Level Security (RLS)

All tables must have RLS policies ensuring:
- Role-based access control
- Service role bypasses RLS for system operations

```sql
-- Example RLS policy pattern
CREATE POLICY "Users with appropriate role can view batches"
ON batches FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND (
      'Admin' = ANY(users.roles) OR
      'Production Manager' = ANY(users.roles) OR
      'Brewer' = ANY(users.roles)
    )
  )
);
```

## Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  full_name TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Customer Portal

The customer portal (`/portal`) provides a separate interface for brewery customers to view orders and request changes.

### Authentication Flow

1. Admin sends portal invite from customer detail page (Settings > Customers > [customer] > "Send Portal Invite")
2. Customer receives magic link email
3. Customer clicks link or enters OTP code at `/portal/login`
4. On first login, auto-links auth user to customer record by email match via `customer_portal_users` junction table

### Portal Features

- **Order list** (`/portal/orders`) — all orders for linked customers
- **Order detail** (`/portal/orders/[id]`) — items, totals, change request status
- **Change requests** (`/portal/orders/[id]/change-request/new`) — add, modify, or remove items (subject to cutoff state)

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

## Related Documents

- [Architecture](./architecture.md) - Single-tenant decision (DEC-005)
- [Data Model: System](../data-model/system.md) - Full schema details
