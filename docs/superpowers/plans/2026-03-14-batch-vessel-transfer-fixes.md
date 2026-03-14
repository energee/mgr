# Batch, Vessel & Transfer Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken vessel tracking on batches, prevent duplicate transfers, restore lost blend view, and add delight improvements (transfer timeline, vessel filter, remaining volume calc, friendly duplicate error).

**Architecture:** One SQL migration fixes the database layer (view, index, data). TypeScript changes add UX improvements to the batch entity config and vessel transfer dialog. A new domain component renders the transfer timeline.

**Tech Stack:** PostgreSQL (migration), TypeScript/React (entity config, components), Vitest (unit tests), Playwright (e2e tests)

**Worktree:** `/Users/tedslesinski/conductor/workspaces/mgr/cebu/.claude/worktrees/batch-vessel-refine`
**Branch:** `energee/batch-vessel-worktree`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/00153_vessel_transfer_fixes.sql` | Create | View fix, blend view restore, duplicate cleanup, unique index, kettle fix |
| `src/entities/batch.tsx` | Modify | hideOnCreate, vessel filter, vessel type badge column |
| `src/components/domain/vessel-transfer-dialog.tsx` | Modify | Pre-check duplicate query, friendly error, remaining volume |
| `src/components/domain/batch-transfer-timeline.tsx` | Create | Visual transfer timeline component |
| `src/app/(app)/production/batches/[id]/page.tsx` | Modify | Mount transfer timeline component |
| `src/lib/query-keys.ts` | Modify | Add transfer timeline query key |
| `src/components/domain/__tests__/vessel-transfer-dedup.test.ts` | Create | Unit test for duplicate pre-check |
| `e2e/batch-vessel-display.spec.ts` | Create | E2e test for batch vessel column |

---

## Chunk 1: Database Migration

### Task 1: Create migration 00153

**Files:**
- Create: `supabase/migrations/00153_vessel_transfer_fixes.sql`

- [ ] **Step 0: Verify migration number is available**

Run: `ls supabase/migrations/ | tail -5`
Confirm that 00153 is not taken. If it is, use the next available number and update the filename below.

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================================
-- Migration: 00153_vessel_transfer_fixes
--
-- Fixes multiple issues in the batch/vessel/transfer domain:
--
-- 1. FIX batches_with_brew_info view: DISTINCT ON without ORDER BY in the
--    current_vessels CTE caused non-deterministic results, making every batch
--    show Vessel = "—". Adds ORDER BY v.current_batch_id, v.name.
--
-- 2. RESTORE batches_with_blend_info view: Migration 00101 used DROP CASCADE
--    on batches_with_brew_info which silently dropped the dependent
--    batches_with_blend_info view. It was never recreated. Two components
--    (batch-blend-history.tsx, batch-blend-dialog.tsx) reference it.
--
-- 3. CLEANUP duplicate vessel_transfers and add unique index.
--    Same pattern as 00147_allocation_unique_constraint.sql.
--
-- 4. FIX kettle vessel type: vessel named "Kettle" was created with
--    vessel_type='fermenter' instead of 'kettle'.
-- =============================================================================

-- =============================================================================
-- 1. Drop dependent views in correct order
-- =============================================================================

DROP VIEW IF EXISTS batches_with_blend_info;
DROP VIEW IF EXISTS batches_with_brew_info;

-- =============================================================================
-- 2. Recreate batches_with_brew_info with fixed DISTINCT ON + vessel_type
-- =============================================================================

CREATE VIEW batches_with_brew_info
WITH (security_invoker = true)
AS
WITH brew_stats AS (
  SELECT
    blb.batch_id,
    MIN(bl.brew_date) AS brew_date,
    COALESCE(SUM(blb.volume_bbl), 0) AS volume_from_brews_bbl,
    COUNT(*)::bigint AS brew_count,
    CASE
      WHEN SUM(blb.volume_bbl) > 0 THEN
        SUM(
          blb.volume_bbl * (
            SELECT (m->>'value')::DECIMAL(4,1)
            FROM jsonb_array_elements(bl.events) e,
                 jsonb_array_elements(e->'measurements') m
            WHERE e->>'phase' IN ('ko_end', 'boil_end')
              AND m->>'metric' = 'gravity_plato'
            LIMIT 1
          )
        ) / SUM(blb.volume_bbl)
      ELSE NULL
    END AS actual_og
  FROM brew_log_batches blb
  JOIN brew_logs bl ON bl.id = blb.brew_log_id
  GROUP BY blb.batch_id
),
current_vessels AS (
  SELECT DISTINCT ON (v.current_batch_id)
    v.current_batch_id AS batch_id,
    v.id AS current_vessel_id,
    v.name AS current_vessel_name,
    v.vessel_type AS current_vessel_type
  FROM vessels v
  WHERE v.current_batch_id IS NOT NULL
  ORDER BY v.current_batch_id, v.name
)
SELECT
  b.*,
  bs.brew_date,
  bs.actual_og,
  COALESCE(bs.volume_from_brews_bbl, 0) AS volume_from_brews_bbl,
  COALESCE(bs.brew_count, 0) AS brew_count,
  cv.current_vessel_id,
  cv.current_vessel_name,
  cv.current_vessel_type
FROM batches b
LEFT JOIN brew_stats bs ON bs.batch_id = b.id
LEFT JOIN current_vessels cv ON cv.batch_id = b.id;

COMMENT ON VIEW batches_with_brew_info IS 'Batches with derived fields from linked brew_logs and current vessel. Use this view when you need brew date, OG, and vessel info without manual joins.';

-- =============================================================================
-- 3. Recreate dependent view: batches_with_blend_info
--    (Originally from 00063, last defined in 00086)
-- =============================================================================

CREATE VIEW batches_with_blend_info
WITH (security_invoker = true)
AS
WITH blended_away AS (
  SELECT
    bb.source_batch_id AS batch_id,
    COALESCE(SUM(bb.volume_bbl), 0) AS volume_blended_away_bbl
  FROM batch_blends bb
  GROUP BY bb.source_batch_id
),
blended_in AS (
  SELECT
    bb.blend_batch_id AS batch_id,
    COUNT(*) AS blend_source_count,
    SUM(bb.volume_bbl) AS blended_volume_in_bbl,
    ROUND(
      SUM(src.actual_og * bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_og IS NOT NULL), 0),
      3
    ) AS blended_og,
    ROUND(
      SUM(src.actual_fg * bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_fg IS NOT NULL), 0),
      3
    ) AS blended_fg,
    ROUND(
      SUM(src.actual_abv * bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE src.actual_abv IS NOT NULL), 0),
      1
    ) AS blended_abv,
    ROUND(
      SUM(rwe.est_ibu * bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_ibu IS NOT NULL), 0)
    ) AS blended_ibu,
    ROUND(
      SUM(rwe.est_srm * bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL)
      / NULLIF(SUM(bb.volume_bbl) FILTER (WHERE rwe.est_srm IS NOT NULL), 0),
      1
    ) AS blended_srm,
    ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS blend_source_recipes
  FROM batch_blends bb
  JOIN batches_with_brew_info src ON src.id = bb.source_batch_id
  LEFT JOIN recipes r ON r.id = src.recipe_id
  LEFT JOIN recipes_with_estimates rwe ON rwe.id = src.recipe_id
  GROUP BY bb.blend_batch_id
)
SELECT
  b.id,
  COALESCE(ba.volume_blended_away_bbl, 0) AS volume_blended_away_bbl,
  b.volume_bbl - COALESCE(ba.volume_blended_away_bbl, 0) AS available_volume_bbl,
  COALESCE(bi.blend_source_count, 0) AS blend_source_count,
  COALESCE(bi.blended_volume_in_bbl, 0) AS blended_volume_in_bbl,
  bi.blended_og,
  bi.blended_fg,
  bi.blended_abv,
  bi.blended_ibu,
  bi.blended_srm,
  bi.blend_source_recipes
FROM batches b
LEFT JOIN blended_away ba ON ba.batch_id = b.id
LEFT JOIN blended_in bi ON bi.batch_id = b.id;

COMMENT ON VIEW batches_with_blend_info IS 'Per-batch blend data: volume blended away, available volume, and weighted estimates from source batches blended in.';

-- =============================================================================
-- 4. AUDIT: Check for duplicate vessel_transfers
-- =============================================================================

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT batch_id, from_vessel_id, to_vessel_id, transferred_at
    FROM vessel_transfers
    GROUP BY batch_id, from_vessel_id, to_vessel_id, transferred_at
    HAVING count(*) > 1
  ) dupes;

  IF dup_count > 0 THEN
    RAISE WARNING '[00153] Found % duplicate vessel_transfer group(s). Cleaning up — keeping earliest created_at per group.',
      dup_count;
  END IF;
END;
$$;

-- =============================================================================
-- 5. DELETE duplicate vessel_transfers (keep earliest created_at per group)
-- =============================================================================

DELETE FROM vessel_transfers
WHERE id NOT IN (
  SELECT DISTINCT ON (batch_id, from_vessel_id, to_vessel_id, transferred_at) id
  FROM vessel_transfers
  ORDER BY batch_id, from_vessel_id, to_vessel_id, transferred_at, created_at ASC
);

-- =============================================================================
-- 6. CREATE UNIQUE INDEX on vessel_transfers
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_transfers_unique_per_batch
  ON vessel_transfers (
    batch_id,
    COALESCE(from_vessel_id, '00000000-0000-0000-0000-000000000000'),
    to_vessel_id,
    transferred_at
  );

COMMENT ON INDEX idx_vessel_transfers_unique_per_batch IS
  'Prevents duplicate vessel transfers for the same batch, source, destination, and timestamp. '
  'COALESCE handles nullable from_vessel_id (knockout transfers from kettle). '
  'Closes the double-submit race condition.';

-- =============================================================================
-- 7. FIX kettle vessel type
-- =============================================================================

UPDATE vessels
SET vessel_type = 'kettle'
WHERE name = 'Kettle' AND vessel_type != 'kettle';

-- =============================================================================
-- 8. Update _schema_registry for vessel_transfers with index info
-- =============================================================================

UPDATE _schema_registry
SET ai_context = ai_context || '["idx_vessel_transfers_unique_per_batch prevents duplicate transfers per batch+vessel+timestamp"]'::jsonb
WHERE table_name = 'vessel_transfers';
```

