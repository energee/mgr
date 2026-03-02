# Schema Review Decisions (January 2026)

This document captures architectural decisions from a comprehensive schema review. It serves as a living reference for understanding why the schema is designed the way it is.

## Decision Status Legend

| Status | Meaning |
|--------|---------|
| **Documented** | Data model docs updated, migration pending |
| **Implemented** | Migration created and applied |
| **Rejected** | Decision was considered but not adopted |
| **RESOLVED/DEFERRED** | Evaluated and intentionally deferred; current approach documented |
| **RESOLVED/MODIFIED** | Implemented with a different approach than originally proposed |
| **RESOLVED/DOCUMENTED** | Rules documented; enforcement is application-layer |
| *(no status)* | Proposed, not yet reviewed |

---

## High Priority Decisions

### DEC-HP-001: Unified Allocation Table
**Status**: Implemented (migration 00010_unified_allocations.sql)

Merge `allocations` and `fg_allocations` into single polymorphic `allocations` table.

```sql
allocations:
  id                  UUID PRIMARY KEY
  source_type         TEXT NOT NULL  -- 'inventory_lot', 'batch', 'finished_good', 'external'
  source_id           UUID NOT NULL
  destination_type    TEXT NOT NULL  -- 'batch', 'finished_good', 'order', 'sample', 'adjustment', 'destruction', 'loss', 'transfer'
  destination_id      UUID           -- nullable for sample/adjustment/destruction/loss
  quantity            DECIMAL NOT NULL
  volume_bbl          DECIMAL
  status              TEXT NOT NULL  -- 'planned', 'completed', 'cancelled'
  reason_code         TEXT           -- for samples/adjustments: 'breakage', 'sample_customer', etc.
  lot_number          TEXT           -- traceability
  notes               TEXT
  created_at          TIMESTAMPTZ
  updated_at          TIMESTAMPTZ
```

**Allocation flows:**
| Flow | source_type | destination_type |
|------|-------------|------------------|
| Raw material → Batch | inventory_lot | batch |
| Batch → Packaging | batch | finished_good |
| FG → Sale | finished_good | order |
| FG → Sample | finished_good | sample |
| FG → Adjustment | finished_good | adjustment |
| FG → Destroyed | finished_good | destruction |
| FG → Lost | finished_good | loss |
| FG → Transfer | finished_good | transfer |
| External → FG | external | finished_good |

**Rationale**: Single audit trail, simpler queries, consistent allocation logic across all inventory types.

### DEC-HP-002: Recipe Ingredients as Junction Tables
**Status**: Implemented (migration 00011)

Move recipe ingredients from JSONB arrays to proper junction tables.

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

### DEC-HP-003: Brew Log to Batch Linking
**Status**: Implemented (migration 00004, brew_log_batches table and UI components)

**Core principle:** Batches represent fermentation slots and are created during planning. Brew logs capture hot-side execution. The two are linked when wort is allocated to fermenter(s).

**Workflow:**
1. Create batch(es) with `status=planned` and `planned_start_date` (planning phase)
2. On brew day, create brew_log and record events
3. At knockout, link brew_log to batch(es) via `brew_log_batches` with `volume_bbl`
4. Batch transitions `planned → fermenting`

**Core Rules:**
- **Batches pre-exist**: Batches are scheduled in advance; brew logs link to existing batches
- **Yeast binds to batch**: Yeast pitch tracking is at batch level, not brew log (cold-side operation)
- **Volume allocation**: `brew_log_batches.volume_bbl` specifies wort allocated to each batch
- **Multi-brew acknowledged**: Batches derived from multiple brews are linked via `brew_log_batches` junction table
- **Split fermentation**: One brew can feed multiple batches (parti-gyle, different yeasts)

**Validation Constraints:**

| Rule | Enforcement | Description |
|------|-------------|-------------|
| Volume reconciliation | Application warning | SUM(brew_log_batches.volume_bbl) should equal knockout volume ±5% |
| Batch requires brew for fermenting | Application | Batch cannot transition to `fermenting` without at least one brew_log_batches link |
| Brew completion optional | None | brew_log can complete without batch links (test brews, dump scenarios) |
| No unlink after fermenting | Application | Cannot delete brew_log_batches record if batch.status != 'planned' |
| Volume positive | Database | `brew_log_batches.volume_bbl > 0` |

**Edge Cases:**

| Scenario | Handling |
|----------|----------|
| Planned batch never brewed | Stays `planned`; user can cancel or reschedule |
| Brew log with no batch links | Valid for test brews; flagged as "unallocated" in UI |
| Volume mismatch >5% | Warning displayed; user must acknowledge or adjust |
| Batch already fermenting, add another brew | Allowed (blend scenario); batch volume_bbl updated |

