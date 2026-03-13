# Batch-Centric Brew Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `recipe_id` from `brew_logs` and re-orient the entity around batches as the primary relationship.

**Architecture:** Drop `recipe_id` column from `brew_logs`. Create `brew_logs_with_batches` view to derive recipe/batch info from the `brew_log_batches` junction table. Update entity config to use `viewTable` for reads and show batch info instead of recipe. Update all components that reference `brew_logs.recipe_id`.

**Tech Stack:** PostgreSQL (migration), TypeScript/React (entity config + components), Supabase PostgREST

**Worktree:** `/Users/tedslesinski/Repos/mgr/.worktrees/brewlog`
**Branch:** `feature/brewlog`

---

### Task 1: Write the database migration

**Files:**
- Create: `supabase/migrations/00095_batch_centric_brew_logs.sql`

**Step 1: Write the migration**

```sql
-- Batch-Centric Brew Logs Migration
--
-- Removes recipe_id FK from brew_logs. Recipe is now derived from
-- linked batches via brew_log_batches junction table.
-- Brew logs are records of brewing batches, not recipes.

-- =============================================================================
-- Drop recipe_id from brew_logs
-- =============================================================================

-- Drop indexes first (some were created with different names in different migrations)
DROP INDEX IF EXISTS idx_brew_logs_recipe;
DROP INDEX IF EXISTS idx_brew_logs_recipe_id;

-- Drop the column (cascades FK constraint)
ALTER TABLE brew_logs DROP COLUMN recipe_id;

-- =============================================================================
-- Create brew_logs_with_batches view
-- =============================================================================
-- Enriches brew_logs with batch and recipe data derived from the junction table.
-- This is the primary view for list and detail pages.

CREATE OR REPLACE VIEW brew_logs_with_batches
WITH (security_invoker = true)
AS
SELECT
  bl.*,
  bs.recipe_id,
  bs.recipe_name,
  bs.batch_count,
  bs.batch_numbers
FROM brew_logs bl
LEFT JOIN LATERAL (
  SELECT
    (array_agg(b.recipe_id))[1] AS recipe_id,
    (array_agg(r.name))[1] AS recipe_name,
    COUNT(*)::int AS batch_count,
    string_agg(b.batch_number, ', ' ORDER BY b.batch_number) AS batch_numbers
  FROM brew_log_batches blb
  JOIN batches b ON b.id = blb.batch_id
  LEFT JOIN recipes r ON r.id = b.recipe_id
  WHERE blb.brew_log_id = bl.id
) bs ON true;

COMMENT ON VIEW brew_logs_with_batches IS 'Brew logs enriched with batch/recipe data derived from brew_log_batches junction. Recipe is derived from linked batches, not stored directly.';

-- =============================================================================
-- Update brew_log_metrics view
-- =============================================================================
-- Remove JOIN on recipes (recipe_id no longer on brew_logs).
-- Derive recipe info from batches instead.

DROP VIEW IF EXISTS brew_log_metrics CASCADE;
CREATE VIEW brew_log_metrics
WITH (security_invoker = true)
AS
SELECT
  bl.id,
  bl.brew_date,
  bl.status,
  bs.recipe_name,
  bs.batch_count,
  -- Extract OG from knockout event
  (
    SELECT (m->>'value')::DECIMAL(4,1)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' IN ('ko_end', 'boil_end')
      AND m->>'metric' = 'gravity_plato'
    LIMIT 1
  ) AS actual_og,
  -- Extract volume to fermenter from knockout event
  (
    SELECT (m->>'value')::DECIMAL(8,2)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'ko_end'
      AND m->>'metric' = 'volume_bbl'
    LIMIT 1
  ) AS volume_to_fermenter_bbl,
  -- Extract mash pH from mash_in event
  (
    SELECT (m->>'value')::DECIMAL(3,2)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'mash_in'
      AND m->>'metric' = 'ph'
    LIMIT 1
  ) AS actual_mash_ph,
  -- Extract pre-boil gravity from boil_start event
  (
    SELECT (m->>'value')::DECIMAL(4,1)
    FROM jsonb_array_elements(bl.events) e,
         jsonb_array_elements(e->'measurements') m
    WHERE e->>'phase' = 'boil_start'
      AND m->>'metric' = 'gravity_plato'
    LIMIT 1
  ) AS pre_boil_gravity,
  -- Total volume allocated to batches
  (
    SELECT COALESCE(SUM(blb.volume_bbl), 0)
    FROM brew_log_batches blb
    WHERE blb.brew_log_id = bl.id
  ) AS allocated_volume_bbl,
  -- Phases completed
  (
    SELECT jsonb_agg(e->>'phase')
    FROM jsonb_array_elements(bl.events) e
  ) AS phases_completed
FROM brew_logs bl
LEFT JOIN LATERAL (
  SELECT
    (array_agg(r.name))[1] AS recipe_name,
    COUNT(*)::int AS batch_count
  FROM brew_log_batches blb
  JOIN batches b ON b.id = blb.batch_id
  LEFT JOIN recipes r ON r.id = b.recipe_id
  WHERE blb.brew_log_id = bl.id
) bs ON true;

COMMENT ON VIEW brew_log_metrics IS 'Brew logs with calculated metrics extracted from events JSONB and batch data. Use this for list views and reports.';

-- =============================================================================
-- Update Schema Registry
-- =============================================================================

UPDATE _schema_registry
SET
  description = 'Brew day records (hot-side process). Events array captures timeline with measurements. Linked to batches via brew_log_batches. Recipe derived from linked batches.',
  relationships = '["belongs_to: auth.users (brewer)", "has_many: brew_log_batches"]',
  key_fields = '["brew_number", "brew_date", "status", "events"]'
WHERE table_name = 'brew_logs';
```

