# Inventory Domain

## Inventory System Architecture

The inventory system uses multiple tables that work together. This section clarifies when to use each.

### Table Responsibilities

| Table | Purpose | Use When |
|-------|---------|----------|
| `allocations` | **Unified audit trail** for all inventory movements | Any quantity change (usage, sales, adjustments) |
| `inventory_lots` | Track **raw material receipts** with lot/expiry data | Receiving goods from POs |
| `location_transfers` | Track **FG movements** between bins/locations | Moving packaged goods |
| `bin_inventory` | **Current FG quantities** per bin | Quick bin lookups |

### How They Work Together

```
RAW MATERIALS FLOW:
PO receive → inventory_lots (creates lot record)
                ↓
batch_additions → allocations (source_type=inventory_lot, destination_type=batch)
                ↓
inventory_lots quantity calculated from: received - SUM(allocations)

FINISHED GOODS FLOW:
packaging_session → allocations (source_type=batch, destination_type=finished_good)
                         ↓
                    finished_goods (created)
                         ↓
order fulfillment → allocations (source_type=finished_good, destination_type=order)

FG LOCATION MOVEMENTS:
location_transfers → transfer_lines (what's moving)
                         ↓
                    allocations (source_type=finished_good, destination_type=transfer)
                         ↓
                    bin_inventory (updated on completion)
```

### Key Principles

1. **Allocations is the source of truth** for all quantity calculations
2. **No mutable balances** - quantities always calculated from allocation records
3. **Location_transfers** tracks physical movement state (planned → in_transit → completed)
4. **Bin_inventory** is denormalized for fast bin lookups (derived from allocations)
5. **Inventory_lots** stores receipt metadata; quantity derived from allocations

### When to Query Which Table

| I want to... | Query |
|--------------|-------|
| Check available raw material quantity | `inventory_lots` LEFT JOIN `allocations` (calculate remaining) |
| Check available FG for sale | `finished_goods` LEFT JOIN `allocations` (calculate remaining) |
| See what's in a bin | `bin_inventory` (denormalized) |
| Audit all movements for an item | `allocations` WHERE source/destination matches |
| Track a transfer's status | `location_transfers` |
| Get lot/expiry info for raw material | `inventory_lots` |

---

## `inventory_items`

Inventory item catalog (links to catalog items for stock tracking).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| category | TEXT | Category: grain, hops, yeast, adjunct, sugar, spice, fruit, additive, packaging, other |
| name | TEXT | Item name |
| sku | TEXT | SKU/product code |
| unit | TEXT | Stock unit: lb, oz, kg, g, each, case |
| catalog_type | TEXT | Linked catalog type: malt, hop, yeast, adjunct, sugar, spice, fruit, additive |
| catalog_id | UUID | FK to catalog item (polymorphic) |
| reorder_point | DECIMAL(10,2) | Reorder threshold |
| reorder_qty | DECIMAL(10,2) | Reorder quantity |
| supplier | TEXT | Primary supplier |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `allocations`

Unified allocation table for all inventory movements (raw materials, finished goods, batches). Polymorphic source/destination enables single audit trail across all inventory types.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source_type | TEXT | Source type: inventory_lot, batch, finished_good, external |
| source_id | UUID | FK to source record (polymorphic) |
| destination_type | TEXT | Destination: batch, finished_good, order, sample, adjustment, destruction, loss, transfer |
| destination_id | UUID | FK to destination record (polymorphic, nullable for adjustments/destruction/loss) |
| quantity | DECIMAL(10,4) | Quantity allocated (always positive) |
| volume_bbl | DECIMAL(10,4) | Volume in BBL (for TTB reporting, nullable) |
| unit_cost | DECIMAL(10,4) | Unit cost at time of allocation |
| status | TEXT | Status: planned, pending_approval, completed, rejected, cancelled |
| reason_code | TEXT | For adjustments/removals: breakage, sample_customer, sample_quality, contamination, expired, spillage, theft |
| lot_number | TEXT | Lot number for traceability |
| notes | TEXT | Notes |
| **Approval** | | |
| requires_approval | BOOLEAN | Whether this allocation requires approval (set by business rules) |
| approved_by | UUID | FK to auth.users (who approved) |
| approved_at | TIMESTAMPTZ | When approved |
| rejection_reason | TEXT | Reason for rejection (if rejected) |
| **Timestamps** | | |
| completed_at | TIMESTAMPTZ | When completed |
| cancelled_at | TIMESTAMPTZ | When cancelled |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Source Types

