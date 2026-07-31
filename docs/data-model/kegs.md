# Kegs Domain

Keg inventory tracking with support for different keg types, fleet owners, and customer balance tracking.

**Design Pattern**: Following the unified allocations pattern, keg inventory is a **calculated view** derived from immutable transaction records. Quantities are never stored as mutable balances.

## Keg Types (via `containers` + `selling_formats`)

Keg types are now stored as rows in the unified `containers` table where `type = 'keg'`. Each keg container has a corresponding `selling_formats` entry (typically "Per Keg" with `unit_count = 1`). See [packaging.md](./packaging.md) for the full `containers` and `selling_formats` schema.

**Key columns on `containers` for kegs:**
- `name` — Display name (e.g., "1/2 Barrel", "1/6 Barrel")
- `type` — Always `'keg'`
- `volume_bbl` — Volume in barrels
- `deposit_amount` — Default deposit amount per keg

**Backward compatibility:** Keg views (e.g., `keg_inventory_with_details`) expose `keg_type_name` as an alias for `containers.name` to maintain UI compatibility.

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

Per-owner per-format deposit amounts. Overrides `containers.deposit_amount` when a fleet owner is specified.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_owner_id | UUID | FK to keg_owners |
| selling_format_id | UUID | FK to selling_formats (keg format) |
| deposit_amount | DECIMAL(10,2) | Deposit amount for this owner + format combination |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique Constraint:** `(keg_owner_id, selling_format_id)` — index
`uq_keg_owner_deposits_owner_format` (00284). Rows with a NULL
`selling_format_id` are not constrained (NULLs compare distinct).

