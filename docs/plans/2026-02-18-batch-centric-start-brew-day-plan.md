# Batch-Centric Start Brew Day Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Start Brew Day so the batch is always known — remove recipe-centric flow, simplify dialog to single-step confirmation, add row action on batches list.

**Architecture:** The dialog is rewritten to accept batch props directly. Entry points shift from recipe→brew to batch→brew. The batches list page and batch detail page are the only two places to start a brew day.

**Tech Stack:** React, TypeScript, Supabase, Tanstack Query, Radix UI, Zod

---

### Task 1: Rewrite StartBrewDayDialog as single-step confirmation

**Files:**
- Modify: `src/components/domain/start-brew-day-dialog.tsx` (full rewrite)

**Context:** The current dialog is a 4-step wizard (recipe select → confirm → splits → review) with ~980 lines. It creates batches inline. The new dialog is a simple confirmation: show batch info, let user set brew date/number, create brew log + junction record. The batch already exists.

**Step 1: Rewrite the dialog**

Replace the entire file with:

```typescript
"use client";

/**
 * StartBrewDayDialog - Single-step confirmation for starting a brew day
 *
 * Accepts a pre-selected batch and creates a brew log linked to it.
 * The batch must already exist (planned status). Recipe info is derived
 * from the batch, not selected in this dialog.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys, entityKeys, batchKeys, userKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

interface StartBrewDayDialogProps {
  batchId: string;
  batchNumber: string;
  batchName: string | null;
  recipeName: string | null;
  volumeBbl: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (brewLogId: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function generateBrewNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(year, 0, 0).getTime()) / 86400000
  );
  return `BRW-${year}-${String(dayOfYear).padStart(3, "0")}`;
}

// =============================================================================
// Component
// =============================================================================

export function StartBrewDayDialog({
  batchId,
  batchNumber,
  batchName,
  recipeName,
  volumeBbl,
  open,
  onOpenChange,
  onSuccess,
}: StartBrewDayDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [brewDate, setBrewDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [brewNumber, setBrewNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch current user for brewer default
  const { data: currentUser } = useQuery({
    queryKey: userKeys.current(),
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
    enabled: open,
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setBrewDate(new Date().toISOString().split("T")[0]);
      setBrewNumber(generateBrewNumber());
    }
  }, [open]);

  const isValid = brewNumber.trim().length > 0 && brewDate.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);

    try {
      // 1. Create brew log
      const { data: brewLog, error: brewLogError } = await supabase
        .from("brew_logs")
        .insert({
          brew_number: brewNumber.trim(),
          brew_date: brewDate,
          brewer_id: currentUser?.id ?? null,
          status: "draft",
        })
        .select("id")
        .single();

      if (brewLogError) throw brewLogError;
      const brewLogId = brewLog.id as string;

      // 2. Link brew log to batch
      const { error: junctionError } = await supabase
        .from("brew_log_batches")
        .insert({
          brew_log_id: brewLogId,
          batch_id: batchId,
          volume_bbl: volumeBbl ?? 0,
        });

      if (junctionError) throw junctionError;

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: brewLogKeys.all() });
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("brew_logs") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });

      toast.success(`Brew day started for ${batchNumber}`);
      onOpenChange(false);
      onSuccess(brewLogId);
    } catch (error) {
      console.error("Start brew day error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to start brew day";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Start Brew Day
          </DialogTitle>
          <DialogDescription>
            Create a brew log for this batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Batch info (read-only) */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Batch</span>
              <span className="font-medium">{batchNumber}</span>
            </div>
            {batchName && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span>{batchName}</span>
              </div>
            )}
            {recipeName && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Recipe</span>
                <span>{recipeName}</span>
              </div>
            )}
            {volumeBbl != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Volume</span>
                <span>
                  <UnitDisplay value={volumeBbl} unitType="volume" />
                </span>
              </div>
            )}
          </div>

          {/* Brew date */}
          <div className="space-y-2">
            <Label htmlFor="brew-date">Brew Date</Label>
            <Input
              id="brew-date"
              type="date"
              value={brewDate}
              onChange={(e) => setBrewDate(e.target.value)}
            />
          </div>

          {/* Brew number */}
          <div className="space-y-2">
            <Label htmlFor="brew-number">Brew Number</Label>
            <Input
              id="brew-number"
              type="text"
              value={brewNumber}
              onChange={(e) => setBrewNumber(e.target.value)}
              placeholder="e.g., BRW-2024-001"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !isValid}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Brew Day
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Clean (no errors)

**Step 3: Commit**

```bash
git add src/components/domain/start-brew-day-dialog.tsx
git commit -m "refactor: rewrite StartBrewDayDialog as single-step batch confirmation"
```

---

### Task 2: Add `start_brew_day` action to batch entity config

**Files:**
- Modify: `src/entities/batch.tsx:459` (actions array)

**Context:** The batch entity config defines actions that appear as row-level buttons/dropdowns in the list and detail views. Actions with `fromStates` only show when the record is in that state. The `start_brew_day` action should appear for `planned` batches only and does NOT trigger a state transition (it opens a dialog instead).

**Step 1: Add the action**

In `src/entities/batch.tsx`, add this entry at the **beginning** of the `actions` array (before `start_fermentation`):

```typescript
    {
      name: "start_brew_day",
      label: "Start Brew Day",
      icon: "play",
      type: "button",
      fromStates: ["planned"],
    },
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Clean

