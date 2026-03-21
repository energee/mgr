# Packaging Sessions Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign packaging sessions into a batch-driven, real-time packaging day experience with completion review and reporting.

**Architecture:** Hybrid approach — custom PackagingDayView for in_progress sessions, EntityDetailUnified for everything else. Follows the recipe editor pattern (custom page component with dedicated context/state). Database simplification: JSONB `source_batches` → direct `batch_id` FK.

**Tech Stack:** TypeScript, React, Next.js, Supabase (PostgreSQL + PostgREST), React Query, Zod, shadcn/ui, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-14-packaging-sessions-redesign.md`

**Worktree:** `/Users/tedslesinski/conductor/workspaces/mgr/packaging-sessions` (branch: `energee/packaging-sessions-worktree`)

---

## Chunk 1: Database Migration & Schema Changes

All schema changes in a single migration. This must land first — everything else depends on it.

### Task 1: Write the migration SQL

**Files:**
- Create: `supabase/migrations/00153_packaging_sessions_redesign.sql`

**Important:** Before creating, verify the highest migration number:
```bash
ls supabase/migrations/ | sort | tail -3
```
If the highest is not `00152`, adjust the filename accordingly.

- [ ] **Step 1: Create the migration file**

```sql
-- =============================================================================
-- Migration: Packaging Sessions Redesign
-- =============================================================================
-- Changes:
--   1. Add completed_at to packaging_sessions
--   2. Add batch_id FK to session_line_items (replacing source_batches JSONB)
--   3. Migrate existing source_batches data to batch_id
--   4. Add UNIQUE constraint on (session_id, batch_id, selling_format_id)
--   5. Add BEFORE UPDATE trigger for completed_at + validation guards
--   6. Recreate packaging_sessions_with_summary view with new columns
--   7. Create brand_packaging_summary view
--   8. Update create_finished_goods_from_packaging() to use batch_id
--   9. Fix notification trigger URL
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add completed_at to packaging_sessions
-- -----------------------------------------------------------------------------
ALTER TABLE packaging_sessions
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN packaging_sessions.completed_at
  IS 'Timestamp when the session was marked completed. Set by BEFORE UPDATE trigger.';

-- -----------------------------------------------------------------------------
-- 2. Add batch_id FK to session_line_items
-- -----------------------------------------------------------------------------
ALTER TABLE session_line_items
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);

COMMENT ON COLUMN session_line_items.batch_id
  IS 'Source batch for this line item. Replaces the source_batches JSONB column.';

-- -----------------------------------------------------------------------------
-- 3. Migrate source_batches data to batch_id
-- -----------------------------------------------------------------------------

-- 3a. Split multi-batch rows into separate line items
-- For each source_batches entry beyond the first, create a new line item
DO $$
DECLARE
  v_line RECORD;
  v_entry JSONB;
  v_idx INTEGER;
BEGIN
  FOR v_line IN
    SELECT id, session_id, brand_id, selling_format_id, keg_owner_id,
           planned_quantity, actual_quantity, source_batches
    FROM session_line_items
    WHERE source_batches IS NOT NULL
      AND jsonb_array_length(source_batches) > 1
  LOOP
    v_idx := 0;
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_line.source_batches)
    LOOP
      IF v_idx = 0 THEN
        -- First entry: update the existing row
        UPDATE session_line_items
        SET batch_id = (v_entry->>'batch_id')::UUID
        WHERE id = v_line.id;
      ELSE
        -- Subsequent entries: create new line items (quantities set to null)
        INSERT INTO session_line_items (
          session_id, brand_id, selling_format_id, keg_owner_id,
          batch_id, planned_quantity, actual_quantity
        ) VALUES (
          v_line.session_id, v_line.brand_id, v_line.selling_format_id,
          v_line.keg_owner_id,
          (v_entry->>'batch_id')::UUID,
          NULL, NULL
        );
      END IF;
      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- 3b. Migrate single-batch rows
UPDATE session_line_items
SET batch_id = (source_batches->0->>'batch_id')::UUID
WHERE source_batches IS NOT NULL
  AND jsonb_array_length(source_batches) = 1
  AND batch_id IS NULL;

-- 3c. Drop the source_batches column
ALTER TABLE session_line_items DROP COLUMN IF EXISTS source_batches;

-- -----------------------------------------------------------------------------
-- 4. Add UNIQUE constraint
-- -----------------------------------------------------------------------------
-- Allows same batch with different formats (e.g., cases + kegs from one batch)
-- but prevents duplicate batch+format combos in a session.
-- Use a partial unique index to allow NULL batch_id (manual line items).
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_line_items_batch_format
  ON session_line_items (session_id, batch_id, selling_format_id)
  WHERE batch_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. BEFORE UPDATE trigger on packaging_sessions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION packaging_session_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line_count INTEGER;