### DEC-HP-004: Database Constraints
**Status**: Implemented (migrations 00060/00061 indexes, CHECK constraints in various migrations)

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

-- FG entry point: either both batch_id AND session_line_item_id set (internal), or both null (external)
ALTER TABLE finished_goods ADD CONSTRAINT chk_fg_entry_point CHECK (
  (batch_id IS NOT NULL AND session_line_item_id IS NOT NULL) OR
  (batch_id IS NULL AND session_line_item_id IS NULL)
);
```

### DEC-HP-005: Remove Redundant Calculated Fields
**Status**: Implemented (recipes_with_estimates view, inventory_lot_quantities view; redundant columns never on base tables)

| Remove | Calculate From |
|--------|---------------|
| `inventory_lots.remaining_quantity` | `quantity - SUM(allocations)` |
| `customer_keg_balances.balance` | `SUM(keg_transactions)` |
| `po_line_items.received_quantity` | `SUM(po_receives)` |
| `recipes.est_og`, `est_fg`, `est_abv`, `est_ibu`, `est_srm` | Recipe calculation functions |

**Note**: Create database views or application functions to calculate these on read.

---

## Medium Priority Decisions

### DEC-MP-001: Unified Entity Revisions
**Status**: Implemented (migration 00019, entity_revisions table)

Single `entity_revisions` table for all audit tracking.

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

### DEC-MP-002: Water Profile Consolidation
**Status**: Implemented (water_profiles table exists; default_water_* fields never added)

Remove `default_water_*` fields from system_settings; always use `water_profiles` table.

- Create a default water profile record
- Reference by ID in account settings
- Single source of truth for water chemistry

### DEC-MP-003: Temporal Pricing
**Status**: Implemented (migration 00028, effective_from/effective_to with exclusion constraint)

Add `valid_from` and `valid_to` dates to `tier_prices`.

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

### DEC-MP-004: Derive Vessel Current Batch
**Status**: Implemented (vessels_with_current_batch view)

Remove `vessels.current_batch_id`; derive from `vessel_transfers`.

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

### DEC-MP-005: Enum Registry
See [Appendices](./appendices.md) for complete enum registry.

### DEC-MP-006: Customer Sales Channel FK
Add explicit `sales_channel_id` foreign key to customers.

```sql
ALTER TABLE customers ADD COLUMN sales_channel_id UUID REFERENCES sales_channels(id);
```

**Rationale**: Explicit relationship instead of implicit mapping by `customer_type` name.

---

## Gap Resolutions

### DEC-GAP-001: Over-Allocation Handling

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

### DEC-GAP-002: Packaging Session Rollback Rules
**Status**: RESOLVED/DOCUMENTED

**Block rollback if**:
- `allocations` exist with `status = 'completed'` for session's finished goods
- `transfer_lines` exist with `status IN ('in_transit', 'completed')`

**Allow rollback if**:
- Only `planned` allocations exist (auto-cancel them)

**Rollback behavior**:
- Cancel all planned allocations
- Reverse bin_inventory quantities
- Set FG status to `voided` (preserve for audit)

#### Resolution

**Status**: RESOLVED/DOCUMENTED
**Date**: 2026-02-26

**Implementation notes**: Rollback rules are documented in `docs/spec/workflows.md` (Packaging Session Rules table) and `docs/data-model/packaging.md` (State Machine section). Application-layer validation enforces the blocking conditions. No database-level constraints were added for rollback rules since they require multi-table checks that are better suited to application logic.

**Caveats**: Rollback enforcement is application-side only. Direct database operations could bypass these rules. RLS policies do not cover rollback-specific constraints.

### DEC-GAP-003: Yeast Cost Spreading

```
cost_per_batch = original_purchase_cost / COUNT(batches_in_lineage)
```

Recalculate when new batches added to lineage.

### DEC-GAP-004: Yeast Viability Decay
**Status**: Documented (data model updated)

**Formula:**
```
viability = baseline_viability × (0.79 ^ months_elapsed)
```

**Calculation priority:**
1. **If viability readings exist**: Use most recent reading as baseline, decay from reading date
2. **If no readings exist**: Use `initial_viability_percent` as baseline, decay from `harvested_at` (or `created_at` for purchased yeast)

**Defaults:**
- `initial_viability_percent`: 95% for harvested, 98% for purchased (gen 0)
- Alert threshold: configurable, default 50%

**Manual override:** Viability readings always take precedence over calculated values.

### DEC-GAP-005: Order Allocation & Production Planning

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

### DEC-GAP-006: Price Tier Fallback

Resolution order:
1. Brand + Format + Tier → Use if found
2. Style + Format + Tier → Use if found
3. No match → Flag line item for manual price entry; block order confirmation until resolved

### DEC-GAP-007: Partial Transfer Handling
**Status**: RESOLVED/DOCUMENTED

**Flow**:
1. Original transfer ships partial items
2. Complete original transfer with shipped items
3. Auto-create new transfer for remaining items
4. Unshipped items stay in source bin

**Cancellation**: New transfer can be cancelled; releases reservation, items remain in source bin.

#### Resolution

**Status**: RESOLVED/DOCUMENTED
**Date**: 2026-02-26

**Implementation notes**: The schema supports partial transfers via the `location_transfers` and `transfer_lines` tables (see `docs/data-model/inventory.md`). `transfer_lines` tracks per-item quantities, enabling partial receives. Application-layer logic handles auto-creation of remainder transfers when a transfer is completed with fewer items than planned.

**Caveats**: Auto-creation of remainder transfers is application-side logic, not a database trigger. The `transfer_lines` table supports both finished goods and raw materials via an XOR constraint (`finished_good_id` or `inventory_lot_id`, exactly one must be set).

### DEC-GAP-008: Adjustment Approval Workflow
**Status**: RESOLVED/MODIFIED

**Original proposal**: Separate `inventory_adjustments` table with approval workflow.

**Original schema** (proposed):
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

**Original configuration** (in account_settings JSONB):
```json
{
  "adjustments": {
    "breakage": { "approval_required": true, "approval_role": "inventory_manager" },
    "sample_customer": { "approval_required": false },
    "sample_internal": { "approval_required": true, "approval_role": "inventory_manager" }
  }
}
```

#### Resolution

**Status**: RESOLVED/MODIFIED
**Date**: 2026-02-26

**Implementation notes**: Instead of a separate `inventory_adjustments` table, the approval workflow was integrated directly into the unified `allocations` table. The following fields on `allocations` support the approval flow:
- `requires_approval BOOLEAN` - Set by business rules when creating the allocation
- `status` - Extended to include `pending_approval` and `rejected` states
- `approved_by UUID` - FK to auth.users (who approved)
- `approved_at TIMESTAMPTZ` - When approved
- `rejection_reason TEXT` - Reason for rejection (if rejected)

The status flow for approved allocations is: `planned -> pending_approval -> completed` (or `-> rejected`).

This is a simpler approach that avoids a separate table and keeps all inventory movements in the single `allocations` audit trail. See `docs/data-model/inventory.md` for the full allocations schema.

**Caveats**: Less granular than the original proposal -- there is no `recipient_type`/`recipient_id` tracking for who received samples. The `reason_code` and `notes` fields on `allocations` capture this context instead. Approval configuration is not yet implemented in `system_settings`; approval rules are currently hardcoded in application logic.

### DEC-GAP-009: TTB Reporting

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

### DEC-GAP-010: Delete/Archive Rules (Hybrid)

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

## Redundancy Resolutions

### DEC-RED-001: Finished Goods brand_id
Keep `brand_id` on finished_goods for query performance.

**Rationale**: Brand queries are common; avoiding 2-join lookup is worth the denormalization.

### DEC-RED-002: Batch actual_og
Remove `batches.actual_og`; derive from linked brew_logs.

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

### DEC-RED-003: Order Price Fields
Simplify to `unit_price` + `price_source` enum.

```sql
order_items:
  -- Remove: tier_price_id, price_override
  unit_price    DECIMAL NOT NULL
  price_source  TEXT NOT NULL  -- 'tier', 'style_tier', 'manual', 'promotional'
