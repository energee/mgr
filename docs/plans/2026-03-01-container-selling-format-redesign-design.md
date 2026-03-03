# Container + Selling Format Pricing Redesign

## Problem

The current pricing system conflates physical containers with selling formats. A "16oz Can" might be sold as a case of 24, a 4-pack, or individually — but each is modeled as a separate `package_types` row. This makes the pricing matrix a flat, confusing list of formats. Kegs live in a separate `keg_types` table with different fields, requiring special-case handling throughout the codebase. "Units per case" is unintuitive. Format visibility is global (a single `show_in_pricing` boolean) rather than per-channel.

## Design

### Data Model

#### `containers` — the physical vessel

Replaces both `package_types` and `keg_types`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL UNIQUE | "16oz Can", "12oz Bottle", "1/2 Barrel" |
| type | TEXT NOT NULL | `package` or `keg` |
| volume_oz | DECIMAL(6,2) | For packages (cans, bottles). NULL for kegs. |
| volume_bbl | DECIMAL(10,4) | For kegs (TTB reporting). NULL for packages. |
| deposit_amount | DECIMAL(10,2) DEFAULT 0 | Keg deposit. 0 for packages. |
| is_active | BOOLEAN DEFAULT true | |
| position | INTEGER DEFAULT 0 | Display order |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `selling_formats` — how a container is grouped for sale

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| container_id | UUID FK → containers ON DELETE CASCADE | |
| name | TEXT NOT NULL | "Single", "4-Pack", "6-Pack", "Case of 24", "Per Keg" |
| unit_count | INTEGER NOT NULL DEFAULT 1 | 1, 4, 6, 24 |
| is_active | BOOLEAN DEFAULT true | |
| position | INTEGER DEFAULT 0 | Display order within container |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| UNIQUE(container_id, name) | | |

Kegs get one auto-created selling format: "Per Keg" with `unit_count = 1`.

#### `channel_formats` — per-channel selling format visibility

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| selling_format_id | UUID FK → selling_formats ON DELETE CASCADE | |
| sales_channel_id | UUID FK → sales_channels ON DELETE CASCADE | |
| UNIQUE(selling_format_id, sales_channel_id) | | |

A row in this table means the selling format appears in that channel's pricing matrix.

#### Changes to existing tables

- `pricing_tier_prices.format_id` → references `selling_formats.id` (no FK constraint, same pattern as today)
- `order_items` → new `selling_format_id` column replaces `package_type_id` and `keg_type_id`
- `allocations` → reference `selling_format_id`
- `pricing_history` → `format_id` now references `selling_formats.id`

#### Tables dropped

- `package_types` — migrated into `containers` + `selling_formats`
- `keg_types` — migrated into `containers` (with auto-created "Per Keg" selling format)
- `packaging_formats` view — replaced by `selling_formats JOIN containers`

### Pricing Matrix UI

Channel tabs across the top (one per active sales channel). Matrix columns are only the selling formats enabled for the active channel via `channel_formats`, grouped by container:

```
           ┌─── 16oz Can ───┐  ┌─ 12oz Bottle ─┐  ┌── 1/2 Barrel ──┐
           │ Case/24 │4-Pack │  │  Case/12       │  │  Per Keg       │
───────────┼─────────┼───────┼──┼────────────────┼──┼────────────────┤
Tier 1     │  $38.00 │$12.00 │  │  $24.00        │  │  $185.00       │
Tier 2     │  $42.00 │$14.00 │  │  $28.00        │  │  $195.00       │
```

- Column headers: container name as group header, selling format name as column label
- Different channels show different columns
- Keyboard navigation, inline editing, bulk adjust, and copy-from all work the same as today

### Formats Tab

Nested container > selling format > channel toggle grid replaces the current flat toggle list:

```
▼ 16oz Can
    ☑ Case of 24      [Distributor ☑] [Retailer ☑] [Taproom ☐]
    ☑ 4-Pack           [Distributor ☑] [Retailer ☑] [Taproom ☑]
    ☑ Single           [Distributor ☐] [Retailer ☐] [Taproom ☑]
▼ 1/2 Barrel
    ☑ Per Keg          [Distributor ☑] [Retailer ☐] [Taproom ☑]
```

### Settings Pages

**Containers page** (`/settings/containers`) — replaces both "Package Types" and "Keg Types" settings. Standard entity list. Detail page shows container properties and inline selling format management (add/remove/reorder).

**Pricing page** (`/settings/pricing`) — three tabs: Matrix, Tiers, Formats. Matrix and Formats updated as described above. No separate Channels tab — channel visibility is managed in the Formats tab.

**Removed from nav:**
- "Package Types" → replaced by "Containers"
- "Keg Types" tab under Kegs → replaced by "Containers" (keg owners stays as its own page)

### Migration Strategy

1. **Create new tables** — `containers`, `selling_formats`, `channel_formats` with RLS policies gated by `settings:manage`.
2. **Migrate data** — For each `package_types` row: create a `containers` row (deduped by container_type + volume_oz) and a `selling_formats` row. For each `keg_types` row: create a `containers` row and a "Per Keg" selling format. Build a mapping table of old IDs → new selling_format IDs.
3. **Add `selling_format_id` to referencing tables** — Add nullable FK columns to `order_items`, `allocations`, `pricing_tier_prices`, etc. Backfill from old IDs using the mapping.
4. **Update views** — Replace `packaging_formats` view with `selling_formats JOIN containers`. Update `recipes_with_estimates` and other views.
5. **Switch application code** — Entity configs, order items editor, pricing page all point to new tables.
6. **Drop old columns and tables** — Remove `package_type_id`, `keg_type_id` FKs. Drop `package_types`, `keg_types`, `packaging_formats`.
