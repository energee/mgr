# Kegs Domain

Keg inventory tracking with support for different keg types, fleet owners, and customer balance tracking.

**Design Pattern**: Following the unified allocations pattern, keg inventory is a **calculated view** derived from immutable transaction records. Quantities are never stored as mutable balances.

## `keg_types`

Keg type definitions with size and deposit information.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Display name (e.g., "1/2 Barrel", "1/6 Barrel") |
| code | TEXT | Short code (e.g., "half", "sixth") |
| volume_bbl | DECIMAL(10,4) | Volume in barrels |
| deposit_amount | DECIMAL(10,2) | Default deposit amount per keg |
| description | TEXT | Optional description |
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Migration:** `00029_keg_types.sql`

---

## `keg_owners`

Fleet provider definitions. Tracks who owns each keg for logistics, deposits, and return routing.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Display name (e.g., "Owned", "Microstar") |
| code | TEXT | Short code (e.g., "owned", "microstar") |
| contact_name | TEXT | Contact person |
| contact_email | TEXT | Contact email |
| contact_phone | TEXT | Contact phone |
| notes | TEXT | Optional notes |
| is_active | BOOLEAN | Active flag |
| position | INTEGER | Display order |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Seed Data:** Owned, Microstar, KegFleet

**Migration:** `00079_keg_owners.sql`

---

## `keg_owner_deposits`

Per-owner per-keg-type deposit amounts. Overrides `keg_types.deposit_amount` when a fleet owner is specified.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_owner_id | UUID | FK to keg_owners |
| keg_type_id | UUID | FK to keg_types |
| deposit_amount | DECIMAL(10,2) | Deposit amount for this owner + type combination |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique Constraint:** `(keg_owner_id, keg_type_id)`

**Migration:** `00079_keg_owners.sql`

---

## Owner × Type Matrix

```
keg_types (sizes)           keg_owners (fleet providers)
──────────────────          ────────────────────────────
1/2 Barrel (0.5 BBL)   ×   Owned (house kegs)
1/6 Barrel (0.167 BBL)     Microstar
1/4 Barrel (0.25 BBL)      KegFleet
```

Deposit resolution: `COALESCE(keg_owner_deposits.deposit_amount, keg_types.deposit_amount)`

---

## `keg_transactions`

Immutable audit log for all keg state transitions. Keg inventory is calculated from these records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| transaction_type | keg_transaction_type | Transaction type (enum) |
| keg_type_id | UUID | FK to keg_types |
| keg_owner_id | UUID | FK to keg_owners (nullable) |
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

**Migration:** `00032_keg_transactions.sql`, `00079_keg_owners.sql` (adds keg_owner_id)

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
| keg_owner_id | UUID | FK to keg_owners (nullable) |
| state | keg_state | Current state (enum) |
| location_id | UUID | FK to locations (optional) |
| quantity | INTEGER | Calculated quantity |
| batch_id | UUID | FK to batches (for filled kegs) |
| finished_good_id | UUID | FK to finished_goods (for filled kegs) |

**Calculation Logic:**
- Kegs entering a state (to_state) add to quantity
- Kegs leaving a state (from_state) subtract from quantity
- Groups by keg_type × keg_owner × state × location × batch × finished_good
- Only rows with positive quantity are shown

**Migration:** `00032_keg_transactions.sql` (original), `00079_keg_owners.sql` (adds owner dimension)

---

## `keg_inventory_with_details` View

Keg inventory with joined display names for UI.

| Column | Type | Description |
|--------|------|-------------|
| (all keg_inventory columns) | | Base inventory data |
| keg_type_name | TEXT | Keg type display name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_name | TEXT | Fleet owner name |
| keg_owner_code | TEXT | Fleet owner code |
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
| keg_owner_name | TEXT | Fleet owner name |
| keg_owner_code | TEXT | Fleet owner code |
| customer_name | TEXT | Customer name |
| order_number | TEXT | Order number |
| batch_number | TEXT | Batch number |
| finished_good_name | TEXT | Finished good name |
| location_name | TEXT | Location name |

---

## `keg_inventory_summary` View

Aggregated view of keg inventory by type, owner, and state.

| Column | Type | Description |
|--------|------|-------------|
| keg_type_id | UUID | Keg type ID |
| keg_type_name | TEXT | Keg type display name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| state | keg_state | Current state |
| total_quantity | INTEGER | Sum of kegs in this state |
| location_count | INTEGER | Number of distinct locations |

---

## `customer_keg_balances` View (Calculated)

**This is a calculated VIEW, not a table.** Tracks kegs out to customers derived from `keg_transactions`.

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | FK to customers |
| customer_name | TEXT | Customer name |
| keg_type_id | UUID | FK to keg_types |
| keg_type_name | TEXT | Keg type name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| deposit_amount | DECIMAL | Deposit amount (owner-specific or default) |
| kegs_out | INTEGER | Kegs currently out (shipped - returned) |
| deposit_value | DECIMAL | Total deposit value (kegs_out × deposit_amount) |

**Deposit Resolution:** Uses `COALESCE(keg_owner_deposits.deposit_amount, keg_types.deposit_amount)` to prefer owner-specific deposits when available.