```

### DEC-RED-004: Batch Volume Tracking
Remove stored `batches.volume_gallons`; derive from brew_logs minus finished_goods.

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

## Settings Consolidation

### DEC-SETTINGS-001: Single JSONB Account Settings

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

## Simplification Decisions

### DEC-SIMP-001: Unified Catalog Items Table
**Status**: RESOLVED/DEFERRED

**Original proposal**: Merge all ingredient tables into a single `catalog_items` table with a `type` discriminator and JSONB `metadata` for type-specific fields.

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

**Rationale for original**: Proper FK constraints, simpler queries, single table to query for all ingredients.

#### Resolution

**Status**: RESOLVED/DEFERRED
**Date**: 2026-02-26

**Implementation notes**: Separate type-safe tables (malts, hops, yeasts, adjuncts, sugars, spices, fruits, additives) were retained. The unified `catalog_items` table was not created. Cross-domain references use a polymorphic pattern (`catalog_type` + `catalog_id`) in tables that need to reference any ingredient type: `supplier_catalog`, `po_line_items`, `inventory_items`, and `batch_additions`.

Recipe ingredients continue to use concrete junction tables (`recipe_malts`, `recipe_hops`, etc.) with direct foreign keys for stronger typing, database-level constraints, and proper indexing.

**Caveats**: The polymorphic `catalog_type + catalog_id` pattern does not enforce referential integrity at the database level. Application-layer validation is required. The current approach provides better type safety and query performance for the common case (type-specific queries), at the cost of a union query when querying across all ingredient types. See `docs/data-model/catalog.md` for the full architecture.

### DEC-SIMP-002: Keep Brew Log Events as JSONB
Retain `brew_logs.events` as JSONB array.

**Rationale**: Events are always fetched with the brew log, rarely queried independently. JSONB provides flexibility for varying event structures without schema changes.

### DEC-SIMP-003: Revised Yeast Management (Brinks Model)
**Status**: RESOLVED/MODIFIED

**Original proposal**: Replace simple `yeast_pitches` with a full three-table brinks model (`yeast_brinks`, `brink_viability_readings`, `yeast_pitches`).

**Original schema** (proposed):
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

#### Resolution

**Status**: RESOLVED/MODIFIED
**Date**: 2026-02-26
**Migration**: `00095_yeast_workflow_unification.sql`

**Implementation notes**: An event-based yeast tracking model was implemented instead of the full three-table brinks model. The approach uses two tables:
- `yeast_pitches` - Represents yeast sources (purchases or harvests stored in brink vessels). Tracks lineage via `parent_pitch_id`, weight-based quantity (`quantity_lbs`), cell counts in thousands, and links to brink vessels via `vessel_id` FK to the `vessels` table (brink is a vessel type).
- `yeast_pitch_events` - Immutable event log recording each deduction from a source into a batch. Quantity remaining is calculated as `quantity_lbs - SUM(events.quantity_lbs)`.

The full brinks model (`brink_identifier`, `brink_viability_readings` table) was deferred as unnecessary complexity. Viability is tracked via `initial_viability` and `current_viability` on `yeast_pitches`, with decay estimated by the `yeast_pitches_with_remaining` view using a linear model (0.5%/day dry, 2.0%/day liquid). Manual viability overrides are supported via `current_viability`.

**Key views**: `yeast_pitches_with_remaining` (replaces old `yeast_pitches_with_details`), `batch_yeast_summary`, `yeast_lineage_summary`.

**Caveats**: If detailed viability reading history becomes needed (method, cell count per reading, measured_by), a dedicated readings table could be added later. The current model tracks only the latest measurement.

**Workflow** (as implemented):
```
Purchase Yeast (Gen 0, source_type: purchase)
    ↓
