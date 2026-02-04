# Data Enhancements: Orders, Bins, Inventory & Deliveries

## Overview

Enhance the order items experience with inventory awareness, build out bin management and location transfers for both finished goods and raw materials, and introduce deliveries to group inter-location movements.

**Starting problem:** The order detail page's "Add" button for items 404s because order items use a generic relation link to non-existent routes. The `OrderItemsEditor` component exists but isn't wired in. Beyond that, the UI has no bin management, no transfer UI, and no delivery grouping — all of which exist in the database schema but lack frontend coverage.

---

## Part 1: Order Items Editor — Inventory-Aware

### Current State

- `OrderItemsEditor` (`src/components/domain/order-items-editor.tsx`) handles inline add/edit/delete with auto-pricing from customer tiers
- Order detail page uses a generic relation table that generates a broken link to `/sales/order-items/new`
- Order items reference `brand_id` + `package_type_id`, with optional `batch_id` for specific lot fulfillment

### Changes

**Wire the editor into order detail.** Replace the generic `hasMany` relation tab with `OrderItemsEditor` rendered as a custom section on the order detail page.

**Add inventory awareness to the editor:**

1. **Brand dropdown** — show available quantity as a badge: `Hazy IPA (120 avail)`. Brands with stock sort first. Brands with zero stock show a subtle "no stock" indicator but remain selectable (orders can be created for future production).

2. **Package type dropdown** — same pattern after brand is selected: `16oz 4-pack (48 avail)` sorted by availability.

3. **Inline inventory panel** — after brand + package are selected, a compact panel appears below the row showing matching finished goods: lot number, production date, available quantity, bin location. If no FG exists, show "No inventory — will need production" (informational, not an error).

4. **Optional FG linking** — a "Pin to lot" action on any FG in the panel locks the order item to that specific finished good. Most users skip this; it's for "customer wants batch #42" scenarios.

5. **Quantity warning** — if quantity exceeds total available, show an orange warning (not blocking). The order is still valid; it flags that fulfillment will need production.

### Data Sources

- Availability comes from `finished_goods_with_availability` view, filtered by brand + package type
- Bin locations come from `bin_inventory` joined to `bins`
- No schema changes needed for this part

---

## Part 2: Bins — Universal Storage Tracking

### Current State

- `bins` table exists in DB with types: storage, cold_room, staging, taproom, shipping, hold, quarantine
- `bin_inventory` table tracks FG quantities per bin
- No entity config, no UI pages
- Raw materials (`inventory_lots`) track location but not bin-level granularity

### Schema Changes

**New table: `bin_inventory_items`** — mirrors `bin_inventory` for raw materials:

```sql
CREATE TABLE bin_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_lot_id, bin_id)
);
```

### Entity Config: `src/entities/bin.tsx`

**List columns:** Name, Location, Bin Type, Capacity, Items Count, Utilization
**List filters:** Location, Bin Type
**Default sort:** Location name, then bin name
**Searchable:** name, location name

**Detail page:**
- Header: bin name, location, type badge
- **Contents section:** table of all items in this bin (union of FG and raw materials) — item type, name, lot number, quantity, production/receive date
- Transfer action on each row
- Summary: total items, capacity utilization (if capacity set)

**Form fields:** Name, Location (relation), Bin Type (select), Capacity (number, optional)
- Name auto-suggests `{location_code}-{type_code}-{number}` convention but is editable

### Pages

```
/inventory/bins/
  page.tsx         -> EntityList
  new/page.tsx     -> EntityForm
  [id]/page.tsx    -> EntityDetail
  [id]/edit/page.tsx -> EntityForm
```

### View: `bin_contents`

Union query powering the bin detail contents table:

