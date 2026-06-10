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

- [ ] **3.1 Render `type: "button"` actions as visible header buttons**: `entity-detail-unified.tsx:860-935` collapses all actions into one dropdown, ignoring the configured `type: "button"` vs `"dropdown"` distinction (configs: `batch.tsx:368-441`, `order.tsx:291-342`).
- [ ] **3.2 Transition feedback + race guard on detail page**: `entity-detail-unified.tsx:462-476` — `transitionMutation` has no `onError`, no toasts, no `.eq(stateField, currentState)` guard. Port the list-view pattern (`entity-data-table.tsx:134-184`).

## Batch 4 — Server-side pagination (structural perf)

- [ ] **4.1 Server pagination/sort**: `entity-data-table.tsx:442-504` — `select("*")`, no `.range()`/`.limit()`/`.order()`; all 40 entity lists fetch entire tables. Wire pagination+sorting state into queryKey, apply `.order()` + `.range()` with `{ count: "estimated" }`, set `manualPagination`/`manualSorting`. Keep capped unpaginated path for kanban.
- [ ] **4.2 Column projection**: derive select list from `listColumns ∪ listFilters ∪ searchableFields ∪ id/state`; fall back to `*` for custom renderers.
- [ ] **4.3 Mobile list cap**: `entity-mobile-card-list.tsx:167-184` renders all rows; respect pagination or "Load more".

## Batch 5 — Dead code deletion (zero-risk, ~500+ lines)

- [ ] **5.1 Delete `queryExamples` + `keyFields`** from `EntityConfig` (`src/types/entity.ts:144,147`) and all ~38 entity configs. Zero consumers (chat reads `CHAT_ENTITY_MAP` instead).
- [ ] **5.2 Delete dead config knobs**: `detailSections`/`formFields`/`createFields`/`editFields` (deprecated, 0/40) + legacy converter `getUnifiedSections()` (`entity-detail-unified.tsx:121-146`), `editComponent` (0/40 + branch at `:1217`), `stateMachine.hooks` (`onEnter`/`onExit` zero consumers; keep `validate`), `allowUnitSwitch` (0/40), `relationLimit` (0/40), relation `inlineEdit` (0/40).
- [ ] **5.3 Delete dead helpers**: `types/entity.ts` — `getEntity`, `getEntitiesByDomain`, `getStateColor`, `getValueColor` (0 callers).
- [ ] **5.4 Trim `ui/file-upload.tsx`**: only `FileUpload`, `FileUploadDropzone`, `FileUploadTrigger` used (sole consumer `settings/system/page.tsx:33`); delete unused subcomponents (~lines 919-1409 + their store actions).

## Batch 6 — Recipe-domain dedup (~800-line reduction)

- [ ] **6.1 Generic `IngredientTab`**: `other-ingredients-section.tsx` — four ~230-line clone tabs (Adjuncts/Sugars/Spices/Fruits) → one component driven by `{ table, fkColumn, catalogTable, columns[] }` spec.
- [ ] **6.2 `useRecipeChildRows` hook**: 11 components re-implement fetch/sync/dirty/delete-all-reinsert-save/invalidate (~60-90 lines each; all `useRegisterSaver` callers).
- [ ] **6.3 Fold hops into generic section + shared `CatalogPicker`**: `recipe-variant-editor.tsx:219-932` — hops duplicate the generic addition section with one extra column; catalog picker duplicates `CatalogSelector` (`other-ingredients-section.tsx:161`).

## Batch 7 — Drift prevention + COGS testability

- [ ] **7.1 `CHAT_ENTITY_MAP` dedup**: `src/app/api/chat/entity-map.ts` (412 lines) hand-duplicates metadata for 25 entities. Split data-only `*.meta.ts` per entity imported by both config and map, OR add a test asserting map ≡ registry. Also generate `searchEntity` description's entity list from map keys (`tools.ts:90-92`).
- [ ] **7.2 Extract COGS math**: `reports/cogs/page.tsx` — move SKU cost allocation (~330-480) and period bucketing (~490-620) into `src/lib/reports/cogs.ts` with unit tests; split per-tab components. Also dedupe double-fetch of finished_goods/allocations (`:253-265, 329-366`).