BEGIN
  -- Set completed_at when transitioning to completed
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at := NOW();

    -- Guard: must go through in_progress first
    IF OLD.status != 'in_progress' THEN
      RAISE EXCEPTION 'Cannot complete a session directly from "%" status. Must be "in_progress".', OLD.status;
    END IF;

    -- Guard: must have at least one line item
    SELECT COUNT(*) INTO v_line_count
    FROM session_line_items
    WHERE session_id = NEW.id;

    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'Cannot complete a session with zero line items.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS packaging_session_before_update ON packaging_sessions;
CREATE TRIGGER packaging_session_before_update
  BEFORE UPDATE ON packaging_sessions
  FOR EACH ROW
  EXECUTE FUNCTION packaging_session_before_update();

COMMENT ON FUNCTION packaging_session_before_update
  IS 'Sets completed_at timestamp and validates state transitions for packaging sessions.';

-- -----------------------------------------------------------------------------
-- 6. Recreate packaging_sessions_with_summary view
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS packaging_sessions_with_summary;

CREATE VIEW packaging_sessions_with_summary
WITH (security_invoker = true)
AS
SELECT
  ps.*,
  COALESCE(agg.line_count, 0) AS line_count,
  agg.brands,
  COALESCE(agg.total_planned, 0) AS total_planned,
  COALESCE(agg.total_actual, 0) AS total_actual,
  (COALESCE(agg.total_actual, 0) - COALESCE(agg.total_planned, 0)) AS total_variance
FROM packaging_sessions ps
LEFT JOIN (
  SELECT
    sli.session_id,
    COUNT(*) AS line_count,
    STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS brands,
    SUM(sli.planned_quantity) AS total_planned,
    SUM(sli.actual_quantity) AS total_actual
  FROM session_line_items sli
  JOIN brands b ON b.id = sli.brand_id
  GROUP BY sli.session_id
) agg ON agg.session_id = ps.id;

COMMENT ON VIEW packaging_sessions_with_summary
  IS 'Packaging sessions with aggregated line item counts, brand names, quantity totals, and variance.';

-- -----------------------------------------------------------------------------
-- 7. Create brand_packaging_summary view
-- -----------------------------------------------------------------------------
CREATE VIEW brand_packaging_summary
WITH (security_invoker = true)
AS
SELECT
  b.id AS brand_id,
  b.name AS brand_name,
  sf.id AS selling_format_id,
  sf.name AS format_name,
  DATE_TRUNC('month', fg.production_date) AS period,
  SUM(fg.quantity) AS total_quantity,
  COUNT(DISTINCT fg.id) AS fg_count
FROM finished_goods fg
JOIN brands b ON b.id = fg.brand_id
LEFT JOIN selling_formats sf ON sf.id = fg.selling_format_id
GROUP BY b.id, b.name, sf.id, sf.name, DATE_TRUNC('month', fg.production_date);

COMMENT ON VIEW brand_packaging_summary
  IS 'Aggregated finished goods production by brand, selling format, and month.';

