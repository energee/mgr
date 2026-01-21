# Kegs Domain

Keg inventory tracking with support for different keg types and customer balance tracking.

**Design Pattern**: Following the unified allocations pattern, keg inventory is a **calculated view** derived from immutable transaction records. Quantities are never stored as mutable balances.

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

## `keg_transactions`

Immutable audit log for all keg state transitions. Keg inventory is calculated from these records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| transaction_type | keg_transaction_type | Transaction type (enum) |
| keg_type_id | UUID | FK to keg_types |
| quantity | INTEGER | Quantity (always positive) |
| from_state | keg_state | State before transaction (NULL for receive) |
| to_state | keg_state | State after transaction |
| location_id | UUID | FK to locations (optional) |
| order_id | UUID | FK to orders (for ship) |
| customer_id | UUID | FK to customers (for ship/return) |
| packaging_session_id | UUID | FK to packaging_sessions (for fill) |
| batch_id | UUID | FK to batches (for fill) |
| finished_good_id | UUID | FK to finished_goods (for fill) |
| notes | TEXT | Optional notes |
| created_by_name | TEXT | Cached user name |
| created_at | TIMESTAMPTZ | Created timestamp |

**Note**: Transactions are immutable - no UPDATE or DELETE policies.

**Migration:** `00032_keg_transactions.sql`

---

## `keg_transaction_type` Enum

| Value | Description |
|-------|-------------|
| receive | New kegs entering inventory (-> empty) |
| fill | Fill empty kegs from a batch (empty -> filled) |
| ship | Ship filled kegs to customer (filled -> shipped) |
| return | Customer returns kegs (shipped -> returned_dirty) |
| clean | Clean dirty kegs (returned_dirty/cleaning -> empty) |
| adjust | Manual inventory adjustment |
| retire | Retire kegs from service (-> retired) |
| maintain | Send kegs for repair (-> maintenance) |

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

## `keg_inventory` View (Calculated)

**This is a calculated VIEW, not a table.** Quantities are derived from `keg_transactions`.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Deterministic ID for the combination |
| keg_type_id | UUID | FK to keg_types |
| state | keg_state | Current state (enum) |
| location_id | UUID | FK to locations (optional) |
| quantity | INTEGER | Calculated quantity |
| batch_id | UUID | FK to batches (for filled kegs) |
| finished_good_id | UUID | FK to finished_goods (for filled kegs) |

**Calculation Logic:**
- Kegs entering a state (to_state) add to quantity
- Kegs leaving a state (from_state) subtract from quantity
- Only rows with positive quantity are shown

**Migration:** `00032_keg_transactions.sql` (drops table from 00031, creates view)

---

## `keg_inventory_with_details` View

Keg inventory with joined display names for UI.

| Column | Type | Description |
|--------|------|-------------|
| (all keg_inventory columns) | | Base inventory data |
| keg_type_name | TEXT | Keg type display name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| location_name | TEXT | Location name |
| batch_number | TEXT | Batch number |
| finished_good_name | TEXT | Finished good name |

---

## `keg_transactions_with_details` View

Keg transactions with joined display names for UI.

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
| location_name | TEXT | Location name |

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

## Keg Flow

```
receive -> empty -> filled -> shipped -> returned_dirty -> cleaning -> empty (cycle repeats)
              ^                                                    |
              |____________________________________________________|
```

---

## Design Notes

### Why Calculated Inventory?

Following the allocations pattern from CLAUDE.md:
> "All inventory movements via unified allocations table. Quantities calculated via views, never stored as mutable balances."

Benefits:
1. **Immutable audit trail** - Every change is recorded as a transaction
2. **No data corruption** - Quantities can always be recalculated from transactions
3. **Consistency** - Same pattern as raw materials, batches, and finished goods
4. **Auditability** - Full history of every keg movement

### Recording Transactions

To modify keg inventory, insert a record into `keg_transactions`:

```sql
-- Receive 20 new half-barrel kegs
INSERT INTO keg_transactions (
  transaction_type, keg_type_id, quantity, to_state
) VALUES (
  'receive', 'uuid-of-half-barrel', 20, 'empty'
);

-- Ship 5 filled kegs to a customer
INSERT INTO keg_transactions (
  transaction_type, keg_type_id, quantity,
  from_state, to_state, customer_id
) VALUES (
  'ship', 'uuid-of-half-barrel', 5,
  'filled', 'shipped', 'uuid-of-customer'
);
```
