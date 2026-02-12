# Workflows & State Machines

## State Machines

### Brew Log States

Brew logs capture the hot-side (brewing) process.

```
draft → in_progress → completed
  │          │
  └──────────┴──────▶ cancelled
```

| Transition | Trigger |
|------------|---------|
| draft → in_progress | First event recorded |
| in_progress → completed | Knockout complete, linked to batch(es) via brew_log_batches |
| any → cancelled | User cancellation |

### Batch States

Batches represent cold-side (fermentation through packaging). Linked to brew logs via `brew_log_batches`.

```
planned → fermenting → conditioning → packaging → completed
    ↓          ↓            ↓             ↓
cancelled  cancelled   cancelled      (locked)
```

| Transition | Trigger |
|------------|---------|
| planned → fermenting | Wort transferred from brew (linked via brew_log_batches) |
| fermenting → conditioning | Transfer to brite tank |
| conditioning → packaging | Packaging begins |
| packaging → completed | All packaging sessions complete |
| any → cancelled | User cancellation (with checks) |

### Packaging Session States

```
planned → in_progress → completed → revised
    ↓          ↓            ↓
cancelled  cancelled   (adjust only if downstream packed)
```

| Transition | Trigger |
|------------|---------|
| planned → in_progress | Start packaging |
| in_progress → completed | Finish, create FGs |
| completed → revised | Adjust quantities |
| completed → (rollback) | Only if no downstream orders packed |

### Order States

```
draft → confirmed → scheduled → picking → packed → out_the_door
   ↓        ↓           ↓          ↓         ↓
cancelled cancelled  cancelled cancelled (adjust only)
```

| Transition | Trigger |
|------------|---------|
| draft → confirmed | Customer commits |
| confirmed → scheduled | Delivery date set |
| scheduled → picking | Start fulfillment |
| picking → packed | All items picked, debit inventory |
| packed → out_the_door | Shipped/picked up/served |

### Change Request States

```
pending → approved
    ↓
rejected
    ↓
(customer can resubmit)
```

| Transition | Trigger |
|------------|---------|
| pending → approved | Admin approves; `apply_change_request()` atomically updates order items |
| pending → rejected | Admin rejects with reason; customer sees rejection on portal |

**Cutoff rule:** Change requests can only be submitted when the order's status is below the sales channel's `change_request_cutoff_state` (default: `confirmed`).

### Transfer States

```
planned → in_transit → completed
    ↓          ↓
cancelled  cancelled
```

| Transition | Trigger |
|------------|---------|
| planned → in_transit | Ship from origin |
| in_transit → completed | Receive at destination |

### Vessel States

```
empty → in_use → dirty → cleaning → empty
  ↓        ↓        ↓        ↓
maintenance ←←←←←←←←←←←←←←←←
     ↓
   dirty
```

### Purchase Order States

```
draft → submitted → confirmed → partial → fulfilled
   ↓        ↓           ↓          ↓
cancelled cancelled  cancelled  cancelled
```

| Transition | Trigger |
|------------|---------|
| draft → submitted | Send to supplier |
| submitted → confirmed | Supplier confirms |
| confirmed → partial | Some items received |
| partial → fulfilled | All items received |
| confirmed → fulfilled | All received at once |

---

## Allocation System

### Core Concept
Allocations track all inventory movements with a source, destination, quantity, and status. Quantities are never stored as mutable "remaining" fields; they're always calculated from allocations.

### Allocation Types

| Source Type | Destination Type | Use Case |
|-------------|------------------|----------|
| batch | finished_good | Production (packaging) |
| batch | batch | Blending |
| finished_good | order | Sales |
| finished_good | sample_trade | Trade samples |
| finished_good | sample_quality | QA tasting |
| finished_good | consumed | Employee/promo |
| finished_good | destruction | Contamination, QC fail |
| finished_good | loss | Breakage, spillage, theft |
| finished_good | adjustment | Inventory correction |
| external_return | finished_good | Customer returns |
| bond_transfer_in | finished_good | Received in bond |

### Allocation States

```
planned → completed
    ↓
cancelled
```

- **planned**: Reserved, can be revised or cancelled
- **completed**: Done, immutable
- **cancelled**: Won't happen, preserved for audit

### Calculated Quantities

