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

## `keg_transactions`

Audit log for all keg state transitions and movements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| transaction_type | keg_transaction_type | Transaction type (enum) |
| keg_type_id | UUID | FK to keg_types |
| quantity | INTEGER | Quantity (always positive) |
| from_state | keg_state | State before transaction (NULL for receive) |
| to_state | keg_state | State after transaction |
| from_location_id | UUID | FK to locations (optional) |
| to_location_id | UUID | FK to locations (optional) |
| order_id | UUID | FK to orders (for ship) |
| customer_id | UUID | FK to customers (for ship/return) |
| packaging_session_id | UUID | FK to packaging_sessions (for fill) |
| batch_id | UUID | FK to batches (for fill) |
| finished_good_id | UUID | FK to finished_goods (for fill) |
| notes | TEXT | Optional notes |
| created_by_name | TEXT | Cached user name |
| created_at | TIMESTAMPTZ | Created timestamp |

**Migration:** `00032_keg_transactions.sql`

---

## `keg_transaction_type` Enum

| Value | Description |
|-------|-------------|
| fill | Fill empty kegs from a batch (empty -> filled) |
| ship | Ship filled kegs to customer (filled -> shipped) |
| return | Customer returns kegs (shipped -> returned_dirty) |
| clean | Clean dirty kegs (returned_dirty/cleaning -> empty) |
| receive | Receive new kegs into inventory (-> empty) |
| adjust | Manual inventory adjustment |
| retire | Retire kegs from service (-> retired) |
| maintain | Send kegs for repair (-> maintenance) |

---

## `keg_transactions_with_details` View

Keg transactions with joined display names.

| Column | Type | Description |
|--------|------|-------------|
| (all keg_transactions columns) | | Base transaction data |
| keg_type_name | TEXT | Keg type display name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| customer_name | TEXT | Customer name |
| order_number | TEXT | Order number |
| batch_number | TEXT | Batch number |
| finished_good_name | TEXT | Finished good name |
| from_location_name | TEXT | From location name |
| to_location_name | TEXT | To location name |

---

## Keg Flow

```
empty -> filled -> shipped -> returned_dirty -> cleaning -> empty (cycle repeats)
  ^                                                   |
  |___________________________________________________|
```
