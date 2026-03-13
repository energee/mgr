# Universal Entity Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add universal delete/deactivate support to the entity system so any entity can opt in via its config, replacing the bespoke recipe delete implementation.

**Architecture:** Add a `deleteMode` field to `EntityActionDef`. Create a single `EntityDeleteDialog` component that handles both hard delete (`DELETE`) and soft delete (`SET is_active = false`). Wire automatic detection of `name: "delete"` actions into both `EntityDetailUnified` and `buildActionsColumn` so no page-level wiring is needed.

**Tech Stack:** React, Supabase client, TanStack Query, shadcn AlertDialog, Zod

---

### Task 1: Add `deleteMode` to EntityActionDef type

**Files:**
- Modify: `src/types/entity.ts` (EntityActionDef interface, around line 564-600)

**Step 1: Add the deleteMode field to EntityActionDef**

In `src/types/entity.ts`, add to the `EntityActionDef` interface:

```typescript
/** Delete mode: 'hard' issues DELETE, 'soft' sets is_active=false. Only used when name='delete'. */
deleteMode?: "hard" | "soft";
```

Add it after the `dialog?: string` field.

**Step 2: Commit**

```
feat: add deleteMode to EntityActionDef type
```

---

### Task 2: Create EntityDeleteDialog component

**Files:**
- Create: `src/components/universal/entity-delete-dialog.tsx`

**Step 1: Create the dialog component**

The dialog needs these props:
- `entity: EntityConfig<T>` — for table name and display name
- `recordId: string` — the record to delete
- `recordTitle: string` — display name shown in dialog (from detailHeader.title field)
- `deleteMode: "hard" | "soft"` — determines behavior
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `onSuccess: () => void`

Behavior:
- **Hard mode**: calls `supabase.from(entity.table).delete().eq('id', recordId)`. Dialog title: "Delete {displayName}?". Button: "Delete". Copy warns permanent.
- **Soft mode**: calls `supabase.from(entity.table).update({ is_active: false }).eq('id', recordId)`. Dialog title: "Deactivate {displayName}?". Button: "Deactivate". Copy explains record will be hidden.
- **FK constraint errors**: catch Postgres error code `23503` (foreign_key_violation) and show "Cannot delete — this {displayName} is referenced by other records."
- **Other errors**: show the error message directly.
- Uses `AlertDialog` from `@/components/ui/alert-dialog` (same pattern as `RecipeDeleteDialog`).

