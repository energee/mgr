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

Inventory movements for raw materials. Sum allocations to get current balance.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| inventory_item_id | UUID | FK to inventory_items |
| allocation_type | TEXT | Type: receipt, batch_usage, adjustment, transfer, waste |
| quantity | DECIMAL(10,4) | Quantity (+/-) |
| unit_cost | DECIMAL(10,4) | Unit cost at time of allocation |
| reference_type | TEXT | Reference type: batch, order, adjustment |
| reference_id | UUID | FK to referenced record |
| lot_number | TEXT | Lot number |
| expiration_date | DATE | Expiration date |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| created_by | UUID | FK to auth.users |

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

## `fg_allocations`

Finished goods allocations (tracks FG committed to orders, samples, etc.).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| finished_good_id | UUID | FK to finished_goods |
| destination_type | TEXT | Type: order, sample_trade, sample_quality, consumed, destruction, loss, adjustment |
| destination_id | UUID | FK to destination record (order_id, etc.) |
| quantity | INTEGER | Quantity allocated |
| volume_bbl | DECIMAL(10,4) | Volume in BBL (for TTB reporting) |
| status | TEXT | Status: planned, completed, cancelled |
| lot_number | TEXT | Lot number |
| removal_reason | TEXT | For TTB: contamination, failed_qc, expired, breakage, spillage, theft |
| notes | TEXT | Notes |
| completed_at | TIMESTAMPTZ | When completed |
| cancelled_at | TIMESTAMPTZ | When cancelled |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

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

**Available FG:**
```
Available = Total Quantity - SUM(planned + completed allocations)
```

**Bin Available:**
```
Bin Available = Bin Quantity - SUM(planned + completed allocations for that FG in that bin)
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
