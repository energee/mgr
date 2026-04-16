# Unified Material Planning

## Summary

A material planning system that tracks required materials across the full production lifecycle — brewing, packaging, and order fulfillment — and provides forward-looking shortfall detection with drop dead dates based on supplier lead times.

## Problem

The brewery currently has no way to:
- Define what packaging materials a selling format requires (cans, lids, PakTechs, trays, keg caps)
- See a unified view of all material needs across upcoming brews, packaging sessions, and orders
- Calculate "must order by" dates based on supplier lead times
- Track shipping material needs (pallets, wrap) per order with customer-specific preferences
- Link packaging material inventory items to suppliers with structured pricing and lead times

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| BOM level | Per selling format | Each format has a concrete, complete materials list — no fractional math or layer splitting |
| Supplier linkage | Extend `supplier_catalog` with `catalog_type: 'inventory_item'` | Reuses existing supplier pricing/lead time infrastructure |
| Free text supplier field | Remove from `inventory_items` | Replaced by structured `supplier_catalog` relationship |
| Volume display | Show "16oz x 24" instead of "384oz" | Container size stays visible, unit count conveys grouping |
| Planning page location | `/purchasing/material-planning` | It's about what to order |
| Shortfall RPC | Refactor existing `calculate_ingredient_shortfalls` into unified `calculate_material_shortfalls` | One RPC for all demand sources, replaces the old one |
| Open POs in shortfall calc | Factor in expected PO receives | `effective_on_hand = current_inventory + expected_po_receives (where expected_date <= needed_by_date)` |
| Past due handling | Visual flagging only (red highlight) | Alerting/notification system with Slack deferred to separate feature |
| Pallet planning | Simple estimate with manual override | Full pallet capacity visualization and hybrid stacking deferred to Phase 2 |
| Customer material preferences | Junction table (`customer_shipping_materials`) | Flexible, supports any number of material types, same pattern as selling format BOM |
| Pallet quantity overrides | Per customer per selling format | Different customers have different stacking configurations |

## Deferred

- Notification/alerting system with Slack integration (supports batch readings, recipe deltas, overdue orders, material shortfalls)
- Full pallet planning tool with capacity visualization, hybrid stacking, remaining space display

## Data Model Changes

### New Tables

#### `selling_format_materials`

BOM for each selling format — what packaging materials are needed to produce one unit of that format.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| selling_format_id | UUID FK | References `selling_formats.id` (NOT NULL) |
| inventory_item_id | UUID FK | References `inventory_items.id` (NOT NULL) |
| quantity_per_unit | DECIMAL(10,4) | Materials needed per 1 selling format unit (NOT NULL) |
| notes | TEXT | E.g., "1 PakTech per 4 cans" |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

Constraints: `UNIQUE(selling_format_id, inventory_item_id)`

Example for "Case of 24 (16oz cans)":
| inventory_item | quantity_per_unit | notes |
|---|---|---|
| 16oz Can | 24 | |
| 16oz Lid | 24 | |
| PakTech (4-ct) | 6 | 1 per 4 cans |
| Cardboard Tray | 1 | |

Example for "1/2 Barrel":
| inventory_item | quantity_per_unit | notes |
|---|---|---|
| Keg Cap | 1 | |
| Keg Label | 1 | |

#### `order_materials`

Auto-calculated shipping materials per order with manual override capability.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| order_id | UUID FK | References `orders.id` (NOT NULL) |
| inventory_item_id | UUID FK | References `inventory_items.id` (NOT NULL) |
| estimated_qty | DECIMAL(10,4) | Auto-calculated from order line items + pallet quantities |
| actual_qty | DECIMAL(10,4) | Operator-revised, defaults to estimated_qty |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

Constraints: `UNIQUE(order_id, inventory_item_id)`

#### `customer_shipping_materials`

Customer-specific default materials for shipping (pallet type, wrap type, etc.). The `material_role` field allows the resolution logic to determine which brewery default a customer preference overrides.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_id | UUID FK | References `customers.id` (NOT NULL) |
| inventory_item_id | UUID FK | References `inventory_items.id` (NOT NULL) |
| material_role | TEXT | Role this material fills: 'pallet', 'wrap', 'other' (NOT NULL) |
| notes | TEXT | E.g., "required by customer receiving dock" |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