```typescript
"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface EntityDeleteDialogProps {
  entityTable: string;
  entityDisplayName: string;
  recordId: string;
  recordTitle: string;
  deleteMode: "hard" | "soft";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EntityDeleteDialog({
  entityTable,
  entityDisplayName,
  recordId,
  recordTitle,
  deleteMode,
  open,
  onOpenChange,
  onSuccess,
}: EntityDeleteDialogProps) {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const isSoft = deleteMode === "soft";
  const verb = isSoft ? "Deactivate" : "Delete";
  const verbing = isSoft ? "Deactivating..." : "Deleting...";

  const mutation = useMutation({
    mutationFn: async () => {
      if (isSoft) {
        const { error } = await supabase
          .from(entityTable)
          .update({ is_active: false } as Record<string, unknown>)
          .eq("id", recordId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(entityTable)
          .delete()
          .eq("id", recordId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      const pastVerb = isSoft ? "deactivated" : "deleted";
      toast.success(`${entityDisplayName} "${recordTitle}" ${pastVerb}`);
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: unknown) => {
      const pgError = err as { code?: string; message?: string };
      if (pgError.code === "23503") {
        setError(
          `Cannot delete — this ${entityDisplayName.toLowerCase()} is referenced by other records.`
        );
      } else {
        setError(pgError.message ?? "An unexpected error occurred");
      }
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{verb} {entityDisplayName.toLowerCase()}?</AlertDialogTitle>
          <AlertDialogDescription>
            {isSoft
              ? `This will deactivate "${recordTitle}". It will be hidden from lists and dropdowns but preserved for historical records.`
              : `This will permanently delete "${recordTitle}". This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={mutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? verbing : verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Step 2: Commit**

```
feat: add universal EntityDeleteDialog component
```

---

### Task 3: Wire delete into EntityDetailUnified

**Files:**
- Modify: `src/components/universal/entity-detail-unified.tsx`

**Step 1: Add delete dialog state and rendering**

At the top of the `EntityDetailUnified` function (around line 260), add state:

```typescript
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [deleteAction, setDeleteAction] = useState<EntityActionDef<T> | null>(null);
```

Import `EntityDeleteDialog` and `useState`.

**Step 2: Intercept delete actions in the onClick handler**

In the action onClick handler (around line 829-843), add a check BEFORE the existing `onAction` check:

```typescript
onClick={() => {
  if (disabledReason) return;
  // Universal delete handling
  if (action.name === "delete" && action.deleteMode) {
    setDeleteAction(action);
    setDeleteDialogOpen(true);
    return;
  }
  if (onAction && onAction(action.name, displayData)) {
    return;
  }
  // ... existing toState and handler logic
}}
```

**Step 3: Render the dialog**

After the `DropdownMenuContent` closing tag (but inside the component return), render:

```typescript
{deleteAction?.deleteMode && (
  <EntityDeleteDialog
    entityTable={entity.table}
    entityDisplayName={entity.displayName}
    recordId={id!}
    recordTitle={String(
      (displayData as Record<string, unknown>)[
        entity.detailHeader?.title ?? "name"
      ] ?? entity.displayName
    )}
    deleteMode={deleteAction.deleteMode}
    open={deleteDialogOpen}
    onOpenChange={setDeleteDialogOpen}
    onSuccess={() => {
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(entity.viewTable ?? entity.table),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(entity.table),
      });
      const listPath = backUrl ?? basePath ?? `/${entity.domain}/${entity.table.replace(/_/g, "-")}`;
      router.push(listPath);
    }}
  />
)}
```

Import `entityKeys` from `@/lib/query-keys` and `useRouter` from `next/navigation` (check if already imported).

**Step 4: Commit**

```
feat: wire universal delete into EntityDetailUnified
```

---

### Task 4: Wire delete into EntityDataTable / buildActionsColumn

**Files:**
- Modify: `src/lib/data-table-adapter.tsx` (buildActionsColumn, around line 156)
- Modify: `src/components/universal/entity-data-table.tsx` (where buildActionsColumn is called)

**Step 1: Add onDelete callback to buildActionsColumn**

Add a new parameter to `buildActionsColumn`:

```typescript
export function buildActionsColumn<T>(
  entity: EntityConfig<T>,
  basePath: string,
  onAction?: (actionName: string, record: T) => boolean,
  onTransition?: (id: string, toState: string) => void,
  onDelete?: (record: T, action: EntityActionDef<T>) => void
): ColumnDef<T, unknown> {
```

In the action onClick handler inside the cell render, add before the `onAction` check:

```typescript
onClick={() => {
  if (disabledReason) return;
  // Universal delete handling
  if (action.name === "delete" && action.deleteMode && onDelete) {
    onDelete(record, action);
    return;
  }
  if (onAction && onAction(action.name, record)) {
    return;
  }
  // ... existing logic
}}
```

**Step 2: Add delete dialog state in EntityDataTable**

In `entity-data-table.tsx`, find where `buildActionsColumn` is called. Add state for the delete dialog and pass the `onDelete` callback:

```typescript
const [deleteTarget, setDeleteTarget] = useState<{ record: T; action: EntityActionDef<T> } | null>(null);
```

Pass the callback:

```typescript
buildActionsColumn(
  entity,
  basePath,
  onAction,
  handleTransition,
  (record, action) => setDeleteTarget({ record, action })
)
```

Render the dialog (inside the component return):

```typescript
{deleteTarget?.action.deleteMode && (
  <EntityDeleteDialog
    entityTable={entity.table}
    entityDisplayName={entity.displayName}
    recordId={String((deleteTarget.record as Record<string, unknown>).id)}
    recordTitle={String(
      (deleteTarget.record as Record<string, unknown>)[
        entity.detailHeader?.title ?? "name"
      ] ?? entity.displayName
    )}
    deleteMode={deleteTarget.action.deleteMode}
    open={!!deleteTarget}
    onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
    onSuccess={() => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(entity.viewTable ?? entity.table),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(entity.table),
      });
    }}
  />
)}
```

Import `EntityDeleteDialog`, `entityKeys`, `useState`, `useQueryClient`.

**Step 3: Commit**

```
feat: wire universal delete into EntityDataTable row actions
```

---

### Task 5: Add delete action to location entity

**Files:**
- Modify: `src/entities/location.tsx`

**Step 1: Add actions array with soft delete**

Add an `actions` property to `locationEntity`:

```typescript
actions: [
  {
    name: "delete",
    label: "Deactivate Location",
    icon: "trash",
    type: "dropdown",
    variant: "destructive",
    deleteMode: "soft" as const,
  },
],
```

**Step 2: Commit**

```
feat: add soft delete action to location entity
```

---

### Task 6: Add delete action to all reference/catalog entities

**Files:**
- Modify: `src/entities/beer-style.tsx`
- Modify: `src/entities/bin.tsx`
- Modify: `src/entities/customer.tsx`
- Modify: `src/entities/enum-value.tsx`
- Modify: `src/entities/inventory-item.tsx`
- Modify: `src/entities/keg-owner.tsx`
- Modify: `src/entities/keg-type.tsx`
- Modify: `src/entities/package-type.tsx`
- Modify: `src/entities/sales-channel.tsx`
- Modify: `src/entities/supplier.tsx`
- Modify: `src/entities/vessel.tsx`
- Modify: `src/entities/yeast-strain.tsx`

**Step 1: Add the same soft delete action to each entity**

Each entity gets:

```typescript
actions: [
  {
    name: "delete",
    label: "Deactivate {DisplayName}",
    icon: "trash",
    type: "dropdown",
    variant: "destructive",
    deleteMode: "soft" as const,
  },
],
```

Replace `{DisplayName}` with the entity's display name (e.g., "Deactivate Beer Style", "Deactivate Bin").

For entities that already have an `actions` array, append the delete action to the existing array.

**Step 2: Commit**

```
feat: add soft delete action to all reference/catalog entities
```

---

### Task 7: Migrate recipe delete to universal system

**Files:**
- Modify: `src/entities/recipe.tsx` (add deleteMode to existing delete action)
- Modify: `src/app/(app)/production/recipes/page.tsx` (remove custom delete wiring)
- Modify: `src/app/(app)/production/recipes/[id]/page.tsx` (remove custom delete wiring)
- Delete: `src/components/domain/recipe-delete-dialog.tsx`

**Step 1: Add deleteMode to recipe's existing delete action**

In `src/entities/recipe.tsx`, update the existing delete action (around line 800):

```typescript
{
  name: "delete",
  label: "Delete Recipe",
  icon: "trash",
  type: "dropdown",
  variant: "destructive",
  deleteMode: "hard",
  disabledWhen: (data) =>
    data.batch_count ? `Has ${data.batch_count} associated batch${data.batch_count === 1 ? "" : "es"}` : false,
},
```

**Step 2: Simplify recipes list page**

Replace `src/app/(app)/production/recipes/page.tsx` — remove `RecipeDeleteDialog`, `deleteDialogOpen` state, `handleAction` delete branch, and `handleDeleteSuccess`. The page should only keep the `onAction` handler for non-delete actions (clone is not handled here — it's on the detail page).

If delete was the ONLY action handled, the page becomes:

```typescript
"use client";

import { EntityList } from "@/components/universal/entity-list";
import { recipeEntity } from "@/entities/recipe";

export default function RecipesPage() {
  return <EntityList entity={recipeEntity} basePath="/production/recipes" />;
}
```

**Step 3: Simplify recipe detail page**

In `src/app/(app)/production/recipes/[id]/page.tsx`, remove:
- `deleteDialogOpen` state
- The `delete` branch from `handleAction`
- The `RecipeDeleteDialog` rendering
- The `handleDeleteSuccess` callback
- The `RecipeDeleteDialog` import

Keep the `handleAction` for `start_brew_day` and `clone`.

**Step 4: Delete RecipeDeleteDialog**

Remove `src/components/domain/recipe-delete-dialog.tsx`.

**Step 5: Commit**

```
refactor: migrate recipe delete to universal EntityDeleteDialog
```

---

### Task 8: Lint and verify

**Step 1: Run lint**

```bash
bun lint
```

Fix any errors introduced by the changes.

**Step 2: Verify build**

```bash
bun build
```

**Step 3: Commit any lint fixes**

```
fix: lint fixes for universal entity delete
```