-- -----------------------------------------------------------------------------
-- 8. Update create_finished_goods_from_packaging() — use batch_id FK
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_finished_goods_from_packaging(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_line RECORD;
  v_fg_id UUID;
  v_lot_number TEXT;
  v_count INTEGER := 0;
BEGIN
  -- Get session info
  SELECT * INTO v_session
  FROM packaging_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Packaging session % not found', p_session_id;
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Packaging session % is not completed (status: %)',
      p_session_id, v_session.status;
  END IF;

  -- Process each line item
  FOR v_line IN
    SELECT * FROM session_line_items
    WHERE session_id = p_session_id
  LOOP
    -- Skip line items with no actual quantity (null or zero)
    IF v_line.actual_quantity IS NULL OR v_line.actual_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Check if FG already exists for this line item (idempotency)
    IF EXISTS (SELECT 1 FROM finished_goods WHERE session_line_item_id = v_line.id) THEN
      CONTINUE;
    END IF;

    v_lot_number := generate_lot_number(v_session.session_date);

    -- Create finished_goods record using batch_id FK directly
    INSERT INTO finished_goods (
      batch_id,
      brand_id,
      selling_format_id,
      session_line_item_id,
      quantity,
      lot_number,
      production_date,
      created_by
    ) VALUES (
      v_line.batch_id,
      v_line.brand_id,
      v_line.selling_format_id,
      v_line.id,
      v_line.actual_quantity,
      v_lot_number,
      v_session.session_date,
      v_session.created_by
    )
    RETURNING id INTO v_fg_id;

    -- Create allocation record (batch -> finished_good) if batch is set
    IF v_line.batch_id IS NOT NULL THEN
      INSERT INTO allocations (
        source_type,
        source_id,
        destination_type,
        destination_id,
        quantity,
        status,
        lot_number,
        notes,
        completed_at,
        created_by
      ) VALUES (
        'batch',
        v_line.batch_id,
        'finished_good',
        v_fg_id,
        v_line.actual_quantity,
        'completed',
        v_lot_number,
        'Auto-created from packaging session ' || p_session_id::TEXT,
        NOW(),
        v_session.created_by
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION create_finished_goods_from_packaging
  IS 'Creates finished goods and allocations from a completed packaging session. Uses batch_id FK directly. Skips line items with null/zero actual quantity.';

-- -----------------------------------------------------------------------------
-- 9. Fix notification trigger URL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_packaging_completion_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_count INTEGER;
  v_total_units INTEGER;
  v_brands TEXT;
  v_action_url TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF OLD.status = NEW.status OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  -- Derive summary from session line items
  SELECT
    COUNT(*),
    COALESCE(SUM(actual_quantity), 0),
    string_agg(DISTINCT b.name, ', ')
  INTO v_line_count, v_total_units, v_brands
  FROM session_line_items sli
  LEFT JOIN brands b ON b.id = sli.brand_id
  WHERE sli.session_id = NEW.id;

  -- Fixed URL (was /production/packaging-sessions/)
  v_action_url := '/production/packaging/' || NEW.id;

  -- Notify all users
  PERFORM notify_all_users(
    'batch_status',
    'Packaging Complete',
    'Packaging session completed: ' ||
      COALESCE(v_brands, 'Unknown') || ' — ' ||
      v_total_units || ' units across ' || v_line_count || ' line items.',
    'packaging_session',
    NEW.id,
    'normal',
    v_action_url,
    jsonb_build_object(
      'brands', v_brands,
      'total_units', v_total_units,
      'line_count', v_line_count
    )
  );

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Schema registry updates
-- -----------------------------------------------------------------------------
UPDATE _schema_registry
SET
  key_fields = '["session_date", "status", "completed_at", "brands", "total_planned", "total_actual"]'::jsonb,
  description = 'Packaging sessions track kegging, canning, and bottling runs. Each session contains line items with batch sources, selling formats, and planned/actual quantities.',
  updated_at = NOW()
WHERE table_name = 'packaging_sessions';

UPDATE _schema_registry
SET
  key_fields = '["session_id", "brand_id", "batch_id", "selling_format_id", "planned_quantity", "actual_quantity"]'::jsonb,
  description = 'Line items within a packaging session. Each line item represents a product (brand + format) being packaged from a single batch.',
  updated_at = NOW()
WHERE table_name = 'session_line_items';

-- -----------------------------------------------------------------------------
-- Done
-- -----------------------------------------------------------------------------
SELECT 'Packaging sessions redesign migration complete!' AS message;
```

- [ ] **Step 2: Apply the migration locally**

```bash
cd /Users/tedslesinski/conductor/workspaces/mgr/packaging-sessions
bunx supabase db push --local
```

If using a remote Supabase instance instead, run:
```bash
bunx supabase migration up
```

Verify the migration succeeded — check for errors in output.

- [ ] **Step 3: Reload PostgREST schema cache**

```bash
# If using local Supabase:
bunx supabase db reset --local
# Or send schema reload notification:
# psql -c "NOTIFY pgrst, 'reload schema'"
```

- [ ] **Step 4: Verify schema changes**

```sql
-- Check batch_id column exists and source_batches is gone
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'session_line_items'
ORDER BY ordinal_position;

-- Check completed_at exists on packaging_sessions
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'packaging_sessions' AND column_name = 'completed_at';

-- Check the BEFORE UPDATE trigger exists
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'packaging_sessions' AND trigger_name = 'packaging_session_before_update';
```

- [ ] **Step 5: Regenerate Supabase types**

```bash
cd /Users/tedslesinski/conductor/workspaces/mgr/packaging-sessions
bunx supabase gen types typescript --local > src/types/supabase.ts
```

- [ ] **Step 6: Run typecheck**

```bash
bun typecheck
```

Expected: May have type errors in files that reference `source_batches` — that's expected and fixed in Task 2.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00153_packaging_sessions_redesign.sql src/types/supabase.ts
git commit -m "feat: packaging sessions schema redesign — batch_id FK, completed_at, views, triggers"
```

---

## Chunk 2: Entity Config & Editor Updates

Update entity configs and the line items editor to use the new `batch_id` FK. This fixes the type errors from Chunk 1.

### Task 2: Update session-line-item entity config

**Files:**
- Modify: `src/entities/session-line-item.tsx`

- [ ] **Step 1: Replace source_batches with batch_id in Zod schema**

In `src/entities/session-line-item.tsx`, replace the `sessionLineItemSchema`:

```typescript
export const sessionLineItemSchema = z.object({
  session_id: z.string().uuid(),
  brand_id: z.string().uuid({ message: "Brand is required" }),
  selling_format_id: z.string().uuid().nullable().optional(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  planned_quantity: z.coerce.number().int().nullable().optional(),
  actual_quantity: z.coerce.number().int().nullable().optional(),
});
```

Remove the old `source_batches` array schema entirely.

- [ ] **Step 2: Update keyFields**

Change `keyFields` from:
```typescript
keyFields: ["brand_id", "selling_format_id", "planned_quantity", "actual_quantity"],
```
To:
```typescript
keyFields: ["brand_id", "batch_id", "selling_format_id", "planned_quantity", "actual_quantity"],
```

- [ ] **Step 3: Run typecheck**

```bash
bun typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/session-line-item.tsx
git commit -m "feat: update session-line-item entity config for batch_id FK"
```

### Task 2.5: Update session-line-items-display wrapper

**Files:**
- Modify: `src/components/domain/session-line-items-display.tsx`

After view switching (Task 8), `in_progress` sessions render via `PackagingDayView` and never reach this wrapper. Update the `readOnly` logic to always be read-only for `in_progress` (defensive), since the only path to this component is now `planned` (via EntityDetailUnified) or terminal states.

- [ ] **Step 1: Update readOnly logic**

```typescript
// All statuses except "planned" are read-only in this wrapper.
// "in_progress" sessions use PackagingDayView instead, but if this
// component is reached for in_progress, default to read-only for safety.
const readOnly = data.status !== "planned";
```

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/domain/session-line-items-display.tsx
git commit -m "feat: update session-line-items-display readOnly logic for view switching"
```

### Task 3: Update packaging-session entity config

**Files:**
- Modify: `src/entities/packaging-session.tsx`

- [ ] **Step 1: Update the PackagingSession type to include completed_at**

Add `total_variance` to the combined type. Note: `completed_at` will already be in `PackagingSessionTable` after `supabase gen types` runs, so do NOT add it to the intersection — it would be a duplicate. Only add the view-computed fields:
```typescript
type PackagingSession = PackagingSessionTable & {
  line_count: number | null;
  brands: string | null;
  total_planned: number | null;
  total_actual: number | null;
  total_variance: number | null;
};
```

- [ ] **Step 2: Add variance and completed_at to list columns**

After the `total_actual` column, add:
```typescript
{
  accessorKey: "total_variance",
  header: "Variance",
  sortable: true,
  render: (value, row) => {
    const v = value as number | null;
    const status = (row as PackagingSession).status;
    if (status !== "completed" && status !== "revised") return "—";
    if (v === null || v === undefined) return "—";
    const color = v === 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-green-600";
    return <span className={color}>{v > 0 ? `+${v}` : v}</span>;
  },
},
```

- [ ] **Step 3: Add completed_at to the overview section**

In the `overview` section fields, add after `updated_at`:
```typescript
{
  name: "completed_at",
  label: "Completed",
  format: "datetime",
  editable: false,
  colSpan: 6,
},
```

- [ ] **Step 4: Verify status transitions are already correct (no change needed)**

The state machine transitions already prevent `planned → completed`:
```typescript
transitions: {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  // ...
}
```
EntityDetailUnified only shows valid next states from the transitions config. The server-side BEFORE UPDATE trigger is a safety net. No code change needed — this is a verification step.

- [ ] **Step 5: Run typecheck**

```bash
bun typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/entities/packaging-session.tsx
git commit -m "feat: add variance, completed_at to packaging session entity config"
```

### Task 4: Update session-line-items-editor for batch_id FK

**Files:**
- Modify: `src/components/domain/session-line-items-editor.tsx`

This is the largest change — replacing all JSONB `source_batches` handling with `batch_id`.

- [ ] **Step 1: Update SessionLineItemRow type**

Replace:
```typescript
type SessionLineItemRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  selling_format_id: string | null;
  selling_format_name: string | null;
  keg_owner_id: string | null;
  keg_owner_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  source_batches: Array<{
    batch_id: string;
    planned_qty: number | null;
    actual_qty: number | null;
  }>;
}
```

With:
```typescript
type SessionLineItemRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  selling_format_id: string | null;
  selling_format_name: string | null;
  keg_owner_id: string | null;
  keg_owner_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  batch_id: string | null;
}
```

- [ ] **Step 2: Update NewItemState type**

Already has `batch_id: string` — no change needed. Confirm it exists.

- [ ] **Step 3: Update the query that fetches line items**

In the `useQuery` for items, update the mapping from:
```typescript
source_batches:
  (item.source_batches as Array<{...}>) ?? [],
