# Packaging Domain

## `package_types`

Package type definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Package name (e.g., "16oz Can") |
| container_type | TEXT | Type: can, bottle, keg, growler |
| volume_oz | DECIMAL(6,2) | Volume in ounces |
| units_per_case | INTEGER | Units per case |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `packages`

Packaged beer records (simple tracking, see `finished_goods` for full inventory).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| batch_id | UUID | FK to [batches](./production.md#batches) |
| package_type_id | UUID | FK to [package_types](#package_types) |
| quantity | INTEGER | Number of units |
| packaged_date | DATE | Packaging date |
| best_by_date | DATE | Best by date |
| lot_code | TEXT | Lot code |
| notes | TEXT | Notes |
| created_at | TIMESTAMPTZ | Created timestamp |

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
| package_type_id | UUID | FK to [package_types](#package_types) |
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
| package_type_id | UUID | FK to package_types |
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

**Coded format encoding:**
- Y = last digit of year (2026 → 6)
- M = month letter (A=Jan, B=Feb, ... J=Oct, K=Nov, L=Dec)
- D = day (1-9 = 1-9, A=10, B=11, ... U=30, V=31)

**Entry point rules:** See `docs/data-model/inventory.md` "FG Entry Points" for complete documentation.

- **Internal FG:** `batch_id` AND `session_line_item_id` are both required
- **External FG:** Both are NULL, and `notes` is required to document source

```sql
-- Constraint to enforce valid entry point combinations
ALTER TABLE finished_goods ADD CONSTRAINT chk_fg_entry_point CHECK (
  (batch_id IS NOT NULL AND session_line_item_id IS NOT NULL) OR
  (batch_id IS NULL AND session_line_item_id IS NULL)
);
```

### `finished_goods_with_availability` (View)

Use this view for order fulfillment and inventory queries. Available quantity is calculated from allocations.

```sql
CREATE VIEW finished_goods_with_availability AS
SELECT
  fg.*,
  fg.quantity as total_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'completed'
    THEN a.quantity ELSE 0 END), 0) as allocated_quantity,
  COALESCE(SUM(CASE WHEN a.status = 'planned'
    THEN a.quantity ELSE 0 END), 0) as reserved_quantity,
  fg.quantity - COALESCE(SUM(CASE WHEN a.status IN ('planned', 'completed')
    THEN a.quantity ELSE 0 END), 0) as available_quantity
FROM finished_goods fg
LEFT JOIN allocations a
  ON a.source_type = 'finished_good' AND a.source_id = fg.id
GROUP BY fg.id;
```

**Optimistic Locking:** The `version` column enables optimistic locking for concurrent updates:

```typescript
// Application pattern
const result = await supabase
  .from('finished_goods')
  .update({ quantity: newQty, version: currentVersion + 1 })
  .eq('id', fgId)
  .eq('version', currentVersion);

if (result.count === 0) {
  throw new Error('Concurrent modification detected');
}
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

This creates an audit trail of batch → FG movement and enables:
- Volume reconciliation (wort volume vs. packaged volume = packaging loss)
- COGS calculation (batch cost spread across FG units)
- TTB reporting (Line 2: production removals)

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

---

## Example Queries

### Packaging Loss Calculation

Calculate packaging loss (wort volume vs. packaged volume):

```sql
SELECT
  ps.id as session_id,
  ps.session_date,
  sli.brand_id,
  b.brand_name,
  -- Input: total batch volume allocated
  SUM(
    (SELECT a.volume_bbl
     FROM allocations a
     WHERE a.source_type = 'batch'
       AND a.destination_type = 'finished_good'
       AND a.destination_id IN (
         SELECT id FROM finished_goods WHERE session_line_item_id = sli.id
       ))
  ) as input_volume_bbl,
  -- Output: packaged volume
  SUM(sli.actual_quantity * pt.volume_oz / 128.0 / 31.0) as packaged_volume_bbl,
  -- Loss
  SUM(
    (SELECT a.volume_bbl FROM allocations a
     WHERE a.source_type = 'batch'
       AND a.destination_type = 'finished_good'
       AND a.destination_id IN (SELECT id FROM finished_goods WHERE session_line_item_id = sli.id))
  ) - SUM(sli.actual_quantity * pt.volume_oz / 128.0 / 31.0) as loss_bbl
FROM packaging_sessions ps
JOIN session_line_items sli ON sli.session_id = ps.id
JOIN brands b ON sli.brand_id = b.id
JOIN package_types pt ON sli.package_type_id = pt.id
WHERE ps.status = 'completed'
GROUP BY ps.id, ps.session_date, sli.brand_id, b.brand_name
ORDER BY ps.session_date DESC;
```

### Recent Packaging Sessions with FG Output

```sql
SELECT
  ps.session_date,
  ps.status,
  b.name as brand,
  pt.name as package,
  sli.planned_quantity,
  sli.actual_quantity,
  sli.actual_quantity - sli.planned_quantity as variance,
  fg.lot_number,
  fg.best_by_date
FROM packaging_sessions ps
JOIN session_line_items sli ON sli.session_id = ps.id
JOIN brands b ON sli.brand_id = b.id
JOIN package_types pt ON sli.package_type_id = pt.id
LEFT JOIN finished_goods fg ON fg.session_line_item_id = sli.id
WHERE ps.session_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY ps.session_date DESC, b.name;
```

### Session Completion Checklist

Before completing a packaging session, verify all line items are ready:

```sql
SELECT
  sli.id,
  b.name as brand,
  pt.name as package,
  sli.planned_quantity,
  sli.actual_quantity,
  CASE
    WHEN sli.actual_quantity IS NULL THEN 'Missing actual quantity'
    WHEN sli.actual_quantity <= 0 THEN 'Invalid quantity'
    WHEN jsonb_array_length(sli.source_batches) = 0 THEN 'No source batches'
    ELSE 'OK'
  END as validation_status
FROM session_line_items sli
JOIN brands b ON sli.brand_id = b.id
JOIN package_types pt ON sli.package_type_id = pt.id
WHERE sli.session_id = 'session-uuid-here'
  AND (sli.actual_quantity IS NULL
    OR sli.actual_quantity <= 0
    OR jsonb_array_length(sli.source_batches) = 0);
```