**Step 2: Verify migration syntax**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && cat supabase/migrations/00095_batch_centric_brew_logs.sql | head -5`
Expected: Shows the migration header.

**Step 3: Commit**

```bash
git add supabase/migrations/00095_batch_centric_brew_logs.sql
git commit -m "feat: migration to drop recipe_id from brew_logs, add batch-derived views"
```

---

### Task 2: Update entity config — remove recipe_id references

**Files:**
- Modify: `src/entities/brew-log.tsx`

**Step 1: Update the entity config**

Remove all `recipe_id` references from the entity config:

1. **Zod schema** (line 93): Remove `recipe_id: z.string().uuid().nullable().optional(),`

2. **Add `viewTable`** (after line 188): Add `viewTable: "brew_logs_with_batches",`

3. **List columns** (lines 220-227): Replace the `recipe_id` relation column with:
```typescript
    {
      accessorKey: "batch_numbers",
      header: "Batches",
    },
```

4. **Unified sections** (lines 310-316): Remove the `recipe_id` field block entirely. Move `brewer_id` and `status` up.

5. **Form fields** (lines 380-389): Remove the `recipe_id` field block entirely.

6. **Relations** (lines 456-462): Remove the `recipe` relation object entirely, keeping only `brewer`.

7. **keyFields** (line 482): Change to `["brew_number", "brew_date", "status"]`

8. **queryExamples** (line 478): Change `"Find brews for the Hazy IPA recipe"` to `"Find brews linked to batch B-20240115-01"`

9. **Module docstring** (lines 1-11): Update to reflect batch-centric model.

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`
Expected: May have type errors in components that still reference `recipe_id` — that's expected and will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/entities/brew-log.tsx
git commit -m "feat: update brew log entity config to batch-centric model"
```

---

### Task 3: Update brew-log-split-overview.tsx — derive recipe from batches

**Files:**
- Modify: `src/components/domain/brew-log-split-overview.tsx`

**Step 1: Update the component**

1. **Props interface** (lines 36-42): Remove `recipe_id` from the data shape:
```typescript
interface BrewLogSplitOverviewProps {
  data: {
    id: string;
    [key: string]: unknown;
  };
}
```

2. **LinkedBatch interface** (lines 44-56): Add `recipe_name` to the batch shape:
```typescript
interface LinkedBatch {
  id: string;
  volume_bbl: number;
  notes: string | null;
  batch: {
    id: string;
    batch_number: string;
    name: string;
    status: string;
    volume_bbl: number | null;
    current_vessel_name: string | null;
    recipe_name: string | null;
  } | null;
}
```

3. **Remove `RecipeSummary` interface** (lines 58-64): Delete entirely.

4. **Remove `recipeId` variable** (line 68): Delete `const recipeId = data.recipe_id;`

5. **Update batch query** (lines 72-97): Add `recipe_name` to the select on `batches_with_brew_info`:
```typescript
  const { data: linkedBatches, isLoading: batchesLoading } = useQuery({
    queryKey: brewLogKeys.batches(brewLogId),
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("brew_log_batches")
        .select(
          `
          id,
          volume_bbl,
          notes,
          batch:batches_with_brew_info!brew_log_batches_batch_id_fkey (
            id,
            batch_number,
            name,
            status,
            volume_bbl,
            current_vessel_name,
            recipe_name
          )
        `
        )
        .eq("brew_log_id", brewLogId);

      if (error) throw error;
      return (links ?? []) as unknown as LinkedBatch[];
    },
  });
