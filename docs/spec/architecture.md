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
- **Notifications**: Slack API, Email (Resend or similar)
- **POS**: Square API (taproom inventory sync)

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
- `detailSections[].component` - Custom section component

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
| Packaging | package_types, packaging_sessions, finished_goods | [packaging.md](../data-model/packaging.md) |
| Sales | customers, orders, sales_channels, price_tiers, tier_prices | [sales.md](../data-model/sales.md) |
| Purchasing | suppliers, purchase_orders, po_line_items, inventory_lots | [purchasing.md](../data-model/purchasing.md) |
| Kegs | keg_types, keg_inventory, customer_keg_balances, keg_transactions | [kegs.md](../data-model/kegs.md) |
| Notifications | notifications, notification_preferences, slack_settings | [notifications.md](../data-model/notifications.md) |
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
| Notifications | In-app, email, Slack | In-app only (Phase 1) | Ship core first |
| Next.js | 14+ | 16.x | Latest stable |
| Forms | React Hook Form | TanStack Form | Ecosystem consistency |
| Tenancy | Multi-tenant SaaS | Single-tenant | Simpler for target use case |

## Related Documents

- [Decisions](./decisions.md) - Schema review decisions
- [AI Integration](../AI.md) - AI assistance patterns
- [Data Model](../data-model/) - Schema details
