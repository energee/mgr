# Inventory Domain

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
| destination_type | TEXT | Destination: batch, finished_good, order, sample, adjustment, waste, transfer |
| destination_id | UUID | FK to destination record (polymorphic, nullable for adjustments) |
| quantity | DECIMAL(10,4) | Quantity allocated (always positive) |
| volume_bbl | DECIMAL(10,4) | Volume in BBL (for TTB reporting, nullable) |
| unit_cost | DECIMAL(10,4) | Unit cost at time of allocation |
| status | TEXT | Status: planned, completed, cancelled |
| reason_code | TEXT | For adjustments/removals: breakage, sample_customer, sample_quality, contamination, expired, spillage, theft |
| lot_number | TEXT | Lot number for traceability |
| notes | TEXT | Notes |
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

| destination_type | destination_id references | Use case |
|------------------|--------------------------|----------|
| batch | batches.id | Raw materials used in production |
| finished_good | finished_goods.id | Packaging creates FG from batch |
| order | orders.id | FG sold to customer |
| sample | NULL | Trade or quality samples |
| adjustment | NULL | Inventory corrections |
| waste | NULL | Breakage, spillage, expired |
| transfer | location_transfers.id | Inter-location movement |

---

## `bins`

Storage bins/locations for finished goods.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| location_id | UUID | FK to locations |
| name | TEXT | Bin name/identifier |
| bin_type | TEXT | Type: storage, taproom, shipping, hold, quarantine |
| capacity | INTEGER | Capacity (units or cases) |
| notes | TEXT | Notes |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

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

Finished goods enter inventory via two paths:

**1. Internal Production (typical)**
```
packaging_session → session_line_items → finished_goods
```
- `batch_id` populated from source batch
- `session_line_item_id` links to packaging session
- `lot_number` auto-generated (YYYYMMDD-NNN)

**2. External Receipt (contract/purchased/legacy)**
```
finished_goods (direct creation)
```
- `batch_id` = null
- `session_line_item_id` = null
- `lot_number` = external lot code
- `notes` = source details (supplier, contract brewer, etc.)

Both paths result in FG records that flow through the same allocation system.
