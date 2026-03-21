# Packaging Sessions Redesign

## Overview

Redesign packaging sessions from a disconnected manual workflow into a batch-driven, real-time packaging day experience with completion review and reporting.

**Approach:** Hybrid — custom packaging-day view for active (in_progress) sessions, entity config for list/creation/completed views. Follows the recipe editor precedent.

## Requirements

- Sessions created from batches (single or multi-select), not standalone
- One brand per line item, one batch per line item (no blending)
- Quantities = individual units of the selling format (cases, kegs, etc.)
- Real-time data entry during active packaging with live totals and variance
- Per-line-item review with discrepancy flagging before completion
- Full reporting: per-batch history, yield tracking, brand totals, schedule

## Section 1: Batch-Initiated Session Creation

### Single Batch
1. "Start Packaging" on batch detail (available when batch status is `conditioning`) opens a dialog
2. Dialog pre-populates:
   - `session_date` = today
   - One line item: brand (from batch's recipe), batch pre-selected as source
   - User picks selling format and planned quantity
3. On confirm:
   - Creates packaging session (status: `planned`)
   - Creates one session line item with `batch_id` FK
   - Transitions batch status to `packaging`
   - Navigates to session detail page

### Batch Already in `packaging` State
- If a batch is already in `packaging` status, the batch detail page shows a "View Packaging Session" link instead of "Start Packaging"
- The link navigates to the existing session that references this batch (query `session_line_items` by `batch_id`)
- If no session references this batch (e.g., it was transitioned manually), show "Add to Packaging Session" which opens a dialog to select an existing `planned` or `in_progress` session, or create a new one

### Multi-Batch
1. On batch list page, select 2+ batches in `conditioning` or `packaging` status
2. "Create Packaging Session" bulk action
3. Creates session with one line item per selected batch
4. Each line item pre-populated with brand from batch's recipe, `batch_id` set
5. Batches in `conditioning` are transitioned to `packaging`; batches already in `packaging` are left as-is
6. User fills in formats and quantities on the session page

### Manual Creation
- Keep existing "New Session" button on packaging list for edge cases
- Functions as it does today

## Section 2: Packaging Day View (In-Progress Sessions)

### Layout
Full-width table with sticky header. Replaces EntityDetailUnified when session status is `in_progress`.

### Components
- **Session header bar:** Compact row showing session date, status badge, item count, total planned, total actual
- **Line items table:**
  - Columns: Brand, Batch, Format, Planned Qty, Actual Qty (highlighted), Variance
  - Actual column visually emphasized as primary input area
  - Variance column: `actual - planned`, color-coded (green = 0, red = negative, gray = not yet entered)
  - Keg owner shown as badge on format when applicable
- **Quick-add row:** Always visible at bottom of table for adding new line items
- **Footer row:** Running totals for planned and actual

### Behavior
- Actual quantity inputs save on blur (existing pattern)
- Variance updates live as actuals are entered
- Tab-through optimized: pressing Tab moves between actual quantity inputs
- Read-only brand/batch/format for existing items (set at planning time)
- Add/delete line items while in progress

### View Switching
The `[id]/page.tsx` detail route checks session status:
- `planned` → EntityDetailUnified (standard view with edit toggle, `completed` removed from status dropdown options)
- `in_progress` → Custom PackagingDayView component
- `completed`, `revised`, `cancelled` → EntityDetailUnified (read-only)

**Status dropdown guard:** When rendering `planned` sessions via EntityDetailUnified, the status field options exclude `completed` and `revised`. The only valid transition from `planned` is `in_progress` or `cancelled`. This prevents bypassing the completion review modal. Enforced both client-side (filtered options) and server-side (see Section 4, `BEFORE UPDATE` trigger).

## Section 3: Completion Review Flow

### Trigger
User clicks "Complete Session" button (visible only in packaging day view).

### Review Modal
1. Shows each line item: brand, batch, format, planned, actual, variance
2. Flags line items with missing actuals in red with warning text ("N items have no actual quantity")
3. Shows total planned vs total actual at bottom
4. Optional session-level completion notes field
5. Two actions:
   - **Confirm** → transitions status to `completed`, fires triggers
   - **Go Back** → closes modal, returns to editing

### Rules
- Cannot complete a session with zero line items
- Line items with actual = 0 are allowed (decided not to package that item)
- Line items with actual = null are flagged as likely mistakes (but not blocked)

### On Completion — Trigger Behavior
Updated `create_finished_goods_from_packaging()` function:
- Reads `batch_id` column directly (no JSONB iteration)
- **Null-actual handling:** Line items with `actual_quantity IS NULL` are **skipped** — no `finished_goods` or `allocations` record is created for them. The function does not error on null actuals.
- Line items with `actual_quantity = 0` are also skipped (no FG for zero units)
- Line items with `actual_quantity > 0` create one `finished_goods` record and one `allocations` record
- Generates lot numbers via `generate_lot_number()`
- Sends completion notification (with corrected action URL: `/production/packaging/{id}`)

### `completed_at` Timestamp
Set by a `BEFORE UPDATE` trigger on `packaging_sessions`:
```sql
-- In the BEFORE UPDATE trigger:
IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
  NEW.completed_at = NOW();
END IF;
```
This avoids recursive trigger issues — the `BEFORE UPDATE` trigger modifies `NEW` directly, so no second UPDATE statement is needed. The `AFTER UPDATE` trigger (`create_finished_goods_from_packaging`) fires after and reads the already-set `completed_at`.

## Section 4: Data Model Changes

### `packaging_sessions` table
- **Add:** `completed_at TIMESTAMPTZ` — set by `BEFORE UPDATE` trigger when status → `completed`

### `session_line_items` table
- **Add:** `batch_id UUID REFERENCES batches(id)` — direct FK to the source batch
- **Add:** `UNIQUE(session_id, batch_id, selling_format_id)` — prevents duplicate line items for the same batch+format in a session. Same batch with different formats is allowed (e.g., cases and kegs from one batch).
- **Remove:** `source_batches JSONB` — replaced by `batch_id`

### Migration Strategy for `source_batches → batch_id`
1. Add `batch_id` column (nullable initially)
2. Check for multi-batch rows: `SELECT id FROM session_line_items WHERE jsonb_array_length(COALESCE(source_batches, '[]'::jsonb)) > 1`
3. If any multi-batch rows exist: split them into separate line items (one per source batch), preserving the first entry's `planned_quantity`/`actual_quantity` and setting subsequent entries to null
4. Migrate single-batch rows: `UPDATE session_line_items SET batch_id = (source_batches->0->>'batch_id')::uuid WHERE source_batches IS NOT NULL AND jsonb_array_length(source_batches) = 1`
5. Drop `source_batches` column
6. Add the UNIQUE constraint

### `packaging_sessions_with_summary` view
- **Recreate** with `security_invoker = true`
- **Add:** `completed_at` from base table
- **Add:** `total_variance` computed column (`total_actual - total_planned`)

### `brand_packaging_summary` view (new)
- **Create** with `security_invoker = true`
- Aggregates finished goods by brand, selling format, time period
- Columns: brand_name, format_name, total_quantity, period

### `create_finished_goods_from_packaging()` function
- **Update:** Read `batch_id` column directly instead of iterating JSONB
- **Update:** Skip line items where `actual_quantity IS NULL OR actual_quantity <= 0` (no error, just skip)
- **Update:** Set `search_path = public`

### `BEFORE UPDATE` trigger on `packaging_sessions` (new)
- Sets `completed_at = NOW()` when status transitions to `completed`
- **Server-side guard:** Rejects `status → completed` if session has zero line items
- **Server-side guard:** Rejects direct `planned → completed` transition (must go through `in_progress` first)

### `trigger_packaging_completion_notification()` function
- **Fix:** Correct action URL from `/production/packaging-sessions/` to `/production/packaging/`

### No changes to:
- `finished_goods` table
- `allocations` table
- `generate_lot_number()` function
- RLS policies

### Migration File
`supabase/migrations/00153_packaging_sessions_redesign.sql` — verify highest migration number before creating.

## Section 5: Reporting

### A) Packaging History per Batch
- Add "Packaging" section to batch detail page
- Query: join `session_line_items` → `packaging_sessions` → `finished_goods` where `batch_id` matches
- Shows: session date, format, planned/actual quantities, lot numbers

### B) Yield Tracking (Per-Session)
- Packaging list view: add variance % column
- Formula: `(total_actual - total_planned)::float / NULLIF(total_planned, 0) * 100` (guards against division by zero)
- Completed session detail: per-line-item variance with color coding
  - Green: variance = 0
  - Yellow: variance within ±5%
  - Red: variance beyond ±5%
- Deferred: dashboard trend widget (average variance by week/month)

### C) Brand Production Totals
- New database view: `brand_packaging_summary` with `security_invoker = true`
  - Aggregates finished goods by brand, selling format, time period
  - Columns: brand_name, format_name, total_quantity, period
- Accessible from brand detail page ("Packaging" section)
- Filterable by date range

### D) Packaging Schedule / Forecast
- Enhance packaging list view with:
  - Date range filter defaulting to "upcoming" (today + 7 days)
  - "Scheduled" quick filter showing only `planned` status
- No new pages — better filtering on existing list

### Phasing
All reporting except the dashboard trend widget is in scope.

## Section 6: Query Key Factories

New keys to add to `src/lib/query-keys.ts`:

```typescript
export const packagingKeys = {
  // Existing
  batchesForBrand: (brandId: string) =>
    ["packaging", "batches-for-brand", brandId] as const,
  // New
  historyForBatch: (batchId: string) =>
    ["packaging", "history", batchId] as const,
  brandSummary: (brandId: string, dateRange?: { from: string; to: string }) =>
    ["packaging", "brand-summary", brandId, dateRange] as const,
  schedule: (filters?: Record<string, unknown>) =>
    ["packaging", "schedule", filters] as const,
};
```

## Section 7: Documentation Updates

All documentation ships in the same commits as code:

1. `docs/data-model/packaging.md` — schema changes (batch_id FK, completed_at, updated views, new UNIQUE constraint)
2. `docs/spec/architecture.md` — packaging day view as custom component pattern
3. `docs/spec/workflows.md` — updated state machine flow with batch-initiated creation and completion review
4. Entity config inline comments — updated JSDoc on `packaging-session.tsx`, `session-line-item.tsx`
5. New component module comments — packaging day view, completion review modal
6. Migration comments — rationale for schema changes

## Section 8: Type Changes in Editor

The `session-line-items-editor.tsx` component requires these type-level changes:

### `SessionLineItemRow` type
```typescript
// Before
type SessionLineItemRow = {
  // ...
  source_batches: Array<{ batch_id: string; planned_qty: number | null; actual_qty: number | null }>;
}

// After
type SessionLineItemRow = {
  // ...
  batch_id: string | null;
}
```

### `BatchCell` prop source
```typescript
// Before
currentBatchId={item.source_batches?.[0]?.batch_id ?? ""}

// After
currentBatchId={item.batch_id ?? ""}
```

### Insert mutation
```typescript
// Before: source_batches JSONB array
source_batches: [{ batch_id, planned_qty, actual_qty }]

// After: direct FK
batch_id: item.batch_id || null
```

### Update mutation for batch change
```typescript
// Before
updateItem.mutate({ id, field: "source_batches", value: [{ batch_id, planned_qty, actual_qty }] })

// After
updateItem.mutate({ id, field: "batch_id", value: batchId })
```

## File Impact Summary

### New Files
- `src/components/domain/packaging-day-view.tsx` — custom in-progress session view
- `src/components/domain/packaging-completion-review.tsx` — completion review modal
- `src/components/domain/packaging-batch-dialog.tsx` — single-batch "Start Packaging" dialog
- `supabase/migrations/00153_packaging_sessions_redesign.sql` — schema changes

### Modified Files
- `src/entities/packaging-session.tsx` — add completed_at, update view table columns, filter status options
- `src/entities/session-line-item.tsx` — replace source_batches with batch_id in schema and type
- `src/entities/batch.tsx` — update "Start Packaging" action to open dialog
- `src/app/(app)/production/batches/[id]/page.tsx` — handle Start Packaging dialog, add Packaging history section
- `src/app/(app)/production/packaging/[id]/page.tsx` — conditional rendering based on status
- `src/components/domain/session-line-items-editor.tsx` — replace JSONB source_batches with batch_id FK (type, query, insert, update paths)
- `src/components/domain/session-line-items-display.tsx` — update for batch_id
- `src/lib/query-keys.ts` — add packaging reporting key factories
- `docs/data-model/packaging.md` — schema updates
- `docs/spec/architecture.md` — custom component pattern
- `docs/spec/workflows.md` — updated packaging flow

### Potentially Removed
- JSONB source_batches handling in editor (~50 lines)
- JSONB iteration in completion trigger (~20 lines SQL)