```typescript
// Available = Original - SUM(planned + completed allocations)
function getAvailable(sourceType: string, sourceId: string): number {
  const original = getOriginalQuantity(sourceType, sourceId);
  const allocated = getAllocations(sourceType, sourceId)
    .filter(a => a.status !== 'cancelled' && !a.archived)
    .reduce((sum, a) => sum + a.quantity, 0);
  return original - allocated;
}
```

### TTB Line Mapping
Allocations map to TTB report lines based on destination_type and sales_channel:

| Destination Type | TTB Line |
|------------------|----------|
| finished_good | Line 2 (Production) |
| order (distributor/retailer/taproom) | Line 10 (Tax-paid removals) |
| order (export/bond_transfer) | Line 11 (Tax-free removals) |
| sample_trade | Line 11 |
| sample_quality | Line 12 |
| consumed | Line 12 |
| destruction | Line 13 |
| loss | Line 14 |
| adjustment (+) | Line 5 (Overage) |
| adjustment (-) | Line 15 (Shortage) |
| external_return | Line 4 |
| bond_transfer_in | Line 3 |

---

## Rollback & Adjustment Rules

### General Principles
1. **Rollback** when possible (before downstream dependencies lock it)
2. **Adjust** when rollback not possible (correct quantities, log revision)
3. **Never block** operations; warn and proceed
4. **Recalculate history** on backdated adjustments

### Packaging Session Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| planned | Rollback | ✓ | Delete session |
| in_progress | Rollback | ✓ | Delete session, no FGs created yet |
| completed | Rollback | ✓ if no downstream orders packed | Delete FGs, restore batch volume, orders become unallocated |
| completed | Rollback | ✗ if any order packed | Show error, suggest adjust |
| completed | Adjust | ✓ | Update FG quantities, log revision, flag over-allocations |

### Order Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| draft-picking | Rollback | ✓ | Release allocations |
| packed | Rollback | ✗ | Adjust only |
| packed | Adjust | ✓ | Update quantities, recalculate bin/keg inventory |
| out_the_door | Rollback | ✗ | Adjust only |
| out_the_door | Adjust | ✓ | Update quantities, recalculate, log revision |

### Transfer Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| planned | Cancel | ✓ | Delete transfer |
| in_transit | Cancel | ✓ | Restore origin bin quantities |
| completed | Rollback | ✗ | Create reverse transfer instead |
| completed | Adjust | ✓ | Correct quantities, recalculate bins |

### Batch Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| planned | Cancel | ✓ | Delete batch, release any planned allocations |
| planned | Reschedule | ✓ | Update planned_start_date |
| fermenting | Rollback to planned | ✗ | Wort already allocated; adjust or continue |
| fermenting | Cancel | ✓ with reason | Mark as cancelled, log reason, batch volume becomes loss |
| conditioning | Rollback | ✗ | Too late; continue or cancel with loss |
| packaging | Rollback | ✗ | FGs may exist; adjust only |
| completed | Rollback | ✗ | Final state; adjustments via FG records |
| completed | Adjust | ✓ | Update notes, actual values; log revision |

**Batch cancellation at any fermentation stage requires:**
- Reason code (contamination, stuck_fermentation, off_flavor, other)
- Creates loss allocation for volume

### Brew Log Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| draft | Delete | ✓ | Delete brew log |
| in_progress | Rollback to draft | ✓ | Clear events, reset to draft |
| in_progress | Cancel | ✓ | Delete brew log (no batches linked yet) |
| completed | Rollback | ✓ if no batches linked | Delete brew log |
| completed | Rollback | ✗ if batches linked | Batches depend on this brew; unlink first or adjust |
| completed | Adjust | ✓ | Update events, recalculate OG; log revision |

**Unlinking batches from completed brew:**
- Only allowed if batch.status = 'planned'
- Batch reverts to unlinked state (no source brew)

### Purchase Order Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| draft | Delete | ✓ | Delete PO and line items |
| submitted | Cancel | ✓ | Mark cancelled, notify supplier if integration exists |
| submitted | Rollback to draft | ✓ | Clear submitted_at, revert to draft |
| confirmed | Cancel | ✓ with reason | Mark cancelled; no receives yet |
| partial | Cancel | ✗ | Some items received; close PO instead |
| partial | Close | ✓ | Mark as fulfilled with remaining items as shortfall |
| fulfilled | Rollback | ✗ | Inventory lots exist; adjust lots instead |
| fulfilled | Adjust | ✓ | Update notes; log revision |

