# Batch Blending Completion Implementation Plan

**Status:** COMPLETED (PR #135)

**Goal:** Complete batch blending with volume tracking and weighted blended estimates (OG, FG, ABV, IBU, SRM) via a database view, and update the UI to surface available volumes and projected estimates.

**Architecture:** `batch_blends` table is the source of truth for blend relationships and volumes. A new `batches_with_blend_info` view calculates remaining volume and weighted estimates on read (consistent with `recipes_with_estimates` and `batches_with_brew_info` patterns). The blend dialog and history components are updated to use this view.

**Tech Stack:** PostgreSQL views, React/TypeScript, React Query, Supabase client

**Branch:** `feat/batch-blending-completion`
**PR:** https://github.com/energee/mgr/pull/135

---

## Lessons Learned

1. **`actual_og` is NOT a column on `batches`** — it's computed by the `batches_with_brew_info` view from brew log data. The migration must join `batches_with_brew_info` (not `batches`) for OG data.
2. **PostgreSQL `FILTER (WHERE ...)` with `NULLIF`** is more idiomatic than nested CASE expressions for conditional aggregation with NULL handling.
3. **Supabase views need explicit type assertions** in TypeScript since generated types don't cover views — added a `SourceBatch` interface for the blend dialog query.

---

### Task 1: Create `batches_with_blend_info` Database View -- DONE

**Files:**
- Created: `supabase/migrations/00063_batch_blend_views.sql`

**What was built:**
- View with two CTEs: `blended_away` (volume given to other blends) and `blended_in` (sources blended into this batch)
- Joins `batches_with_brew_info` for OG, `recipes_with_estimates` for IBU/SRM
- Uses `FILTER (WHERE ... IS NOT NULL)` / `NULLIF` for clean weighted averages
- Outputs: `id`, `volume_blended_away_bbl`, `available_volume_bbl`, `blend_source_count`, `blended_volume_in_bbl`, `blended_og`, `blended_fg`, `blended_abv`, `blended_ibu`, `blended_srm`, `blend_source_recipes`
- Migration applied to Supabase, verified working

---

### Task 2: Add `blendInfo` Query Key -- DONE

**Files:**
- Modified: `src/lib/query-keys.ts`

Added `blendInfo: (id: string) => ["batches", id, "blend-info"] as const` to `batchKeys`.

---

### Task 3: Update Blend Dialog — Available Volume and Projected Estimates -- DONE

**Files:**
- Modified: `src/components/domain/batch-blend-dialog.tsx`

**Changes:**
- Added `SourceBatch` interface for type safety (Supabase views don't have generated types)
- Source batch query now fetches from `batches_with_brew_info` (for `actual_og`) instead of `batches`
- New query fetches `batches_with_blend_info` for available volume data
- `availableVolumeMap` provides O(1) lookup of available volume per batch
- Table shows available volume (not total), volume input capped to available
- `toggleBatch` defaults to available volume
- Mutation validates against available volume
- `blendTotals` expanded with `weightedAvg` helper for OG, FG, ABV
- Blend summary displays weighted OG/FG when data available
- Cache invalidation includes blend info query

---

### Task 4: Update Blend History — Show Blended Estimates -- DONE

**Files:**
- Modified: `src/components/domain/batch-blend-history.tsx`

**Changes:**
- Added blend info query from `batches_with_blend_info`
- "Blended Estimates" card shows OG, FG, ABV, IBU, SRM and source recipe names
- "Used as Source In" section shows volume blended away and remaining

---

### Task 5: Update CLAUDE.md Migration Counter -- DONE

Updated to `00063` / `00064`. Done as part of Task 1 commit.

---

### Task 6: Final Verification -- DONE

- `pnpm lint` — 0 errors (11 pre-existing warnings)
- `pnpm tsc --noEmit` — 0 type errors
- `pnpm test` — 222/222 tests pass
- Migration applied and verified on Supabase
