# Design: Batch-Centric Start Brew Day

**Date:** 2026-02-18
**Branch:** feature/brewlog
**Status:** Approved

## Problem

The Start Brew Day dialog is recipe-centric: it starts by selecting a recipe, then creates new batches inline. This is backwards — batches should be planned first, then brewed. Starting from a recipe bypasses batch planning and makes it unclear which batch the brew is for.

## Decision

Redesign the Start Brew Day flow so the batch is always known before opening the dialog. Remove all recipe-selection and batch-creation logic from the dialog.

## Entry Points

### Keep
- **Batch detail page** — "Start Brew Day" banner on planned batches with no linked brew log (existing, update props)

### Add
- **Batches list** — "Start Brew Day" row action on planned batches (new action in `batchEntity.actions`)

### Remove
- **Brew logs list** — remove "Start Brew Day" button and dialog
- **Recipe detail** — remove "Start Brew Day" action and dialog

## Dialog Redesign

The dialog simplifies from a 4-step wizard to a single-step confirmation since the batch is always known.

### Props (simplified)
```typescript
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
```

### Dialog Content
- **Read-only display**: batch number, batch name, recipe name, volume
- **Editable fields**: brew date (default today), brew number (auto-generated)
- **Action**: "Start Brew Day" button

### What Gets Created
1. One `brew_logs` record (brew_number, brew_date, brewer_id, status=draft)
2. One `brew_log_batches` junction record linking brew log to the batch

### What Gets Removed from Dialog
- Recipe selector step (step 0)
- Recipe summary display with estimates
- Batch splits configuration (step 2)
- Recipe variant fetching and initialization
- Vessel assignment
- Batch creation logic
- `recipeId`/`recipeName` props
- `existingBatchId`/`existingBatchVolume` props (batch is now the primary input)

## Entity Config Changes

### `batchEntity` (`src/entities/batch.tsx`)
Add action:
```typescript
{
  name: "start_brew_day",
  label: "Start Brew Day",
  icon: "play",
  type: "button",
  fromStates: ["planned"],
}
```

### `recipeEntity` (`src/entities/recipe.tsx`)
Remove the `start_brew_day` action.

## Component/Page Changes

### `src/app/(app)/production/batches/page.tsx`
- Add `onAction` handler for `start_brew_day` to open the dialog
- Add `StartBrewDayDialog` with batch info from the selected record

### `src/app/(app)/production/batches/[id]/page.tsx`
- Update `StartBrewDayDialog` usage to match new simplified props

### `src/app/(app)/production/brew-logs/page.tsx`
- Remove "Start Brew Day" button
- Remove `StartBrewDayDialog` import and usage

### `src/app/(app)/production/recipes/[id]/page.tsx`
- Remove `start_brew_day` action handler
- Remove `StartBrewDayDialog` import and usage
- Remove `showBrewDay` state

### `src/components/domain/start-brew-day-dialog.tsx`
- Rewrite as single-step confirmation dialog
- Remove all recipe/variant/split/vessel logic

## Unchanged
- `brew_log_batches` junction table
- Brew log entity config
- Brew log detail page
- Batch detail page banner logic (already works correctly)
