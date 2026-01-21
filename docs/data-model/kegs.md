# Kegs Domain

Keg inventory tracking with support for different keg types and customer balance tracking.

## `keg_types`

Keg type definitions with size and deposit information.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Display name (e.g., "1/2 Barrel", "1/6 Barrel") |
| code | TEXT | Short code (e.g., "half", "sixth") |
| volume_bbl | DECIMAL(10,4) | Volume in barrels |
| deposit_amount | DECIMAL(10,2) | Deposit amount per keg |
| description | TEXT | Optional description |
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Migration:** `00029_keg_types.sql`

---

## `keg_inventory`

Current keg inventory by type, state, and location.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_type_id | UUID | FK to keg_types |
| state | keg_state | Current state (enum) |
| location_id | UUID | FK to locations (optional) |
| quantity | INTEGER | Current quantity |
| batch_id | UUID | FK to batches (for filled kegs) |
| finished_good_id | UUID | FK to finished_goods (for filled kegs) |
| notes | TEXT | Optional notes |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (keg_type_id, state, location_id, batch_id, finished_good_id)

**Migration:** `00031_keg_inventory.sql`

---

## `keg_state` Enum

| Value | Description |
|-------|-------------|
| empty | Clean, empty kegs ready to be filled |
| filled | Filled with beer, in inventory |
| shipped | Out with a customer |
| returned_dirty | Returned from customer, needs cleaning |
| cleaning | In the cleaning process |
| maintenance | Out for repair/inspection |
| retired | No longer in service |

---

## `keg_inventory_summary` View

Aggregated view of keg inventory by type and state.

| Column | Type | Description |
|--------|------|-------------|
| keg_type_id | UUID | Keg type ID |
| keg_type_name | TEXT | Keg type display name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| state | keg_state | Current state |
| total_quantity | INTEGER | Sum of kegs in this state |
| location_count | INTEGER | Number of distinct locations |

---

## Future: `customer_keg_balances`

Track kegs out to customers.

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | FK to customers |
| keg_type_id | UUID | FK to keg_types |
| balance | INTEGER | Kegs out (positive = customer owes kegs) |

**Phase:** 10.4

---

## Future: `keg_transactions`

Audit log for all keg movements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_type_id | UUID | FK to keg_types |
| transaction_type | TEXT | fill, ship, return, clean, receive, adjust |
| quantity | INTEGER | Quantity (+/-) |
| from_state | keg_state | State before transaction |
| to_state | keg_state | State after transaction |
| order_id | UUID | FK to orders (for ship) |
| customer_id | UUID | FK to customers (for ship/return) |
| packaging_session_id | UUID | FK to packaging_sessions (for fill) |
| notes | TEXT | Notes |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |

**Phase:** 10.3

---

## Keg Flow

```
empty -> filled -> shipped -> returned_dirty -> cleaning -> empty (cycle repeats)
  ^                                                   |
  |___________________________________________________|
```