Constraints: `UNIQUE(customer_id, material_role)` — one material per role per customer

#### `customer_pallet_configs`

Customer-specific override for how many units of a selling format fit on a pallet.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_id | UUID FK | References `customers.id` (NOT NULL) |
| selling_format_id | UUID FK | References `selling_formats.id` (NOT NULL) |
| pallet_quantity | INTEGER | Units per pallet for this customer (NOT NULL) |
| notes | TEXT | E.g., "2 rows of cases, 1 row sixtels" |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

Constraints: `UNIQUE(customer_id, selling_format_id)`

#### `brewery_shipping_defaults`

Brewery-wide default shipping materials applied when no customer preference exists. The `material_role` field matches `customer_shipping_materials.material_role` for override resolution.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| inventory_item_id | UUID FK | References `inventory_items.id` (NOT NULL) |
| material_role | TEXT | Role this material fills: 'pallet', 'wrap', 'other' (NOT NULL, UNIQUE) |
| notes | TEXT | E.g., "standard plastic pallet" |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

### Schema Changes to Existing Tables

#### `selling_formats`

Add column:
| Column | Type | Description |
|--------|------|-------------|
| pallet_quantity | INTEGER | Units of this selling format that fit on one pallet (nullable) |

#### `inventory_items`

Drop column:
| Column | Action | Reason |
|--------|--------|--------|
| supplier | DROP | Replaced by structured `supplier_catalog` relationship |

#### `supplier_catalog`

Extend `catalog_type` to accept `'inventory_item'` as a valid value, with `catalog_id` referencing `inventory_items.id`. This enables packaging materials, shipping supplies, and any other inventory item to have structured supplier relationships with pricing and lead times.

## Calculation Layer

### `calculate_material_shortfalls(p_horizon_weeks INTEGER)`

Replaces `calculate_ingredient_shortfalls`. Returns unified shortfall data across three demand sources.

**Inputs:**
- `p_horizon_weeks` — planning horizon in weeks from today

**Demand sources:**

1. **Brewing** — batches with status `planned` or `scheduled` within the horizon. Demand derived from recipe grain bills, hop schedules, and yeast pitches. Uses existing recipe-to-inventory-item mapping via `inventory_items.catalog_type`/`catalog_id`.

2. **Packaging** — packaging sessions with status `planned` within the horizon. For each session line item: `planned_quantity x selling_format_materials.quantity_per_unit` per material.

3. **Shipping** — orders with status `confirmed` or `scheduled` within the horizon. For each order: pallet count calculated from line item quantities and `pallet_quantity` (customer override via `customer_pallet_configs`, falling back to `selling_formats.pallet_quantity`). Shipping materials resolved from `customer_shipping_materials`, falling back to `brewery_shipping_defaults`.

**Supply calculation:**
```
effective_on_hand = current_inventory (from inventory_lots_with_quantities)
                  + expected_po_receives (from open POs where expected_date <= needed_by_date)
shortfall = total_demand - effective_on_hand
```

Open POs = status IN ('submitted', 'confirmed', 'partial').

**Drop dead date:**
```
drop_dead_date = needed_by_date - supplier_lead_time_days
```

Lead time resolved via existing cascade: `supplier_catalog.lead_time_days` -> `suppliers.default_lead_time_days` -> 7-day fallback.

Best supplier = supplier from `supplier_catalog` with shortest lead time that can deliver by `needed_by_date`. If multiple qualify, pick cheapest.

**Return columns:**

| Column | Type | Description |
|--------|------|-------------|
| inventory_item_id | UUID | The material |
| inventory_item_name | TEXT | Material name |
| category | TEXT | Material category (grain, hop, packaging, etc.) |
| demand_source | TEXT | 'brewing', 'packaging', or 'shipping' |
| source_id | UUID | Batch, session, or order ID |
| source_name | TEXT | Batch number, session date, or order number |
| needed_by_date | DATE | Brew date, session date, or order expected date |
| quantity_needed | DECIMAL | Total demand for this source |
| on_hand | DECIMAL | Current inventory |
| incoming_po | DECIMAL | Expected from open POs |
| shortfall | DECIMAL | Demand - on_hand - incoming_po (0 if no shortfall) |
| unit | TEXT | Unit of measure |
| best_supplier_id | UUID | Recommended supplier |
| best_supplier_name | TEXT | Supplier name |
| lead_time_days | INTEGER | Supplier lead time |
| drop_dead_date | DATE | Must order by this date |
| is_past_due | BOOLEAN | drop_dead_date < today |

