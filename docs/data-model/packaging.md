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
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** `(container_id, name)`

**Examples:**

| Container | Selling Format | unit_count |
|-----------|---------------|------------|
| 16oz Can | Case of 24 | 24 |
| 16oz Can | 4-Pack | 4 |
| 16oz Can | Single | 1 |
| 12oz Bottle | Case of 24 | 24 |
| 1/2 Barrel | Per Keg | 1 |
| 1/6 Barrel | Per Keg | 1 |

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

Packaging sessions (group multiple products/batches packaged together).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_date | DATE | Session date |
| status | TEXT | Status: planned, in_progress, completed, revised, cancelled |
| notes | TEXT | Notes |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Audit trail:** All changes tracked in `entity_revisions` table (entity_type='packaging_session'). See `docs/data-model/system.md`.

---

## `session_line_items`

Line items within a packaging session.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK to [packaging_sessions](#packaging_sessions) |
| brand_id | UUID | FK to [brands](./production.md#brands) |
| selling_format_id | UUID | FK to [selling_formats](#selling_formats) |
| source_batches | JSONB | Source batch allocations |
| planned_quantity | INTEGER | Planned quantity |
| actual_quantity | INTEGER | Actual quantity |
| created_at | TIMESTAMPTZ | Created timestamp |

**source_batches schema:**
```json
[
  { "batch_id": "uuid", "planned_qty": 100, "actual_qty": 98 }
]
```

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
  'batch', session_line.source_batches[0].batch_id,
  'finished_good', new_fg.id,
  session_line.actual_quantity,
  calculated_volume_bbl,
  'completed'
);
```

See [inventory.md](./inventory.md#allocations) for complete allocation documentation.

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
| in_progress -> completed | Finish, create finished goods + allocations |
| completed -> revised | Adjust quantities |
| completed -> (rollback) | Only if no downstream orders packed |