```
To:
```typescript
batch_id: item.batch_id,
```

Also update the select query — remove `source_batches` join. The select should be:
```typescript
.select("*, brands(name), selling_formats(name), keg_owners(name)")
```
(This is already correct — `source_batches` was a column, not a join.)

- [ ] **Step 4: Update the addItem mutation**

Replace the source_batches insert:
```typescript
const { error } = await supabase.from("session_line_items").insert({
  session_id: sessionId,
  brand_id: item.brand_id,
  selling_format_id: item.format_id || null,
  keg_owner_id: isKeg ? item.keg_owner_id || null : null,
  batch_id: item.batch_id || null,
  planned_quantity: item.planned_quantity,
  actual_quantity: item.actual_quantity,
});
```

Remove the `sourceBatches` variable construction entirely.

- [ ] **Step 5: Update BatchCell usage in existing items**

Change:
```typescript
currentBatchId={item.source_batches?.[0]?.batch_id ?? ""}
```
To:
```typescript
currentBatchId={item.batch_id ?? ""}
```

- [ ] **Step 6: Update batch change handler for existing items**

Change the `onSelect` handler from:
```typescript
onSelect={(batchId) =>
  updateItem.mutate({
    id: item.id,
    field: "source_batches",
    value: [
      {
        batch_id: batchId,
        planned_qty: item.planned_quantity,
        actual_qty: item.actual_quantity,
      },
    ],
  })
}
```
To:
```typescript
onSelect={(batchId) =>
  updateItem.mutate({
    id: item.id,
    field: "batch_id",
    value: batchId,
  })
}
```

- [ ] **Step 7: Run typecheck**

```bash
bun typecheck
```
Expected: PASS (all source_batches references removed)

- [ ] **Step 8: Run lint**

```bash
bun lint
```

- [ ] **Step 9: Commit**

```bash
git add src/components/domain/session-line-items-editor.tsx
git commit -m "feat: replace source_batches JSONB with batch_id FK in line items editor"
```

### Task 5: Update query keys

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Expand packagingKeys**

Replace the existing `packagingKeys` block:
```typescript
export const packagingKeys = {
  batchesForBrand: (brandId: string) =>
    ["packaging", "batches-for-brand", brandId] as const,
  historyForBatch: (batchId: string) =>
    ["packaging", "history", batchId] as const,
  brandSummary: (brandId: string, dateRange?: { from: string; to: string }) =>
    ["packaging", "brand-summary", brandId, dateRange] as const,
  schedule: (filters?: Record<string, unknown>) =>
    filters
      ? (["packaging", "schedule", filters] as const)
      : (["packaging", "schedule"] as const),
};
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add packaging reporting query key factories"
```

---

## Chunk 3: Packaging Day View

The custom in-progress session view — the core UX improvement.

### Task 6: Create PackagingDayView component

**Files:**
- Create: `src/components/domain/packaging-day-view.tsx`

- [ ] **Step 1: Create the full component file (~400 lines)**

**This is NOT a stub — build the complete, working component.** Use `session-line-items-editor.tsx` as the reference implementation and adapt it. The component must include all of the following:

**Required imports:** `useState`, `useMemo`, `useCallback`, `useQuery`, `useMutation`, `useQueryClient`, `useRouter`, `createClient`, UI components (Button, Input, Badge, StatusBadge, Table/*, Combobox/*, Select/*), icons (Plus, Trash2, Loader2, CheckCircle, ArrowLeft), toast, query keys, catalog hooks, UnitDisplay, PackagingCompletionReview.

**Component structure (all sections required):**

1. **Session header bar** — compact row with: session date (fetched from DB), StatusBadge for `in_progress`, item count, total planned, total actual. Use `flex justify-between` layout.

2. **Line items table** — Columns: Brand (read-only text), Batch (read-only text showing batch_number), Format (read-only text with keg owner badge), Planned Qty (read-only number), **Actual Qty** (editable Input with `bg-amber-50` highlight, saves on blur), Variance (computed: `actual - planned`, colored: green if 0, red if negative, gray if null), Delete button.

3. **Quick-add row** — always visible at bottom of table (no toggle). Brand combobox, Batch select (filtered by brand via `useBatchesForBrand`), Format combobox (with keg badge + conditional keg owner), Planned qty input, Actual qty input, Add button.

4. **Footer row** — totals for Planned and Actual columns.

5. **Action bar** — "Back to List" link (`/production/packaging`), "Complete Session" button (opens `PackagingCompletionReview` modal). Show "Complete Session" only when at least one line item exists.

**Required behaviors:**
- Actual quantity inputs: `defaultValue` with `key` pattern (like existing editor), save on blur via `updateItem` mutation
- Variance: computed client-side as `(actual ?? 0) - (planned ?? 0)`, show "—" if actual is null
- Variance colors: `text-green-600` for 0 or positive, `text-red-600` for negative, `text-muted-foreground` for null
- Tab-through: actual quantity inputs should use sequential `tabIndex` values
- Import `useBatchesForBrand` from shared hook file (see Step 2)
- Completion review: track `showReview` state, pass items array to `PackagingCompletionReview`
- On completion callback: invalidate queries, redirect to detail page (it will now render read-only EntityDetailUnified)

**Data fetching:**
- Session metadata: `useQuery` on `packaging_sessions` table for id, session_date, status, notes
- Line items: same query pattern as existing editor but mapping `batch_id` instead of `source_batches`
- Resolve batch_number for display: join `batches(batch_number)` in the line items select

**Module-level JSDoc:**
```typescript
/**
 * Packaging Day View
 *
 * Custom view for in-progress packaging sessions. Replaces EntityDetailUnified
 * when a session is in "in_progress" status. Optimized for real-time data entry
 * with a full-width table, highlighted actual-quantity column, live variance
 * calculation, and quick-add row.
 *
 * Follows the recipe editor pattern: custom page component for active editing,
 * entity config for list/read-only views.
 */
