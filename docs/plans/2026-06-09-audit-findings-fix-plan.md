# Application Audit Findings & Fix Plan (2026-06-09)

Four-lens audit (simplification, performance, UI/UX, brewery-operations value).
This file is the working checklist for the fix loop on branch `fix/audit-findings`.
Status legend: `[ ]` pending · `[x]` fixed & verified (lint+typecheck+tests green) · `[~]` in progress · `[d]` deferred (needs user decision).

## Batch 1 — Quick wins A: correctness + perf (code-only)

- [x] **1.1 Timeline queryKey omits date-range end** (correctness bug): `src/app/(app)/production/planning/timeline/page.tsx:192-196` — `entityKeys.timeline(...)` keyed only on `startDate`, but queryFn filters through `endDate = addWeeks(startDate, weeksToShow)`. Changing 6→12 weeks serves stale 6-week cache. Fix: include `weeksToShow`/endDate in the key.
- [x] **1.2 Timeline scroll reset + unmemoized `days`**: same file `:188-189, 362-372` — `days` rebuilt every render; scroll-to-today effect depends on it and force-resets `scrollLeft` whenever any query settles. Fix: `useMemo` days on `[startDate, weeksToShow]`; key scroll effect on `[startDate]`.
- [x] **1.3 Dashboard false empty state**: `src/app/(app)/dashboard/page.tsx:166-232, 324-329` — batch/vessel sections render "No active batches" + 0% utilization during initial fetch. Fix: gate on `isLoading` with skeletons (pattern exists: `ProductionTrendsSkeleton`).
- [x] **1.4 Lazy-load recharts** (COGS chart extracted to `src/components/domain/reports/cogs-period-chart{,-lazy}.tsx`): `dashboard/page.tsx:37` (TrendChart), `dashboard/sales/page.tsx:20`, `reports/cogs/page.tsx:77-86` — wrap charts in `next/dynamic` like existing `batch-readings-chart-lazy.tsx`.
- [x] **1.5 TTB sequential queries**: `reports/ttb/page.tsx:160-175` — two independent queries awaited sequentially; wrap in `Promise.all`.

## Batch 2 — Quick wins B: UX config + polish

- [x] **2.1 Order quickFilters** (real states: draft/confirmed/scheduled/picking/packed open; fulfilled/cancelled terminal): `src/entities/order.tsx` — add `quickFilters` (Open = draft…packed default, Due sorted by `scheduled_date asc`, Done) mirroring `batch.tsx:179-200`.
- [x] **2.2 Required-field indicator** (asterisk span already existed; removed dead `required` class): `src/components/universal/field-input.tsx:130` sets class `required` but no CSS rule exists. Add `.required::after { content: " *" }` (or asterisk span).
- [x] **2.3 List/detail error retry**: `entity-data-table.tsx:654-660` and `entity-detail-unified.tsx:787-793` render plain "Failed to load" text. Add `refetch()` retry button (pattern: `route-error.tsx:24-51`).
- [x] **2.4 Sidebar IA**: `src/components/domain/shared/app-sidebar.tsx:102-179, 253-255` — move Deliveries from Inventory → Sales; allow multiple sections open simultaneously.

## Batch 3 — Detail-page action ergonomics (high UX impact)

- [x] **3.1 Render `type: "button"` actions as visible header buttons**: `entity-detail-unified.tsx:860-935` collapses all actions into one dropdown, ignoring the configured `type: "button"` vs `"dropdown"` distinction (configs: `batch.tsx:368-441`, `order.tsx:291-342`).
- [x] **3.2 Transition feedback + race guard on detail page**: `entity-detail-unified.tsx:462-476` — `transitionMutation` has no `onError`, no toasts, no `.eq(stateField, currentState)` guard. Port the list-view pattern (`entity-data-table.tsx:134-184`).

## Batch 4 — Server-side pagination (structural perf)

- [x] **4.1 Server pagination/sort** (done: manualPagination/manualSorting, `.order()` + id tiebreaker + `.range()` with `count: "estimated"`, `entityKeys.pagedList`, keepPreviousData, kanban capped at 1000): `entity-data-table.tsx:442-504` — `select("*")`, no `.range()`/`.limit()`/`.order()`; all 40 entity lists fetch entire tables. Wire pagination+sorting state into queryKey, apply `.order()` + `.range()` with `{ count: "estimated" }`, set `manualPagination`/`manualSorting`. Keep capped unpaginated path for kanban.
- [x] **4.2 Column projection** (done: `buildSelectList` auto-detects safety; falls back to `*` when render fns / action predicates / onAction can read arbitrary fields; board mode always `*`): derive select list from `listColumns ∪ listFilters ∪ searchableFields ∪ id/state`; fall back to `*` for custom renderers.
- [x] **4.3 Mobile list cap** (done: mobile fetches pages 0..N with "Load more" button driven by server count): `entity-mobile-card-list.tsx:167-184` renders all rows; respect pagination or "Load more".

