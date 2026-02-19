# Design: Batch-Centric Brew Logs

**Date:** 2026-02-17
**Branch:** feature/brewlog
**Status:** Approved

## Problem

Brew logs currently have a direct `recipe_id` FK, making recipes the primary association. This is backwards — a brew log records the brewing of a **batch** (or multiple batches in split scenarios). The recipe is accessible through the batch. The direct `recipe_id` on brew logs creates:

- **Redundancy** — batches already carry `recipe_id`
- **Potential inconsistency** — brew log recipe could mismatch its linked batch's recipe
- **Misleading UX** — list/detail views emphasize recipe over batch

## Decision

Drop `recipe_id` from `brew_logs` entirely. Recipe is always derived from linked batches via the `brew_log_batches` junction table.

## Database Changes

### Migration: `00095_batch_centric_brew_logs.sql`

1. Drop `recipe_id` column from `brew_logs` (cascades indexes and FK constraint)
2. Create `brew_logs_with_batches` view that derives:
   - `recipe_id` — from first linked batch's recipe
   - `recipe_name` — from first linked batch's recipe name
   - `batch_count` — count of linked batches
   - `batch_numbers` — comma-separated batch numbers
3. Update `brew_log_metrics` view to remove recipe dependency
4. Update `_schema_registry` entry for `brew_logs`

## Entity Config Changes (`src/entities/brew-log.tsx`)

- Set `viewTable: "brew_logs_with_batches"` for list/detail views
- Replace `recipe_id` relation column in `listColumns` with `batch_numbers` text column
- Remove `recipe_id` from `sections` (unified detail) and `formFields`
- Remove `recipe_id` from `brewLogSchema` (Zod)
- Remove `belongsTo: recipe` from `relations`
- Remove `recipe_id` from `keyFields`

## Component Changes

### `brew-log-split-overview.tsx`
- Remove recipe summary query that uses `data.recipe_id`
- Derive recipe display from linked batches (already fetched by the component)

### `brew-log detail page` (`src/app/(app)/production/brew-logs/[id]/page.tsx`)
- Remove separate recipe query for breadcrumb
- Derive recipe from linked batches (already fetched)
- Breadcrumb becomes: Batch(es) → Brew Log (instead of Recipe → Brew Log → Batch)

### `start-brew-day-dialog.tsx`
- Remove `recipe_id` from brew log insert
- `recipe_id` stays on batch inserts (single source of truth)

### `batch-brew-info.tsx`
- Remove nested `recipe:recipes(name)` join from brew_log fetch (no longer exists on brew_logs)

### `brew-log-linker.tsx`
- Remove nested `recipe:recipes(name)` join from brew_log fetch

## Unchanged

- `brew_log_batches` junction table
- `batches.recipe_id` (single source of truth for recipe)
- `batches_with_brew_info` view
- Start Brew Day UX flow (same steps, just drops one field from brew log insert)
- Brew log timeline/events system
