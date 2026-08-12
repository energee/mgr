# Purchasing Domain

## `suppliers`

Ingredient and material suppliers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Supplier name |
| contact_name | TEXT | Primary contact |
| contact_email | TEXT | Email |
| contact_phone | TEXT | Phone |
| address | JSONB | Address object |
| default_lead_time_days | INTEGER | Default lead time |
| payment_terms | TEXT | Payment terms (Net 30, etc.) |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Deletion audit — migration `00286`, committed but NOT YET APPLIED LIVE
(sequenced behind `00282`, #693).** Once pushed, every row deletion writes an
[`entity_revisions`](system.md#entity_revisions) row
(`entity_type = 'suppliers'`, `operation = 'DELETE'`, full `old_data` image).
The trigger is deliberately DELETE-only: the MongoDB sync upserts every
supplier document on every run, so an INSERT/UPDATE trigger would append one
no-change ledger row per supplier per sync (#694). Deletion is the loss mode —
`00252_merge_duplicate_suppliers.sql` hard-deleted supplier rows with no trail.
Reading those revisions requires `purchasing:read`, the same permission
`suppliers_select` requires.

---

## `supplier_catalog`

What each supplier offers (links suppliers to catalog items and inventory items).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| supplier_id | UUID | FK to suppliers |
| catalog_type | TEXT | Catalog type: malt, hop, yeast, adjunct, sugar, spice, fruit, additive, **inventory_item** |
| catalog_id | UUID | FK to catalog item (polymorphic; when catalog_type = 'inventory_item', references inventory_items.id) |
| supplier_sku | TEXT | Supplier's SKU/product code |
| price | DECIMAL(10,4) | Current price |
| unit | TEXT | Price unit |
| min_order_qty | DECIMAL(10,2) | Minimum order quantity |
| lead_time_days | INTEGER | Lead time override |
| notes | TEXT | Notes |
| is_preferred | BOOLEAN | Is this the preferred supplier for this item? |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (supplier_id, catalog_type, catalog_id)

Migration `00252_merge_duplicate_suppliers.sql` consolidates suppliers whose
names differ only by case or whitespace. When both duplicate suppliers have a
row for the same catalog item, a preferred designation on either row is carried
onto the surviving row before the collision is removed.

**Audited — migration `00282`, committed but NOT YET APPLIED LIVE (#693).**
Once it is pushed, every INSERT / UPDATE / DELETE writes an
[`entity_revisions`](system.md#entity_revisions) row with the full before/after
image (`entity_type = 'supplier_catalog'`). Until then the live database has no
such trigger and `supplier_catalog` edits made in production leave no trail —
check `supabase/live-catalog.snapshot.txt` for `tr_supplier_catalog_revision`
before relying on this. Rows here are only ever written by a deliberate human
action, and `is_preferred` has no derivable ground truth, so a row destroyed by
a data migration or hand-edit is unrecoverable — that is what happened before
#494 fixed `00252`, and #549 tracks the live re-marking still owed. Reading
those revisions requires `purchasing:read`, the same permission
`supplier_catalog_select` requires.

**Extension — `inventory_item` catalog_type (migration `00161`):** The `catalog_type` column now accepts `'inventory_item'` in addition to the brewing ingredient catalog types. When `catalog_type = 'inventory_item'`, `catalog_id` is a direct FK to `inventory_items.id`, enabling structured supplier relationships for raw packaging materials and other non-catalog inventory (e.g., cans, trays, pallets, stretch wrap). This replaces the legacy free-text `inventory_items.supplier` column.

```sql
-- Link a supplier to an inventory item (e.g., can supplier)
INSERT INTO supplier_catalog (supplier_id, catalog_type, catalog_id, price, unit, is_preferred)
VALUES (:supplier_id, 'inventory_item', :inventory_item_id, 0.05, 'each', true);
```

---

## `purchase_orders`

Purchase orders to suppliers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| supplier_id | UUID | FK to suppliers |
| po_number | TEXT | PO number |
| status | TEXT | Status: draft, submitted, confirmed, partial, fulfilled, cancelled |
| order_date | DATE | Order date |
| expected_date | DATE | Expected delivery date |
| shipping_cost | DECIMAL(10,2) | Shipping cost |
| tax | DECIMAL(10,2) | Tax amount |
| notes | TEXT | Notes |
| submitted_at | TIMESTAMPTZ | When submitted to supplier |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `po_line_items`

Purchase order line items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| po_id | UUID | FK to purchase_orders |
| catalog_type | TEXT | Catalog type: malt, hop, yeast, etc. |
| catalog_id | UUID | FK to catalog item |
| quantity | DECIMAL(10,4) | Ordered quantity |
| unit | TEXT | Unit |
| unit_price | DECIMAL(10,4) | Unit price |
| created_at | TIMESTAMPTZ | Created timestamp |

**Note:** `received_quantity` is calculated, not stored. Use `po_line_items_with_quantities` view.

### `po_line_items_with_quantities` (View)

```sql
CREATE VIEW po_line_items_with_quantities AS
SELECT
  pli.*,
  pli.quantity as ordered_quantity,
  COALESCE(SUM(por.quantity), 0) as received_quantity,
  pli.quantity - COALESCE(SUM(por.quantity), 0) as outstanding_quantity
FROM po_line_items pli
LEFT JOIN po_receives por ON por.po_line_item_id = pli.id
GROUP BY pli.id;
```

---

## `po_receives`

Partial receives against PO line items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| po_line_item_id | UUID | FK to po_line_items |
| quantity | DECIMAL(10,4) | Quantity received |
| lot_number | TEXT | Lot number |
| expiration_date | DATE | Expiration date |
| received_date | DATE | Date received |
| received_by | UUID | FK to auth.users |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## `inventory_lots`

Inventory lots from received POs. Tracks lot-level inventory for FIFO costing.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| inventory_item_id | UUID | FK to inventory_items |
| po_receive_id | UUID | FK to po_receives (optional) |
| lot_number | TEXT | Lot number |
| quantity | DECIMAL(10,4) | Original received quantity |
| unit | TEXT | Unit |
| unit_cost | DECIMAL(10,4) | Unit cost before shipping |
| landed_cost | DECIMAL(10,4) | Unit cost including shipping allocation |
| received_date | DATE | Date received |
| expiration_date | DATE | Expiration date |
| location | TEXT | Storage location |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Note:** `remaining_quantity` is calculated from allocations, not stored. Use `inventory_lots_with_quantities` view.

### `inventory_lots_with_quantities` (View)

```sql
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
```

**FIFO Usage Query:**
```sql
-- Get available lots for an inventory item, oldest first
SELECT * FROM inventory_lots_with_quantities
WHERE inventory_item_id = :item_id
  AND remaining_quantity > 0
ORDER BY received_date ASC, expiration_date ASC NULLS LAST;
```

---

## Accept into Inventory Workflow

After PO items are physically received (`po_receives`), an "Accept into Inventory" step creates `inventory_lots` records, linking them via `po_receive_id`.

**Flow:**
```
po_receives (physical receipt) → Accept into Inventory → inventory_lots (tracked inventory)
```

**Database function:** `get_unaccepted_po_receives(p_po_id UUID)` returns all `po_receives` for a PO that don't yet have a linked `inventory_lot`. The dialog uses this to show which received items still need inventory acceptance.

**Why two steps?** Separating receiving from inventory acceptance enables:
- QA/inspection steps between receipt and inventory acceptance
- Proper mapping to `inventory_items` (which may not match catalog items 1:1)
- User control over which items enter inventory tracking

**UI:** The "Accept into Inventory" action button appears on PO detail pages when status is `partial` or `fulfilled`.

---

## State Machine: Purchase Order

```
draft -> submitted -> confirmed -> partial -> fulfilled
  |          |            |           |
  v          v            v           v
cancelled  cancelled   cancelled   cancelled
```

| Transition | Trigger |
|------------|---------|
| draft -> submitted | Send to supplier |
| submitted -> confirmed | Supplier confirms |
| confirmed -> partial | Some items received |
| partial -> fulfilled | All items received |
| confirmed -> fulfilled | All received at once |

---

## `order_materials`

Shipping materials (estimated and actual quantities) associated with a specific order. Rows are derived from the current order lines and the customer/brewery shipping configuration, and can be adjusted through fulfillment.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| order_id | UUID | FK to [orders](./sales.md#orders) |
| inventory_item_id | UUID | FK to [inventory_items](./inventory.md#inventory_items) |
| estimated_qty | DECIMAL(10,4) | System-calculated quantity estimate (pallets, wrap, etc.) |
| actual_qty | DECIMAL(10,4) | Override quantity confirmed at fulfillment (nullable) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** `(order_id, inventory_item_id)`

**Transactional recalculation:** Every insert, quantity/format update, or delete
on `order_items` calls `recalculate_order_materials(order_id)` through database
triggers. The function locks the parent order, totals pallets per line using a
customer layer override when present (otherwise the selling-format pallet
quantity), and resolves one material per role with customer materials taking
precedence over brewery defaults. It updates `estimated_qty`, adds/removes
configured rows, and leaves a non-null `actual_qty` untouched — a row whose
material falls out of the configured set is deleted only when its `actual_qty`
is null, so manually recorded usage survives configuration changes. This same
trigger boundary covers both direct staff edits and approved customer change
requests, so a recalculation error rolls the line change back.

The per-row `AFTER` trigger re-runs the full order recalculation once per
changed line, so a multi-item change request performs O(N) redundant
recalculations. This is a known, accepted tradeoff: each run is cheap,
correctness comes from the shared order lock, and per-statement batching is
not worth the complexity at current order sizes.

**Quantity resolution:** `calculate_shipping_material_demand()` uses `actual_qty` when set, otherwise falls back to `estimated_qty`. See [calculate_material_shortfalls](#calculate_material_shortfalls) for the full shortfall calculation.

---

## RPC Functions

### `calculate_ingredient_shortfalls(p_horizon_weeks)`

Calculates brewing ingredient shortfalls over a given horizon. Uses lead time cascade: `supplier_catalog.lead_time_days` -> `suppliers.default_lead_time_days` -> 7-day fallback.

**Deprecated in favour of `calculate_material_shortfalls` for new callers.** Retained for backwards compatibility.

Returns: `catalog_type, catalog_id, catalog_name, total_required, available_qty, on_order_qty, shortfall_qty, unit, required_by_date, order_by_date, lead_time_days, preferred_supplier_id, preferred_supplier_name, min_order_qty, unit_price, is_urgent, batch_count`

### `calculate_material_shortfalls(p_horizon_weeks DEFAULT 8)`

Unified material shortfalls report replacing `calculate_ingredient_shortfalls`. Combines demand from three sources and compares against on-hand inventory and open POs to produce per-item shortfall rows with lead-time and drop-dead-date.

**Three demand sources:**

| demand_source | Source | How demand is measured |
|---------------|--------|------------------------|
| `brewing` | Scheduled batches (via `calculate_ingredient_demand`) | Ingredient quantities from recipe grain bill, hop schedule, and yeast |
| `packaging` | Planned packaging sessions (via `calculate_packaging_material_demand`) | `session_line_items.planned_quantity × selling_format_materials.quantity_per_unit` |
| `shipping` | Open orders with `order_materials` rows (via `calculate_shipping_material_demand`) | `actual_qty` if set, else `estimated_qty` |

**Returns:**

| Column | Type | Description |
|--------|------|-------------|
| inventory_item_id | UUID | Inventory item with demand |
| inventory_item_name | TEXT | Item name |
| category | TEXT | Item category (grain, hops, packaging, etc.) |
| demand_source | TEXT | `brewing`, `packaging`, or `shipping` |
| needed_by_date | DATE | Earliest date the item is needed |
| quantity_needed | DECIMAL(12,4) | Total demand quantity |
| on_hand | DECIMAL(12,4) | Current available quantity from inventory lots |
| incoming_po | DECIMAL(12,4) | Outstanding quantity on open POs (submitted, confirmed, partial) |
| shortfall | DECIMAL(12,4) | `MAX(quantity_needed - on_hand - incoming_po, 0)` |
| unit | TEXT | Unit of measure |
| best_supplier_id | UUID | Preferred supplier (is_preferred DESC, lead_time ASC, price ASC) |
| best_supplier_name | TEXT | Preferred supplier name |
| lead_time_days | INTEGER | Lead time for best supplier (falls back to 7 days) |
| drop_dead_date | DATE | `needed_by_date - lead_time_days` — must order by this date |
| is_past_due | BOOLEAN | True when drop_dead_date is in the past |
| source_count | INTEGER | Number of sessions/orders/batches contributing to demand |

```sql
-- Get all shortfalls over the next 8 weeks
SELECT * FROM calculate_material_shortfalls(8);

-- Filter to only items with actual shortfalls
SELECT * FROM calculate_material_shortfalls(8)
WHERE shortfall > 0
ORDER BY is_past_due DESC, drop_dead_date ASC;
```

### `cogs_by_period(p_start_date, p_end_date)`

Returns per-batch cost breakdown using allocation data from inventory lots. Pivots costs by ingredient category (grain, hops, yeast, adjunct, other). Falls back to recipe-estimated COGS when no allocation data exists.

Returns: `batch_id, batch_number, recipe_name, brand_name, volume_bbl, malt_cost, hop_cost, yeast_cost, adjunct_cost, other_cost, total_ingredient_cost, total_landed_cost, cost_per_bbl, has_allocation_data`

### `margin_by_channel(p_start_date, p_end_date)`

Revenue vs estimated COGS by sales channel. Estimates unit COGS via `recipes_with_cogs.cogs_per_bbl / calculate_units_per_bbl()`. Customers without a sales channel are grouped as "Uncategorized".

Returns: `channel_id, channel_name, order_count, total_units, total_revenue, total_cogs, gross_margin, margin_pct`

---

## Indexes

Performance indexes for purchasing domain tables:

```sql
-- Purchase order queries
CREATE INDEX idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
CREATE INDEX idx_purchase_orders_status_date ON purchase_orders(status, order_date DESC);
CREATE INDEX idx_purchase_orders_po_number ON purchase_orders(po_number);

-- PO line items (for receiving and COGS)
CREATE INDEX idx_po_line_items_po ON po_line_items(purchase_order_id);
CREATE INDEX idx_po_line_items_catalog ON po_line_items(catalog_type, catalog_id);

-- Supplier catalog lookups
CREATE INDEX idx_supplier_catalog_supplier ON supplier_catalog(supplier_id, is_active);
CREATE INDEX idx_supplier_catalog_catalog ON supplier_catalog(catalog_type, catalog_id, is_active);
CREATE INDEX idx_supplier_catalog_sku ON supplier_catalog(supplier_sku);

-- Supplier queries
CREATE INDEX idx_suppliers_active ON suppliers(is_active);
CREATE INDEX idx_suppliers_name ON suppliers(name) WHERE is_active = true;
```