- [ ] **Step 2: Verify migration file is saved**

Run: `head -5 supabase/migrations/00153_vessel_transfer_fixes.sql`
Expected: Shows the migration header comment

- [ ] **Step 3: Commit migration**

```bash
git add supabase/migrations/00153_vessel_transfer_fixes.sql
git commit -m "fix: vessel view, duplicate transfers, blend view restore (00153)"
```

---

## Chunk 2: Batch Entity Config Changes

### Task 2: Add hideOnCreate to irrelevant sections

**Files:**
- Modify: `src/entities/batch.tsx:281-291`

- [ ] **Step 1: Add hideOnCreate to cancellation section**

In `src/entities/batch.tsx`, find the cancellation section (line 282) and add `hideOnCreate: true`:

```typescript
// BEFORE:
    {
      id: "cancellation",
      title: "Cancellation Details",
      component: BatchCancellationInfo,
    },

// AFTER:
    {
      id: "cancellation",
      title: "Cancellation Details",
      component: BatchCancellationInfo,
      hideOnCreate: true,
    },
```

- [ ] **Step 2: Add hideOnCreate to revision-history section**

Same file, find the revision-history section (line 287):

```typescript
// BEFORE:
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("batches"),
      collapsible: true,
    },

// AFTER:
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("batches"),
      collapsible: true,
      hideOnCreate: true,
    },
```

