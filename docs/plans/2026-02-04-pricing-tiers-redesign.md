# Pricing Tiers Redesign

## Overview

Redesign the pricing system to support a tier-based pricing matrix. Price tiers group products at similar price points (e.g., Tier 1-6, or named like "Lager", "IPA", "Stout"). Each tier defines prices across the full matrix of package formats and sales channels.

Recipes are assigned to a tier (manually or auto-assigned via COGS thresholds), and orders resolve prices through the chain: recipe tier + customer channel + order format.

## Data Model

### `pricing_tiers`

Tier definitions. Small, rarely-changing set.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | e.g., "Tier 1", "IPA" |
| `sort_order` | integer | Display ordering |
| `default_upc` | text | Optional. Overridden by brand UPC if set |
| `cogs_min` | numeric | Lower bound for auto-assignment (nullable) |
| `cogs_max` | numeric | Upper bound for auto-assignment (nullable) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `pricing_tier_prices`

One row per tier x format x channel combination. The matrix cells.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `pricing_tier_id` | uuid | FK -> pricing_tiers |
| `package_format_id` | uuid | FK -> package_types |
| `sales_channel_id` | uuid | FK -> sales_channels |
| `price` | numeric(10,2) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique constraint: `(pricing_tier_id, package_format_id, sales_channel_id)`

### `pricing_history`

Trigger-managed audit trail. No application code writes to this table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `pricing_tier_price_id` | uuid | FK -> pricing_tier_prices |
| `pricing_tier_id` | uuid | Denormalized for querying after deletions |
| `package_format_id` | uuid | Denormalized |
| `sales_channel_id` | uuid | Denormalized |
| `old_price` | numeric(10,2) | |
| `new_price` | numeric(10,2) | Null on deletion |
| `changed_at` | timestamptz | Default now() |
| `changed_by` | uuid | Captured via auth.uid() |

### Triggers

- `BEFORE UPDATE` on `pricing_tier_prices`: When `price` changes, insert a row into `pricing_history` with old and new values.
- `BEFORE DELETE` on `pricing_tier_prices`: Insert a row with `new_price` as null.

### Format visibility

A `show_in_pricing` boolean flag on the `package_types` table controls which formats appear in the pricing matrix. Most formats (especially variants like keg brands) stay hidden. If a variant needs its own price, toggle it on and it gets its own column.

### Recipe connection

Recipes get a `pricing_tier_id` FK (nullable). Auto-assignment: when a recipe's estimated COGS falls within a tier's `cogs_min`/`cogs_max` range, the tier is suggested or auto-set. Overlapping or ambiguous ranges flag for manual selection.

## Interface

### Page structure

Located at `/settings/pricing` with two views:

1. **Matrix view** (default) - Spreadsheet-like grid for scanning, comparing, and editing prices.
2. **Tier settings** - List to manage tier definitions (name, sort order, COGS thresholds, default UPC).

### Matrix view

Sales channels as tabs across the top. Switching tabs shows prices for that channel.

Rows are tiers (sorted by `sort_order`). Columns are priceable package formats (where `show_in_pricing` is true), pulled dynamically from settings.

```
[Retail] [Resale On-Prem] [Resale Off-Prem] [Wholesale]

| Tier   | Glass | Pack | Case | Sixtel | Half BBL |
|--------|-------|------|------|--------|----------|
| Tier 1 | $7    | $15  | $70  | $76    | $189     |
| Tier 2 | $7    | $17  | $79  | $88    | $220     |
| Tier 3 | $8    | $18  | $85  | $96    | $240     |
```

### Editing

- **Inline cell editing**: Click a cell to edit. Tab to next cell, Enter to confirm.
- **Optimistic saves**: Changes save on blur/Enter. Toast on error. Trigger handles history automatically.
- **Bulk adjust**: Toolbar action to apply percentage or flat dollar change across the visible channel. Opens a popover with preview before confirming.
- **Copy channel**: Duplicate prices from one channel to another as a starting point for new channels.

### Tier settings

Simple list or inline-editable table for managing tier definitions:
- Name, sort order
- COGS min/max thresholds
- Default UPC

## Order Integration

Price resolution for an order line:

1. Recipe has a `pricing_tier_id`
2. Customer has a `sales_channel_id`
3. Order line specifies a package format
4. Lookup: `tier x channel x format -> price`

If no price found for the combination, the price field is left blank for manual entry. No silent defaults or fallbacks.

## Migration from Current Schema

The current `price_tiers` and `tier_prices` tables are replaced by `pricing_tiers` and `pricing_tier_prices`. A migration should:

1. Create the new tables
2. Migrate any existing data
3. Drop the old tables
4. Add `show_in_pricing` to `package_types`
5. Add `pricing_tier_id` to recipes