**Calculation Logic:**
- Kegs shipped to customer (ship transactions) add to kegs_out
- Kegs returned from customer (return transactions) subtract from kegs_out
- Groups by customer × keg_type × keg_owner
- Only rows with non-zero balances are shown

**Migration:** `00033_customer_keg_balances.sql` (original), `00079_keg_owners.sql` (adds owner dimension)

---

## `customer_keg_balance_summary` View

Aggregated totals per customer (all keg types and owners combined).

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | FK to customers |
| customer_name | TEXT | Customer name |
| total_kegs_out | INTEGER | Total kegs out (all types) |
| total_deposit_value | DECIMAL | Total deposit value |
| keg_type_count | INTEGER | Number of distinct keg types |

---

## `customer_keg_transaction_history` View

Keg transaction history filtered to customer-related transactions (ship/return).

| Column | Type | Description |
|--------|------|-------------|
| (all keg_transactions columns) | | Base transaction data |
| keg_type_name | TEXT | Keg type name |
| keg_owner_name | TEXT | Fleet owner name |
| customer_name | TEXT | Customer name |
| order_number | TEXT | Order number |

---

## `keg_aging_report` View

Shows kegs that are currently out with customers, with age calculations.

| Column | Type | Description |
|--------|------|-------------|
| customer_id | UUID | FK to customers |
| customer_name | TEXT | Customer name |
| keg_type_id | UUID | FK to keg_types |
| keg_type_name | TEXT | Keg type name |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| quantity | INTEGER | Quantity shipped |
| shipped_at | TIMESTAMPTZ | When shipped |
| age | INTERVAL | Time since shipped |
| days_out | NUMERIC | Days since shipped |
| deposit_amount | DECIMAL | Deposit per keg |
| deposit_value | DECIMAL | Total deposit value |

---

## `keg_turnover_metrics` View

Turnover statistics by keg type and owner.

| Column | Type | Description |
|--------|------|-------------|
| keg_type_id | UUID | FK to keg_types |
| keg_type_name | TEXT | Keg type name |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| total_shipments | INTEGER | Total ship transactions |
| total_returns | INTEGER | Total return transactions |
| return_rate_pct | NUMERIC | Return rate percentage |
| avg_days_out | NUMERIC | Average days between ship and return |

---

## `keg_fleet_summary` View

Fleet-wide summary of keg counts by type, owner, and state.

| Column | Type | Description |
|--------|------|-------------|
| keg_type_id | UUID | FK to keg_types |
| keg_type_name | TEXT | Keg type name |
| keg_type_code | TEXT | Keg type code |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| empty_count | INTEGER | Empty kegs |
| filled_count | INTEGER | Filled kegs |
| shipped_count | INTEGER | Shipped kegs |
| returned_dirty_count | INTEGER | Returned dirty kegs |
| cleaning_count | INTEGER | Kegs in cleaning |
| maintenance_count | INTEGER | Kegs in maintenance |
| retired_count | INTEGER | Retired kegs |
| total_count | INTEGER | Total kegs |

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

### Fleet Owner Tracking

The `keg_owners` table adds a second dimension to keg tracking without changing pricing:

- **`keg_types`** define sizes (1/2 BBL, 1/6 BBL, etc.)
- **`keg_owners`** define fleet providers (Owned, Microstar, KegFleet, etc.)
- **`keg_owner_deposits`** allow per-owner per-type deposit overrides
- Pricing stays at `package_type_id` level — fleet owner is an operational detail

### Unified Packaging Formats

The `packaging_formats` view combines non-keg `package_types` with `keg_types` into a single dropdown source:

```sql
-- Union view: packaging_formats
SELECT id, name, 'package_type' AS format_source, container_type, is_active FROM package_types WHERE container_type != 'keg'
UNION ALL
SELECT id, name, 'keg_type' AS format_source, 'keg' AS container_type, is_active FROM keg_types
```

**Dual FK pattern**: `order_items`, `session_line_items`, and `finished_goods` have mutually exclusive `package_type_id` OR `keg_type_id` (enforced by CHECK constraints). The `format_source` discriminator tells the UI which FK to set.

### Automatic Keg Transactions

- **Order fulfillment**: When `orders.status` transitions to `'fulfilled'`, a trigger auto-creates `ship` keg_transactions for all order items with `keg_type_id`.
- **Packaging completion**: When `create_finished_goods_from_packaging()` runs, it also creates `fill` keg_transactions for session line items with `keg_type_id`.

**Migration:** `00080_unify_packaging_formats.sql`

### Recording Transactions

To modify keg inventory, insert a record into `keg_transactions`:

```sql
-- Receive 20 new half-barrel kegs from Microstar
INSERT INTO keg_transactions (
  transaction_type, keg_type_id, keg_owner_id, quantity, to_state
) VALUES (
  'receive', 'uuid-of-half-barrel', 'uuid-of-microstar', 20, 'empty'
);

-- Ship 5 filled kegs to a customer
INSERT INTO keg_transactions (
  transaction_type, keg_type_id, keg_owner_id, quantity,
  from_state, to_state, customer_id
) VALUES (
  'ship', 'uuid-of-half-barrel', 'uuid-of-microstar', 5,
  'filled', 'shipped', 'uuid-of-customer'
);
```