| source_type | source_id references | Use case |
|-------------|---------------------|----------|
| inventory_lot | inventory_lots.id | Raw material usage in batches |
| batch | batches.id | Batch transfer to packaging/blending |
| finished_good | finished_goods.id | FG sold, sampled, or removed |
| external | NULL | External receipts (contract brewing, purchases) |

### Destination Types

| destination_type | destination_id references | Use case | TTB Line |
|------------------|--------------------------|----------|----------|
| batch | batches.id | Raw materials used in production | — |
| finished_good | finished_goods.id | Packaging creates FG from batch | Line 2 |
| order | orders.id | FG sold to customer (wholesale) | Line 10/11 |
| taproom_sale | NULL | POS sale from Square integration | Line 10 |
| sample | NULL | Trade or quality samples (use reason_code for type) | Line 12/18-21 |
| adjustment | NULL | Inventory corrections (+/-) | Line 5/15 |
| destruction | NULL | Contamination, QC failure, intentional destruction | Line 13 |
| loss | NULL | Breakage, spillage, theft, shrinkage | Line 14 |
| transfer | location_transfers.id | Inter-location movement | Line 19 (offsite) |

### Approval Workflow

Some allocations require manager approval before completion. The `requires_approval` flag is set by business rules.

**Status flow:**
```
planned → pending_approval → completed
              ↓
           rejected
```

**When approval is required** (configurable):
| Scenario | Threshold |
|----------|-----------|
| Adjustments (any) | Always require approval |
| Destruction | Always require approval |
| Loss > threshold | Volume > 0.5 BBL |
| Samples > daily limit | > 3 samples/day |

**Approval rules:**
- Approver must be different from creator (`approved_by != created_by`)
- Approver must have `production_manager` or `admin` role
- Rejected allocations can be edited and resubmitted (new approval cycle)

**Query: Pending approvals**
```sql
SELECT a.*, u.email as created_by_email
FROM allocations a
JOIN auth.users u ON a.created_by = u.id
WHERE a.status = 'pending_approval'
ORDER BY a.created_at;
```

---

## `bins`

Storage bins/locations for finished goods. Bins belong to locations and provide granular inventory tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| location_id | UUID | FK to locations |
| name | TEXT | Bin name/identifier (e.g., "Cold Room A", "Shelf 1") |
| bin_type | TEXT | Type: storage, cold_room, staging, taproom, shipping, hold, quarantine |
| capacity | INTEGER | Capacity (units or cases) |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Bin Types

| Type | Purpose | Typical Location |
|------|---------|------------------|
| storage | General storage | brewery, warehouse |
| cold_room | Temperature-controlled storage | brewery |
| staging | Temporary holding for orders | brewery, warehouse |
| taproom | Beer on tap or for on-site sale | taproom |
| shipping | Prepared for pickup/delivery | brewery, warehouse |
| hold | QC hold, pending release | any |
| quarantine | Contamination suspect, do not sell | any |

### Bin Type Constraints

Certain bin types restrict what operations are allowed:

| Bin Type | Can allocate to orders? | Can transfer out? |
|----------|------------------------|-------------------|
| storage | Yes | Yes |
| cold_room | Yes | Yes |
| staging | Yes | Yes |
| taproom | Yes (on-premise only) | No |
| shipping | No (already allocated) | Yes |
| hold | No | Yes (after release) |
| quarantine | No | Yes (after QC pass) |

### Bin Naming Convention

Recommended format: `{location_code}-{type_code}-{number}`

Examples:
- `BRW-CR-01` (Brewery Cold Room 1)
- `WH-STG-A` (Warehouse Staging A)
- `TAP-BAR-1` (Taproom Bar 1)

---

## `bin_inventory`

Finished goods quantities per bin.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| finished_good_id | UUID | FK to finished_goods |
| bin_id | UUID | FK to bins |
| quantity | INTEGER | Current quantity in bin |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (finished_good_id, bin_id)

---

## `location_transfers`

Transfers of finished goods between locations/bins.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| from_bin_id | UUID | FK to bins |
| to_bin_id | UUID | FK to bins |
| status | TEXT | Status: planned, in_transit, completed, cancelled |
| ship_date | DATE | Ship date |
| receive_date | DATE | Receive date |
| shipped_by | UUID | FK to auth.users |
| received_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `transfer_lines`

Line items for location transfers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| transfer_id | UUID | FK to location_transfers |
| finished_good_id | UUID | FK to finished_goods |
| quantity | INTEGER | Quantity transferred |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## State Machine: Location Transfer

```
planned -> in_transit -> completed
    |           |
    v           v
cancelled   cancelled
```

| Transition | Trigger |
|------------|---------|
| planned -> in_transit | Ship from origin |
| in_transit -> completed | Receive at destination |

---

## Calculated Quantities