**Retired column — `keg_type_id`.** 00079 created the table with a NOT NULL
`keg_type_id` referencing the old `keg_types` table and a
`UNIQUE (keg_owner_id, keg_type_id)`. The container/selling-format refactor
moved the format key to `selling_format_id` (00159), and every reader since —
`keg_aging_report` (00191), `keg_fleet_summary` (00236), the
`COALESCE(keg_owner_deposits.deposit_amount, containers.deposit_amount)`
resolution — joins on that. The chain kept the NOT NULL column, so a database
built from the chain rejected every deposit-override write with
`null value in column "keg_type_id" ... violates not-null constraint` (#711 —
latent, since no packaging or fulfillment path writes this table). 00284
retires the column on the 00283 pattern: backfill `selling_format_id` from the
legacy id where one exists (00112 reuses each keg_type UUID as its replacement
selling format's id), abort rather than drop an unmappable reference, and
re-key uniqueness on `(keg_owner_id, selling_format_id)`.

**Migration:** `00079_keg_owners.sql`,
`00159_packaging_sessions_redesign.sql` (adds selling_format_id),
`00284_retire_keg_owner_deposits_keg_type_id.sql` (retires keg_type_id)

---

## Owner × Format Matrix

```
containers (type='keg')     keg_owners (fleet providers)
──────────────────────      ────────────────────────────
1/2 Barrel (0.5 BBL)   ×   Owned (house kegs)
1/6 Barrel (0.167 BBL)     Microstar
1/4 Barrel (0.25 BBL)      KegFleet
```

Deposit resolution: `COALESCE(keg_owner_deposits.deposit_amount, containers.deposit_amount)`

---

## `keg_transactions`

Immutable audit log for all keg state transitions. Keg inventory is calculated from these records.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| transaction_type | keg_transaction_type | Transaction type (enum) |
| selling_format_id | UUID | FK to selling_formats (keg format) |
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

**Retired column — `keg_type_id`.** 00032 created the table with a NOT NULL
`keg_type_id` referencing the old `keg_types` table. The container/selling-format
refactor moved the format key to `selling_format_id` (00159), and every writer
since 00183 — `create_finished_goods_from_packaging`,
`create_keg_ship_transactions_from_order`, `record_keg_transaction` — supplies
only that. Live appears to have dropped `keg_types` (and the column) out of band —
inferred from `live-catalog.snapshot.txt` and the live-generated
`src/types/supabase.ts`, not from a direct column read; the migration
chain kept both, so any database built from the chain rejected *every* keg write
with `null value in column "keg_type_id" ... violates not-null constraint`, which
made keg packaging and keg order fulfillment impossible on a fresh replay (#701).
00283 retires the column, backfilling `selling_format_id` from it first where a
legacy value exists (00112 reuses each keg_type UUID as its replacement selling
format's id) and aborting rather than dropping a reference it cannot map. The keg
identity of a transaction is now `selling_format_id -> containers.type = 'keg'`.

**Migration:** `00032_keg_transactions.sql`, `00079_keg_owners.sql` (adds keg_owner_id),
`00159_packaging_sessions_redesign.sql` (adds selling_format_id),
`00283_retire_keg_transactions_keg_type_id.sql` (retires keg_type_id)

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
| selling_format_id | UUID | FK to selling_formats (keg format) |
| keg_owner_id | UUID | FK to keg_owners (nullable) |
| state | keg_state | Current state (enum) |
| location_id | UUID | FK to locations (optional) |
| quantity | INTEGER | Calculated quantity |
| batch_id | UUID | FK to batches (for filled kegs) |
| finished_good_id | UUID | FK to finished_goods (for filled kegs) |

**Calculation Logic:**
- Kegs entering a state (to_state) add to quantity
- Kegs leaving a state (from_state) subtract from quantity
- Groups by selling_format × keg_owner × state × location × batch × finished_good
- Only rows with positive quantity are shown

**Migration:** `00032_keg_transactions.sql` (original), `00079_keg_owners.sql` (adds owner dimension)

---

## `keg_inventory_with_details` View

Keg inventory with joined display names for UI. Joins through `selling_formats` → `containers` to resolve display names.

| Column | Type | Description |
|--------|------|-------------|
| (all keg_inventory columns) | | Base inventory data |
| keg_type_name | TEXT | Container name (backward-compat alias from `containers.name`) |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_name | TEXT | Fleet owner name |
| keg_owner_code | TEXT | Fleet owner code |
| location_name | TEXT | Location name |
| batch_number | TEXT | Batch number |
| finished_good_name | TEXT | Finished good name |

---

## `keg_transactions_with_details` View

Keg transactions with joined display names for UI. Joins through `selling_formats` → `containers` to resolve display names.

| Column | Type | Description |
|--------|------|-------------|
| (all keg_transactions columns) | | Base transaction data |
| keg_type_name | TEXT | Container name (backward-compat alias from `containers.name`) |
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
| selling_format_id | UUID | FK to selling_formats |
| keg_type_name | TEXT | Container name (backward-compat alias) |
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
| selling_format_id | UUID | FK to selling_formats |
| keg_type_name | TEXT | Container name (backward-compat alias) |
| volume_bbl | DECIMAL | Volume in barrels |
| keg_owner_id | UUID | Fleet owner ID |
| keg_owner_name | TEXT | Fleet owner name |
| deposit_amount | DECIMAL | Deposit amount (owner-specific or default) |
| kegs_out | INTEGER | Kegs currently out (shipped - returned) |
| deposit_value | DECIMAL | Total deposit value (kegs_out × deposit_amount) |

**Deposit Resolution:** Uses `COALESCE(keg_owner_deposits.deposit_amount, containers.deposit_amount)` to prefer owner-specific deposits when available.

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
| selling_format_id | UUID | FK to selling_formats |
| keg_type_name | TEXT | Container name (backward-compat alias) |
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
| selling_format_id | UUID | FK to selling_formats |
| keg_type_name | TEXT | Container name (backward-compat alias) |
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
| selling_format_id | UUID | FK to selling_formats |
| keg_type_name | TEXT | Container name (backward-compat alias) |
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

Following the allocations pattern (see [`docs/spec/workflows.md`](../spec/workflows.md)):
> "All inventory movements via unified allocations table. Quantities calculated via views, never stored as mutable balances."

Benefits:
1. **Immutable audit trail** - Every change is recorded as a transaction
2. **No data corruption** - Quantities can always be recalculated from transactions
3. **Consistency** - Same pattern as raw materials, batches, and finished goods
4. **Auditability** - Full history of every keg movement

### Fleet Owner Tracking

The `keg_owners` table adds a second dimension to keg tracking without changing pricing:

- **`containers`** (where `type='keg'`) define sizes (1/2 BBL, 1/6 BBL, etc.)
- **`selling_formats`** link containers to the sales model (typically "Per Keg" with `unit_count=1`)
- **`keg_owners`** define fleet providers (Owned, Microstar, KegFleet, etc.)
- **`keg_owner_deposits`** allow per-owner per-format deposit overrides
- Pricing uses `selling_format_id` — fleet owner is an operational detail

### Unified Containers Model

All packaging (cans, bottles, kegs) shares a single `containers` + `selling_formats` model. See [packaging.md](./packaging.md) for details.

- `containers` holds physical vessels with `type` = `'package'` or `'keg'`
- `selling_formats` defines how containers are grouped for sale
- All FKs use a single `selling_format_id` (no more dual-FK pattern)

### Automatic Keg Transactions

- **Order fulfillment**: When `orders.status` transitions to `'fulfilled'`, a trigger auto-creates `ship` keg_transactions for all keg order items (where the selling format's container has `type='keg'`).
- **Packaging completion**: When `create_finished_goods_from_packaging()` runs, it also creates `fill` keg_transactions for keg session line items.

### Recording Transactions

To modify keg inventory, insert a record into `keg_transactions`:

```sql
-- Receive 20 new half-barrel kegs from Microstar
INSERT INTO keg_transactions (
  transaction_type, selling_format_id, keg_owner_id, quantity, to_state
) VALUES (
  'receive', 'uuid-of-half-barrel-format', 'uuid-of-microstar', 20, 'empty'
);

-- Ship 5 filled kegs to a customer
INSERT INTO keg_transactions (
  transaction_type, selling_format_id, keg_owner_id, quantity,
  from_state, to_state, customer_id
) VALUES (
  'ship', 'uuid-of-half-barrel-format', 'uuid-of-microstar', 5,
  'filled', 'shipped', 'uuid-of-customer'
);
```
