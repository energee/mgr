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

## Related Documents

- [Architecture](./architecture.md) - Single-tenant decision (DEC-005)
- [Data Model: System](../data-model/system.md) - Full schema details
