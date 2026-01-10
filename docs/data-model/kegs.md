# Kegs Domain

Keg inventory tracking with support for different keg types (owned, rented, one-way) and customer balance tracking.

## `keg_types`

Keg type definitions with lifecycle rules.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Type name (e.g., "House Kegs", "Microstar", "Unikeg") |
| description | TEXT | Description |
| is_reusable | BOOLEAN | Whether kegs are returned and reused |
| track_customer_balance | BOOLEAN | Track kegs out to customers |
| valid_states | JSONB | Valid states for this keg type |
| deposit_amount | DECIMAL(10,2) | Deposit amount per keg (if applicable) |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**valid_states examples:**
- Reusable (House): `["empty", "clean", "full", "dirty"]`
- Microstar (arrives dirty): `["dirty", "clean", "full"]`
- One-way (Unikeg): `["unpurged", "purged", "full"]`

---

## `keg_sizes`

Keg size definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Size name (e.g., "1/6 BBL", "1/2 BBL", "50L") |
| volume_bbl | DECIMAL(6,4) | Volume in barrels |
| volume_gal | DECIMAL(6,2) | Volume in gallons |
| is_active | BOOLEAN | Active flag |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

---

## `keg_inventory`

Current keg inventory by type, size, and state.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_type_id | UUID | FK to keg_types |
| keg_size_id | UUID | FK to keg_sizes |
| state | TEXT | Current state (from keg_type.valid_states) |
| location | TEXT | Location identifier |
| quantity | INTEGER | Current quantity |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (keg_type_id, keg_size_id, state, location)

---

## `customer_keg_balances`

Track kegs out to customers (for keg types with track_customer_balance).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| customer_id | UUID | FK to customers |
| keg_type_id | UUID | FK to keg_types |
| keg_size_id | UUID | FK to keg_sizes |
| balance | INTEGER | Kegs out (positive = customer owes kegs) |
| created_at | TIMESTAMPTZ | Created timestamp |
| updated_at | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** (customer_id, keg_type_id, keg_size_id)

---

## `keg_transactions`

Audit log for all keg movements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| keg_type_id | UUID | FK to keg_types |
| keg_size_id | UUID | FK to keg_sizes |
| transaction_type | TEXT | Type: fill, ship, return, clean, receive, transfer, adjust |
| quantity | INTEGER | Quantity (+/-) |
| from_state | TEXT | State before transaction |
| to_state | TEXT | State after transaction |
| location | TEXT | Location |
| order_id | UUID | FK to orders (for ship transactions) |
| customer_id | UUID | FK to customers (for ship/return) |
| packaging_session_id | UUID | FK to packaging_sessions (for fill) |
| notes | TEXT | Notes |
| created_by | UUID | FK to auth.users |
| created_at | TIMESTAMPTZ | Created timestamp |

---

## Transaction Types

| Type | Description | State Change |
|------|-------------|--------------|
| receive | New kegs received | -> initial state |
| clean | Kegs cleaned/sanitized | dirty -> clean |
| fill | Kegs filled at packaging | clean -> full |
| ship | Kegs shipped to customer | full -> (out) |
| return | Kegs returned from customer | (out) -> dirty |
| transfer | Move between locations | same state |
| adjust | Manual adjustment | any |

---

## Keg Flow Example (House Kegs)

```
receive -> dirty -> clean -> full -> ship -> return -> dirty (cycle repeats)
              ^                                  |
              |__________________________________|
```