```

6. **Remove recipe summary query** (lines 99-113): Delete the entire `useQuery` block for `recipeKeys.summary`.

7. **Remove `recipeKeys` import** (line 15): Change to `import { brewLogKeys } from "@/lib/query-keys";`

8. **Remove `Beer` and `ExternalLink` imports** (line 21): Remove `Beer` and `ExternalLink` from the lucide import (only if no longer used — check).

9. **Remove recipe reference JSX** (lines 152-177): Delete the entire `{recipe && (...)}` block. Optionally replace with a simpler recipe name display derived from the first batch:
```tsx
      {/* Recipe (derived from linked batches) */}
      {validBatches[0]?.batch?.recipe_name && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Beer className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{validBatches[0].batch.recipe_name}</span>
        </div>
      )}
```
(Keep `Beer` import if using this pattern, remove `ExternalLink`.)

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`
Expected: Clean or shows errors in other files (not this one).

**Step 3: Commit**

```bash
git add src/components/domain/brew-log-split-overview.tsx
git commit -m "feat: derive recipe from batches in brew log split overview"
```

---

### Task 4: Update brew log detail page — remove recipe query, fix breadcrumb

**Files:**
- Modify: `src/app/(app)/production/brew-logs/[id]/page.tsx`

**Step 1: Update the detail page**

1. **Remove `recipeKeys` import** (line 21): Change to:
```typescript
import { brewLogKeys, entityKeys } from "@/lib/query-keys";
```

2. **Remove `recipe_id` from brew log query** (line 41): Change select to:
```typescript
        .select("id, brew_number, status, events")
```

3. **Remove recipe query** (lines 49-62): Delete the entire `useQuery` block for `recipeKeys.detail`.

4. **Update linkedBatches query** (lines 65-78): Add recipe info to the batch select:
```typescript
  const { data: linkedBatches } = useQuery({
    queryKey: brewLogKeys.batches(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_log_batches")
        .select("batch_id, batch:batches(batch_number, recipe_id, recipe:recipes(name))")
        .eq("brew_log_id", id);
      if (error) throw error;
      return (data ?? []) as Array<{
        batch_id: string;
        batch: {
          batch_number: string;
          recipe_id: string | null;
          recipe: { name: string } | null;
        } | null;
      }>;
    },
  });
```

5. **Update breadcrumb** (lines 119-132): Derive recipe from first linked batch:
```typescript
  const breadcrumbSegments = useMemo(() => {
    const segments: { label: string; href?: string }[] = [];
    // Recipe derived from first linked batch
    const firstBatch = linkedBatches?.[0];
    if (firstBatch?.batch?.recipe) {
      segments.push({
        label: firstBatch.batch.recipe.name,
        href: `/production/recipes/${firstBatch.batch.recipe_id}`,
      });
    }
    segments.push({ label: brewLog?.brew_number ?? "Brew Log" });
    if (linkedBatches?.length === 1) {
      const b = linkedBatches[0];
      const batchNumber = b.batch?.batch_number ?? "Batch";
      segments.push({ label: batchNumber, href: `/production/batches/${b.batch_id}` });
    }
    return segments;
  }, [brewLog, linkedBatches]);
```

6. **Remove `recipe` from useMemo deps** (line 132): Already handled above.

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`
Expected: Clean or shows errors in remaining files.

**Step 3: Commit**

```bash
git add src/app/(app)/production/brew-logs/[id]/page.tsx
git commit -m "feat: derive recipe from batches in brew log detail page"
```

---

### Task 5: Update start-brew-day-dialog.tsx — remove recipe_id from brew log insert

**Files:**
- Modify: `src/components/domain/start-brew-day-dialog.tsx`

**Step 1: Remove recipe_id from brew log insert**

At line 376, remove `recipe_id: effectiveRecipeId,` from the brew log insert object. The insert becomes:
```typescript
      const { data: brewLog, error: brewLogError } = await db
        .from("brew_logs")
        .insert({
          brew_number: brewNumber.trim(),
          brew_date: brewDate,
          brewer_id: currentUser?.id ?? null,
          status: "draft",
        })
        .select("id")
        .single();
```

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`

**Step 3: Commit**

```bash
git add src/components/domain/start-brew-day-dialog.tsx
git commit -m "feat: remove recipe_id from brew log insert in start brew day dialog"
```