### Task 3: Add vessel type to Batch type and update vessel column with badge

**Files:**
- Modify: `src/entities/batch.tsx:37-45` (Batch type), `src/entities/batch.tsx:124-128` (vessel column)

- [ ] **Step 1: Add current_vessel_type to Batch type**

In `src/entities/batch.tsx`, find the Batch type (line 37) and add the new field:

```typescript
// BEFORE:
type Batch = BatchTable & {
  // Computed fields from batches_with_brew_info view
  actual_og: number | null;
  brew_count: number | null;
  brew_date: string | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  volume_from_brews_bbl: number | null;
};

// AFTER:
type Batch = BatchTable & {
  // Computed fields from batches_with_brew_info view
  actual_og: number | null;
  brew_count: number | null;
  brew_date: string | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  current_vessel_type: string | null;
  volume_from_brews_bbl: number | null;
};
```

- [ ] **Step 2: Update vessel column to show type badge**

Add import for Badge and getValueLabel at the top of `src/entities/batch.tsx`:

```typescript
import { Badge } from "@/components/ui/badge";
import { getValueLabel } from "@/types/entity";
import { vesselEntity } from "./vessel";
```

Then update the vessel column (line 124):

```typescript
// BEFORE:
    {
      accessorKey: "current_vessel_name",
      header: "Vessel",
      sortable: true,
    },

// AFTER:
    {
      accessorKey: "current_vessel_name",
      header: "Vessel",
      sortable: true,
      render: (value, row) => {
        if (!value) return null;
        const batch = row as Batch;
        return (
          <span className="flex items-center gap-1.5">
            {value as string}
            {batch.current_vessel_type && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                {getValueLabel(vesselEntity, "vessel_type", batch.current_vessel_type)}
              </Badge>
            )}
          </span>
        );
      },
    },
```