**Cancellation after receives:**
- Cannot cancel if `po_receives` exist
- Must close with shortfall or adjust received quantities

### Vessel Rules

| Current State | Action | Allowed? | Effect |
|---------------|--------|----------|--------|
| available | No rollback needed | — | Base state |
| occupied | Release | ✓ if batch transferred out | Mark available, clear current_batch_id |
| occupied | Force release | ✓ with override | Admin only; clears vessel without batch transfer |
| cleaning | Complete | ✓ | Mark available, log cleaning record |
| cleaning | Cancel | ✓ | Return to previous state (occupied or available) |
| maintenance | Complete | ✓ | Mark available, log maintenance record |
| maintenance | Extend | ✓ | Update expected completion date |

**Vessel state is derived from:**
- Current batch assignment (occupied)
- Active cleaning/maintenance records
- Default: available

### Revision Tracking
All adjustments logged in revisions array:
```typescript
interface Revision {
  timestamp: string;
  user_id: string;
  action: string; // quantity_changed, status_changed, etc.
  previous_value: any;
  new_value: any;
  field?: string;
  reason?: string;
}
```

---

## Error Handling

### Error Categories

| Category | Examples | User Message | Recovery |
|----------|----------|--------------|----------|
| Validation | Invalid input, missing required fields | Specific field error | Fix input, retry |
| Constraint | Unique violation, FK violation, check constraint | Business rule explanation | Adjust data, retry |
| Concurrent | Optimistic lock failure, stale data | "Record modified by another user" | Refresh, retry |
| Permission | RLS denied, role insufficient | "You don't have permission" | Contact admin |
| Network | Timeout, connection lost | "Connection error, retrying..." | Auto-retry with backoff |
| Server | 500 errors, unexpected exceptions | "Something went wrong" | Log, notify admin |

### Validation Error Format

```typescript
interface ValidationError {
  field: string;           // Field path (e.g., "volume_bbl", "items[0].quantity")
  code: string;            // Machine-readable code (e.g., "required", "min", "invalid_format")
  message: string;         // User-friendly message
  meta?: Record<string, unknown>;  // Additional context (e.g., { min: 0, max: 100 })
}

// Example response
{
  success: false,
  errors: [
    { field: "volume_bbl", code: "min", message: "Volume must be greater than 0", meta: { min: 0 } },
    { field: "batch_id", code: "required", message: "Batch is required" }
  ]
}
```

### Database Constraint Errors

Map PostgreSQL constraint violations to user-friendly messages:

| Constraint | PostgreSQL Code | User Message Template |
|------------|-----------------|----------------------|
| Unique violation | 23505 | "{field} already exists" |
| Foreign key violation | 23503 | "Referenced {entity} not found or deleted" |
| Check constraint | 23514 | Map by constraint name (see below) |
| Not null violation | 23502 | "{field} is required" |

**Check constraint messages** (by constraint name pattern):
```typescript
const constraintMessages: Record<string, string> = {
  'chk_quantity_positive': 'Quantity must be positive',
  'chk_volume_nonnegative': 'Volume cannot be negative',
  'chk_viability_range': 'Viability must be between 0 and 100',
  'chk_allocation_status_valid': 'Invalid allocation status',
  'chk_fg_entry_point': 'Invalid finished goods entry point configuration',
};
```

### Concurrent Modification Handling

For entities with optimistic locking (`version` column):

```typescript
async function updateWithOptimisticLock<T>(
  table: string,
  id: string,
  updates: Partial<T>,
  currentVersion: number
): Promise<T> {
  const { data, error, count } = await supabase
    .from(table)
    .update({ ...updates, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single();

  if (count === 0) {
    throw new ConcurrentModificationError(
      'This record was modified by another user. Please refresh and try again.'
    );
  }
  if (error) throw error;
  return data;
}
```

**Entities with optimistic locking:**
- `finished_goods` (high contention during order fulfillment)
- `bin_inventory` (warehouse operations)

### Network Error Handling

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,        // 1 second
  maxDelay: 10000,        // 10 seconds
  backoffMultiplier: 2,
};

// Retry with exponential backoff for network errors
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error)) throw error;
      lastError = error;
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
```

---

## Related Documents

- [Modules](./modules.md) - Feature specifications
- [Decisions](./decisions.md) - Schema design decisions
- [Operations](./operations.md) - Notifications and reporting
