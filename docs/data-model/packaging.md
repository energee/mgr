# Packaging Domain

## `containers`

Physical vessels — cans, bottles, kegs. Parent of selling_formats.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Container name (e.g., "16oz Can", "1/2 Barrel") |
| type | TEXT | Type: package, keg |
| volume_oz | DECIMAL(6,2) | Volume per unit in ounces (required for packages) |
| volume_bbl | DECIMAL(10,4) | Volume in barrels (required for kegs) |
| deposit_amount | DECIMAL(10,2) | Default deposit amount (kegs) |
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Constraints:**
```sql
CHECK (type IN ('package', 'keg'))
CHECK (type != 'package' OR volume_oz IS NOT NULL)
CHECK (type != 'keg' OR volume_bbl IS NOT NULL)
```

---

## `selling_formats`

How a container is grouped for sale — single, 4-pack, case of 24, per keg.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| container_id | UUID | FK to [containers](#containers) |
| name | TEXT | Format name (e.g., "Case of 24", "4-Pack", "Per Keg") |
| unit_count | INTEGER | Units per selling format (e.g., 24 for a case, 1 for single/keg) |
| units_per_layer | INTEGER | How many units of this format fit on one pallet layer (nullable) |
| default_layers | INTEGER | Default number of layers per pallet (nullable) |
| pallet_quantity | INTEGER | Total units per pallet — auto-computed as `units_per_layer × default_layers` when both layer fields are set; can be set manually when only one field is provided (nullable) |
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** `(container_id, name)`

**Pallet quantity trigger (`trg_selling_formats_pallet_quantity`):** Fires `BEFORE INSERT OR UPDATE` of `units_per_layer` or `default_layers`. Behaviour:
- Both fields set → `pallet_quantity` is computed as `units_per_layer × default_layers`
- Both fields NULL → `pallet_quantity` is cleared to NULL
- Exactly one field set → `pallet_quantity` is left unchanged (allows manual override)

**Examples:**

| Container | Selling Format | unit_count | units_per_layer | default_layers | pallet_quantity |
|-----------|---------------|------------|-----------------|----------------|-----------------|
| 16oz Can | Case of 24 | 24 | 20 | 5 | 100 |
| 16oz Can | 4-Pack | 4 | 50 | 5 | 250 |
| 16oz Can | Single | 1 | — | — | — |
| 12oz Bottle | Case of 24 | 24 | 20 | 5 | 100 |
| 1/2 Barrel | Per Keg | 1 | — | — | — |
| 1/6 Barrel | Per Keg | 1 | — | — | — |

**Related table:** `selling_format_materials` in [inventory.md](./inventory.md#selling_format_materials) defines the packaging BOM (cans, lids, trays, etc.) for each format.

---

## `channel_formats`

Junction table: which selling formats appear in which sales channel. Replaces the old `show_in_pricing` boolean with per-channel visibility.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| selling_format_id | UUID | FK to [selling_formats](#selling_formats) |
| sales_channel_id | UUID | FK to [sales_channels](./sales.md#sales_channels) |

**Unique constraint:** `(selling_format_id, sales_channel_id)`

---

## `packaging_sessions`

Packaging sessions (group multiple products/batches packaged together). Created from batch detail pages when batches are ready for packaging.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_date | DATE | Session date |
| status | TEXT | Status: planned, in_progress, completed, revised, cancelled |
| notes | TEXT | Notes |
| completed_at | TIMESTAMPTZ | Timestamp when session was marked completed. Set by BEFORE UPDATE trigger. |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**BEFORE UPDATE trigger:** `packaging_session_before_update` — sets `completed_at` when status transitions to `completed`, blocks `planned → completed` bypass (must go through `in_progress`), blocks completion if session has zero line items.

**Audit trail:** All changes tracked in `entity_revisions` table (entity_type='packaging_session'). See `docs/data-model/system.md`.

---

## `session_line_items`

Line items within a packaging session. Each line item represents one product (brand + format) being packaged from a single batch.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK to [packaging_sessions](#packaging_sessions) |
| brand_id | UUID | FK to [brands](./production.md#brands) |
| selling_format_id | UUID | FK to [selling_formats](#selling_formats) |
| keg_owner_id | UUID | FK to keg_owners (nullable, for keg formats) |
| batch_id | UUID | FK to [batches](./production.md#batches) — source batch for this line item |
| planned_quantity | INTEGER | Planned quantity |
| actual_quantity | INTEGER | Actual quantity |
| created_at | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** `(session_id, batch_id, selling_format_id) WHERE batch_id IS NOT NULL` — prevents duplicate line items for the same batch+format within a session.

---

## `finished_goods`

Finished goods inventory (packaged products ready for sale).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID? | FK to batches (nullable for contract/purchased FG) |
| brand_id | UUID | FK to brands |
| selling_format_id | UUID | FK to selling_formats |
| session_line_item_id | UUID? | FK to session_line_items (nullable for external FG) |
| quantity | INTEGER | Total quantity produced |
| lot_number | TEXT | Lot number (auto-generated or external) |
| production_date | DATE | Production date |
| best_by_date | DATE | Best by date |
| expiration_date | DATE | Expiration date |
| notes | TEXT | Notes (use for external FG source details) |
| version | INTEGER | Optimistic locking version |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Lot number formats** (configured via `settings.lot_format`):

| Format | Example (Oct 31, 2026 #1) | Description |
|--------|---------------------------|-------------|
| `standard` | `20261031-001` | YYYYMMDD-NNN (readable) |
| `julian` | `26304-001` | YYDDD-NNN (day of year) |
| `coded` | `6JV-001` | YMD-NNN (obscured) |

**Entry point rules:** See `docs/data-model/inventory.md` "FG Entry Points" for complete documentation.

- **Internal FG:** `batch_id` AND `session_line_item_id` are both required
- **External FG:** Both are NULL, and `notes` is required to document source

### `finished_goods_with_availability` (View)

Use this view for order fulfillment and inventory queries. Available quantity is calculated from allocations.

```sql
CREATE VIEW finished_goods_with_availability
WITH (security_invoker = true)
AS
SELECT
  fg.*,
  fg.quantity as total_quantity,
  sf.name as selling_format_name,
  c.name as container_name,
  c.type as container_type,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) as reserved_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as available_quantity
FROM finished_goods fg
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
LEFT JOIN containers c ON c.id = sf.container_id
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id, sf.name, c.name, c.type;
```

---

## Packaging to Inventory Flow

When a packaging session is completed, the system creates:

1. **Finished Goods Record(s)** - One `finished_goods` record per line item
2. **Allocations** - Batch-to-FG allocations tracking the inventory movement

**Allocation pattern:**
```sql
-- When packaging session completes:
INSERT INTO allocations (
  source_type, source_id,        -- 'batch', batch.id
  destination_type, destination_id, -- 'finished_good', fg.id
  quantity, volume_bbl,
  status                          -- 'completed'
) VALUES (
  'batch', session_line.batch_id,
  'finished_good', new_fg.id,
  session_line.actual_quantity,
  calculated_volume_bbl,
  'completed'
);
```

See [inventory.md](./inventory.md#allocations) for complete allocation documentation.

---

## Views

### `packaging_sessions_with_summary`

Packaging sessions with aggregated line item counts, brand names, and quantity totals.

Includes computed fields: `line_count`, `brands`, `total_planned`, `total_actual`, `total_variance` (actual - planned).

### `brand_packaging_summary`

Aggregated packaging totals per brand and selling format. Used on the brand detail page.

Columns: `brand_id`, `brand_name`, `selling_format_id`, `format_name`, `total_quantity`, `session_count`.

---

## State Machine: Packaging Session

```
planned -> in_progress -> completed -> revised
    |           |             |
    v           v             v
cancelled   cancelled    (adjust only if no downstream orders packed)
```

| Transition | Trigger |
|------------|---------|
| planned -> in_progress | Start packaging |
| in_progress -> completed | Completion review modal confirms all actuals entered |
| completed -> revised | Adjust quantities |
| planned -> completed | **BLOCKED** — must go through in_progress (enforced by trigger) |

**Batch-initiated creation:** Sessions are typically created from the batch detail page ("Start Packaging" action on conditioning batches). This creates the session, adds a line item with the batch as source, and transitions the batch to `packaging` status.

**UI pattern:** In-progress sessions render a custom `PackagingDayView` component (full-width table with highlighted actual-quantity column and live variance). All other states render via `EntityDetailUnified`.