**Step 3: Commit**

```bash
git add src/entities/batch.tsx
git commit -m "feat: add start_brew_day action to batch entity config"
```

---

### Task 3: Remove `start_brew_day` action from recipe entity config and recipe detail page

**Files:**
- Modify: `src/entities/recipe.tsx:786-792` (remove start_brew_day action)
- Modify: `src/app/(app)/production/recipes/[id]/page.tsx` (remove dialog and handler)

**Context:** The recipe detail page currently has a "Start Brew Day" action that opens StartBrewDayDialog with a recipeId. This entire flow is being removed — brew days start from batches, not recipes.

**Step 1: Remove the action from recipe entity config**

In `src/entities/recipe.tsx`, remove lines 786-792 (the `start_brew_day` action object):

```typescript
    // DELETE THIS ENTIRE BLOCK:
    {
      name: "start_brew_day",
      label: "Start Brew Day",
      icon: "play",
      type: "button",
      fromStates: ["complete"],
    },
```

**Step 2: Clean up recipe detail page**

In `src/app/(app)/production/recipes/[id]/page.tsx`:

1. Remove the `StartBrewDayDialog` import (line 9)
2. Remove the `showBrewDay` state (line 21)
3. Remove the `start_brew_day` case from `handleAction` (lines 40-43)
4. Remove the `StartBrewDayDialog` JSX block (lines 67-76)

The resulting file should look like:

```typescript
"use client";

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { RecipeCloneDialog } from "@/components/domain/recipe-clone-dialog";
import { recipeEntity } from "@/entities/recipe";
import { recipeKeys } from "@/lib/query-keys";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const supabase = createClient();

  // Fetch recipe name for clone dialog
  const { data: recipe } = useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("name")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Handle custom actions
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "clone") {
      setCloneDialogOpen(true);
      return true;
    }
    return false;
  }, []);

  // Navigate to new recipe after successful clone
  const handleCloneSuccess = (newRecipeId: string) => {
    router.push(`/production/recipes/${newRecipeId}`);
  };

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        entity={recipeEntity}
        id={id}
        basePath="/production/recipes"
        onAction={handleAction}
      />

      {recipe && (
        <RecipeCloneDialog
          recipeId={id}
          recipeName={recipe.name}
          open={cloneDialogOpen}
          onOpenChange={setCloneDialogOpen}
          onSuccess={handleCloneSuccess}
        />
      )}
    </>
  );
}
```

**Step 3: Verify types compile**

Run: `bun typecheck`
Expected: Clean

**Step 4: Commit**

```bash
git add src/entities/recipe.tsx src/app/\(app\)/production/recipes/\[id\]/page.tsx
git commit -m "feat: remove start_brew_day action from recipe entity and detail page"
```

---

### Task 4: Update batches list page to handle `start_brew_day` action

**Files:**
- Modify: `src/app/(app)/production/batches/page.tsx`

**Context:** The batches list page already has an `onAction` handler for `cancel`/`archive`. We need to add handling for `start_brew_day` — when clicked on a row, it opens StartBrewDayDialog with that batch's data. The row record from `batches_with_brew_info` has `id`, `batch_number`, `name`, `status`, `volume_bbl` but NOT `recipe_name`. We'll need to fetch recipe name inside the dialog or pass `null` (the dialog handles null gracefully). Since the batch record has `recipe_id`, we can query the name when the action fires. However, the simplest approach: the entity list passes the full row record which includes `recipe_id`, and we do a quick fetch. Actually even simpler — the `batches_with_brew_info` view has `recipe_name` in it. Let me verify...

Actually, `batches_with_brew_info` does NOT include `recipe_name`. The simplest approach: pass `recipeName: null` to the dialog. The batch number and name are sufficient context — the user knows what recipe they planned.

**Step 1: Update the page**

Replace the entire `src/app/(app)/production/batches/page.tsx` with:

