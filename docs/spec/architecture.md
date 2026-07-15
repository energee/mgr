# Architecture

## Technology Stack

### Frontend
- **Framework**: Next.js 16.x (App Router)
- **React**: React 19.x
- **UI Components**: shadcn/ui
- **Styling**: Tailwind CSS 4.x

### TanStack Ecosystem
- **Server State**: TanStack Query 5.x - caching, mutations, optimistic updates
- **Forms**: TanStack Form - type-safe forms with fine-grained reactivity
- **Tables**: TanStack Table 8.x - headless tables for EntityList component
- **Virtualization**: TanStack Virtual 3.x - virtualize large lists (inventory, lots)
- **Validation**: Zod 3.x - schema validation, integrates with TanStack Form

### Backend
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **File Storage**: Supabase Storage
- **Realtime**: Supabase Realtime (for notifications, live updates)
- **Edge Functions**: Supabase Edge Functions (for integrations, complex calculations)

### Integrations
- **Accounting**: QuickBooks Online API
- **Notifications**: Slack (webhook-based, see [notifications.md](../data-model/notifications.md)), Email (Resend or similar)
- **POS**: Square API (taproom inventory sync)

#### Slack Integration Architecture
Database triggers call `notify_all_users()` which creates a `slack_notification_log` entry and fires an async HTTP POST via `pg_net` to `/api/slack/send`. The API route reads `slack_settings` for the webhook URL and channel routing, formats a Slack Block Kit message, and posts to Slack. See migration `00088_slack_integration.sql` for the full implementation.

### Deployment
- **Hosting**: Vercel
- **Database**: Supabase Cloud

---

## Architecture Decisions

### DEC-001: Entity Configuration System
Every entity (batch, recipe, order, etc.) defined declaratively in a single config file:
```typescript
interface EntityConfig<T> {
  name: string;
  table: string;
  displayName: string;
  listColumns: ColumnDef<T>[];       // What to show in list view
  formSchema: ZodSchema;              // Validation schema
  stateMachine?: StateMachineConfig;  // State transitions
  dialogs?: Record<string, DialogConfig>; // Action dialogs (customizable)
  relations: RelationDef[];           // Related entities
}
```
**Customization Escape Hatches**:
- `dialogs[action].component` - Custom dialog component when config isn't enough
- `listColumns[].render` - Custom cell renderer
- `sections[].component` - Custom section component for complex views
- `sections[].headerActions` - Component rendered next to section title (e.g., action buttons)
- `sections[].editComponent` - Separate component for edit mode when view/edit differ

**Custom Page Components (bypass EntityDetailUnified entirely):**

Some entities need fully custom editing experiences that go beyond entity config escape hatches. These use a status-based routing pattern on the detail page:

| Entity | Custom Component | When Active | Reference |
|--------|-----------------|-------------|-----------|
| Recipes | `RecipeEditorPage` | Always (recipes are always-editable) | `src/components/domain/recipe-editor/` |
| Packaging Sessions | `PackagingDayView` | When status = `in_progress` | `src/components/domain/packaging-day-view.tsx` |

The detail page checks entity state and routes to either the custom component or `EntityDetailUnified`. For packaging sessions, this means `in_progress` → `PackagingDayView` (real-time data entry), all other states → `EntityDetailUnified` (standard view/edit).

### DEC-002: Schema Registry for AI Integration
`_schema_registry` table contains self-documenting metadata:
- Entity descriptions and purposes
- Field-level documentation
- Relationship explanations
- Example natural language queries
- Available actions per entity

AI queries this to understand domain without external documentation.

> **See Also:** AI-specific decisions (DEC-AI-001 through DEC-AI-003) are documented in [AI Integration](./ai-integration.md).

### DEC-003: Universal State Machine
All stateful entities (batch, order, session, transfer, PO) use same pattern:
```typescript
stateMachine: {
  states: ['planned', 'fermenting', 'conditioning', 'packaged', 'completed'],
  transitions: {
    planned: ['fermenting', 'cancelled'],
    fermenting: ['conditioning', 'cancelled'],
    // ...
  },
  hooks: {
    onEnter: { fermenting: validateBrewStart },
    onExit: { packaged: createFinishedGoods }
  }
}
```