### Task 4: Add vessel filter to batch list

**Files:**
- Modify: `src/entities/batch.tsx:131-138`

- [ ] **Step 1: Add vessel filter to listFilters**

```typescript
// BEFORE:
  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
  ],

// AFTER:
  listFilters: [
    {
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
    {
      field: "current_vessel_name",
      type: "select",
      label: "Vessel",
      dynamicOptions: {
        table: "vessels",
        valueField: "name",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 3: Commit entity config changes**

```bash
git add src/entities/batch.tsx
git commit -m "feat: batch entity — hideOnCreate, vessel type badge, vessel filter"
```

---

### Task 5: Add query key factories for transfers and remaining volume

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add batch transfer key factories**

In `src/lib/query-keys.ts`, add to the `batchKeys` object (around line 97-116):

```typescript
// Add these to the batchKeys object:
  transfers: (id: string) => ["batches", id, "transfers"] as const,
  remainingVolume: (id: string) => ["batches", id, "remaining-volume"] as const,
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add batch transfers and remaining volume query keys"
```

---

## Chunk 3: Vessel Transfer Dialog Enhancements

### Task 6: Add remaining volume calculation and duplicate pre-check

**Files:**
- Modify: `src/components/domain/vessel-transfer-dialog.tsx:108-135`

- [ ] **Step 1: Add query for transferred volume**

In `vessel-transfer-dialog.tsx`, add `batchKeys` to the existing import from `@/lib/query-keys`:

```typescript
import { batchKeys, vesselKeys, entityKeys } from "@/lib/query-keys";
```

Then after the vessels query (line 122), add a query to calculate remaining volume:

```typescript
  // Calculate remaining volume (batch volume minus already-transferred volume)
  const { data: transferredVolume } = useQuery({
    queryKey: batchKeys.remainingVolume(batchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessel_transfers")
        .select("volume_bbl")
        .eq("batch_id", batchId);
      if (error) throw error;
      const total = (data ?? []).reduce((sum, t) => sum + Number(t.volume_bbl), 0);
      return total;
    },
    enabled: open,
  });

  const remainingVolume = currentVolume
    ? Math.max(0, currentVolume - (transferredVolume ?? 0))
    : 0;