```sql
CREATE VIEW bin_contents
WITH (security_invoker = true)
AS
SELECT
  bi.bin_id,
  'finished_good' AS item_type,
  fg.id AS item_id,
  b.name AS item_name,
  pt.name AS package_name,
  fg.lot_number,
  bi.quantity,
  fg.production_date AS date
FROM bin_inventory bi
JOIN finished_goods fg ON fg.id = bi.finished_good_id
JOIN brands b ON b.id = fg.brand_id
JOIN package_types pt ON pt.id = fg.package_type_id

UNION ALL

SELECT
  bii.bin_id,
  'raw_material' AS item_type,
  il.id AS item_id,
  ii.name AS item_name,
  NULL AS package_name,
  il.lot_number,
  bii.quantity,
  il.received_date AS date
FROM bin_inventory_items bii
JOIN inventory_lots il ON il.id = bii.inventory_lot_id
JOIN inventory_items ii ON ii.id = il.inventory_item_id;
```

---

## Part 3: Finished Good Detail — Inventory Section

### Current State

- FG detail page exists at `/inventory/finished-goods/[id]`
- Shows basic fields and allocations tab
- No bin breakdown or availability summary

### Changes

Add a custom **"Inventory" section** to the FG detail page (domain component, not generic).

**Layout:**

Three stat cards in a row:
- **Total** — total quantity produced
- **Allocated** — committed to orders/pick lists
- **Available** — free quantity (visually emphasized)

**Location breakdown table:**

| Location | Bin | Quantity | |
|----------|-----|----------|----|
| Warehouse | BRW-CR-01 | 48 | [Transfer] |
| Warehouse | BRW-ST-02 | 24 | [Transfer] |
| Taproom | TAP-CR-01 | 12 | [Transfer] |

**Commitments table:**

| Order | Customer | Quantity | Status |
|-------|----------|----------|--------|
| ORD-2024-042 | Bar & Grill | 24 | Planned |
| ORD-2024-045 | Bottle Shop | 12 | Completed |

**Inline transfer:** The "Transfer" action on each bin row opens a compact inline form — destination bin dropdown (filtered to exclude current), quantity (prefilled with full amount), confirm. No page navigation.

### Data Sources

- Stat cards: `finished_goods_with_availability` view
- Bin breakdown: `bin_inventory` joined to `bins` and `locations`
- Commitments: `allocations` where `source_type = 'finished_good'` and `destination_type = 'order'`

---

## Part 4: Location Transfers

### Current State

- `location_transfers` table exists with state machine: planned → in_transit → completed (or cancelled)
- `transfer_lines` table tracks FG per transfer
- No entity config, no UI pages

### Schema Changes

**Modify `transfer_lines`** — add raw material support:

```sql
ALTER TABLE transfer_lines
ADD COLUMN inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE CASCADE;

ALTER TABLE transfer_lines
ADD CONSTRAINT transfer_lines_item_xor
CHECK (
  (finished_good_id IS NOT NULL AND inventory_lot_id IS NULL) OR
  (finished_good_id IS NULL AND inventory_lot_id IS NOT NULL)
);
```

**Add `delivery_id` to `location_transfers`** (see Part 5):

```sql
ALTER TABLE location_transfers
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;
```

### Entity Config: `src/entities/location-transfer.tsx`

**List columns:** Transfer #, From (location > bin), To (location > bin), Lines Count, Status, Ship Date
**List filters:** Status, Location
**Default sort:** Most recent first

**State machine:**
```
planned → in_transit → completed
   ↓          ↓
cancelled  cancelled
```

**Detail page:**
- Header: transfer identifier, status badge, dates
- Lines section: table of items being moved — type (FG/raw material), name, lot number, quantity
- State machine actions: Ship (captures `shipped_by`, `ship_date`), Receive (captures `received_by`, `receive_date`), Cancel

**Form:** From bin (relation), To bin (relation, validated different from source), then add lines by selecting items from the source bin's contents.

### Pages

```
/inventory/transfers/
  page.tsx         -> EntityList
  new/page.tsx     -> EntityForm (or custom component for line item editing)
  [id]/page.tsx    -> EntityDetail
```

---

## Part 5: Deliveries

### Purpose

Group multiple transfers and order fulfillments into a single delivery run. A Tuesday truck might restock the taproom AND deliver Order #42 to a customer.

### Schema Changes

**New table: `deliveries`**

