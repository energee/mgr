# MGR - Brewery Management System
## Technical Specification Document

**Version:** 1.0
**Date:** January 2026
**Purpose:** Complete specification for building MGR, a professional brewery management system

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
   - 2A. [Architecture Decisions](#2a-architecture-decisions)
   - 2B. [Schema Review Decisions](#2b-schema-review-decisions-january-2026)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Database Schema](#4-database-schema)
5. [Core Modules](#5-core-modules)
6. [State Machines & Workflows](#6-state-machines--workflows)
7. [Allocation System](#7-allocation-system)
8. [Rollback & Adjustment Rules](#8-rollback--adjustment-rules)
9. [Unit System](#9-unit-system)
10. [Notifications](#10-notifications)
11. [Reporting](#11-reporting)
12. [Integrations](#12-integrations)
13. [File Storage](#13-file-storage)
14. [UI/UX Guidelines](#14-uiux-guidelines)
15. [API Structure](#15-api-structure)
16. [Migration Plan](#16-migration-plan)
17. [Appendices](#appendix-a-environment-variables)
    - A. Environment Variables
    - B. Glossary
    - C. References
    - D. Enum Registry

---

## 1. Overview

### 1.1 What is MGR?

MGR is a comprehensive brewery management system designed for professional brewing operations. It handles the complete lifecycle from production planning through fulfillment, with emphasis on:

- **Planning & Allocation**: Plan batches months ahead, allocate inventory before it exists, adjust as reality differs from plan
- **Traceability**: Track beer from ingredients through batch, packaging, inventory, and customer delivery
- **Flexibility**: Rollback when possible, adjust when not, never block operations
- **Cost Tracking**: Full COGS visibility including ingredient costs, yeast lineage spreading, and landed costs

### 1.2 Core Principles

1. **Planning-First**: Everything can be planned in advance (batches, packaging, orders)
2. **Allocation-Based Inventory**: No mutable running balances; quantities calculated from allocations
3. **Non-Blocking Operations**: Brewers should never be blocked by system state; log what happened, reconcile later
4. **Full Audit Trail**: All changes logged with revisions; history recalculates on backdated adjustments
5. **Mobile-First for Operations**: Brewing floor activities designed for mobile use

### 1.3 Key Flows

```
Recipe ──────────────────────────────────────────────────────────────────────────────────────────────
    │
    ├──→ Brew Log (hot-side) ──→ brew_log_batches ──→ Batch (cold-side) ──→ Packaging ──→ FG ──→ Orders
    │    - brew_date (actual)    (volume allocation)  - planned_start_date
    │    - events timeline                            - fermentation
    │    - OG (from events)                           - FG, ABV
    │
    └──→ Batch (cold-side)  ←─────────────────────────┘
         can have multiple brews (blend)
         or one brew can split to multiple batches
```

```
Demand (planned batches) → PO Generation → Supplier → Receive → Inventory Lots → Usage → COGS
```

---

## 2. Technology Stack

### 2.1 Frontend
- **Framework**: Next.js 16.x (App Router)
- **React**: React 19.x
- **UI Components**: shadcn/ui
- **Styling**: Tailwind CSS 4.x

### 2.2 TanStack Ecosystem
- **Server State**: TanStack Query 5.x - caching, mutations, optimistic updates
- **Forms**: TanStack Form - type-safe forms with fine-grained reactivity
- **Tables**: TanStack Table 8.x - headless tables for EntityList component
- **Virtualization**: TanStack Virtual 3.x - virtualize large lists (inventory, lots)
- **Validation**: Zod 3.x - schema validation, integrates with TanStack Form

### 2.3 Backend
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **File Storage**: Supabase Storage
- **Realtime**: Supabase Realtime (for notifications, live updates)
- **Edge Functions**: Supabase Edge Functions (for integrations, complex calculations)

### 2.4 Integrations
- **Accounting**: QuickBooks Online API
- **Notifications**: Slack API, Email (Resend or similar)

### 2.5 Deployment
- **Hosting**: Vercel
- **Database**: Supabase Cloud

---

## 2A. Architecture Decisions

### Design Philosophy
1. **Primitives over Modules** - Composable building blocks, not monolithic features
2. **Schema as Documentation** - Database schema is self-describing for AI integration
3. **One Pattern, Many Uses** - Universal components that adapt to context via configuration
4. **Minimize, Don't Maximize** - Only build what's needed

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
**Decision**: Single-tenant architecture instead of multi-tenant SaaS.

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

**Future multi-tenancy**: If needed, add back `breweries` table, `brewery_id` columns, and update RLS policies. Current schema documented in `docs/data-model/system.md` under "Future: Multi-Tenant Support".

### Deviations from Original Spec
| Area | Original | Implementation | Rationale |
|------|----------|----------------|-----------|
| Mobile | Separate mobile app | Responsive web + PWA | Single codebase |
| Notifications | In-app, email, Slack | In-app only (Phase 1) | Ship core first |
| Next.js | 14+ | 16.x | Latest stable |
| Forms | React Hook Form | TanStack Form | Ecosystem consistency |
| Tenancy | Multi-tenant SaaS | Single-tenant | Simpler for target use case |

---

## 2B. Schema Review Decisions (January 2026)

This section documents architectural decisions from a comprehensive schema review.

### Decision Status Legend

| Status | Meaning |
|--------|---------|
| **Documented** | Data model docs updated, migration pending |
| **Implemented** | Migration created and applied |
| **Rejected** | Decision was considered but not adopted |
| *(no status)* | Proposed, not yet reviewed |

### HIGH PRIORITY DECISIONS

#### DEC-HP-001: Unified Allocation Table
**Status**: Documented (data model updated, migration pending)
**Decision**: Merge `allocations` and `fg_allocations` into single polymorphic `allocations` table.

```sql
allocations:
  id                  UUID PRIMARY KEY
  source_type         TEXT NOT NULL  -- 'batch', 'finished_good', 'inventory_lot', 'external'
  source_id           UUID NOT NULL
  destination_type    TEXT NOT NULL  -- 'finished_good', 'order', 'sample', 'adjustment', etc.
  destination_id      UUID
  quantity            DECIMAL NOT NULL
  volume_bbl          DECIMAL
  status              TEXT NOT NULL  -- 'planned', 'completed', 'cancelled'
  reference_type      TEXT           -- context for the allocation
  reference_id        UUID
  reason_code         TEXT           -- for adjustments: 'breakage', 'sample_customer', etc.
  notes               TEXT
  created_at          TIMESTAMPTZ
  updated_at          TIMESTAMPTZ
```

**Rationale**: Single audit trail, simpler queries, consistent allocation logic across all inventory types.

#### DEC-HP-002: Recipe Ingredients as Junction Tables
**Status**: Documented (data model updated, migration pending)
**Decision**: Move recipe ingredients from JSONB arrays to proper junction tables.

```sql
recipe_malts:
  id            UUID PRIMARY KEY
  recipe_id     UUID REFERENCES recipes(id)
  malt_id       UUID REFERENCES malts(id)
  weight_lbs    DECIMAL NOT NULL
  position      INTEGER NOT NULL
  notes         TEXT

recipe_hops:
  id            UUID PRIMARY KEY
  recipe_id     UUID REFERENCES recipes(id)
  hop_id        UUID REFERENCES hops(id)
  weight_oz     DECIMAL NOT NULL
  timing        TEXT NOT NULL  -- 'mash', 'first_wort', 'boil', 'whirlpool', 'dry_hop'
  boil_time_min INTEGER
  position      INTEGER NOT NULL
  notes         TEXT

-- Similar tables for: recipe_adjuncts, recipe_yeasts, recipe_water_additions
```

**Rationale**: Enables queries like "all recipes using Citra hops", database-level constraints, proper indexing.

#### DEC-HP-003: Brew Log to Batch Linking
**Decision**: Clarify brew log to batch relationship rules.

- **Batches pre-exist**: Batches are scheduled in advance; brew logs link to existing batches
- **Yeast binds to batch**: Yeast pitch tracking is at batch level, not brew log
- **Blends create new batch**: When consolidating batches from multiple brew logs, create a new batch record
- **Multi-brew acknowledged**: Batches derived from multiple brews are linked via `brew_log_batches` junction table

#### DEC-HP-004: Database Constraints
**Decision**: Add comprehensive indexes and constraints.

**Indexes**:
```sql
-- Allocation calculations
CREATE INDEX idx_allocations_source ON allocations(source_type, source_id, status);
CREATE INDEX idx_allocations_destination ON allocations(destination_type, destination_id, status);

-- Batch operations
CREATE INDEX idx_batches_status_recipe ON batches(status, recipe_id);
CREATE INDEX idx_batch_readings_batch_date ON batch_readings(batch_id, recorded_at DESC);
CREATE INDEX idx_brew_log_batches_batch ON brew_log_batches(batch_id);
CREATE INDEX idx_brew_log_batches_brew ON brew_log_batches(brew_log_id);

-- Inventory
CREATE INDEX idx_inventory_lots_item_date ON inventory_lots(inventory_item_id, received_date, expiration_date);
CREATE INDEX idx_bin_inventory_bin_fg ON bin_inventory(bin_id, finished_good_id);

-- Orders & Sales
CREATE INDEX idx_orders_customer_status_date ON orders(customer_id, status, order_date DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_fg ON order_items(finished_good_id);

-- Kegs
CREATE INDEX idx_keg_transactions_customer ON keg_transactions(customer_id, keg_type_id, keg_size_id);

-- Yeast lineage
CREATE INDEX idx_yeast_pitches_batch ON yeast_pitches(batch_id);
CREATE INDEX idx_yeast_pitches_parent ON yeast_pitches(parent_pitch_id, generation);
```

**CHECK Constraints**:
```sql
-- Quantities never negative
ALTER TABLE allocations ADD CONSTRAINT chk_quantity_positive CHECK (quantity >= 0);
ALTER TABLE finished_goods ADD CONSTRAINT chk_quantity_positive CHECK (quantity >= 0);

-- Percentage bounds
ALTER TABLE batches ADD CONSTRAINT chk_abv_range CHECK (actual_abv BETWEEN 0 AND 100);
ALTER TABLE yeast_pitches ADD CONSTRAINT chk_viability_range CHECK (viability BETWEEN 0 AND 100);

-- Logical date ordering
ALTER TABLE inventory_lots ADD CONSTRAINT chk_dates_logical
  CHECK (expiration_date IS NULL OR expiration_date > received_date);
```

#### DEC-HP-005: Remove Redundant Calculated Fields
**Status**: Documented (data model updated, migration pending)
**Decision**: Remove stored fields that should be calculated.

| Remove | Calculate From |
|--------|---------------|
| `inventory_lots.remaining_quantity` | `quantity - SUM(allocations)` |
| `customer_keg_balances.balance` | `SUM(keg_transactions)` |
| `po_line_items.received_quantity` | `SUM(po_receives)` |
| `recipes.est_og`, `est_fg`, `est_abv`, `est_ibu`, `est_srm` | Recipe calculation functions |

**Note**: Create database views or application functions to calculate these on read.

---

### MEDIUM PRIORITY DECISIONS

#### DEC-MP-001: Unified Entity Revisions
**Status**: Documented (data model updated, migration pending)
**Decision**: Single `entity_revisions` table for all audit tracking.

```sql
entity_revisions:
  id              UUID PRIMARY KEY
  entity_type     TEXT NOT NULL  -- 'batch', 'order', 'packaging_session', etc.
  entity_id       UUID NOT NULL
  action          TEXT NOT NULL  -- 'created', 'updated', 'status_changed', 'deleted'
  field           TEXT           -- specific field changed (nullable)
  previous_value  JSONB
  new_value       JSONB
  reason          TEXT
  user_id         UUID REFERENCES users(id)
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

**Rationale**: Consistent audit trail across all entities, replaces scattered JSONB revision arrays.

#### DEC-MP-002: Water Profile Consolidation
**Status**: Documented (data model updated, migration pending)
**Decision**: Remove `default_water_*` fields from system_settings; always use `water_profiles` table.

- Create a default water profile record
- Reference by ID in account settings
- Single source of truth for water chemistry

#### DEC-MP-003: Temporal Pricing
**Status**: Documented (data model updated, migration pending)
**Decision**: Add `valid_from` and `valid_to` dates to `tier_prices`.

```sql
tier_prices:
  id          UUID PRIMARY KEY
  tier_id     UUID REFERENCES price_tiers(id)
  style_id    UUID REFERENCES beer_styles(id)  -- NEW: for style-level pricing
  brand_id    UUID REFERENCES brands(id)       -- nullable if style-level
  format_id   UUID REFERENCES package_types(id)
  price       DECIMAL NOT NULL
  valid_from  DATE NOT NULL DEFAULT CURRENT_DATE
  valid_to    DATE           -- null = current
  created_at  TIMESTAMPTZ
  updated_at  TIMESTAMPTZ

  CHECK (style_id IS NOT NULL OR brand_id IS NOT NULL)
```

**Price Resolution Order**:
1. Brand + Format + Tier (most specific)
2. Style + Format + Tier (fallback)
3. Flag for manual entry (no match)

#### DEC-MP-004: Derive Vessel Current Batch
**Status**: Documented (data model updated, migration pending)
**Decision**: Remove `vessels.current_batch_id`; derive from `vessel_transfers`.

```sql
-- Current batch = latest transfer TO this vessel with no subsequent transfer OUT
CREATE VIEW vessel_current_batch AS
SELECT DISTINCT ON (v.id)
  v.id as vessel_id,
  vt.batch_id
FROM vessels v
LEFT JOIN vessel_transfers vt ON vt.to_vessel_id = v.id
WHERE NOT EXISTS (
  SELECT 1 FROM vessel_transfers vt2
  WHERE vt2.from_vessel_id = v.id
  AND vt2.batch_id = vt.batch_id
  AND vt2.transferred_at > vt.transferred_at
)
ORDER BY v.id, vt.transferred_at DESC;
```

**Rationale**: Single source of truth (transfer log), no sync issues.

#### DEC-MP-005: Enum Registry
**Decision**: Document all valid enum values in specification.

See Appendix D for complete enum registry.

#### DEC-MP-006: Customer Sales Channel FK
**Decision**: Add explicit `sales_channel_id` foreign key to customers.

```sql
ALTER TABLE customers ADD COLUMN sales_channel_id UUID REFERENCES sales_channels(id);
```

**Rationale**: Explicit relationship instead of implicit mapping by `customer_type` name.

---

### GAP RESOLUTIONS

#### DEC-GAP-001: Over-Allocation Handling
**Decision**: Soft block with override + adjustment allocations for reconciliation.

**At allocation time**:
- Warn if `requested > available`
- Require confirmation to proceed (creates over-committed status)

**For reconciliation**:
- Adjustment allocations with reason codes
- Types: `breakage`, `shrinkage`, `found`, `recount`, `sample_customer`, `sample_event`, `sample_internal`, `donation`

**Available calculation**:
```
Available = Packaged - Allocated - Adjustments(negative) + Adjustments(positive)
```

#### DEC-GAP-002: Packaging Session Rollback Rules
**Decision**: Define clear blocking conditions.

**Block rollback if**:
- `allocations` exist with `status = 'completed'` for session's finished goods
- `transfer_lines` exist with `status IN ('in_transit', 'completed')`

**Allow rollback if**:
- Only `planned` allocations exist (auto-cancel them)

**Rollback behavior**:
- Cancel all planned allocations
- Reverse bin_inventory quantities
- Set FG status to `voided` (preserve for audit)

#### DEC-GAP-003: Yeast Cost Spreading
**Decision**: Equal split across all batches in lineage.

```
cost_per_batch = original_purchase_cost / COUNT(batches_in_lineage)
```

Recalculate when new batches added to lineage.

#### DEC-GAP-004: Yeast Viability Decay
**Decision**: Industry standard formula (Zainasheff).

```
viability = initial_viability × (0.79 ^ months_stored)
```

- Calculate based on `harvested_at` date
- Allow manual override with tested value
- Alert when viability drops below threshold (configurable, default 50%)

#### DEC-GAP-005: Order Allocation & Production Planning
**Decision**: Support both brand-specific and style-based ordering with demand-driven planning.

**Order flexibility**:
- Orders can specify brand + format (specific) OR style + format (flexible)
- Both feed into same demand aggregation

**Planning approach**:
- Add `estimated_ready_date` to batches
- Add lead time fields to styles/recipes: `fermentation_days`, `conditioning_days`, `packaging_buffer_days`
- Calculate "brew by" dates: `order_due_date - packaging_buffer - conditioning - fermentation`
- Aggregate demand by style across orders
- Display planning dashboard showing demand vs scheduled batches

**Allocation timing**: On order `confirmed` status, allocate against current or planned batches.

**Multi-SKU orders**: Track per-line-item readiness; order ships when slowest item ready.

#### DEC-GAP-006: Price Tier Fallback
**Decision**: Hierarchical resolution with style-level pricing.

See DEC-MP-003 for tier_prices schema. Resolution order:
1. Brand + Format + Tier → Use if found
2. Style + Format + Tier → Use if found
3. No match → Flag line item for manual price entry; block order confirmation until resolved

#### DEC-GAP-007: Partial Transfer Handling
**Decision**: Split into multiple transfers.

**Flow**:
1. Original transfer ships partial items
2. Complete original transfer with shipped items
3. Auto-create new transfer for remaining items
4. Unshipped items stay in source bin

**Cancellation**: New transfer can be cancelled; releases reservation, items remain in source bin.

#### DEC-GAP-008: Adjustment Approval Workflow
**Decision**: Configurable approval per adjustment type.

**Schema**:
```sql
inventory_adjustments:
  id                  UUID PRIMARY KEY
  bin_id              UUID REFERENCES bins(id)
  finished_good_id    UUID REFERENCES finished_goods(id)
  quantity            INTEGER NOT NULL  -- positive or negative
  reason_code         TEXT NOT NULL
  notes               TEXT
  status              TEXT NOT NULL  -- 'pending_approval', 'approved', 'rejected'
  recipient_type      TEXT           -- 'customer', 'event', 'staff', 'other'
  recipient_id        UUID           -- FK to customers if applicable
  recipient_name      TEXT           -- for events/other
  requested_by        UUID REFERENCES users(id)
  requested_at        TIMESTAMPTZ DEFAULT NOW()
  reviewed_by         UUID REFERENCES users(id)
  reviewed_at         TIMESTAMPTZ
```

**Configuration** (in account_settings JSONB):
```json
{
  "adjustments": {
    "breakage": { "approval_required": true, "approval_role": "inventory_manager" },
    "sample_customer": { "approval_required": false },
    "sample_internal": { "approval_required": true, "approval_role": "inventory_manager" }
  }
}
```

#### DEC-GAP-009: TTB Reporting
**Decision**: Single premises with comprehensive line mapping.

**Data sources**:
| TTB Line | Description | System Source |
|----------|-------------|---------------|
| 1 | Beginning inventory | Previous period Line 33 |
| 2 | Beer produced | `brew_logs.volume` |
| 3 | Water/liquids added | `batch_additions` (type: water) |
| 5 | Received in bond | `adjustments` (reason: received_in_bond) |
| 7-8 | Beer returned | `adjustments` or order returns |
| 9 | Racked | `vessel_transfers` |
| 10 | Bottled | `packaging_sessions` |
| 11 | Physical overage | `adjustments` (reason: found/recount+) |
| 14 | Removed for sale | `orders` (standard) |
| 15 | Taproom sales | `orders` (channel: taproom) |
| 16 | Export | `orders` (is_export: true) |
| 18-21 | Samples/consumed | `adjustments` (sample_*) |
| 22-23 | Transferred for racking/bottling | `vessel_transfers` |
| 27 | Laboratory samples | `adjustments` (sample_internal) |
| 28 | Beer destroyed | `adjustments` (breakage) |
| 30 | Losses/theft | `adjustments` (shrinkage) |
| 31 | Physical shortage | `adjustments` (recount-) |

**Export tracking**: Add `is_export` boolean to orders table.

**Offsite premises**: Transfers to bins tagged `is_offsite_premises = true` map to Line 19 (removals) / Line 8 (returns).

#### DEC-GAP-010: Delete/Archive Rules (Hybrid)
**Decision**: Hard delete for drafts, soft delete for anything with history.

**Hard delete allowed**:
| Entity | Condition |
|--------|-----------|
| `brew_log` | status = 'planned', no batches linked |
| `batch` | status = 'planned', no vessel, no brew logs linked |
| `packaging_session` | status = 'planned', no FGs created |
| `order` | status = 'draft', no allocations |
| `recipe` | no batches ever created |
| `yeast_pitch` | status = 'available', never used |

**Soft delete required**: Anything with downstream activity.

**Soft delete schema**:
```sql
is_active       BOOLEAN DEFAULT true
deactivated_at  TIMESTAMPTZ
deactivated_by  UUID REFERENCES users(id)
```

**Blocking conditions** (cannot soft delete):
- Batch with completed orders
- Packaging session with shipped FGs
- Order with status `fulfilled` or later

---

### REDUNDANCY RESOLUTIONS

#### DEC-RED-001: Finished Goods brand_id
**Decision**: Keep `brand_id` on finished_goods for query performance.

**Rationale**: Brand queries are common; avoiding 2-join lookup is worth the denormalization.

#### DEC-RED-002: Batch actual_og
**Decision**: Remove `batches.actual_og`; derive from linked brew_logs.

```sql
-- Derive OG from brew_log events
SELECT
  b.id,
  (SELECT value FROM jsonb_array_elements(bl.events) e
   WHERE e->>'phase' = 'ko_end'
   AND e->'measurements' @> '[{"metric": "gravity_plato"}]'
   LIMIT 1) as actual_og
FROM batches b
JOIN brew_log_batches blb ON blb.batch_id = b.id
JOIN brew_logs bl ON bl.id = blb.brew_log_id;
```

#### DEC-RED-003: Order Price Fields
**Decision**: Simplify to `unit_price` + `price_source` enum.

```sql
order_items:
  -- Remove: tier_price_id, price_override
  unit_price    DECIMAL NOT NULL
  price_source  TEXT NOT NULL  -- 'tier', 'style_tier', 'manual', 'promotional'
```

#### DEC-RED-004: Batch Volume Tracking
**Decision**: Remove stored `batches.volume_gallons`; derive from brew_logs minus finished_goods.

**Volume flow**:
- `brew_log_batches.volume_bbl` = initial volume from hot side
- `vessel_transfers` = movement audit trail
- `finished_goods` = packaged output

**Loss calculation**:
```sql
SELECT
  b.id,
  SUM(blb.volume_bbl) as initial_volume,
  SUM(fg.volume_bbl) as packaged_volume,
  SUM(blb.volume_bbl) - COALESCE(SUM(fg.volume_bbl), 0) as loss_volume
FROM batches b
JOIN brew_log_batches blb ON blb.batch_id = b.id
LEFT JOIN finished_goods fg ON fg.batch_id = b.id
GROUP BY b.id;
```

---

### SETTINGS CONSOLIDATION

#### DEC-SETTINGS-001: Single JSONB Account Settings
**Decision**: Consolidate all account-level settings into single JSONB column.

```sql
account_settings:
  id          UUID PRIMARY KEY
  settings    JSONB NOT NULL DEFAULT '{}'
  updated_at  TIMESTAMPTZ DEFAULT NOW()
```

**Settings structure** (validated by Zod in application):
```json
{
  "defaults": {
    "water_profile_id": "uuid",
    "fermentation_days": 14,
    "conditioning_days": 7,
    "packaging_buffer_days": 2
  },
  "adjustments": {
    "breakage": { "approval_required": true, "approval_role": "inventory_manager" },
    "shrinkage": { "approval_required": true, "approval_role": "admin" },
    "sample_customer": { "approval_required": false },
    "sample_internal": { "approval_required": true, "approval_role": "inventory_manager" },
    "donation": { "approval_required": true, "approval_role": "admin" }
  },
  "notifications": {
    "low_inventory_threshold": 50,
    "email_on_order_confirmed": true
  },
  "ttb": {
    "is_export_enabled": true
  }
}
```

**Rationale**: Flexible, no migrations for new settings, validate with Zod at application layer.

---

### SIMPLIFICATION DECISIONS

#### DEC-SIMP-001: Unified Catalog Items Table
**Decision**: Create unified `catalog_items` table for polymorphic ingredient references.

```sql
catalog_items:
  id              UUID PRIMARY KEY
  type            TEXT NOT NULL  -- 'malt', 'hop', 'adjunct', 'yeast', 'sugar', 'spice', 'fruit', 'additive'
  name            TEXT NOT NULL
  -- Common fields
  supplier_id     UUID REFERENCES suppliers(id)
  cost_per_unit   DECIMAL
  unit            TEXT
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  -- Type-specific data
  metadata        JSONB  -- type-specific fields (alpha_acid for hops, color_lovibond for malts, etc.)
```

**Usage**:
```sql
-- supplier_catalog now uses simple FK
supplier_catalog:
  supplier_id     UUID REFERENCES suppliers(id)
  catalog_item_id UUID REFERENCES catalog_items(id)  -- replaces catalog_type + catalog_id
  supplier_sku    TEXT
  price           DECIMAL

-- batch_additions uses simple FK
batch_additions:
  batch_id        UUID REFERENCES batches(id)
  catalog_item_id UUID REFERENCES catalog_items(id)  -- replaces catalog_type + catalog_id
  quantity        DECIMAL
  unit            TEXT
```

**Rationale**: Proper FK constraints, simpler queries, single table to query for all ingredients.

#### DEC-SIMP-002: Keep Brew Log Events as JSONB
**Decision**: Retain `brew_logs.events` as JSONB array.

**Rationale**: Events are always fetched with the brew log, rarely queried independently. JSONB provides flexibility for varying event structures without schema changes.

#### DEC-SIMP-003: Revised Yeast Management (Brinks Model)
**Decision**: Replace simple yeast_pitches with comprehensive brink-based tracking.

**Schema**:
```sql
yeast_brinks:
  id                    UUID PRIMARY KEY
  brink_identifier      TEXT NOT NULL UNIQUE    -- physical label "B-001"
  strain_id             UUID REFERENCES yeasts(id) NOT NULL
  source_batch_id       UUID REFERENCES batches(id)  -- null if purchased
  harvested_at          TIMESTAMPTZ
  initial_weight_lbs    DECIMAL NOT NULL
  generation            INTEGER NOT NULL DEFAULT 0  -- 0 = purchased
  parent_brink_id       UUID REFERENCES yeast_brinks(id)
  status                TEXT NOT NULL DEFAULT 'active'  -- active, depleted, dumped
  cost_cents            INTEGER                 -- purchase cost (gen 0 only)
  notes                 TEXT
  created_at            TIMESTAMPTZ
  updated_at            TIMESTAMPTZ

brink_viability_readings:
  id                    UUID PRIMARY KEY
  brink_id              UUID REFERENCES yeast_brinks(id)
  measured_at           TIMESTAMPTZ NOT NULL
  viability_percent     DECIMAL NOT NULL        -- 0-100
  cell_count            DECIMAL                 -- billion cells (optional)
  method                TEXT                    -- 'hemocytometer', 'cell_counter', 'estimated'
  measured_by           UUID REFERENCES users(id)
  notes                 TEXT

yeast_pitches:
  id                    UUID PRIMARY KEY
  brink_id              UUID REFERENCES yeast_brinks(id)
  batch_id              UUID REFERENCES batches(id)
  pitched_at            TIMESTAMPTZ NOT NULL
  weight_lbs            DECIMAL NOT NULL        -- amount removed from brink
  viability_at_pitch    DECIMAL                 -- snapshot from most recent reading
  pitch_rate            DECIMAL                 -- cells/ml/°P
  notes                 TEXT
```

**Calculated fields**:
- `current_weight = initial_weight_lbs - SUM(yeast_pitches.weight_lbs)`
- Viability: most recent reading, or decay formula from last reading

**Workflow**:
```
Purchase Yeast (Gen 0)
    ↓
Brink B-001 (strain: WLP001, weight: 10 lbs)
    ↓
├── Viability reading: 95% (day before brew)
├── Pitch 2 lbs → Batch #101
├── Pitch 2 lbs → Batch #102
├── Viability reading: 75%
└── Remaining 6 lbs → viability too low → DUMP

Harvest from Batch #101 (Gen 1)
    ↓
Brink B-002 (strain: WLP001, parent: B-001, weight: 8 lbs)
    ↓
└── Continue pitching...
```

**Analytics support**: Track `source_pitch_rate` on brinks to learn optimal pitch rates for harvest viability.

**Cost spreading**: Equal split across all batches in lineage (per DEC-GAP-003).

#### DEC-SIMP-004: Keep Both Batch Sources Tables
**Decision**: Retain both `brew_log_batches` and `batch_sources`.

- `brew_log_batches` = hot-side origin (which brews contributed wort)
- `batch_sources` = cold-side blending (batch-to-batch blends)

**Rationale**: Different purposes; hot-side and cold-side operations are distinct.

#### DEC-SIMP-005: Keep Transfer Lines Normalized
**Decision**: Retain `location_transfers` + `transfer_lines` normalized structure.

**Rationale**: Proper normalization enables partial receives (per DEC-GAP-007) and supports multi-FG transfers with line-level tracking.

---

## 3. Authentication & Authorization

### 3.1 Authentication
- Supabase Auth with email/password
- Magic link option for passwordless login
- Session management via Supabase

### 3.2 Roles

| Role | Description |
|------|-------------|
| **Admin** | Full system access including setup, users, integrations |
| **Production Manager** | Scheduling, packaging, inventory, purchasing, order review |
| **Brewer** | Recipes, batches, brew logs, readings, additions, vessels |
| **Sales** | Orders, customers, pricing, sales channels |

### 3.3 Role Capabilities Matrix

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

### 3.4 Multi-Role Support
- Users can have multiple roles assigned
- Permissions are additive (union of all role capabilities)
- Roles stored in `users.roles` array field

### 3.5 Row Level Security (RLS)
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

---

## 4. Database Schema

> **Source of Truth:** Detailed table definitions are in [`/docs/data-model/`](./data-model/). This section covers conventions and patterns only.

### 4.1 Naming Conventions
- Tables: `snake_case`, plural (e.g., `batches`, `finished_goods`)
- Columns: `snake_case` (e.g., `created_at`, `updated_at`)
- Enums: `snake_case` (e.g., `batch_status`)
- Foreign keys: `{table_singular}_id` (e.g., `batch_id`, `recipe_id`)

### 4.2 Common Columns
All tables include:
- `id` - UUID primary key
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp (where applicable)
- `is_active` - Soft delete flag (where applicable)

### 4.3 System Settings
The `system_settings` table stores global configuration:
```sql
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address JSONB,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.4 Users Table
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

### 4.5 Domain Overview

| Domain | Key Tables | Documentation |
|--------|-----------|---------------|
| Catalog | beer_styles, yeasts, malts, hops, adjuncts, sugars, spices, fruits, additives | [catalog.md](./data-model/catalog.md) |
| Production | recipes, batches, vessels, batch_readings, batch_additions, yeast_pitches | [production.md](./data-model/production.md) |
| Inventory | inventory_items, allocations, bins, bin_inventory, location_transfers | [inventory.md](./data-model/inventory.md) |
| Packaging | package_types, packaging_sessions, finished_goods | [packaging.md](./data-model/packaging.md) |
| Sales | customers, orders, sales_channels, price_tiers, tier_prices | [sales.md](./data-model/sales.md) |
| Purchasing | suppliers, purchase_orders, po_line_items, inventory_lots | [purchasing.md](./data-model/purchasing.md) |
| Kegs | keg_types, keg_inventory, customer_keg_balances, keg_transactions | [kegs.md](./data-model/kegs.md) |
| Notifications | notifications, notification_preferences, slack_settings | [notifications.md](./data-model/notifications.md) |
| System | settings, locations | [system.md](./data-model/system.md) |

### 4.6 Key Design Patterns

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

## 5. Core Modules

### 5.1 Recipe Module

#### 5.1.1 Features
- Create/edit recipes
- Template support (is_template flag)
- Variable ingredients (null ingredient_id)
- Clone recipe from template
- Calculate estimated COGS
- Mash schedule builder
- Fermentation schedule builder
- Water chemistry calculator

#### 5.1.2 Template to Recipe Flow
1. Select template
2. System clones template as new recipe
3. User fills in variable ingredients
4. User assigns to brand (if not already)
5. Recipe ready for use

#### 5.1.3 Ingredient Projections
```typescript
interface IngredientProjection {
  fixed: {
    ingredient_id: string;
    name: string;
    total_amount: number;
    unit: string;
  }[];
  variable: {
    style_id: string;
    style_name: string;
    ingredient_type: string;
    total_amount: number;
    unit: string;
    batch_count: number;
  }[];
}
```

### 5.2 Batch Module

#### 5.2.1 Features
- Create/schedule batches
- Assign recipe
- Plan packaging output
- Track through lifecycle states
- Record vessel transfers
- Add batch additions
- Record check-in readings
- Blend batches
- View allocation status

#### 5.2.2 Batch Readings
Mobile-first interface for recording:
- Temperature
- Gravity (Plato)
- pH
- Pressure
- Dissolved oxygen
- Diacetyl (scale + notes)
- Clarity (scale + notes)
- Taste/smell (freeform)

#### 5.2.3 Batch Additions
- Dry hops (first-class, dedicated UI)
- Other additions (flexible: fruit, sugar, adjunct, etc.)
- Optional inventory lot linking
- Untracked usage supported (brewer not blocked)

### 5.3 Brew Log Module

Brew logs are **decoupled from batches** to support flexible production scenarios:
- **Split fermentation**: 1 brew → multiple batches (different yeasts, treatments)
- **Parti-gyle**: 1 brew → multiple batches (first/second runnings)
- **Blend at knockout**: Multiple brews → 1 batch

#### 5.3.1 Architecture
```
brew_logs (hot-side)          batches (cold-side)
├── brew_number               ├── batch_number
├── brew_date (actual)        ├── planned_start_date
├── events[] (timeline)       ├── status (planned→fermenting→...)
├── recipe_id                 ├── actual_fg, actual_abv
└── status                    └── fermenter
         │                            │
         └──── brew_log_batches ──────┘
              (volume_bbl allocation)
```

#### 5.3.2 Features
- Record brew day events timeline
- Compare actuals to recipe targets
- Track all measurements via events array
- Record ingredient additions with actual times
- Link to one or more batches with volume allocation
- Derive summary metrics from events (OG, volumes, etc.)

#### 5.3.3 Events Structure
```typescript
interface BrewLogEvent {
  id: string;
  phase: string; // strike_water, mash_in, boil_start, ko_end, etc.
  custom_phase?: string;
  time: string; // HH:MM
  measurements: {
    metric: string; // temp_f, ph, gravity_plato, volume_bbl, etc.
    value: string | number;
    custom_metric?: string;
  }[];
  ingredient?: {
    type: string;
    id: string;
  };
  vessel?: string;
  notes?: string;
}
```

#### 5.3.4 Calculated Values (derived from events, not stored)
| Value | Source Event |
|-------|--------------|
| actual_og | `gravity_plato` from `ko_end` or `boil_end` |
| pre_boil_gravity | `gravity_plato` from `boil_start` |
| volume_to_fermenter | `volume_bbl` from `ko_end` |
| actual_mash_ph | `ph` from `mash_in` |

See [`docs/data-model/brew-logs.md`](./data-model/brew-logs.md) for full schema documentation.

### 5.4 Packaging Module

#### 5.4.1 Features
- Create packaging sessions
- Multi-product, multi-batch per session
- Plan quantities
- Record actuals
- Auto-create finished goods on completion
- Adjust after completion
- Rollback if no downstream packed orders

#### 5.4.2 Session Line Item Structure
```typescript
interface SessionLineItem {
  brand_id?: string;
  product_id?: string;
  format_id: string;
  source_batches: {
    batch_id: string;
    planned_qty: number;
    actual_qty?: number;
  }[];
  planned_quantity: number;
  actual_quantity?: number;
}
```

### 5.5 Inventory Module

#### 5.5.1 Features
- View finished goods by brand/format
- View bin inventory
- Create transfers between locations
- Split FG across bins
- Track in-transit inventory
- View allocation status

#### 5.5.2 Bin Inventory View
```typescript
interface BinInventoryView {
  bin: Bin;
  items: {
    finished_good: FinishedGood;
    quantity: number;
    available: number; // quantity - allocated
    allocated: number;
  }[];
}
```

### 5.6 Keg Module

#### 5.6.1 Features
- Define keg types with custom lifecycles
- Track inventory by type/size/state/location
- Record state transitions
- Track customer balances (optional)
- Debit on order ship
- Credit on return

#### 5.6.2 Keg Transaction Types
- `fill`: clean → full (packaging)
- `ship`: full → out (order)
- `return`: out → dirty (customer return)
- `clean`: dirty → clean (washing)
- `receive`: new kegs received
- `adjust`: manual adjustment

### 5.7 Order Module

#### 5.7.1 Features
- Create/edit orders
- Auto-price from tiers (with override)
- Assign keg types per line
- Allocate from inventory (flexible)
- Pick from bins
- Pack and debit inventory
- Push to QuickBooks

#### 5.7.2 Order Pricing Flow
1. Line item added with brand/product + format
2. System looks up customer's sales channel
3. System finds price tier for that channel
4. System finds tier_price for brand (or style fallback) + format
5. Price applied to line (can be overridden)

#### 5.7.3 Allocation Flow
1. Order confirmed → attempt allocation
2. Find available FG for brand + format
3. Create planned allocation (FG → Order)
4. If insufficient: set allocation_warning = 'unallocated'
5. At picking: assign bins
6. At packed: debit bin inventory, complete allocation

### 5.8 Purchasing Module

#### 5.8.1 Features
- Manage suppliers and catalogs
- Generate POs from demand
- Manual PO creation
- Track PO lifecycle
- Receive partial shipments
- Auto-create inventory lots
- Calculate landed costs

#### 5.8.2 PO Generation Flow
1. Calculate demand (from planned batches, date range, or low inventory)
2. Compare to current inventory + on order
3. Factor in lead times
4. Group shortfalls by preferred supplier
5. Generate draft POs
6. User reviews and adjusts
7. Submit to supplier

#### 5.8.3 Landed Cost Calculation
```typescript
function calculateLandedCosts(po: PurchaseOrder): LotCost[] {
  const totalValue = po.line_items.reduce(
    (sum, li) => sum + (li.quantity * li.unit_price), 0
  );
  
  return po.line_items.map(li => {
    const lineValue = li.quantity * li.unit_price;
    const shippingAllocation = (lineValue / totalValue) * po.shipping_cost;
    const landedCost = (lineValue + shippingAllocation) / li.quantity;
    
    return {
      line_item_id: li.id,
      unit_cost: li.unit_price,
      shipping_allocation: shippingAllocation,
      landed_cost: landedCost
    };
  });
}
```

### 5.9 Yeast Module

#### 5.9.1 Features
- Manage yeast strains
- Track pitches with lineage
- Record harvests
- Calculate viability decay
- Spread costs across lineage
- Track pitch usage per batch

#### 5.9.2 Lineage Tracking
```typescript
interface YeastLineage {
  root_pitch: YeastPitch;
  descendants: {
    pitch: YeastPitch;
    source_batch?: Batch;
    generation: number;
    batches_used: Batch[];
  }[];
  total_batches: number;
  cost_per_batch: number;
}
```

### 5.10 Customer & Pricing Module

#### 5.10.1 Features
- Manage customers
- Assign to sales channels
- Define price tiers
- Map tiers to channels
- Set prices by style or brand (brand overrides)
- Sync customers to QuickBooks

#### 5.10.2 Price Resolution
```typescript
function resolvePrice(
  brand_id: string,
  format_id: string,
  customer_id: string
): number | null {
  const customer = getCustomer(customer_id);
  const tier = getTierForChannel(customer.sales_channel_id);

  // Try brand-specific price first
  let price = getTierPrice(tier.id, brand_id, null, format_id);

  // Fall back to style price
  if (!price) {
    const brand = getBrand(brand_id);
    price = getTierPrice(tier.id, null, brand.style_id, format_id);
  }

  return price;
}
```

---

## 6. State Machines & Workflows

### 6.1 Brew Log States

Brew logs capture the hot-side (brewing) process.

```
draft → in_progress → completed
  │          │
  └──────────┴──────▶ cancelled
```

| Transition | Trigger |
|------------|---------|
| draft → in_progress | First event recorded |
| in_progress → completed | Knockout complete, linked to batch(es) via brew_log_batches |
| any → cancelled | User cancellation |

### 6.2 Batch States

Batches represent cold-side (fermentation through packaging). Linked to brew logs via `brew_log_batches`.

```
planned → fermenting → conditioning → packaging → completed
    ↓          ↓            ↓             ↓
cancelled  cancelled   cancelled      (locked)
```

| Transition | Trigger |
|------------|---------|
| planned → fermenting | Wort transferred from brew (linked via brew_log_batches) |
| fermenting → conditioning | Transfer to brite tank |
| conditioning → packaging | Packaging begins |
| packaging → completed | All packaging sessions complete |
| any → cancelled | User cancellation (with checks) |

### 6.3 Packaging Session States

```
planned → in_progress → completed → revised
    ↓          ↓            ↓
cancelled  cancelled   (adjust only if downstream packed)
```

| Transition | Trigger |
|------------|---------|
| planned → in_progress | Start packaging |
| in_progress → completed | Finish, create FGs |
| completed → revised | Adjust quantities |
| completed → (rollback) | Only if no downstream orders packed |

### 6.4 Order States

```
draft → confirmed → scheduled → picking → packed → out_the_door
   ↓        ↓           ↓          ↓         ↓
cancelled cancelled  cancelled cancelled (adjust only)
```

| Transition | Trigger |
|------------|---------|
| draft → confirmed | Customer commits |
| confirmed → scheduled | Delivery date set |
| scheduled → picking | Start fulfillment |
| picking → packed | All items picked, debit inventory |
| packed → out_the_door | Shipped/picked up/served |

### 6.5 Transfer States

```
planned → in_transit → completed
    ↓          ↓
cancelled  cancelled
```

| Transition | Trigger |
|------------|---------|
| planned → in_transit | Ship from origin |
| in_transit → completed | Receive at destination |

### 6.6 Vessel States

```
empty → in_use → dirty → cleaning → empty
  ↓        ↓        ↓        ↓
maintenance ←←←←←←←←←←←←←←←←
     ↓
   dirty
```

### 6.7 Purchase Order States

```
draft → submitted → confirmed → partial → fulfilled
   ↓        ↓           ↓          ↓
cancelled cancelled  cancelled  cancelled
```

| Transition | Trigger |
|------------|---------|
| draft → submitted | Send to supplier |
| submitted → confirmed | Supplier confirms |
| confirmed → partial | Some items received |
| partial → fulfilled | All items received |
| confirmed → fulfilled | All received at once |

---

## 7. Allocation System

### 7.1 Core Concept
Allocations track all inventory movements with a source, destination, quantity, and status. Quantities are never stored as mutable "remaining" fields; they're always calculated from allocations.

### 7.2 Allocation Types

| Source Type | Destination Type | Use Case |
|-------------|------------------|----------|
| batch | finished_good | Production (packaging) |
| batch | batch | Blending |
| finished_good | order | Sales |
| finished_good | sample_trade | Trade samples |
| finished_good | sample_quality | QA tasting |
| finished_good | consumed | Employee/promo |
| finished_good | destruction | Contamination, QC fail |
| finished_good | loss | Breakage, spillage, theft |
| finished_good | adjustment | Inventory correction |
| external_return | finished_good | Customer returns |
| bond_transfer_in | finished_good | Received in bond |

### 7.3 Allocation States

```
planned → completed
    ↓
cancelled
```

- **planned**: Reserved, can be revised or cancelled
- **completed**: Done, immutable
- **cancelled**: Won't happen, preserved for audit

### 7.4 Calculated Quantities

```typescript
// Available = Original - SUM(planned + completed allocations)
function getAvailable(sourceType: string, sourceId: string): number {
  const original = getOriginalQuantity(sourceType, sourceId);
  const allocated = getAllocations(sourceType, sourceId)
    .filter(a => a.status !== 'cancelled' && !a.archived)
    .reduce((sum, a) => sum + a.quantity, 0);
  return original - allocated;
}
```

### 7.5 TTB Line Mapping
Allocations map to TTB report lines based on destination_type and sales_channel:

| Destination Type | TTB Line |
|------------------|----------|
| finished_good | Line 2 (Production) |
| order (distributor/retailer/taproom) | Line 10 (Tax-paid removals) |
| order (export/bond_transfer) | Line 11 (Tax-free removals) |
| sample_trade | Line 11 |
| sample_quality | Line 12 |
| consumed | Line 12 |
| destruction | Line 13 |
| loss | Line 14 |
| adjustment (+) | Line 5 (Overage) |
| adjustment (-) | Line 15 (Shortage) |
| external_return | Line 4 |
| bond_transfer_in | Line 3 |

---

## 8. Rollback & Adjustment Rules

### 8.1 General Principles
1. **Rollback** when possible (before downstream dependencies lock it)
2. **Adjust** when rollback not possible (correct quantities, log revision)
3. **Never block** operations; warn and proceed
4. **Recalculate history** on backdated adjustments

### 8.2 Packaging Session Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| planned | Rollback | ✓ | Delete session |
| in_progress | Rollback | ✓ | Delete session, no FGs created yet |
| completed | Rollback | ✓ if no downstream orders packed | Delete FGs, restore batch volume, orders become unallocated |
| completed | Rollback | ✗ if any order packed | Show error, suggest adjust |
| completed | Adjust | ✓ | Update FG quantities, log revision, flag over-allocations |

### 8.3 Order Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| draft-picking | Rollback | ✓ | Release allocations |
| packed | Rollback | ✗ | Adjust only |
| packed | Adjust | ✓ | Update quantities, recalculate bin/keg inventory |
| out_the_door | Rollback | ✗ | Adjust only |
| out_the_door | Adjust | ✓ | Update quantities, recalculate, log revision |

### 8.4 Transfer Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| planned | Cancel | ✓ | Delete transfer |
| in_transit | Cancel | ✓ | Restore origin bin quantities |
| completed | Rollback | ✗ | Create reverse transfer instead |
| completed | Adjust | ✓ | Correct quantities, recalculate bins |

### 8.5 Revision Tracking
All adjustments logged in revisions array:
```typescript
interface Revision {
  timestamp: string;
  user_id: string;
  action: string; // quantity_changed, status_changed, etc.
  previous_value: any;
  new_value: any;
  field?: string;
  reason?: string;
}
```

---

## 9. Unit System

### 9.1 Base Units (Storage)
All quantities stored in consistent base units:
- **Volume**: Barrels (BBL)
- **Weight**: Pounds (lbs)
- **Temperature**: Fahrenheit (°F)

### 9.2 User Preferences
Users can set display preferences:
```typescript
interface UserUnitPreferences {
  volume: 'bbl' | 'gal' | 'l' | 'hl';
  weight: 'lbs' | 'kg' | 'oz' | 'g';
  temperature: 'f' | 'c';
  gravity: 'plato' | 'sg';
}
```

### 9.3 Conversion Functions
```typescript
const volumeConversions = {
  bbl: 1,
  gal: 31,
  l: 117.348,
  hl: 1.17348
};

function convertVolume(value: number, from: string, to: string): number {
  const inBbl = value / volumeConversions[from];
  return inBbl * volumeConversions[to];
}

// Never round during conversion - display only
function formatVolume(bbl: number, displayUnit: string, decimals: number = 2): string {
  const converted = convertVolume(bbl, 'bbl', displayUnit);
  return `${converted.toFixed(decimals)} ${displayUnit}`;
}
```

### 9.4 Input Handling
- Accept input in user's preferred unit
- Convert to base unit for storage
- Store original unit for reference if needed

---

## 10. Notifications

### 10.1 Notification Types

| Type | Trigger | Default Channels |
|------|---------|------------------|
| low_inventory | Ingredient below reorder point | In-app, Email |
| batch_ready | Batch ready for next step | In-app, Slack |
| order_due | Order delivery date approaching | In-app, Email |
| po_delivery | PO expected delivery date | In-app |
| packaging_scheduled | Packaging session tomorrow | In-app, Slack |
| fg_expiring | FG approaching expiration | In-app, Email |

### 10.2 Channels
- **In-app**: Real-time via Supabase Realtime
- **Email**: Via Resend or similar service
- **Slack**: Via webhook to brewery channel or user DM

### 10.3 User Preferences
Each user can configure per notification type:
- Enable/disable each channel
- Brewery-wide Slack channel
- User-specific overrides

### 10.4 Implementation
```typescript
async function sendNotification(
  type: NotificationType,
  data: NotificationData,
  userId?: string // optional, for user-specific
) {
  // Get preferences
  const prefs = await getNotificationPrefs(userId);
  const typePrefs = prefs[type] || defaultPrefs[type];

  // Create in-app notification
  if (typePrefs.in_app) {
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title: formatTitle(type, data),
      message: formatMessage(type, data),
      data
    });
  }

  // Send email
  if (typePrefs.email) {
    await sendEmail(userId, type, data);
  }

  // Send Slack
  if (typePrefs.slack) {
    await sendSlack(type, data);
  }
}
```

---

## 11. Reporting

### 11.1 TTB Reporting
Monthly report matching TTB Form 5130.9:
- Line 1: Beginning inventory
- Line 2: Beer produced
- Line 3: Received in bond
- Line 4: Beer returned
- Line 5: Inventory overage
- Lines 6-9: Total/adjustments
- Line 10: Tax-paid removals
- Line 11: Tax-free removals
- Line 12: Consumed on premises
- Line 13: Destroyed
- Line 14: Losses
- Line 15: Inventory shortage
- Lines 16-17: Ending inventory

```typescript
async function generateTTBReport(
  month: Date
): Promise<TTBReport> {
  const startDate = startOfMonth(month);
  const endDate = endOfMonth(month);

  // Query allocations by destination_type and date
  const allocations = await getAllocationsForPeriod(
    startDate, endDate
  );

  // Map to TTB lines
  return {
    line1: await getBeginningInventory(startDate),
    line2: sumAllocations(allocations, 'finished_good'),
    line3: sumAllocations(allocations, 'bond_transfer_in'),
    line4: sumAllocations(allocations, 'external_return'),
    // ... etc
  };
}
```

### 11.2 Projections Report
Based on planned batches:
- Ingredient needs (fixed vs variable)
- Hop projections by style
- Malt projections by style
- Expected finished goods
- Expected revenue

### 11.3 COGS Report
- Ingredient costs per batch
- Yeast costs (spread across lineage)
- Landed costs
- Total COGS per brand/format

### 11.4 Production Report
Daily/monthly:
- Batches completed
- Packaging sessions
- Finished goods created
- Volume produced

### 11.5 Inventory Report
Current state:
- FG by brand/format/location
- Raw materials by ingredient
- Keg inventory by type/state

---

## 12. Integrations

### 12.1 QuickBooks Online

#### 12.1.1 Sync Direction
One-way: MGR → QuickBooks

#### 12.1.2 Data Pushed
- **Customers**: Create/update in QBO when created in MGR
- **Invoices**: Create from orders when status = out_the_door
- **Bills**: Create from POs when status = fulfilled

#### 12.1.3 Implementation
```typescript
// Supabase Edge Function triggered by database webhook
export async function syncOrderToQBO(order: Order) {
  if (order.status !== 'out_the_door') return;
  if (order.qb_invoice_id) return; // Already synced
  
  const customer = await getCustomer(order.customer_id);
  
  // Ensure customer exists in QBO
  if (!customer.qb_customer_id) {
    const qbCustomer = await qbo.createCustomer({
      DisplayName: customer.name,
      // ... other fields
    });
    await updateCustomer(customer.id, { qb_customer_id: qbCustomer.Id });
  }
  
  // Create invoice
  const invoice = await qbo.createInvoice({
    CustomerRef: { value: customer.qb_customer_id },
    Line: order.line_items.map(li => ({
      Amount: li.line_total,
      Description: formatLineDescription(li),
      // ...
    })),
    // ...
  });
  
  await updateOrder(order.id, { qb_invoice_id: invoice.Id });
}
```

#### 12.1.4 Settings
System-wide QBO connection:
- OAuth tokens (encrypted)
- Company ID
- Sync preferences

### 12.2 Slack

#### 12.2.1 Setup
- Webhook URL (system-wide)
- Default channel
- Per-notification-type channel overrides

#### 12.2.2 Message Format
```typescript
async function sendSlackNotification(
  type: NotificationType,
  data: any
) {
  const settings = await getSlackSettings();
  if (!settings.enabled) return;

  const channel = settings.notification_channels[type] || settings.channel;

  await fetch(settings.webhook_url, {
    method: 'POST',
    body: JSON.stringify({
      channel,
      text: formatSlackMessage(type, data),
      attachments: formatSlackAttachments(type, data)
    })
  });
}
```

---

## 13. File Storage

### 13.1 Storage Buckets
- `avatars`: User profile pictures
- `documents`: General documents (future)

### 13.2 Avatar Upload
```typescript
async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/${Date.now()}-${file.name}`;
  
  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      upsert: true,
      contentType: file.type
    });
  
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(path);
  
  await supabase
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);
  
  return publicUrl;
}
```

### 13.3 Storage Policies
```sql
-- Users can upload their own avatars
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read for avatars
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');
```

---

## 14. UI/UX Guidelines

### 14.1 Design System
- Use shadcn/ui components exclusively
- Tailwind CSS for styling
- Consistent spacing, colors, typography from shadcn defaults
- Dark mode support

### 14.2 Mobile-First Screens
Optimized for mobile use on the brewhouse floor:
- Batch readings input
- Brew log event recording
- Batch additions
- Vessel status updates
- Quick batch lookup

### 14.3 Desktop-Optimized Screens
Complex data entry and analysis:
- Recipe builder
- Order entry
- Packaging session planning
- Reports and dashboards
- Settings and configuration

### 14.4 Navigation Structure
```
├── Dashboard
├── Production
│   ├── Batches
│   ├── Brew Logs
│   ├── Vessels
│   └── Recipes
├── Packaging
│   ├── Sessions
│   └── Formats
├── Inventory
│   ├── Finished Goods
│   ├── Bins
│   ├── Transfers
│   └── Kegs
├── Purchasing
│   ├── Purchase Orders
│   ├── Suppliers
│   ├── Ingredients
│   └── Inventory (raw materials)
├── Sales
│   ├── Orders
│   ├── Customers
│   └── Pricing
├── Reports
│   ├── TTB
│   ├── Projections
│   ├── COGS
│   └── Production
└── Settings
    ├── System
    ├── Users
    ├── Locations
    ├── Integrations
    └── Notifications
```

### 14.5 Common Patterns

#### 14.5.1 List Views
- Filterable columns
- Sortable columns
- Search
- Pagination
- Bulk actions where appropriate
- Quick actions (edit, delete, status change)

#### 14.5.2 Detail Views
- Header with key info and status
- Tabbed sections for related data
- Action buttons contextual to state
- Revision history accessible

#### 14.5.3 Forms
- Inline validation with Zod
- Auto-save for complex forms (drafts)
- Confirmation for destructive actions
- Loading states on submit

#### 14.5.4 Status Badges
Consistent colors:
- Draft/Planned: Gray
- In Progress: Blue
- Completed/Success: Green
- Warning: Yellow
- Error/Cancelled: Red

---

## 15. API Structure

### 15.1 API Routes (Next.js App Router)

```
app/
├── api/
│   ├── auth/
│   │   └── [...supabase]/route.ts
│   ├── batches/
│   │   ├── route.ts (GET list, POST create)
│   │   ├── [id]/route.ts (GET, PATCH, DELETE)
│   │   ├── [id]/readings/route.ts
│   │   ├── [id]/additions/route.ts
│   │   └── [id]/transfer/route.ts
│   ├── recipes/
│   │   ├── route.ts
│   │   ├── [id]/route.ts
│   │   └── [id]/clone/route.ts
│   ├── packaging/
│   │   ├── sessions/route.ts
│   │   ├── sessions/[id]/route.ts
│   │   └── sessions/[id]/complete/route.ts
│   ├── inventory/
│   │   ├── finished-goods/route.ts
│   │   ├── bins/route.ts
│   │   ├── transfers/route.ts
│   │   └── kegs/route.ts
│   ├── orders/
│   │   ├── route.ts
│   │   ├── [id]/route.ts
│   │   ├── [id]/allocate/route.ts
│   │   └── [id]/fulfill/route.ts
│   ├── purchasing/
│   │   ├── pos/route.ts
│   │   ├── pos/[id]/route.ts
│   │   ├── pos/[id]/receive/route.ts
│   │   └── generate/route.ts
│   ├── reports/
│   │   ├── ttb/route.ts
│   │   ├── projections/route.ts
│   │   └── cogs/route.ts
│   └── webhooks/
│       └── qbo/route.ts
```

### 15.2 API Response Format
```typescript
// Success
{
  data: T,
  meta?: {
    page?: number,
    per_page?: number,
    total?: number
  }
}

// Error
{
  error: {
    code: string,
    message: string,
    details?: any
  }
}
```

### 15.3 Authentication
All API routes (except webhooks) require authentication:
```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function GET(request: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  // Check user roles for authorization
  const { data: userData } = await supabase
    .from('users')
    .select('roles')
    .eq('id', user.id)
    .single();

  if (!userData || !hasRequiredRole(userData.roles, requiredRoles)) {
    return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }

  // ... rest of handler
}
```

---

## 16. Migration Plan

### 16.1 Data Migration from Payload

#### 16.1.1 Phase 1: Schema Mapping
Map existing Payload collections to new Supabase tables:
- Identify field mappings
- Handle relationship transformations
- Plan for data cleanup

#### 16.1.2 Phase 2: Migration Scripts
Create idempotent migration scripts:
```typescript
// Example migration script structure
async function migrateRecipes(payload: PayloadData, supabase: SupabaseClient) {
  for (const recipe of payload.recipes) {
    // Transform data
    const transformed = transformRecipe(recipe);
    
    // Upsert to Supabase
    const { error } = await supabase
      .from('recipes')
      .upsert(transformed, { onConflict: 'legacy_id' });
    
    if (error) {
      console.error(`Failed to migrate recipe ${recipe.id}:`, error);
    }
  }
}
```

#### 16.1.3 Phase 3: Validation
- Compare counts between systems
- Spot-check critical data
- Verify relationships intact

#### 16.1.4 Phase 4: Cutover
- Final sync
- Switch application to new backend
- Monitor for issues

### 16.2 Migration Order
1. System settings
2. Reference data (styles, formats, keg_types, sales_channels)
3. Users
4. Suppliers and ingredients
5. Yeast strains
6. Recipes
7. Customers
8. Vessels
9. Batches and brew logs
10. Inventory lots
11. Finished goods
12. Allocations
13. Orders
14. Transactions and history

---

## Appendix A: Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# QuickBooks
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=

# Email (Resend)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Allocation** | A record tracking inventory movement from source to destination |
| **BBL** | Barrel, the standard unit for beer volume (31 gallons) |
| **Bin** | A storage location within a facility |
| **Brite Tank** | Conditioning vessel where beer is carbonated before packaging |
| **COGS** | Cost of Goods Sold |
| **FG** | Finished Goods - packaged beer ready for sale |
| **Generation** | Yeast pitch count from original purchase (Gen 0 = purchased) |
| **Landed Cost** | Total cost including shipping allocation |
| **Lot Number** | Unique identifier for a production batch, used for traceability |
| **Pitch** | A quantity of yeast used to ferment beer |
| **PO** | Purchase Order |
| **QBO** | QuickBooks Online |
| **RLS** | Row Level Security - Supabase/PostgreSQL feature for access control |
| **SKU** | Stock Keeping Unit - a specific beer or product |
| **Template** | A recipe pattern with variable ingredients for projections |
| **TTB** | Alcohol and Tobacco Tax and Trade Bureau |

---

## Appendix C: References

- [Supabase Documentation](https://supabase.com/docs)
- [Next.js App Router](https://nextjs.org/docs/app)
- [shadcn/ui](https://ui.shadcn.com/)
- [TTB Form 5130.9](https://www.ttb.gov/system/files?file=images/pdfs/forms/f51309.pdf)
- [QuickBooks Online API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities)

---

## Appendix D: Enum Registry

All TEXT fields with constrained values. Use these exact values in application code.

### Entity Statuses

#### Batch Status
```
planned | fermenting | conditioning | packaging | completed | cancelled
```

#### Brew Log Status
```
draft | in_progress | completed | cancelled
```

#### Order Status
```
draft | confirmed | scheduled | picking | packed | out_the_door | fulfilled | cancelled
```

#### Packaging Session Status
```
planned | in_progress | completed | revised | cancelled
```

#### Purchase Order Status
```
draft | submitted | confirmed | partial | fulfilled | cancelled
```

#### Transfer Status
```
planned | in_transit | completed | cancelled
```

#### Vessel Status
```
empty | in_use | dirty | cleaning | maintenance
```

#### Yeast Brink Status
```
active | depleted | dumped
```

#### Viability Measurement Method
```
hemocytometer | cell_counter | estimated
```

### Allocation Types

#### Source Types
```
batch | finished_good | inventory_lot | external
```

#### Destination Types
```
finished_good | order | sample | adjustment | transfer | destruction | loss
```

#### Allocation Status
```
planned | completed | cancelled
```

### Adjustment Reason Codes
```
breakage | shrinkage | found | recount | sample_customer | sample_event | sample_internal | donation | received_in_bond | destroyed | theft
```

### Adjustment Approval Status
```
pending_approval | approved | rejected
```

### Price Source (Order Items)
```
tier | style_tier | manual | promotional
```

### Hop Timing
```
mash | first_wort | boil | whirlpool | dry_hop
```

### Customer Type
```
distributor | retailer | taproom | direct | export
```

### Keg Transaction Types
```
fill | ship | return | clean | receive | adjust
```

### Vessel Types
```
fermenter | brite | unitank | barrel | serving
```

### Bin Types
```
cold_room | warehouse | taproom | offsite | shipping
```

### User Roles
```
Admin | Production Manager | Brewer | Sales
```

### Notification Types
```
low_inventory | batch_ready | order_due | po_delivery | packaging_scheduled | fg_expiring
```

### Catalog Item Types
```
malt | hop | adjunct | yeast | sugar | spice | fruit | additive
```

### Brew Log Phases
```
strike_water | mash_in | vorlauf | sparge | boil_start | hop_addition | boil_end | whirlpool | ko_start | ko_end | custom
```

### Measurement Metrics
```
temp_f | ph | gravity_plato | volume_bbl | pressure_psi | do_ppb | diacetyl | clarity
```

---

**End of Specification**