## Batch 5 — Dead code deletion (zero-risk, ~500+ lines)

- [x] **5.1 Delete `queryExamples` + `keyFields`** (keyFields *type member* kept — CHAT_ENTITY_MAP casts to EntityConfig and route.ts reads it; untangle with a future map/registry dedup) from `EntityConfig` (`src/types/entity.ts:144,147`) and all ~38 entity configs. Zero consumers (chat reads `CHAT_ENTITY_MAP` instead).
- [x] **5.2 Delete dead config knobs** (also deleted orphaned recipe-schedule-edit.tsx): `detailSections`/`formFields`/`createFields`/`editFields` (deprecated, 0/40) + legacy converter `getUnifiedSections()` (`entity-detail-unified.tsx:121-146`), `editComponent` (0/40 + branch at `:1217`), `stateMachine.hooks` (`onEnter`/`onExit` zero consumers; keep `validate`), `allowUnitSwitch` (0/40), `relationLimit` (0/40), relation `inlineEdit` (0/40).
- [x] **5.3 Delete dead helpers**: `types/entity.ts` — `getEntity`, `getEntitiesByDomain`, `getStateColor`, `getValueColor` (0 callers).
- [x] **5.4 Trim `ui/file-upload.tsx`** (1410 → 803): only `FileUpload`, `FileUploadDropzone`, `FileUploadTrigger` used (sole consumer `settings/system/page.tsx:33`); delete unused subcomponents (~lines 919-1409 + their store actions).

## Batch 6 — Recipe-domain dedup (~800-line reduction)

- [x] **6.1 Generic `IngredientTab`** (1218 → 678 lines): `other-ingredients-section.tsx` — four ~230-line clone tabs (Adjuncts/Sugars/Spices/Fruits) → one component driven by `{ table, fkColumn, catalogTable, columns[] }` spec.
- [x] **6.2 `useRecipeChildRows` hook** (6 true child-row savers migrated; 7 recipe-editor callers are form-based parent updates — different pattern, correctly left): 11 components re-implement fetch/sync/dirty/delete-all-reinsert-save/invalidate (~60-90 lines each; all `useRegisterSaver` callers).
- [x] **6.3 Fold hops into generic section + shared `CatalogPicker`**: `recipe-variant-editor.tsx:219-932` — hops duplicate the generic addition section with one extra column; catalog picker duplicates `CatalogSelector` (`other-ingredients-section.tsx:161`).

## Batch 7 — Drift prevention + COGS testability

- [x] **7.1 `CHAT_ENTITY_MAP` dedup** (sync test added; caught 3 real runtime bugs — yeast_strain table, keg_transaction sort, yeast_pitch dropped view; searchYeastPitches also fixed): `src/app/api/chat/entity-map.ts` (412 lines) hand-duplicates metadata for 25 entities. Split data-only `*.meta.ts` per entity imported by both config and map, OR add a test asserting map ≡ registry. Also generate `searchEntity` description's entity list from map keys (`tools.ts:90-92`).
- [x] **7.2 Extract COGS math** (src/lib/reports/cogs.ts + 19 tests; double-fetch intentionally kept — tabs use genuinely different date semantics): `reports/cogs/page.tsx` — move SKU cost allocation (~330-480) and period bucketing (~490-620) into `src/lib/reports/cogs.ts` with unit tests; split per-tab components. Also dedupe double-fetch of finished_goods/allocations (`:253-265, 329-366`).

## Batch 8 — Operations: attention surface + small schema adds (MIGRATIONS — apply only after user confirms DB push)

- [x] **8.1 "Today" dashboard panel**: batches exceeding recipe `fermentation_days`/`conditioning_days` (logic exists in `timeline/page.tsx:234-246`), POs due (`expected_date`), kegs >30d at accounts, expiring lots. Done: `src/components/dashboard/today-panel.tsx`, rendered near the top of `dashboard/page.tsx`.
- [x] **8.2 Schedule `check_low_inventory()`** via pg_cron (function exists since migration 00022, never scheduled). Migration written: `00174_schedule_low_inventory_check.sql` (daily 06:00 UTC, idempotent unschedule guard) — **not applied; needs DB push confirmation**.
- [x] **8.3 TTB `completed_at`**: batches lack completion timestamp; `ttb/page.tsx:160-165` filters by `planned_start_date` → wrong-month attribution. Add column + filter on it.
  - Migration `00175_batches_completed_at.sql` (nullable timestamptz, backfill from `updated_at` for `status='completed'`, BEFORE UPDATE trigger `trg_batches_set_completed_at`) — applied; types regenerated.
  - Done: `ttb/page.tsx` ttbBatches queryFn now filters/selects `completed_at` (gte startDate, lte endDate end-of-day); comment notes pre-backfill attribution is approximate (`completed_at` backfilled from `updated_at`).