yeast_pitch (in Brink vessel, strain: WLP001, quantity: 10 lbs)
    ↓
├── Pitch Event: 2 lbs → Batch #101
├── Pitch Event: 2 lbs → Batch #102
└── Remaining 6 lbs → viability too low → DISCARD

Harvest from Batch #101 (Gen 1, source_type: harvest)
    ↓
yeast_pitch (parent: prev pitch, strain: WLP001, quantity: 8 lbs)
    ↓
└── Continue pitching...
```

### DEC-SIMP-004: Keep Both Batch Sources Tables
Retain both `brew_log_batches` and `batch_sources`.

- `brew_log_batches` = hot-side origin (which brews contributed wort)
- `batch_sources` = cold-side blending (batch-to-batch blends)

**Rationale**: Different purposes; hot-side and cold-side operations are distinct.

### DEC-SIMP-005: Keep Transfer Lines Normalized
Retain `location_transfers` + `transfer_lines` normalized structure.

**Rationale**: Proper normalization enables partial receives (per DEC-GAP-007) and supports multi-FG transfers with line-level tracking.

### DEC-SIMP-006: Inner Pack Columns for Package Composition
**Status**: Approved

Add `inner_pack_size` and `inner_packs_per_case` columns to `package_types`.

**Schema:**
```sql
package_types:
  inner_pack_size       INTEGER   -- Units per inner pack (NULL = loose)
  inner_packs_per_case  INTEGER   -- Inner packs per case (NULL if loose)
  units_per_case        INTEGER   -- Total units (must equal inner_pack_size × inner_packs_per_case when both set)
