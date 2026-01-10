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
| batch_id | UUID | FK to batches |
| package_type_id | UUID | FK to package_types |
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
| revisions | JSONB | Revision history |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `session_line_items`

Line items within a packaging session.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK to packaging_sessions |
| brand_id | UUID | FK to brands |
| package_type_id | UUID | FK to package_types |
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

**External FG:** When `batch_id` is null, the FG originated externally (contract brewing, purchased, legacy). Use `notes` to document source. External lot codes bypass format setting.

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
| in_progress -> completed | Finish, create finished goods |
| completed -> revised | Adjust quantities |
| completed -> (rollback) | Only if no downstream orders packed |