### DEC-004: TanStack Form over React Hook Form
- Fine-grained reactivity (only re-renders what changes)
- First-class TypeScript inference
- Consistent with rest of TanStack ecosystem
- Better async validation support

### DEC-005: Single-Tenant Architecture
**Status**: Implemented (January 2026)

**Changes from multi-tenant design**:
- Removed `breweries` and `user_breweries` tables
- Removed `brewery_id` foreign key from all data tables
- User roles stored directly in `users.roles` array
- Single `settings` table (singleton) for brewery configuration
- RLS policies check role membership, not brewery membership

**Authorization model**:
```sql
-- Users have roles directly
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  name TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}', -- ['admin', 'brewer', 'sales', 'production_manager']
  ...
);

-- RLS checks role membership
CREATE POLICY "Role-based access" ON batches FOR SELECT
USING (auth.uid() IN (SELECT id FROM users WHERE 'brewer' = ANY(roles)));
```

**Benefits**:
- Simpler data model (no brewery_id on every table)
- Easier queries (no brewery filtering)
- Reduced complexity (fewer joins, simpler RLS)
- Better performance (fewer indexes needed)

**Future multi-tenancy**: If needed, add back `breweries` table, `brewery_id` columns, and update RLS policies.

### DEC-006: Entity Configuration Extensions

**Status**: Implemented (January 2026)

The Entity Configuration System (DEC-001) has been extended with two patterns that enhance how entities interact with the database and forms.

#### View Tables for List Displays

Entity configurations can specify a `viewTable` property to use database views with joined/calculated columns for list displays, while maintaining the base `table` for CRUD operations.

**Pattern**:
```typescript
export const vesselEntity: EntityConfig<Vessel> = {
  name: "vessel",
  table: "vessels",              // Used for create, update, delete
  viewTable: "vessels_with_batch", // Used for list queries (includes joins)

  listColumns: [
    {
      accessorKey: "current_batch_id",
      header: "Current Batch",
      render: (_value, row) => {
        // Access joined columns from view
        const viewRow = row as VesselWithBatch;
        return viewRow.batch_number || viewRow.batch_name;
      },
    },
  ],
};
```

**When to use**:
- List displays need to show data from related tables (e.g., vessel list showing current batch name)
- Calculated fields are needed in list view (e.g., inventory with remaining quantity)
- Complex aggregations are required for display (e.g., orders with total value)