All quantities are calculated from the unified `allocations` table. No mutable balances are stored.

**Raw Material Available:**
```sql
SELECT i.id, i.name,
  COALESCE(SUM(CASE WHEN a.destination_type = 'batch' THEN 0 ELSE a.quantity END), 0) as received,
  COALESCE(SUM(CASE WHEN a.destination_type = 'batch' AND a.status IN ('planned', 'completed') THEN a.quantity ELSE 0 END), 0) as used
FROM inventory_items i
LEFT JOIN inventory_lots l ON l.inventory_item_id = i.id
LEFT JOIN allocations a ON a.source_type = 'inventory_lot' AND a.source_id = l.id
GROUP BY i.id, i.name;
-- Available = received - used
```

**Finished Goods Available:**
```sql
SELECT fg.id, fg.lot_number,
  fg.quantity as total,
  COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed') THEN a.quantity ELSE 0 END), 0) as allocated
FROM finished_goods fg
LEFT JOIN allocations a ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id, fg.lot_number, fg.quantity;
-- Available = total - allocated
```

**Batch Volume Remaining:**
```sql
SELECT b.id, b.batch_number,
  b.actual_volume_bbl as total,
  COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.volume_bbl ELSE 0 END), 0) as packaged
FROM batches b
LEFT JOIN allocations a ON a.source_type = 'batch' AND a.source_id = b.id
GROUP BY b.id, b.batch_number, b.actual_volume_bbl;
-- Remaining = total - packaged
```

---

## FG Entry Points

Finished goods enter inventory via two distinct paths. The entry point determines which fields are populated and how the FG flows through allocations.

### Entry Point Matrix

| Entry Point | batch_id | session_line_item_id | lot_number | Use Case |
|-------------|----------|---------------------|------------|----------|
| Internal Production | **Required** | **Required** | Auto-generated | Normal packaging from batches |
| External Receipt | NULL | NULL | External code | Contract brewing, purchased, legacy |

**Constraint rule:** Either BOTH `batch_id` AND `session_line_item_id` are set (internal), OR BOTH are null (external). Mixed states are invalid.

### 1. Internal Production (typical)

```
packaging_session → session_line_items → finished_goods
```

**Workflow:**
1. Create `packaging_session` with status=planned
2. Add `session_line_items` specifying brand, package_type, source_batches
3. Complete session → system creates `finished_goods` records
4. System creates `allocation` record: source_type=batch, destination_type=finished_good

**Required fields:**
- `batch_id` - FK to batches (from session_line_items.source_batches)
- `session_line_item_id` - FK to session_line_items
- `brand_id` - FK to brands (from session_line_items)
- `lot_number` - auto-generated per `settings.lot_format`

### 2. External Receipt (contract/purchased/legacy)

```
finished_goods (direct creation)
```

**Workflow:**
1. Create `finished_goods` record directly with batch_id=null
2. System creates `allocation` record: source_type=external, destination_type=finished_good

**Required fields:**
- `batch_id` = NULL (no internal batch)
- `session_line_item_id` = NULL (not from packaging session)
- `brand_id` - FK to brands
- `lot_number` = external lot code (bypasses format setting)
- `notes` = source details (required for audit: supplier name, contract brewer, etc.)

### Allocation Flow by Entry Point

| Entry Point | Allocation source_type | Allocation destination_type |
|-------------|------------------------|----------------------------|
| Internal | batch | finished_good |
| External | external | finished_good |

Both paths result in FG records that flow through the same allocation system for sales, samples, and adjustments.

### Validation Rules

```typescript
// Application-level validation
if (fg.batch_id && !fg.session_line_item_id) {
  throw Error("Internal FG requires session_line_item_id");
}
if (!fg.batch_id && fg.session_line_item_id) {
  throw Error("External FG cannot have session_line_item_id");
}
if (!fg.batch_id && !fg.notes) {
  throw Error("External FG requires notes documenting source");
}
```

---

## TTB Reporting (Form 5130.9)

The allocations table provides data for TTB Form 5130.9 - Brewer's Report of Operations. All volume flows are captured via allocations with appropriate destination_type values.

### Line Mapping

| TTB Line | Description | Query |
|----------|-------------|-------|
| Line 1 | Beginning inventory | Previous month ending |
| Line 2 | Production (produced) | `destination_type='finished_good'` |
| Line 5 | Inventory adjustments (+) | `destination_type='adjustment'` AND quantity > 0 |
| Line 10 | Taxable removals - Domestic | `destination_type='order'` AND order is domestic |
| Line 11 | Taxable removals - Export | `destination_type='order'` AND order is export |
| Line 12 | Tax-free for samples | `destination_type='sample'` AND reason_code='trade' |
| Line 13 | Destroyed/disposed | `destination_type='destruction'` |
| Line 14 | Losses/shortages | `destination_type='loss'` |
| Line 15 | Inventory adjustments (-) | `destination_type='adjustment'` AND quantity < 0 |
| Line 17 | Ending inventory | Calculated from movements |
| Line 19 | Offsite premises | `destination_type='transfer'` to offsite location |