```typescript
"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * Includes custom action handling for cancel/archive dialogs and
 * start brew day dialog.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";
import { batchKeys } from "@/lib/query-keys";
import { BatchCancellationDialog } from "@/components/domain/batch-cancellation-dialog";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";

interface BatchRecord {
  id: string;
  batch_number: string;
  name: string | null;
  status: string | null;
  volume_bbl: number | null;
  current_vessel_name: string | null;
}

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);

  // Custom action handler for batch-specific actions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleAction = useCallback((actionName: string, record: any) => {
    if (actionName === "cancel" || actionName === "archive") {
      setSelectedBatch(record as BatchRecord);
      setShowTerminationDialog(true);
      return true;
    }
    if (actionName === "start_brew_day") {
      setSelectedBatch(record as BatchRecord);
      setShowStartBrewDay(true);
      return true;
    }
    return false;
  }, []);

  const handleDialogSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  }, [queryClient]);

  return (
    <>
      <EntityList
        entity={batchEntity}
        basePath="/production/batches"
        onAction={handleAction}
      />

      {selectedBatch && (
        <>
          <BatchCancellationDialog
            batchId={selectedBatch.id}
            batchNumber={selectedBatch.batch_number}
            batchName={selectedBatch.name}
            currentStatus={selectedBatch.status}
            currentVolume={selectedBatch.volume_bbl}
            vesselName={selectedBatch.current_vessel_name}
            open={showTerminationDialog}
            onOpenChange={setShowTerminationDialog}
            onSuccess={handleDialogSuccess}
          />

          <StartBrewDayDialog
            batchId={selectedBatch.id}
            batchNumber={selectedBatch.batch_number}
            batchName={selectedBatch.name}
            recipeName={null}
            volumeBbl={selectedBatch.volume_bbl}
            open={showStartBrewDay}
            onOpenChange={setShowStartBrewDay}
            onSuccess={(brewLogId) => {
              handleDialogSuccess();
              router.push(`/production/brew-logs/${brewLogId}`);
            }}
          />
        </>
      )}
    </>
  );
}
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/\(app\)/production/batches/page.tsx
git commit -m "feat: add start_brew_day action handler to batches list page"
```

---

### Task 5: Update batch detail page to use new dialog props

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

**Context:** The batch detail page currently passes `recipeId`, `recipeName`, `existingBatchId`, `existingBatchVolume` to StartBrewDayDialog (old props). It also has a separate recipe query just for the dialog. Update to the new simplified props and remove the recipe query.

**Step 1: Update the dialog usage and remove recipe query**

In `src/app/(app)/production/batches/[id]/page.tsx`:

1. Remove the recipe query (lines 85-99 — the `useQuery` that fetches recipe by `batch.recipe_id`)
2. Remove `recipeKeys` from the import on line 23
3. Update the breadcrumb `useMemo` to not depend on the removed `recipe` variable — instead fetch recipe name from the batch's linked data (or simplify the breadcrumb to just show batch number)
4. Replace the `StartBrewDayDialog` usage (lines 239-254) with the new props:

Old:
```typescript
      {recipe && (
        <StartBrewDayDialog
          recipeId={recipe.id}
          recipeName={recipe.name}
          existingBatchId={id}
          existingBatchVolume={batch?.volume_bbl ?? undefined}
          open={showStartBrewDay}
          onOpenChange={setShowStartBrewDay}
          onSuccess={(brewLogId) => {
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogLinks(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
            router.push(`/production/brew-logs/${brewLogId}`);
          }}
        />
      )}
```

New:
```typescript
      {batch && (
        <StartBrewDayDialog
          batchId={batch.id}
          batchNumber={batch.batch_number}
          batchName={batch.name}
          recipeName={recipe?.name ?? null}
          volumeBbl={batch.volume_bbl}
          open={showStartBrewDay}
          onOpenChange={setShowStartBrewDay}
          onSuccess={(brewLogId) => {
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogLinks(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
            queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
            router.push(`/production/brew-logs/${brewLogId}`);
          }}
        />
      )}
```

Note: Keep the recipe query on this page — it's still used for the breadcrumb. Just update the dialog props.

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/\(app\)/production/batches/\[id\]/page.tsx
git commit -m "feat: update batch detail page to use new StartBrewDayDialog props"
```

---

### Task 6: Remove Start Brew Day from brew logs list page

**Files:**
- Modify: `src/app/(app)/production/brew-logs/page.tsx`

**Context:** The brew logs list page currently has a "Start Brew Day" button that opens StartBrewDayDialog without a pre-selected recipe. This entry point is being removed — brew days start from batches.

**Step 1: Simplify the page**

Replace the entire file with:

```typescript
"use client";

/**
 * Brew Logs List Page
 *
 * Displays all brew logs using the universal EntityList component.
 * Brew days are started from the Batches page, not from here.
 */

import { EntityList } from "@/components/universal/entity-list";
import { brewLogEntity } from "@/entities/brew-log";

export default function BrewLogsPage() {
  return (
    <EntityList
      entity={brewLogEntity}
      basePath="/production/brew-logs"
    />
  );
}
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/\(app\)/production/brew-logs/page.tsx
git commit -m "feat: remove Start Brew Day button from brew logs list page"
```

---

### Task 7: Final validation

**Step 1: Run lint**

Run: `bun lint`
Expected: Clean

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: Clean

**Step 3: Run tests**

Run: `bun vitest run`
Expected: All 254 tests pass

**Step 4: Verify no stale references**

Search for any remaining references to the old dialog props:

```bash
grep -r "recipeId.*recipeName\|existingBatchId\|existingBatchVolume" src/ --include="*.tsx" --include="*.ts"
```

Expected: No matches (or only in unrelated files)

**Step 5: Commit any lint fixes if needed**