### Order materials auto-calculation

Triggered application-side (not a database trigger) when an order is created or its line items are modified. This keeps the logic in TypeScript where it can access the resolution cascade cleanly and avoids complex trigger chains.

Steps:
1. Calculate pallet count per selling format: `ceil(line_item_quantity / pallet_quantity)` using customer override (`customer_pallet_configs`) or selling format default
2. Sum total pallets across all line items
3. Resolve shipping materials per role: customer preference (`customer_shipping_materials`) -> brewery default (`brewery_shipping_defaults`), matched by `material_role`
4. Upsert `order_materials` with `estimated_qty` = total pallets x 1 per material
5. Set `actual_qty = estimated_qty` as default (operator can override later)

## UI Changes

### Selling Format BOM Editor

Location: selling format detail page, new "Required Materials" section.

Editable table:
| Material | Qty Per Unit | Notes |
|---|---|---|
| 16oz Can | 24 | |
| 16oz Lid | 24 | |
| PakTech (4-ct) | 6 | 1 per 4 cans |
| Cardboard Tray | 1 | |

Add/remove rows with inventory item picker. Similar pattern to existing grain bill or hop schedule editors.

### Packaging Session Material Preview

Location: packaging session detail page, new "Materials Required" read-only section.

Auto-calculated from session line items x selling format BOMs:
| Material | Needed | On Hand | Shortfall |
|---|---|---|---|
| 16oz Can | 1200 | 3000 | -- |
| PakTech (4-ct) | 300 | 150 | 150 |

Includes link to material planning page for shortfall items.

### Order Shipping Materials

Location: order detail page, new "Shipping Materials" section.

Shows auto-calculated materials with editable actual quantities:
| Material | Estimated | Actual | Notes |
|---|---|---|---|
| Plastic Pallet | 3 | 3 | |
| Clear Shrink Wrap | 3 | 3 | |

Auto-populated from customer preferences or brewery defaults when order is created/updated.

### Customer Detail Enhancements

Two new sections on the customer detail page:

**Shipping Preferences** — default pallet type, wrap type, etc. (references to inventory items)

**Pallet Configs** — per selling format units-per-pallet overrides with notes field for stacking configuration details.

### Material Planning Page

Location: `/purchasing/material-planning`

**Filters:** horizon (2/4/8/12 weeks), demand source (all/brewing/packaging/shipping), show only shortfalls toggle.

**Table:**
| Material | Source | Needed By | Qty Needed | On Hand | Incoming (PO) | Shortfall | Best Supplier | Lead Time | Order By | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 2-Row Malt | Brewing | Apr 25 | 500 lb | 200 lb | 0 | 300 lb | Grain Co | 14d | Apr 11 | PAST DUE |
| PakTech (4-ct) | Packaging | Apr 30 | 300 | 150 | 0 | 150 | PackSupply | 7d | Apr 23 | Order Now |
| 16oz Can | Packaging | Apr 30 | 1200 | 3000 | 0 | -- | -- | -- | -- | OK |
| Plastic Pallet | Shipping | May 2 | 3 | 10 | 0 | -- | -- | -- | -- | OK |

Rows with `is_past_due = true` highlighted in red. Rows with shortfalls but still within lead time in yellow/amber.

### Selling Format Volume Display Fix

Change all selling format volume displays from rolled-up total (e.g., "384oz") to container-anchored format: "16oz x 24".

### Pallet Quantity Display

Wherever inventory quantities for selling formats are shown (finished goods, bin contents), add secondary display when `pallet_quantity` is set: "1200 cans (50 cases, 0.5 pallets)".

Show pallet counts on orders: "this order is 1.2 pallets".

### Brewery Shipping Defaults

Location: settings page or purchasing settings. Simple list of default shipping materials (inventory item references) applied when no customer preference exists.