```sql
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_transit', 'completed', 'cancelled')),
  scheduled_date DATE,
  ship_date TIMESTAMPTZ,
  receive_date TIMESTAMPTZ,
  driver_name TEXT,
  vehicle TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Add `delivery_id` to `orders`:**

```sql
ALTER TABLE orders
ADD COLUMN delivery_id UUID REFERENCES deliveries(id) ON DELETE SET NULL;
```

**State machine:**
```
planned → in_transit → completed
   ↓          ↓
cancelled  cancelled
```

### Entity Config: `src/entities/delivery.tsx`

**List columns:** Delivery #, Scheduled Date, Driver, Stops Count, Status
**List filters:** Status, Date range
**Default sort:** Scheduled date descending

**Detail page:**
- Header: delivery number, status badge, scheduled date, driver, vehicle
- **Stops section:** ordered list of transfers and orders on this run, each showing destination and status

**Form fields:** Scheduled Date, Driver Name, Vehicle, Notes. Then add transfers and orders to the delivery.

### Pages

```
/inventory/deliveries/
  page.tsx         -> EntityList
  new/page.tsx     -> EntityForm or custom
  [id]/page.tsx    -> EntityDetail
```

### Interaction Patterns

- **From delivery new/detail:** Add existing planned transfers or confirmed orders
- **From order or transfer detail:** "Add to delivery" action — creates new delivery or adds to existing planned one
- **Same-location bin moves:** Skip delivery entirely — direct transfer with no logistics overhead

### View: `deliveries_with_summary`

```sql
CREATE VIEW deliveries_with_summary
WITH (security_invoker = true)
AS
SELECT
  d.*,
  (SELECT COUNT(*) FROM location_transfers lt WHERE lt.delivery_id = d.id) AS transfer_count,
  (SELECT COUNT(*) FROM orders o WHERE o.delivery_id = d.id) AS order_count,
  (SELECT COUNT(*) FROM location_transfers lt WHERE lt.delivery_id = d.id)
    + (SELECT COUNT(*) FROM orders o WHERE o.delivery_id = d.id) AS total_stops
FROM deliveries d;
```

---

## Schema Changes Summary

### New Tables

| Table | Purpose |
|-------|---------|
| `bin_inventory_items` | Raw material quantities per bin |
| `deliveries` | Groups transfers + orders into delivery runs |

### Modified Tables

| Table | Change |
|-------|--------|
| `transfer_lines` | Add `inventory_lot_id` FK + XOR constraint |
| `location_transfers` | Add `delivery_id` FK |
| `orders` | Add `delivery_id` FK |

### New Views

| View | Purpose |
|------|---------|
| `bin_contents` | Union of FG and raw materials per bin |
| `deliveries_with_summary` | Delivery with stop counts |

### New Entity Configs

| Entity | Domain | Pages |
|--------|--------|-------|
| `bin` | inventory | list, detail, new, edit |
| `location-transfer` | inventory | list, detail, new |
| `delivery` | inventory | list, detail, new |

### Modified Entity Configs

| Entity | Change |
|--------|--------|
| `order` | Replace `order_item` hasMany relation with custom `OrderItemsEditor` section; add `delivery_id` relation |
| `finished-good` | Add custom inventory section (bin breakdown + commitments + stats) |

---

## Implementation Order

Each step is independently useful and testable.

**Step 1: Schema migration** — `bin_inventory_items`, `deliveries`, FK additions, views, RLS policies, `_schema_registry` entries.

**Step 2: Fix order items experience** — Wire `OrderItemsEditor` into order detail as custom section. Add inventory awareness (availability badges, inline FG panel, optional lot pinning, quantity warnings).

**Step 3: Bin entity pages** — Entity config + pages under `/inventory/bins/`. Detail shows contents from `bin_contents` view with inline transfer action.

**Step 4: Finished good detail inventory section** — Custom domain component with stat cards, bin breakdown, commitments table, inline transfer.

**Step 5: Location transfer pages** — Entity config + pages under `/inventory/transfers/`. State machine, transfer lines with FG and raw material support.

**Step 6: Deliveries** — Entity config + pages under `/inventory/deliveries/`. Grouping of transfers + orders, "Add to delivery" actions on order and transfer detail pages.
