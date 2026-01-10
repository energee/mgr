# Architecture Changes: Multi-Tenant → Single-Tenant

**Date**: January 2026
**Status**: Complete

## Overview

MGR has been updated from a multi-tenant architecture to a single-tenant architecture. This decision simplifies the system for single-brewery use while maintaining all core functionality.

## Key Changes

### 1. Database Schema

#### Removed Tables
- `breweries` - No longer needed
- `user_breweries` - Replaced with role array on users table

#### Updated Tables
All tables that previously included `brewery_id UUID NOT NULL REFERENCES breweries(id)` now omit this field:
- `locations`
- `styles`, `beers`, `products`
- `recipes`, `recipe_ingredients`
- `suppliers`, `ingredients`, `inventory_lots`, `purchase_orders`
- `yeast_strains`, `yeast_pitches`
- `vessels`, `batches`, `brew_logs`
- `packaging_formats`, `packaging_sessions`, `finished_goods`
- `bins`, `location_transfers`
- `keg_types`, `keg_inventory`, `keg_transactions`
- `sales_channels`, `customers`, `price_tiers`, `orders`
- `allocations`
- `notifications`, `notification_preferences`

#### New/Updated System Tables

**users** table now includes:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}', -- ['admin', 'brewer', 'sales', 'production_manager']
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**system_settings** table for global configuration:
```sql
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Authorization Model

**Before (Multi-Tenant)**:
- Users belonged to breweries via `user_breweries` table
- Roles assigned per brewery
- RLS policies filtered by `brewery_id`

**After (Single-Tenant)**:
- Users have roles directly in `users.roles` array
- Roles apply globally
- RLS policies check role membership

**Example RLS Policy Update**:

Before:
```sql
CREATE POLICY "Users can view own brewery data"
ON batches FOR SELECT
USING (
  brewery_id IN (
    SELECT brewery_id FROM user_breweries
    WHERE user_id = auth.uid()
  )
);
```

After:
```sql
CREATE POLICY "Users can view data based on role"
ON batches FOR SELECT
USING (
  auth.uid() IN (
    SELECT user_id FROM users
    WHERE 'brewer' = ANY(roles)
       OR 'production_manager' = ANY(roles)
       OR 'admin' = ANY(roles)
  )
);
```

### 3. API Changes

**Request Authentication**:
- Removed `x-brewery-id` header requirement
- Simplified to user authentication + role checking

**Function Signatures**:
```typescript
// Before
async function generateTTBReport(breweryId: string, month: Date)
async function sendNotification(breweryId: string, type: NotificationType, data: any)

// After
async function generateTTBReport(month: Date)
async function sendNotification(type: NotificationType, data: any)
```

### 4. UI/Navigation

**Settings Section**:
- Changed from "Brewery" to "System"
- Single global configuration instead of per-brewery settings

### 5. Integrations

**QuickBooks**:
- Changed from per-brewery connections to system-wide connection
- Single OAuth token set

**Slack**:
- Changed from per-brewery webhook to system-wide webhook
- Single Slack channel configuration

## Migration Path

For existing deployments, migration requires:

1. **Schema Updates**:
   ```sql
   -- Add roles to users table
   ALTER TABLE users ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}';

   -- Migrate roles from user_breweries
   UPDATE users u
   SET roles = ub.roles
   FROM user_breweries ub
   WHERE u.id = ub.user_id;

   -- Create system_settings table
   CREATE TABLE system_settings (...);

   -- Migrate brewery settings to system_settings
   INSERT INTO system_settings (key, value)
   SELECT 'brewery_name', to_jsonb(name) FROM breweries LIMIT 1;

   -- Drop multi-tenant tables
   DROP TABLE user_breweries;
   DROP TABLE breweries;
   ```

2. **Remove brewery_id columns** from all data tables (if they exist)

3. **Update RLS policies** to use role-based checks

4. **Update application code** to remove brewery context

## Benefits of Single-Tenant

1. **Simpler Data Model**: No brewery_id foreign keys on every table
2. **Easier Queries**: No need to filter by brewery_id in every query
3. **Reduced Complexity**: Fewer joins, simpler RLS policies
4. **Better Performance**: Fewer indexes needed, simpler query plans
5. **Clearer Authorization**: Role-based access is more straightforward

## Documentation Updates

Updated files:
- [`docs/MGR-SPECIFICATION.md`](./MGR-SPECIFICATION.md) - Removed Section 4, updated all schema definitions
- [`CLAUDE.md`](../CLAUDE.md) - Updated settings reference
- [`docs/ARCHITECTURE-CHANGES.md`](./ARCHITECTURE-CHANGES.md) - This document

## Future Considerations

If multi-tenancy is needed in the future:
1. Add back `breweries` table
2. Add `brewery_id` to all data tables
3. Create `user_breweries` junction table
4. Update RLS policies to filter by brewery
5. Add brewery context to API requests
6. Update UI to support brewery selection/switching

However, the current single-tenant architecture is sufficient for the intended use case and provides a cleaner, simpler foundation to build upon.