---

### Task 6: Update batch-brew-info.tsx — remove recipe join from brew log fetch

**Files:**
- Modify: `src/components/domain/batch-brew-info.tsx`

**Step 1: Remove nested recipe join**

At lines 57-63, update the select to remove `recipe:recipes(name)`:
```typescript
      const { data: links, error } = await supabase
        .from("brew_log_batches")
        .select(
          `
          id, volume_bbl, notes,
          brew_log:brew_logs(
            id, brew_number, brew_date, status, events, brewer_id
          )
        `
        )
        .eq("batch_id", data.id);
```

Also update the `BrewSummaryLink` interface (lines 32-46) to remove `recipe` from `brew_log`:
```typescript
interface BrewSummaryLink {
  id: string;
  volume_bbl: number;
  notes: string | null;
  brew_log: {
    id: string;
    brew_number: string;
    brew_date: string;
    status: string;
    events: unknown[] | null;
    brewer_id: string | null;
  };
  brewer_name: string | null;
}
```

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`

**Step 3: Commit**

```bash
git add src/components/domain/batch-brew-info.tsx
git commit -m "feat: remove recipe join from brew log fetch in batch brew info"
```

---

### Task 7: Update brew-log-linker.tsx — remove recipe join from brew log fetch

**Files:**
- Modify: `src/components/domain/brew-log-linker.tsx`

**Step 1: Remove nested recipe join from linked brew logs query**

At lines 82-95, update the select:
```typescript
      const { data, error } = await supabase
        .from("brew_log_batches")
        .select(`
          id,
          brew_log_id,
          batch_id,
          volume_bbl,
          notes,
          brew_log:brew_logs(
            id,
            brew_number,
            brew_date,
            status
          )
        `)
        .eq("batch_id", batchId);
```

At lines 103-108, update the available brew logs query to remove recipe join:
```typescript
      const { data, error } = await supabase
        .from("brew_logs")
        .select("id, brew_number, brew_date, status")
        .eq("status", "completed")
        .order("brew_date", { ascending: false })
        .limit(50);
```

Update the `BrewLog` interface (lines 43-51) to remove `recipe`:
```typescript
interface BrewLog {
  id: string;
  brew_number: string;
  brew_date: string;
  status: string;
}
```

Update the `LinkedBrewLog` interface (lines 53-60) — remove `recipe` from `brew_log`:
```typescript
interface LinkedBrewLog {
  id: string;
  brew_log_id: string;
  batch_id: string;
  volume_bbl: number;
  notes: string | null;
  brew_log: BrewLog;
}
```

Update the display text at line 222 to remove recipe reference:
```tsx
                      <SelectItem key={bl.id} value={bl.id}>
                        {bl.brew_number} (
                        {new Date(bl.brew_date).toLocaleDateString()})
                      </SelectItem>
```

Update the linked brew log display at line 292 to remove recipe reference:
```tsx
                    <div className="text-sm text-muted-foreground">
                      {new Date(link.brew_log.brew_date).toLocaleDateString()}
                    </div>
```

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`

**Step 3: Commit**

```bash
git add src/components/domain/brew-log-linker.tsx
git commit -m "feat: remove recipe join from brew log linker"
```

---

### Task 8: Update documentation

**Files:**
- Modify: `docs/data-model/brew-logs.md`

**Step 1: Update the data model doc**

Update the relationship diagram to remove the `recipes` arrow from `brew_logs`:
```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  brew_logs  │────────▶│ brew_log_batches │◀────────│   batches   │
│  (hot side) │   1:M   │   (allocation)   │   M:1   │ (cold side) │
└─────────────┘         └──────────────────┘         └─────────────┘
                                                            │
                                                            │ belongs to
                                                            ▼
                                                     ┌─────────────┐
                                                     │   recipes   │
                                                     └─────────────┘
```

Remove `recipe_id` from the `brew_logs` table column list. Add a note that recipe is derived from linked batches via the `brew_logs_with_batches` view.

**Step 2: Commit**

```bash
git add docs/data-model/brew-logs.md
git commit -m "docs: update brew logs data model to reflect batch-centric design"
```

---

### Task 9: Final validation

**Step 1: Run full typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun typecheck`
Expected: 0 errors

**Step 2: Run lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun lint`
Expected: 0 errors (or only pre-existing warnings)

**Step 3: Run tests**

Run: `cd /Users/tedslesinski/Repos/mgr/.worktrees/brewlog && bun vitest run`
Expected: All tests pass

**Step 4: If any failures, fix and re-run until clean**