```

- [ ] **Step 2: Extract useBatchesForBrand to shared hook**

Create or move the `useBatchesForBrand` hook to `src/hooks/use-catalog.ts` (where other catalog hooks live), so both the editor and the day view can use it. Or create `src/hooks/use-packaging.ts`.

- [ ] **Step 3: Run typecheck**

```bash
bun typecheck
```

- [ ] **Step 4: Run lint**

```bash
bun lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/domain/packaging-day-view.tsx src/hooks/use-packaging.ts
git commit -m "feat: create PackagingDayView component for in-progress sessions"
```

### Task 7: Create PackagingCompletionReview modal

**Files:**
- Create: `src/components/domain/packaging-completion-review.tsx`

- [ ] **Step 1: Create the component**

A dialog/modal that:
1. Receives session ID and line items data
2. Shows a read-only review table: Brand, Batch, Format, Planned, Actual, Variance
3. Flags missing actuals in red
4. Shows totals at bottom
5. Has a notes textarea
6. Has "Confirm" and "Go Back" buttons
7. On confirm: calls the status transition mutation (`status → completed`)

```typescript
"use client";

/**
 * Packaging Completion Review Modal
 *
 * Review dialog shown before completing a packaging session. Displays
 * per-line-item variance, flags missing actuals, and requires confirmation.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { entityKeys } from "@/lib/query-keys";
```

Props:
```typescript
type PackagingCompletionReviewProps = {
  sessionId: string;
  items: Array<{
    id: string;
    brand_name: string;
    batch_number: string | null;
    format_name: string | null;
    planned_quantity: number | null;
    actual_quantity: number | null;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
};
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/domain/packaging-completion-review.tsx
git commit -m "feat: create PackagingCompletionReview modal with variance display"
```

### Task 8: Wire up view switching on detail page

**Files:**
- Modify: `src/app/(app)/production/packaging/[id]/page.tsx`

- [ ] **Step 1: Add status-based view switching**

Replace the current simple `EntityDetailUnifiedWithErrorBoundary` render with conditional logic:

```typescript
"use client";

/**
 * Packaging Session Detail Page
 *
 * Routes to different views based on session status:
 * - planned → EntityDetailUnified (editable)
 * - in_progress → PackagingDayView (custom real-time editor)
 * - completed/revised/cancelled → EntityDetailUnified (read-only)
 */

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { PackagingDayView } from "@/components/domain/packaging-day-view";
import { entityKeys } from "@/lib/query-keys";
import { Loader2 } from "lucide-react";