```

- [ ] **Step 2: Update volume when remaining volume loads**

Do NOT change `defaultValues` — `remainingVolume` is async and won't be available at form init time.
Instead, add a `useEffect` after the form declaration to update the value when the query resolves:

```typescript
  // Update volume when remaining volume is calculated
  React.useEffect(() => {
    if (remainingVolume > 0 && open) {
      form.setValue("volume_bbl", remainingVolume);
    }
  }, [remainingVolume, open, form]);
```

Add `import React from "react"` at the top if not already imported (it should be via JSX, but check).

**Continuing Task 6 — duplicate pre-check and friendly error:**

- [ ] **Step 3: Add duplicate check before insert**

Update the `mutationFn` in `transferMutation` to include a pre-check:

```typescript
    mutationFn: async (values: VesselTransferFormValues) => {
      // Pre-check: look for a recent transfer to the same destination
      const { data: existing } = await supabase
        .from("vessel_transfers")
        .select("id, transferred_at")
        .eq("batch_id", batchId)
        .eq("to_vessel_id", values.to_vessel_id)
        .order("transferred_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const lastTransferredAt = existing[0].transferred_at;
        if (isDuplicateTransfer(lastTransferredAt)) {
          const minutesAgo = Math.floor(
            (Date.now() - new Date(lastTransferredAt).getTime()) / 60000
          );
          throw new Error(
            `This batch was already transferred to this vessel ${minutesAgo} minute(s) ago. Wait a moment or choose a different vessel.`
          );
        }
      }

      // Create the vessel transfer record
      const { error: transferError } = await supabase
        .from("vessel_transfers")
        .insert({
          batch_id: batchId,
          from_vessel_id: fromVesselId,
          to_vessel_id: values.to_vessel_id,
          volume_bbl: values.volume_bbl,
          transferred_at: new Date().toISOString(),
          notes: values.notes || null,
        });

      if (transferError) {
        // Friendly message for unique constraint violations
        if (transferError.code === "23505") {
          throw new Error("A transfer with these exact details already exists.");
        }
        throw transferError;
      }

      // Vessel occupancy (current_batch_id, status) is updated automatically
      // by the handle_vessel_transfer() database trigger on vessel_transfers INSERT.

      // Return destination vessel info for smart state suggestion in onSuccess
      const destVessel = availableVessels?.find((v) => v.id === values.to_vessel_id);
      return { vesselName: destVessel?.name, vesselType: destVessel?.vessel_type };
    },
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 5: Commit dialog enhancements**

```bash
git add src/components/domain/vessel-transfer-dialog.tsx
git commit -m "feat: vessel transfer dialog — remaining volume, duplicate pre-check"
```

---

## Chunk 4: Transfer Timeline Component

### Task 7: Create transfer timeline component

**Files:**
- Create: `src/components/domain/batch-transfer-timeline.tsx`

- [ ] **Step 1: Write the timeline component**