```

**Examples:**
| Configuration | inner_pack_size | inner_packs_per_case | units_per_case |
|---------------|-----------------|----------------------|----------------|
| 24 loose cans | NULL | NULL | 24 |
| 6 × 4-packs | 4 | 6 | 24 |
| 4 × 6-packs | 6 | 4 | 24 |

**Rationale**: Simple approach that handles 90%+ of real-world cases without complex hierarchical modeling.

---

## Water Chemistry Decisions

### DEC-WATER-001: Water Addition Profiles
**Status**: Implemented

Replace the non-functional `use_default_additions` toggle with named, reusable water addition profiles.

- Water profiles = source water chemistry (existing `water_profiles` table)
- Addition profiles = named salt/acid addition sets (new `water_addition_profiles` table)
- Profile items stored in `recipe_additions` with `profile_id` FK (no schema duplication)
- Recipes link to a profile via `water_addition_profile_id` FK
- Non-water additions (clarifiers, nutrients) remain recipe-specific in `recipe_additions`
- Default source water profile configurable in `system_settings`

**Schema changes:**
- New table: `water_addition_profiles` (id, name, description, is_active, created_at, updated_at)
- `recipe_additions`: dropped `is_default`, added `profile_id` FK, added mutual exclusivity constraint (recipe_id XOR profile_id)
- `recipes`: dropped `use_default_additions`, added `water_addition_profile_id` FK
- New `system_settings` key: `default_water_profile_id`

---

## Performance Decisions

### DEC-PERF-001: Allocation & Query Performance Indexes
**Status**: Implemented (migrations 00010, 00012, 00060, 00061, 00103)

Add composite indexes for frequently-used query patterns across allocations, batches, inventory, orders, and kegs.

**Indexes applied across multiple migrations:**
```sql
-- Allocation calculations (00010)
CREATE INDEX idx_allocations_source ON allocations(source_type, source_id, status);
CREATE INDEX idx_allocations_destination ON allocations(destination_type, destination_id, status);

-- Batch operations (00012)
CREATE INDEX idx_batches_status_recipe ON batches(status, recipe_id);
CREATE INDEX idx_batch_readings_batch_date ON batch_readings(batch_id, recorded_at DESC);
CREATE INDEX idx_brew_log_batches_batch ON brew_log_batches(batch_id);
CREATE INDEX idx_brew_log_batches_brew ON brew_log_batches(brew_log_id);

-- Inventory (00060, 00061)
CREATE INDEX idx_inventory_lots_item_date ON inventory_lots(inventory_item_id, received_date, expiration_date);
CREATE INDEX idx_bin_inventory_bin_fg ON bin_inventory(bin_id, finished_good_id);

-- Orders & Sales (00061)
CREATE INDEX idx_orders_customer_status_date ON orders(customer_id, status, order_date DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_fg ON order_items(finished_good_id);

-- Finished goods FIFO (00103)
CREATE INDEX idx_finished_goods_production_date ON finished_goods(production_date);
```

**Rationale**: Composite indexes aligned with actual query patterns (allocation lookups, batch filtering, order history, FIFO pick-list allocation, TTB reporting date ranges).

### DEC-PERF-002: Calculated Quantity Views
**Status**: Implemented (inventory_lot_quantities view in 00010, finished_goods views in 00010/00061)

Use database views to calculate available quantities on read rather than maintaining mutable balance columns.

**Key views:**
- `inventory_lot_quantities` — calculates remaining quantity from `quantity - SUM(allocations)`
- `finished_goods_with_availability` — derives available FG quantity from packaged minus allocated
- `vessels_with_current_batch` — derives current batch from transfer log

**Rationale**: Single source of truth for quantities. No stale balance bugs. Views perform well with the indexes from DEC-PERF-001.

### DEC-SEC-001: Content-Security-Policy Header
**Status**: Deferred

Add a Content-Security-Policy (CSP) header to `next.config.ts`. CSP is the most impactful header against XSS and is intentionally omitted from the initial security headers deployment to avoid breaking inline scripts/styles used by Next.js, Sentry, and third-party integrations.

**Requirements before implementation:**
- Audit all inline scripts and styles (Next.js runtime, Sentry SDK, Vercel Analytics)
- Determine nonce-based vs hash-based strategy for inline scripts
- Test in report-only mode (`Content-Security-Policy-Report-Only`) before enforcement
- Configure a CSP reporting endpoint to catch violations

**Tracking:** Comment in `next.config.ts:12-13` references this decision.

---

## Related Documents

- [Architecture](./architecture.md) - Technical stack and patterns
- [Workflows](./workflows.md) - State machines and allocation rules
- [Data Model](../data-model/) - Schema implementation details