### Monthly Report Query

```sql
-- TTB Monthly Report for a given month
WITH month_range AS (
  SELECT
    date_trunc('month', :report_date::date) as month_start,
    date_trunc('month', :report_date::date) + interval '1 month' - interval '1 day' as month_end
),
allocations_in_month AS (
  SELECT a.*, o.is_export, l.is_offsite_premises
  FROM allocations a
  LEFT JOIN orders o ON a.destination_type = 'order' AND a.destination_id = o.id
  LEFT JOIN location_transfers lt ON a.destination_type = 'transfer' AND a.destination_id = lt.id
  LEFT JOIN locations l ON lt.to_location_id = l.id
  WHERE a.status = 'completed'
    AND a.created_at >= (SELECT month_start FROM month_range)
    AND a.created_at <= (SELECT month_end FROM month_range)
)
SELECT
  -- Line 2: Production
  COALESCE(SUM(CASE WHEN destination_type = 'finished_good' THEN volume_bbl END), 0) as line_2_production,

  -- Line 5: Positive adjustments
  COALESCE(SUM(CASE WHEN destination_type = 'adjustment' AND quantity > 0 THEN volume_bbl END), 0) as line_5_adj_plus,

  -- Line 10: Domestic taxable removals (wholesale orders + taproom POS sales)
  COALESCE(SUM(CASE WHEN destination_type = 'taproom_sale' THEN volume_bbl
                    WHEN destination_type = 'order' AND NOT COALESCE(is_export, false) THEN volume_bbl END), 0) as line_10_domestic,

  -- Line 11: Export
  COALESCE(SUM(CASE WHEN destination_type = 'order' AND COALESCE(is_export, false) THEN volume_bbl END), 0) as line_11_export,

  -- Line 12: Samples (trade)
  COALESCE(SUM(CASE WHEN destination_type = 'sample' THEN volume_bbl END), 0) as line_12_samples,

  -- Line 13: Destroyed
  COALESCE(SUM(CASE WHEN destination_type = 'destruction' THEN volume_bbl END), 0) as line_13_destroyed,

  -- Line 14: Losses
  COALESCE(SUM(CASE WHEN destination_type = 'loss' THEN volume_bbl END), 0) as line_14_losses,

  -- Line 15: Negative adjustments
  COALESCE(SUM(CASE WHEN destination_type = 'adjustment' AND quantity < 0 THEN ABS(volume_bbl) END), 0) as line_15_adj_minus,

  -- Line 19: Offsite transfers
  COALESCE(SUM(CASE WHEN destination_type = 'transfer' AND COALESCE(is_offsite_premises, false) THEN volume_bbl END), 0) as line_19_offsite

FROM allocations_in_month;
```

### Beginning/Ending Inventory

```sql
-- Calculate inventory at a point in time (for beginning/ending inventory)
WITH inventory_as_of AS (
  -- All FG created (production + external)
  SELECT SUM(volume_bbl) as total_in
  FROM allocations
  WHERE destination_type = 'finished_good'
    AND status = 'completed'
    AND created_at <= :as_of_date

  UNION ALL

  -- All FG removed (sales, taproom, samples, adjustments, destruction, loss)
  SELECT -SUM(volume_bbl) as total_out
  FROM allocations
  WHERE source_type = 'finished_good'
    AND destination_type IN ('order', 'taproom_sale', 'sample', 'adjustment', 'destruction', 'loss')
    AND status = 'completed'
    AND created_at <= :as_of_date
)
SELECT SUM(total_in) as inventory_bbl
FROM inventory_as_of;
```

### Sample Reason Codes (Line 12 breakdown)

| reason_code | TTB Category | Description |
|-------------|--------------|-------------|
| sample_trade | Trade samples | Given to retailers/distributors |
| sample_quality | QC samples | Lab/quality testing |
| sample_tasting | Tasting room | On-premise consumption |
| sample_charity | Charity/donation | Donated samples |

### Date Boundary Handling

TTB reports use calendar months. For allocations that span month boundaries:

- Use `created_at` as the reporting date (when allocation was completed)
- For multi-day packaging sessions, each FG record has its own `created_at`
- Transfers in-transit at month end: report when completed, not when started
