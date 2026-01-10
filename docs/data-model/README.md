# Data Model

This directory contains the relational database schema for MGR. This is the **source of truth** for all table definitions.

## Domains

| Domain | Description |
|--------|-------------|
| [Catalog](./catalog.md) | Reference data for ingredients and materials |
| [Production](./production.md) | Recipes, batches, vessels, and fermentation operations |
| [Brew Logs](./brew-logs.md) | Hot-side brewing records (decoupled from batches) |
| [Inventory](./inventory.md) | Raw material stock tracking and allocations |
| [Packaging](./packaging.md) | Package types, sessions, and finished goods |
| [Sales](./sales.md) | Customers, orders, and pricing |
| [Purchasing](./purchasing.md) | Suppliers, purchase orders, and receiving |
| [Kegs](./kegs.md) | Keg inventory and customer balance tracking |
| [Notifications](./notifications.md) | In-app notifications and integrations |
| [System](./system.md) | Settings, locations, and user data |

## Design Principles

1. **JSONB for recipe ingredients** - Malts, hops, adjuncts, sugars, spices, fruits are stored as JSONB arrays in the recipe. This captures a snapshot of ingredient properties at recipe creation time and simplifies read/write operations.

2. **Junction tables for shared/reusable data** - Water profiles and recipe additions use proper tables because they can be shared (defaults) or need querying across recipes.

3. **Catalog tables for reference data** - All ingredient types have catalog tables for autocomplete, inventory linking, and property management. Recipes store both the catalog ID and a snapshot of relevant properties.

4. **Allocation-based inventory** - No mutable running balances. Quantities calculated from allocation records.

5. **State machines for workflows** - Stateful entities (batches, orders, sessions, transfers) use consistent state machine patterns.

## Relationships Overview

```
Catalog Domain
├── beer_styles
│   └── brands (style_id)
│   └── recipes (style_id)
├── yeasts
│   └── recipes (yeast_id)
│   └── yeast_pitches (yeast_id)
├── malts, hops, adjuncts, sugars, spices, fruits, additives
│   └── inventory_items (catalog_type, catalog_id)
│   └── supplier_catalog (catalog_type, catalog_id)

Production Domain
├── recipes
│   └── recipe_collaborators (recipe_id)
│   └── recipe_additions (recipe_id)
│   └── batches (recipe_id)
│   └── brew_logs (recipe_id)
│   └── [JSONB] malts, hops, adjuncts, sugars, spices, fruits
├── brew_logs (hot-side)
│   └── brew_log_batches (brew_log_id) - volume allocation to batches
│   └── [JSONB] events - timeline with measurements
├── batches (cold-side)
│   └── brew_log_batches (batch_id) - links to source brew(s)
│   └── batch_logs (batch_id)
│   └── batch_readings (batch_id)
│   └── batch_additions (batch_id)
│   └── batch_sources (batch_id) - for blends
│   └── vessel_transfers (batch_id)
│   └── pitch_usage (batch_id)
│   └── finished_goods (batch_id)
├── vessels
│   └── vessel_transfers (from/to_vessel_id)
│   └── batch_readings (vessel_id)
├── yeast_pitches
│   └── pitch_usage (pitch_id)

Packaging Domain
├── package_types
│   └── packages (package_type_id)
│   └── finished_goods (package_type_id)
│   └── order_items (package_type_id)
├── packaging_sessions
│   └── session_line_items (session_id)
│   └── finished_goods (session_line_item_id)
├── finished_goods
│   └── bin_inventory (finished_good_id)
│   └── fg_allocations (finished_good_id)
│   └── transfer_lines (finished_good_id)

Inventory Domain
├── inventory_items
│   └── allocations (inventory_item_id)
│   └── inventory_lots (inventory_item_id)
├── bins
│   └── bin_inventory (bin_id)
│   └── location_transfers (from/to_bin_id)

Purchasing Domain
├── suppliers
│   └── supplier_catalog (supplier_id)
│   └── purchase_orders (supplier_id)
├── purchase_orders
│   └── po_line_items (po_id)
│   └── po_receives (po_line_item_id)
│   └── inventory_lots (po_receive_id)

Sales Domain
├── customers
│   └── orders (customer_id)
│   └── customer_keg_balances (customer_id)
├── orders
│   └── order_items (order_id)
├── sales_channels
│   └── customers (customer_type maps to channel)
│   └── price_tier_channels (channel_id)
├── price_tiers
│   └── price_tier_channels (tier_id)
│   └── tier_prices (tier_id)

Kegs Domain
├── keg_types
│   └── keg_inventory (keg_type_id)
│   └── customer_keg_balances (keg_type_id)
│   └── keg_transactions (keg_type_id)
├── keg_sizes
│   └── keg_inventory (keg_size_id)
│   └── keg_transactions (keg_size_id)

System Domain
├── settings (singleton)
├── locations
│   └── bins (location_id)
│   └── vessels (location_id)
│   └── keg_inventory (location)
```

## Units Convention

All measurements use these standard units in the database:
- **Volume**: BBL (barrels) for production scale, gallons for water
- **Weight**: pounds (lbs) for large quantities, ounces for hops/spices
- **Temperature**: Fahrenheit (°F)
- **Time**: minutes for process times, days for fermentation/conditioning
- **Gravity**: specific gravity format (e.g., 1.050)
- **Color**: SRM (Standard Reference Method) or Lovibond
- **Bitterness**: IBU (International Bitterness Units)

The application layer handles unit conversions for display.

## Calculated Fields

These fields are calculated and cached, updated when dependencies change:

**Recipe**:
- `est_og` - From grain bill and efficiency
- `est_fg` - From OG and attenuation
- `est_abv` - From OG and FG
- `est_ibu` - From hop additions and timing
- `est_srm` - From grain bill color contributions
- `est_cogs` - Sum of ingredient costs

**Application-level calculations** (not stored):
- Ingredient bags count - From weight and bag size
- Ingredient value - From weight and cost per unit
- Total grain bill % - Per malt contribution to total weight
- Available quantity - Total minus allocated

## Common Columns

All tables include these standard columns:
- `id` - UUID primary key
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp (where applicable)
- `is_active` - Soft delete flag (where applicable)

## SQL Generation

SQL CREATE statements will be generated from these markdown definitions. Until then, use the markdown tables as the authoritative schema reference.