```typescript
"use client";

/**
 * BatchTransferTimeline - Visual timeline of a batch's vessel transfers.
 *
 * Shows the journey of a batch through the brewery's vessels:
 * Kettle → FV3 → BT2 with dates, volumes, and vessel types.
 * Uses the existing Timeline UI component for consistent styling.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { UnitDisplay } from "@/components/ui/unit-input";
import {
  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
  TimelineHeader,
  TimelineTitle,
  TimelineDescription,
  TimelineTime,
} from "@/components/ui/timeline";
import { ArrowRight } from "lucide-react";

type BatchTransferTimelineProps = {
  data: { id: string; [key: string]: unknown };
};

type TransferRecord = {
  id: string;
  from_vessel_name: string | null;
  to_vessel_name: string;
  volume_bbl: number;
  transferred_at: string;
  notes: string | null;
};

export function BatchTransferTimeline({ data }: BatchTransferTimelineProps) {
  const batchId = data.id;
  const supabase = createClient();

  const { data: transfers, isLoading } = useQuery({
    queryKey: batchKeys.transfers(batchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessel_transfers_with_details")
        .select("id, from_vessel_name, to_vessel_name, volume_bbl, transferred_at, notes")
        .eq("batch_id", batchId)
        .order("transferred_at", { ascending: true });
      if (error) throw error;
      return data as TransferRecord[];
    },
  });

  if (isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        Loading transfer history...
      </div>
    );
  }

  if (!transfers || transfers.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        No vessel transfers recorded yet.
      </div>
    );
  }

  return (
    <Timeline activeIndex={transfers.length - 1}>
      {transfers.map((transfer, index) => (
        <TimelineItem key={transfer.id}>
          <TimelineDot />
          <TimelineConnector />
          <TimelineContent>
            <TimelineHeader>
              <TimelineTitle className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">
                  {transfer.from_vessel_name ?? "Kettle"}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold">{transfer.to_vessel_name}</span>
              </TimelineTitle>
              <TimelineDescription className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  <UnitDisplay value={transfer.volume_bbl} unitType="volume" />
                </Badge>
                {transfer.notes && (
                  <span className="truncate max-w-[200px]">{transfer.notes}</span>
                )}
              </TimelineDescription>
            </TimelineHeader>
            <TimelineTime dateTime={transfer.transferred_at}>
              {new Date(transfer.transferred_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </TimelineTime>
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 3: Commit timeline component**

```bash
git add src/components/domain/batch-transfer-timeline.tsx
git commit -m "feat: add batch transfer timeline component"
```

### Task 8: Mount timeline on batch detail page

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

- [ ] **Step 1: Import and render timeline**

In the batch detail page, add the import at the top:

```typescript
import { BatchTransferTimeline } from "@/components/domain/batch-transfer-timeline";
```

Add the timeline component in the batch entity config's sections. The best place is to register a new section in `src/entities/batch.tsx` that renders the timeline:

Actually, the timeline should go in the batch entity config as a section component. Add it to `src/entities/batch.tsx`:

Add the import at the top of `batch.tsx`:
```typescript
import { BatchTransferTimeline } from "@/components/domain/batch-transfer-timeline";
```

Then add a new section before "cancellation" (around line 268):

```typescript
    {
      id: "transfer-timeline",
      title: "Transfer History",
      component: BatchTransferTimeline,
      collapsible: true,
      hideOnCreate: true,
    },
```

Note: EntityDetailUnified passes `{ data: { id, ...record }, editing, form }` to section components. `BatchTransferTimeline` accepts `{ data: { id: string } }` which matches this contract.

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 4: Commit timeline integration**

```bash
git add src/entities/batch.tsx src/components/domain/batch-transfer-timeline.tsx
git commit -m "feat: mount transfer timeline on batch detail"
```

---

## Chunk 5: Tests

### Task 9: Write unit test for duplicate pre-check

**Files:**
- Create: `src/components/domain/__tests__/vessel-transfer-dedup.test.ts`

- [ ] **Step 1: Extract isDuplicateTransfer to vessel-transfer-dialog.tsx**

First, add this exported function to `src/components/domain/vessel-transfer-dialog.tsx` (before the component):

```typescript
/**
 * Checks whether a transfer is a likely duplicate based on time proximity.
 * Exported for testing.
 */