export default function PackagingSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();

  // Fetch session status to determine which view to render
  const { data: session, isLoading } = useQuery({
    queryKey: entityKeys.detail("packaging_sessions", id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, status")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // In-progress sessions get the custom packaging day view
  if (session?.status === "in_progress") {
    return <PackagingDayView sessionId={id} />;
  }

  // All other states use the standard entity detail
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={packagingSessionEntity}
      id={id}
      basePath="/production/packaging"
    />
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/production/packaging/[id]/page.tsx
git commit -m "feat: add status-based view switching — PackagingDayView for in_progress"
```

---

## Chunk 4: Batch-Initiated Session Creation

### Task 8.5: Update batch entity config — remove toState from start_packaging

**Files:**
- Modify: `src/entities/batch.tsx`

The current `start_packaging` action has `toState: "packaging"` which triggers an automatic state transition before the custom dialog handler runs. We need to remove `toState` so the dialog controls when the transition happens.

- [ ] **Step 1: Remove toState from start_packaging action**

In `src/entities/batch.tsx`, find the `start_packaging` action (around line 352-358) and remove the `toState` property:

```typescript
{
  name: "start_packaging",
  label: "Start Packaging",
  icon: "package",
  type: "button" as const,
  fromStates: ["conditioning"],
  // toState removed — the PackagingBatchDialog handles the transition
},
```

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/entities/batch.tsx
git commit -m "feat: remove auto-transition from start_packaging action — dialog handles it"
```

### Task 9: Create Start Packaging dialog

**Files:**
- Create: `src/components/domain/packaging-batch-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

A dialog that:
1. Receives batch ID, brand ID, brand name (from the batch's recipe)
2. Shows pre-filled: session date (today), brand (read-only), batch (read-only)
3. User selects: selling format (combobox), planned quantity (number input)
4. Optionally shows keg owner if keg format selected
5. On submit:
   - Creates packaging session (status: `planned`)
   - Creates one session_line_item with batch_id, brand_id, selling_format_id, planned_quantity
   - Transitions batch status to `packaging`
   - Navigates to the new session's detail page

```typescript
"use client";

/**
 * Start Packaging Dialog
 *
 * Opens from a batch detail page to create a new packaging session
 * pre-populated with the batch's brand and the batch as the source.
 * User selects selling format and planned quantity.
 */
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/domain/packaging-batch-dialog.tsx
git commit -m "feat: create Start Packaging dialog for batch-initiated session creation"
```

### Task 10: Wire up Start Packaging action on batch detail

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

- [ ] **Step 1: Import and add dialog state**

Add imports:
```typescript
import { PackagingBatchDialog } from "@/components/domain/packaging-batch-dialog";
```

Add state:
```typescript
const [showStartPackaging, setShowStartPackaging] = useState(false);
```

- [ ] **Step 2: Handle the start_packaging action**

In `handleAction`, add before the `return false`:
```typescript
if (actionName === "start_packaging") {
  setShowStartPackaging(true);
  return true;
}
```

- [ ] **Step 3: Add the dialog to the render**

Add in the JSX alongside the other dialogs:
```typescript
{showStartPackaging && batch && (
  <PackagingBatchDialog
    open={showStartPackaging}
    onOpenChange={setShowStartPackaging}
    batchId={id}
    batchNumber={batch.batch_number}
    brandId={batch.brand_id}
    brandName={batch.brand_name}
  />
)}
```

**Important — resolving brand info:** The batch detail page fetches via `batches_with_brew_info` which does NOT include `brand_id` or `brand_name`. You must resolve brand from the batch's recipe. Add a query to fetch the recipe's brand:

```typescript
const { data: recipeBrand } = useQuery({
  queryKey: ["batch-recipe-brand", id],
  queryFn: async () => {
    const { data: batchData } = await supabase
      .from("batches")
      .select("recipe_id, recipes(brand_id, brands(id, name))")
      .eq("id", id)
      .single();
    const recipe = batchData?.recipes as { brand_id: string; brands: { id: string; name: string } } | null;
    return recipe?.brands ?? null;
  },
  enabled: !!batch,
});
```

Then pass `recipeBrand.id` and `recipeBrand.name` as `brandId` and `brandName` props to the dialog.

- [ ] **Step 4: Handle "View Packaging Session" for batches already in packaging state**

For batches already in `packaging` status, query `session_line_items` for an existing session and show a link instead. This can be a `useQuery` that fetches when `batch.status === "packaging"`:

```typescript
const { data: existingSession } = useQuery({
  queryKey: packagingKeys.historyForBatch(id),
  queryFn: async () => {
    const { data } = await supabase
      .from("session_line_items")
      .select("session_id, packaging_sessions(id, status)")
      .eq("batch_id", id)
      .limit(1)
      .single();
    return data;
  },
  enabled: batch?.status === "packaging",
});
```

- [ ] **Step 5: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/production/batches/[id]/page.tsx
git commit -m "feat: wire up Start Packaging dialog on batch detail page"
```

### Task 10.5: Handle "Add to Packaging Session" for orphaned packaging batches

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`
- Create: `src/components/domain/add-to-packaging-session-dialog.tsx`

When a batch is in `packaging` status but has no session referencing it (e.g., manually transitioned), show "Add to Packaging Session" instead of "View Packaging Session".

- [ ] **Step 1: Create the "Add to Packaging Session" dialog**

A dialog that:
1. Fetches existing `planned` or `in_progress` sessions
2. Shows a select dropdown to pick one, or a "Create New" option
3. On confirm: creates a line item in the selected session (or creates a new session first)
4. Navigates to the session detail page

- [ ] **Step 2: Wire into batch detail page**

In the batch detail page, use the `existingSession` query from Task 10 Step 4. If `existingSession` is null but batch status is `packaging`, show the "Add to Packaging Session" button instead.

- [ ] **Step 3: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/domain/add-to-packaging-session-dialog.tsx src/app/(app)/production/batches/[id]/page.tsx
git commit -m "feat: add 'Add to Packaging Session' dialog for orphaned packaging batches"
```

### Task 10.6: Multi-batch session creation (bulk action on batch list)

**Files:**
- Modify: `src/app/(app)/production/batches/page.tsx` (or wherever the batch list page is)

- [ ] **Step 1: Check if EntityList supports bulk actions**

Examine `src/components/universal/entity-list.tsx` for row selection and bulk action support. If not supported, this task requires adding row selection checkboxes and a bulk action bar to the EntityList component — which is a significant cross-cutting change.

**If EntityList does NOT support bulk actions:** Defer this to a follow-up. Document in the spec that multi-batch creation via batch list is pending EntityList bulk action support. For now, users can create a session from one batch and add more line items on the session page.

**If EntityList DOES support bulk actions:** Add a "Create Packaging Session" bulk action that:
1. Filters selected batches to only those in `conditioning` or `packaging` status
2. Creates a packaging session (status: `planned`)
3. Creates one line item per batch (brand resolved from recipe, batch_id set)
4. Transitions `conditioning` batches to `packaging`
5. Navigates to the new session's detail page

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/production/batches/page.tsx
git commit -m "feat: add multi-batch packaging session creation (or defer if no bulk action support)"
```

---

## Chunk 5: Reporting

### Task 11: Add packaging history to batch detail

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx` (or create a new section component)

- [ ] **Step 1: Create a batch packaging history section**

Add a section to the batch detail page that shows:
- Session line items where `batch_id` matches
- Joined with packaging_sessions for date and status
- Joined with selling_formats for format name
- Joined with finished_goods for lot numbers

Display as a simple read-only table: Date, Format, Planned, Actual, Lot #, Session Status

- [ ] **Step 2: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/production/batches/[id]/page.tsx
git commit -m "feat: add packaging history section to batch detail page"
```

### Task 11.5: Add brand production totals to brand detail page

**Files:**
- Modify: `src/app/(app)/` — find the brand detail page (search for brand entity pages)

- [ ] **Step 1: Find the brand detail page**

```bash
find src/app -path "*brand*" -name "page.tsx"
```

- [ ] **Step 2: Add a Packaging section**

Query `brand_packaging_summary` view (created in migration) filtered by brand ID. Display as a table: Format, Month, Total Quantity, FG Count. Use `packagingKeys.brandSummary(brandId)` query key.

- [ ] **Step 3: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 4: Commit**

```bash
git add src/app/
git commit -m "feat: add brand packaging production totals section"
```

### Task 12: Enhance packaging list view with schedule filters

**Files:**
- Modify: `src/entities/packaging-session.tsx`

- [ ] **Step 1: Add date range filter to list filters**

In `packagingSessionEntity.listFilters`, add a date range filter:
```typescript
{
  field: "session_date",
  type: "date-range",
  label: "Date",
},
```

Check if the entity list component supports `date-range` filter type. If not, this may require a `select` filter with preset options like "Today", "This Week", "Next 7 Days".

- [ ] **Step 2: Add variance % to list columns**

Add after the `total_variance` column (or replace it with percentage):
```typescript
{
  accessorKey: "total_variance",
  header: "Var %",
  sortable: true,
  render: (value, row) => {
    const session = row as PackagingSession;
    if (session.status !== "completed" && session.status !== "revised") return "—";
    const planned = session.total_planned;
    if (!planned || planned === 0) return "—";
    const pct = ((session.total_actual ?? 0) - planned) / planned * 100;
    const color = Math.abs(pct) <= 5 ? "text-green-600" : "text-red-600";
    return <span className={color}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
  },
},
```

- [ ] **Step 3: Run typecheck and lint**

```bash
bun typecheck && bun lint
```

- [ ] **Step 4: Commit**

```bash
git add src/entities/packaging-session.tsx
git commit -m "feat: add variance % column and date filter to packaging list"
```

---

## Chunk 6: Documentation & Final Validation

### Task 13: Update documentation

**Files:**
- Modify: `docs/data-model/packaging.md`
- Modify: `docs/spec/architecture.md`
- Modify: `docs/spec/workflows.md`

- [ ] **Step 1: Update data model docs**

In `docs/data-model/packaging.md`:
- Replace `source_batches JSONB` with `batch_id UUID FK`
- Add `completed_at` column description
- Document the UNIQUE constraint
- Update the packaging flow diagram

- [ ] **Step 2: Update architecture docs**

In `docs/spec/architecture.md`:
- Add PackagingDayView as a custom component pattern alongside the recipe editor

- [ ] **Step 3: Update workflow docs**

In `docs/spec/workflows.md`:
- Update the packaging session state machine to reflect:
  - Batch-initiated creation flow
  - Completion review modal requirement
  - `planned → completed` is blocked (must go through `in_progress`)

- [ ] **Step 4: Commit**

```bash
git add docs/data-model/packaging.md docs/spec/architecture.md docs/spec/workflows.md
git commit -m "docs: update packaging data model, architecture, and workflow docs"
```

### Task 14: Final validation

- [ ] **Step 1: Run full typecheck**

```bash
bun typecheck
```
Expected: Zero errors.

- [ ] **Step 2: Run full lint**

```bash
bun lint
```
Expected: Zero errors from changed files.

- [ ] **Step 3: Run tests (if any exist for packaging)**

```bash
bun test -- --grep packaging 2>/dev/null || echo "No packaging tests found"
```

- [ ] **Step 4: Manual smoke test**

Open `http://localhost:55080` and verify:
1. Packaging list shows new variance column
2. Creating a new session works
3. Transitioning to in_progress shows the PackagingDayView
4. Adding line items with batch_id works
5. Actual quantity entry with live variance works
6. Completing a session shows the review modal
7. Confirming completion creates finished goods

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: packaging sessions — final fixups from smoke test"
```