## Batch 8 — Operations: attention surface + small schema adds (MIGRATIONS — apply only after user confirms DB push)

- [ ] **8.1 "Today" dashboard panel**: batches exceeding recipe `fermentation_days`/`conditioning_days` (logic exists in `timeline/page.tsx:234-246`), POs due (`expected_date`), kegs >30d at accounts, expiring lots.
- [ ] **8.2 Schedule `check_low_inventory()`** via pg_cron (function exists since migration 00022, never scheduled).
- [ ] **8.3 TTB `completed_at`**: batches lack completion timestamp; `ttb/page.tsx:160-165` filters by `planned_start_date` → wrong-month attribution. Add column + filter on it.
- [ ] **8.4 Yeast `recommended_max_generations`** on `yeast_strains` + warning in pitch picker.
- [ ] **8.5 AI chat tool gaps**: `getIngredientInventory` add `itemName` param (`tools.ts:307`); `getVesselAvailability` add projected-free-date (`tools.ts:236`; computation exists in `timeline/page.tsx:380`).

## Batch 9 — Close the inventory loop (highest product value, large)

- [ ] **9.1 Brew-day ingredient consumption**: auto-generate `planned` allocations from recipe grain bill/hop schedule with FIFO lot suggestion at brew start; confirm-to-complete on brew completion (mirror pick-list FIFO, migration 00057).
- [ ] **9.2 Packaging material depletion**: on session completion, insert consumption allocations per `selling_format_materials` BOM line × `actual_quantity` (FIFO).
- [ ] **9.3 Loss capture**: compute implied loss at vessel-transfer and packaging completion; prompt to record loss allocation with reason code; feeds TTB `losses_bbl`.
- [ ] **9.4 Quick depletion actions**: "Record sample" / "Taproom depletion" / "Write off" wrapping allocation insert (replaces raw UUID form for common cases).
- [ ] **9.5 Batch trace report**: downstream batch → finished goods → pick allocations → order/customer (buildable now); upstream unlocked by 9.1.

## Batch 10 — Mobile/tablet ergonomics

- [ ] **10.1 Tablet breakpoint**: `use-mobile.ts:5` (768px) gives iPads the dense desktop table; use card list or larger hit areas up to ~1024px for entity lists, or density toggle.
- [ ] **10.2 Mobile card actions**: `entity-mobile-card-list.tsx:223-296` — cards are pure links; add trailing menu exposing valid state transitions.
- [ ] **10.3 Mobile filter sheet**: `entity-data-table.tsx:756-778` — advanced filters/sort unreachable on mobile; reuse nuqs state in a drawer.
- [ ] **10.4 Optimistic transitions**: `setQueryData` + rollback for status changes (list + detail), replacing full-table invalidation; also drop redundant pre-SELECT in `handleSingleTransition` via `.in(stateField, validFromStates)`.

## Deferred / needs user decision

- [d] Search input per-keystroke re-render (`entity-data-table.tsx:236-238`) — fold into Batch 4 work if convenient.
- [d] Missing indexes `batches(created_at)`, `finished_goods(created_at)` — trivial migration, bundle with Batch 8.
- [d] Sequential per-row upserts in settings/pricing, settings/system, recipe-variant-editor — bundle with Batch 6/7.
- [d] cmd+k navigator (cmdk primitive exists, unused) — nice-to-have.
- [d] Pricing page split into `src/components/domain/pricing/` — mechanical, low-risk, low-priority.

## Verification gate (every batch)

`bun lint` && `bun typecheck` && `bun run test` must be green before commit. Migrations only on this branch; `bun db:migrate` pushes to the shared dev DB, so apply only after explicit user confirmation.