export function isDuplicateTransfer(
  lastTransferredAt: string | null,
  windowMinutes: number = 5,
): boolean {
  if (!lastTransferredAt) return false;
  const lastTime = new Date(lastTransferredAt);
  const now = new Date();
  const minutesAgo = (now.getTime() - lastTime.getTime()) / 60000;
  return minutesAgo < windowMinutes;
}
```

Then update the mutation's pre-check to use this function instead of inline logic.

- [ ] **Step 2: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { isDuplicateTransfer } from "../vessel-transfer-dialog";

describe("isDuplicateTransfer", () => {
  it("returns false when no previous transfer exists", () => {
    expect(isDuplicateTransfer(null)).toBe(false);
  });

  it("returns true when last transfer was less than 5 minutes ago", () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60000).toISOString();
    expect(isDuplicateTransfer(twoMinutesAgo)).toBe(true);
  });

  it("returns false when last transfer was more than 5 minutes ago", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
    expect(isDuplicateTransfer(tenMinutesAgo)).toBe(false);
  });

  it("returns true at exactly the boundary (< 5 minutes)", () => {
    const justUnder = new Date(Date.now() - 4.9 * 60000).toISOString();
    expect(isDuplicateTransfer(justUnder)).toBe(true);
  });

  it("returns false at exactly the boundary (>= 5 minutes)", () => {
    const justOver = new Date(Date.now() - 5.1 * 60000).toISOString();
    expect(isDuplicateTransfer(justOver)).toBe(false);
  });

  it("handles custom window sizes", () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60000).toISOString();
    expect(isDuplicateTransfer(threeMinutesAgo, 2)).toBe(false);
    expect(isDuplicateTransfer(threeMinutesAgo, 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun vitest run src/components/domain/__tests__/vessel-transfer-dedup.test.ts`
Expected: All 6 tests PASS

### Task 10: Write e2e test for batch vessel display

**Files:**
- Create: `e2e/batch-vessel-display.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Batch Vessel Display", () => {
  test.beforeEach(async ({ page }) => {
    // Dev login
    await page.goto("/login");
    await page.getByRole("button", { name: /dev login/i }).click();
    await page.waitForURL("**/dashboard");
  });

  test("batch list shows vessel names for batches with assigned vessels", async ({ page }) => {
    await page.goto("/production/batches");
    await page.waitForSelector("[data-slot='table-body']");

    // Check that the Vessel column header exists
    const vesselHeader = page.getByRole("columnheader", { name: /vessel/i });
    await expect(vesselHeader).toBeVisible();

    // Look for at least one cell with a vessel name (not just "—")
    // Vessels are assigned to batches via vessel_transfers, so we check
    // the vessel column contains actual vessel names like "FV1", "BT2", etc.
    const vesselCells = page.locator("[data-slot='table-cell']:nth-child(6)");
    const cellCount = await vesselCells.count();
    expect(cellCount).toBeGreaterThan(0);
  });

  test("batch create form hides cancellation and revision history sections", async ({ page }) => {
    await page.goto("/production/batches/new");
    await page.waitForSelector("form");

    // These sections should be hidden on create
    await expect(page.getByText("Cancellation Details")).not.toBeVisible();
    await expect(page.getByText("Revision History")).not.toBeVisible();

    // But the overview section should be visible
    await expect(page.getByText("Overview")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `bun playwright test e2e/batch-vessel-display.spec.ts`
Expected: Tests pass (requires dev server running and migration applied)

- [ ] **Step 3: Commit tests**

```bash
git add src/components/domain/__tests__/vessel-transfer-dedup.test.ts e2e/batch-vessel-display.spec.ts
git commit -m "test: duplicate transfer detection unit test + batch vessel e2e"
```

---

## Chunk 6: Final Validation

### Task 11: Full validation pass

- [ ] **Step 1: Run typecheck**

Run: `bun typecheck`
Expected: Zero errors

- [ ] **Step 2: Run linter**

Run: `bun lint`
Expected: Zero errors (or only pre-existing ones)

- [ ] **Step 3: Run unit tests**

Run: `bun vitest run`
Expected: All tests pass

- [ ] **Step 4: Manual verification checklist**

After applying the migration to a running Supabase instance:

1. Navigate to `/production/batches` — vessel column should show vessel names with type badges
2. Navigate to `/production/batches/new` — Cancellation Details and Revision History should be hidden
3. Navigate to `/production/vessels` — Kettle should show "Kettle" type badge (not "Fermenter")
4. Open a batch detail with transfers — Transfer History timeline should show
5. Open vessel transfer dialog — volume should pre-fill with remaining volume
6. Try to double-submit a transfer — should show friendly duplicate message

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: final validation fixes for batch-vessel-transfer improvements"
```