- [x] **8.4 Yeast `recommended_max_generations`** on `yeast_strains` + warning in pitch picker.
  - Migration `00176_yeast_recommended_max_generations.sql` (nullable smallint, CHECK NULL-or-positive) — applied; types regenerated.
  - Done: (1) `pitch-yeast-dialog.tsx` fetches `yeasts.recommended_max_generations` (key `yeastKeys.strainMaxGenerations()`) and shows an amber "Over gen limit" badge per option plus an inline non-blocking warning when the selected pitch's `generation >= recommended_max_generations`; (2) `searchYeastPitches` in `tools.ts` joins `yeasts` by `strain_id` and returns `recommended_max_generations` + `over_recommended_generation` per row (mentioned in tool description).
- [x] **8.5 AI chat tool gaps**: `getIngredientInventory` add `itemName` param (`tools.ts:307`); `getVesselAvailability` add projected-free-date (`tools.ts:236`; computation exists in `timeline/page.tsx:380`). Done: `itemName` ilike filter (escapeLike); `projected_free_date` on `inUse` vessels computed from occupying batch `planned_start_date` + recipe `fermentation_days`/`conditioning_days`.

## Batch 9 — Close the inventory loop (highest product value, large)

- [x] **9.1 Brew-day ingredient consumption**: Start Brew Day prompts FIFO lot allocations from the recipe bill (scaled by batch volume), planned → completed on batch completion. App-side, no migration (`src/domain/consumption-planning.ts`, `src/services/consumption-service.ts`, `BrewConsumptionDialog`). Known gap: kanban-drag completion bypasses the planned→completed hook.
- [x] **9.2 Packaging material depletion**: `PackagingCompletionReview` consumes `selling_format_materials` BOM × actual quantity from lots (FIFO); shortfalls allocate what's available + warning; depletion failure never rolls back completion.
- [x] **9.3 Loss capture**: `RecordLossDialog` prompted at vessel-transfer and packaging completion with implied-loss math (epsilon 0.005 bbl); records `destination_type='loss'` allocations — feeds TTB `losses_bbl` automatically.
- [x] **9.4 Quick depletion actions**: Record Sample / Taproom Depletion / Write Off header actions on the allocations list (`QuickDepletionDialog`) with source picker, over-available warning, reason codes.
- [x] **9.5 Batch trace report**: `/reports/trace` — ingredient lots → batch → finished goods → orders/customers + keg shipments; in reports index + sidebar.

## Batch 10 — Mobile/tablet ergonomics

- [x] **10.1 Tablet breakpoint**: `useIsTouch()` (pointer: coarse) grows hit areas to 40px, taller rows, h-9 search on touch devices; breakpoint and desktop pointer experience unchanged.
- [x] **10.2 Mobile card actions**: trailing 40px menu on cards exposing the same filtered actions/transitions as desktop (shared dispatch via props from EntityDataTable).
- [x] **10.3 Mobile filter sheet**: bottom Sheet rendering the existing DataTableFilterList + DataTableSortList against the same table/nuqs state; active-filter count badge.
- [x] **10.4 Optimistic transitions**: paged-cache `setQueryData` flip with rollback; pre-SELECT dropped in favor of cached-state `.eq` guard (`.in(validFromStates)` fallback); friendly conflict message kept.

## Deferred / needs user decision

- [x] Search input per-keystroke re-render — done in Batch 4: keystroke state moved into `ListSearchInput`; parent only re-renders on the debounced value.
- [x] Missing indexes `batches(created_at)`, `finished_goods(created_at)` — migration `00177_report_date_indexes.sql`, applied.
- [x] Sequential per-row upserts — settings/system single bulk upsert; pricing bulk-adjust + copy-channel single `.upsert(onConflict)`; variant saves parallelized.
- [x] cmd+k navigator — `command-palette.tsx` (⌘K/Ctrl+K), nav config shared with sidebar via `nav-items.ts`.
- [x] Pricing page split — `settings/pricing/page.tsx` 1170 → 207; views/dialogs extracted to `src/components/domain/pricing/`.
- [x] Kanban-drag consumption gap (from 9.1) — `handleSingleTransition` now calls `completeBatchConsumption` on batches→completed, covering kanban/list/mobile paths.
- [x] Migration history repair (discovered during DB push): duplicate version 00171 renumbered (perf indexes → 00178); bulk notification RPCs were never applied despite shipping in PR #279 — renumbered to 00179 and applied. 00176 fixed to target `yeasts` (table `yeast_strains` doesn't exist).

## Verification gate (every batch)

`bun lint` && `bun typecheck` && `bun run test` must be green before commit. Migrations only on this branch; `bun db:migrate` pushes to the shared dev DB, so apply only after explicit user confirmation.