**Implementation**: EntityList component uses `entity.viewTable || entity.table` for queries ([entity-list.tsx:90-91](https://github.com/energee/mgr/blob/feature/phase-2-vessel-brewlog/src/components/universal/entity-list.tsx#L90-L91))

#### Dynamic Options for Form Fields

Form field configurations can specify `dynamicOptions` to populate select fields from database tables at runtime, enabling data-driven dropdowns.

**Pattern**:
```typescript
formFields: [
  {
    name: "style_id",
    label: "Style",
    type: "select",
    dynamicOptions: {
      table: "beer_styles",        // Table to query
      valueField: "id",            // Field to use as option value
      labelField: "name",          // Field to display as option label
      filter: { is_active: true }, // Optional WHERE conditions
      orderBy: "name",             // Optional ORDER BY clause
    },
  },
]
```

**When to use**:
- Foreign key fields where options come from another table (e.g., selecting a style for a brand)
- Dropdown values that change frequently (e.g., active locations, available ingredients)
- Fields that need filtered options based on business rules (e.g., only active items)

**When NOT to use**:
- Static enums or fixed value lists (use hardcoded `options` array instead)
- Complex multi-table joins (use `relation` type field instead)
- Very large datasets (>1000 records) where autocomplete would be better

**Example** (brand.tsx):
```typescript
{
  name: "style_id",
  label: "Style",
  type: "select",
  dynamicOptions: {
    table: "beer_styles",
    valueField: "id",
    labelField: "name",
    orderBy: "name",
  },
}
```

**Relationship to `relation` type**:
- `dynamicOptions`: Simple select field populated from a table, stores primitive value
- `relation`: Foreign key field that stores UUID, may render as autocomplete/lookup with entity preview
- Use `dynamicOptions` for simple dropdowns, `relation` for full entity relationships

---

## Database Schema

> **Source of Truth:** Detailed table definitions are in [`/docs/data-model/`](../data-model/). This section covers conventions and patterns only.

### Naming Conventions
- Tables: `snake_case`, plural (e.g., `batches`, `finished_goods`)
- Columns: `snake_case` (e.g., `created_at`, `updated_at`)
- Enums: `snake_case` (e.g., `batch_status`)
- Foreign keys: `{table_singular}_id` (e.g., `batch_id`, `recipe_id`)

### Common Columns
All tables include:
- `id` - UUID primary key
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp (where applicable)
- `is_active` - Soft delete flag (where applicable)

### Domain Overview

| Domain | Key Tables | Documentation |
|--------|-----------|---------------|
| Catalog | beer_styles, yeasts, malts, hops, adjuncts, sugars, spices, fruits, additives | [catalog.md](../data-model/catalog.md) |
| Production | recipes, batches, vessels, batch_readings, batch_additions, yeast_pitches | [production.md](../data-model/production.md) |
| Inventory | inventory_items, allocations, bins, bin_inventory, location_transfers | [inventory.md](../data-model/inventory.md) |
| Packaging | containers, selling_formats, channel_formats, packaging_sessions, finished_goods | [packaging.md](../data-model/packaging.md) |
| Sales | customers, orders, sales_channels, price_tiers, tier_prices | [sales.md](../data-model/sales.md) |
| Purchasing | suppliers, purchase_orders, po_line_items, inventory_lots | [purchasing.md](../data-model/purchasing.md) |
| Kegs | keg_owners, keg_inventory, customer_keg_balances, keg_transactions | [kegs.md](../data-model/kegs.md) |
| Notifications | notifications, notification_preferences, slack_settings, slack_notification_log | [notifications.md](../data-model/notifications.md) |
| System | settings, locations | [system.md](../data-model/system.md) |

### Key Design Patterns

#### Allocation-Based Inventory
No mutable running balances. Quantities calculated from allocation records:
```
Available = Total Quantity - SUM(planned + completed allocations)
```

#### JSONB for Flexibility
Recipe ingredients, measurements, and schedules use JSONB arrays for flexibility while maintaining catalog references for inventory linking.

#### State Machines
Stateful entities use consistent state machine patterns defined in their respective domain docs.
Transitions are enforced at **both** the client (TypeScript `StateMachineConfig` in `src/entities/`) and the server (PostgreSQL trigger `validate_state_transition()` reading from `get_state_transitions()`). The transition map in `get_state_transitions()` must stay in sync with the TypeScript configs. Tables with server-side enforcement: `batches`, `orders`, `purchase_orders`, `packaging_sessions`, `brew_logs`, `allocations`, `pick_lists`, `recipes`.

All application transition entry points submit `transition_entity_atomic` through `entityService.transition`. The RPC locks and compares the current state, applies allowlisted pre-transition fields, changes status, and performs registered inventory/accounting/vessel/order effects in one PostgreSQL transaction. Bulk transitions are atomic per record: one record may roll back without undoing successful peers, and callers report the failed count. Do not reintroduce a client `UPDATE` followed by asynchronous side effects.

---

## Performance & Optimization

### DEC-PERF-001: Allocation Indexes
**Status**: Pending implementation

```sql
-- Allocation approval workflow (high priority)
CREATE INDEX idx_allocations_status_date
  ON allocations(status, created_at DESC);

-- Source/destination lookups with status (common query pattern)
CREATE INDEX idx_allocations_src_dest_status
  ON allocations(source_type, destination_type, status);

-- TTB reporting (monthly aggregations)
CREATE INDEX idx_allocations_dest_created
  ON allocations(destination_type, created_at);

-- FG order fulfillment (hot path - very frequent)
CREATE INDEX idx_allocations_fg_order
  ON allocations(source_id, destination_type)
  WHERE source_type = 'finished_good' AND destination_type = 'order';

-- Inventory lot availability (frequent)
CREATE INDEX idx_allocations_inventory_lot
  ON allocations(source_id, status)
  WHERE source_type = 'inventory_lot';

-- Bin inventory lookups
CREATE INDEX idx_bin_inventory_bin_fg_qty
  ON bin_inventory(bin_id, finished_good_id)
  WHERE quantity > 0;

-- Vessel transfer performance (for vessels_with_current_batch view)
CREATE INDEX idx_vessel_transfers_to_vessel
  ON vessel_transfers(to_vessel_id, transferred_at DESC);
CREATE INDEX idx_vessel_transfers_from_batch
  ON vessel_transfers(from_vessel_id, batch_id, transferred_at);
```

### DEC-PERF-002: Calculated Field Views
**Status**: Pending implementation

```sql
-- Inventory lots with calculated remaining quantity
CREATE VIEW inventory_lots_with_quantities AS
SELECT
  il.*,
  il.quantity as received_quantity,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  il.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as remaining_quantity
FROM inventory_lots il
LEFT JOIN allocations a
  ON a.source_type = 'inventory_lot' AND a.source_id = il.id
GROUP BY il.id;

-- Finished goods with available quantity
CREATE VIEW finished_goods_with_availability AS
SELECT
  fg.*,
  fg.quantity as total_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) as planned_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as available_quantity
FROM finished_goods fg
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id;
```

### DEC-PERF-003: Materialized Views for Scale
**Status**: Conditional (implement when thresholds exceeded)

**Thresholds:**
| View | Materialize When | Refresh Strategy |
|------|-----------------|------------------|
| `recipes_with_estimates` | >500 recipes | On recipe/ingredient change |
| `vessels_with_current_batch` | >100 vessels | On vessel_transfers change |
| `ttb_monthly_summaries` | Always | Monthly or on-demand |

### DEC-PERF-004: RLS Policy Performance
**Status**: Implemented (January 2026)

Row Level Security (RLS) policies in Supabase/PostgreSQL can cause significant performance issues when `auth.<function>()` calls are evaluated per-row instead of once per query.

**The Problem:**
```sql
-- BAD: auth.uid() is evaluated for each row
CREATE POLICY example_access ON table_name
  FOR ALL USING (auth.uid() IS NOT NULL);
```

**The Solution:**
```sql
-- GOOD: Subquery makes it an InitPlan, evaluated once per query
CREATE POLICY example_access ON table_name
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);
```

**Why this works:** Wrapping the function in a subquery `(SELECT ...)` converts it to a PostgreSQL InitPlan, which is executed once and cached for the entire query execution.

**When writing RLS policies:**
1. Always wrap `auth.uid()`, `auth.jwt()`, and other `auth.<function>()` calls in a subquery
2. Always wrap `current_setting()` calls in a subquery
3. For complex policies, consider using a helper function with `SECURITY DEFINER` that caches the user context

**Examples:**
```sql
-- Simple authentication check
CREATE POLICY table_access ON my_table
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- User-specific access
CREATE POLICY user_data_access ON user_data
  FOR ALL USING (user_id = (SELECT auth.uid()));

-- Role-based access
CREATE POLICY admin_access ON admin_table
  FOR ALL USING (
    (SELECT auth.uid()) IN (
      SELECT id FROM users WHERE 'admin' = ANY(roles)
    )
  );
```

### DEC-PERF-005: Index Management
**Status**: Implemented (January 2026)

**Best Practices:**
1. Always use `CREATE INDEX IF NOT EXISTS` to prevent duplicate index errors during migrations
2. Use consistent naming: `idx_<table>_<column>` or `idx_<table>_<purpose>`
3. Before creating a new index, verify no equivalent index exists
4. Document index purpose in migrations with comments

### Scalability Guidelines

| Entity | Comfortable Limit | Action at Threshold |
|--------|------------------|---------------------|
| allocations | 5M rows | Partition by year |
| finished_goods | 500K rows | Archive old records |
| batches | 50K rows | No action needed |
| orders | 200K rows | Archive after 2 years |
| inventory_lots | 100K rows | Annual cleanup of depleted lots |
| vessel_transfers | 100K rows | Consider materialized view |

---

## Deviations from Original Spec

| Area | Original | Implementation | Rationale |
|------|----------|----------------|-----------|
| Mobile | Separate mobile app | Responsive web + PWA | Single codebase |
| Notifications | In-app, email, Slack | In-app + Slack | Email deferred |
| Next.js | 14+ | 16.x | Latest stable |
| Forms | React Hook Form | TanStack Form | Ecosystem consistency |
| Tenancy | Multi-tenant SaaS | Single-tenant | Simpler for target use case |

---

## Database Security Guidelines

### DEC-SEC-001: View Security (security_invoker)
**Status**: Enforced (January 2026)

All views in the public schema MUST use `security_invoker = true` to ensure RLS policies are respected.

```sql
-- CORRECT: Uses caller's permissions
CREATE VIEW my_view
WITH (security_invoker = true)
AS SELECT ...;

-- WRONG: Uses view owner's permissions (bypasses RLS)
CREATE VIEW my_view AS SELECT ...;
```

**Rationale**: By default, PostgreSQL views use SECURITY DEFINER behavior, meaning they run with the permissions of the view creator (usually postgres). This bypasses Row Level Security policies and can expose data to unauthorized users.

### DEC-SEC-002: Never Expose auth.users
**Status**: Enforced (January 2026)

Views and functions MUST NOT join with or select from `auth.users` directly.

```sql
-- WRONG: Exposes auth.users data
CREATE VIEW recent_activity AS
SELECT a.*, u.email
FROM activities a
JOIN auth.users u ON a.user_id = u.id;

-- CORRECT: Cache user info in the table or use a users table
CREATE VIEW recent_activity AS
SELECT a.*, a.user_name  -- Cached at write time
FROM activities a;
```

**Rationale**: The `auth.users` table contains sensitive authentication data. Exposing it through views can leak user emails and metadata to the PostgREST API.

### DEC-SEC-003: RLS Must Be Enabled
**Status**: Enforced (January 2026)

All tables in the public schema MUST have RLS enabled. If a policy exists, RLS MUST be enabled.

```sql
-- CORRECT: Enable RLS before or after creating policy
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_policy ON my_table ...;

-- WRONG: Policy without RLS enabled (policy has no effect!)
CREATE POLICY my_policy ON my_table ...;
-- Missing: ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
```

### DEC-SEC-004: Function Search Path
**Status**: Enforced (January 2026)

All functions MUST set `search_path` to prevent search path injection attacks.

```sql
-- CORRECT: Explicit search path
CREATE FUNCTION my_func()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$ ... $$;

-- WRONG: Mutable search path
CREATE FUNCTION my_func()
RETURNS void
LANGUAGE plpgsql
AS $$ ... $$;
```

**Rationale**: Without an explicit search_path, malicious users could potentially hijack function calls by creating objects in their own schema that shadow public schema objects.

### DEC-SEC-005: Extensions Not in Public Schema
**Status**: Recommended

Extensions should be installed in the `extensions` schema, not `public`.

```sql
-- CORRECT: Extension in dedicated schema
CREATE EXTENSION pg_trgm SCHEMA extensions;

-- NOT RECOMMENDED: Extension in public
CREATE EXTENSION pg_trgm;  -- Defaults to public
```

### DEC-SEC-006: Restrictive RLS Policies
**Status**: Enforced (January 2026)

Avoid overly permissive RLS policies. Never use `WITH CHECK (true)` for INSERT/UPDATE/DELETE unless absolutely necessary.

```sql
-- WRONG: Allows anyone to insert
CREATE POLICY "Too permissive" ON my_table
  FOR INSERT WITH CHECK (true);

-- CORRECT: Restrict to specific roles or conditions
CREATE POLICY "Users can insert own records" ON my_table
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

### DEC-SEC-007: Permission-Based Role System

**Status:** Implemented
**Date:** 2026-02-12

Multi-role permission system with defense-in-depth enforcement:
- Users hold multiple roles (`roles TEXT[]` in `user_profiles`)
- Permissions are code-defined in `src/lib/permissions.ts` (not database-configurable)
- API routes use `withPermission("domain:action")` middleware
- RLS policies use `user_has_permission()` Postgres function
- Customer role is hardcoded to portal-only access
- Frontend uses `usePermissions()` hook for cosmetic UI gating

See `docs/spec/auth.md` for the full permission matrix.

### DEC-SEC-008: Active Profile Is an Authorization Prerequisite

**Status:** Enforced
**Date:** 2026-07-15

A valid Supabase JWT and an authorized role are both insufficient unless the
caller's matching `user_profiles` row exists with `status = 'active'`.
`pending`, `inactive`, missing, and unreadable profiles fail closed across the
staff and portal layouts, API wrappers, permission helpers, and authenticated
RLS policies. Every public RLS table carries a restrictive enabled-user policy
so permissive customer or legacy policies cannot bypass account revocation.

Account status and role changes are not self-service profile writes.
Status changes use a durable per-user database fence so concurrent commands
cannot interleave across Supabase Auth. Deactivation claims and persists the
database denial before banning the Auth user; reactivation claims without
opening RLS, unbans Auth, then enables the profile while releasing the fence.
A failed enable re-bans as compensation. Fences do not automatically expire,
because a paused old process must never resume after a newer opposite command.
This ordering makes an old JWT lose database access immediately and keeps
known partial failures safely retryable.

### Automated Security Checks

The project includes CI checks that run `supabase db lint` on every PR. All ERROR-level findings must be resolved before merging.

| Level | Action Required |
|-------|-----------------|
| ERROR | Must fix before merge |
| WARN | Should fix, review if acceptable |
| INFO | Consider fixing |

---

## UI Component Governance

### DEC-007: Status Labels from Entity Configs
**Status**: Enforced (January 2026)

All status/enum display labels MUST come from entity configuration `stateMachine.stateDisplay`, never hardcoded in components.

**Pattern**:
```typescript
import { vesselEntity } from "@/entities";
import { getStateLabel, getStateColor } from "@/types/entity";

// CORRECT: Use entity config helpers
<Badge>{getStateLabel(vesselEntity, status)}</Badge>

// WRONG: Hardcoded status config in component
const statusConfig = { available: "Available", in_use: "In Use" };
<Badge>{statusConfig[status]}</Badge>
```

**Helper functions** (`src/types/entity.ts`):
- `getStateLabel(entity, state)` - Returns display label from entity config, falls back to formatted state
- `getStateColor(entity, state)` - Returns color from entity config
- `formatStateLabel(state)` - Converts snake_case to Title Case (fallback)

**Rationale**: Single source of truth for status labels prevents inconsistencies when new statuses are added to the database. Entity configs are the canonical source.

### DEC-008: Radix Select Empty String Constraint
**Status**: Enforced (January 2026)

Radix UI's Select component reserves empty string (`""`) for "no selection" state. Entity configs and filter options MUST NOT use empty strings as option values.

**Problem**:
```typescript
// WRONG: Empty string causes React error
<SelectItem value="">All</SelectItem>

// Error: A <Select.Item /> must have a value prop that is not an empty string.
```

**Solution** (implemented in `entity-list.tsx`):
```typescript
// Filter out empty strings and use sentinel value "_all"
<Select value={filterValue || "_all"} onValueChange={(v) => setFilter(v === "_all" ? "" : v)}>
  <SelectContent>
    <SelectItem value="_all">All</SelectItem>
    {/* Filter out empty string values - Radix Select doesn't allow them */}
    {options
      .filter((option) => option.value !== "")
      .map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
  </SelectContent>
</Select>
```

**Entity config guidance**:
- For filter "All" options: Don't include `{ value: "", label: "All" }` - the component adds it
- For form "None" options: Use a sentinel like `{ value: "_none", label: "None" }` or omit

**Affected files**:
- `src/components/universal/entity-list.tsx` - Filters empty strings defensively
- `src/components/universal/entity-form.tsx` - Maps `_none` sentinel for optional selects

---

## Related Documents

- [Decisions](./decisions.md) - Schema review decisions
- [AI Integration](../AI.md) - AI assistance patterns
- [Data Model](../data-model/) - Schema details
