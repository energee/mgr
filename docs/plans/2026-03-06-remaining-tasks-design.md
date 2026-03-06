# Remaining Tasks Design — Projections Report, COGS Report, and Housekeeping

**Date**: 2026-03-06
**Branch**: `workstream-4`
**Approach**: Client-side report pages (Approach A) — consistent with existing reports

---

## Scope

### Implement Now
1. Projections Report (new page)
2. COGS Report (new page with 3 tabs)
3. Fix getClientIp test failures
4. Sync spec docs with actual state machines
5. Formally close/defer P3 decision items
6. Update reports hub and query keys

### Formally Close
- DEC-SIMP-003 (Yeast Brinks) — implemented with modifications (event-based model)
- Email Notifications — fully implemented

### Formally Defer
- DEC-SIMP-001 (Unified Catalog) — already deferred
- DEC-GAP-008 (Approval Workflows) — schema ready, UI deferred
- DEC-GAP-002 (Packaging Rollback) — documented, deferred
- DEC-GAP-007 (Partial Transfers) — documented, deferred

---

## 1. Projections Report

**File**: `src/app/(app)/reports/projections/page.tsx`

### Data Sources
- Orders with status `confirmed`, `scheduled`, or `picking` — linked to recipes
- Batches with status `planned` or `in_progress` — linked to recipes
- Recipe ingredients: `recipe_malts`, `recipe_hops`, `recipe_adjuncts`, `recipe_yeasts` joined to catalog tables
- On-hand inventory: `inventory_lots_with_quantities`

### UI Layout
1. **Filters**: Time horizon selector (30/60/90 days or custom date range)
2. **Summary cards**:
   - Total ingredients needed
   - Ingredients at risk (need > on-hand)
   - Batches/orders in window
3. **Tabs**:
   - **Combined View** (default) — aggregated ingredient needs with source breakdown
   - **By Batch Schedule** — grouped by planned batch
   - **By Order Pipeline** — grouped by order
4. **Table columns**: Ingredient name, Category, Needed qty, On-hand qty, Shortfall, Unit

### Query Strategy
Fetch orders + batches in time window → resolve recipes → fan out to recipe ingredients → aggregate by ingredient → compare against on-hand inventory. All client-side.

---

## 2. COGS Report

**File**: `src/app/(app)/reports/cogs/page.tsx`

### Data Sources
- Batches with allocations (same pattern as batch-cost) for ingredient costs
- `finished_goods` → `packaging_session_line_items` → `packaging_sessions` → `batch_id` for batch-to-SKU linkage
- `selling_formats` + `brands` for SKU names
- `containers` for package type info

### Tab 1: By Batch
Batch Cost Analysis view with added "COGS per unit" column (total batch cost / units packaged). Date range filter. Expandable ingredient detail rows.

### Tab 2: By SKU
- **Filters**: Date range, optional brand filter
- **Table**: SKU (brand + format), Batches used, Total units produced, Avg ingredient cost/unit, Avg cost/BBL
- **Expandable**: Batch-level cost breakdown per SKU
- **Summary cards**: Highest cost SKU, lowest cost SKU, weighted avg cost/unit

### Tab 3: By Period
- **Filters**: Granularity toggle (monthly/quarterly), date range (default last 12 months)
- **Summary cards**: Total COGS, period-over-period change, avg COGS/BBL
- **Bar chart**: Stacked by category (malts, hops, yeast, adjuncts, other) using Recharts
- **Table**: Period, total COGS, category breakdown, batch count

---

## 3. Housekeeping

### 3a: Close/Defer P3 Decisions
Update `docs/spec/decisions.md`:
- DEC-SIMP-003: "Implemented with modifications" — event-based yeast model
- DEC-GAP-008: "Deferred — schema ready, UI post-launch"
- DEC-GAP-002: "Deferred — documented, post-launch"
- DEC-GAP-007: "Deferred — documented, post-launch"
- Email Notifications: "Implemented"

### 3b: Fix getClientIp Tests
Update 2 test expectations in `src/lib/__tests__/api-utils.test.ts` to match the implementation's correct behavior: `x-real-ip` takes priority over `x-forwarded-for`.

### 3c: Sync Spec Docs
Update `docs/spec/workflows.md`:
- Order states: `draft → confirmed → scheduled → picking → packed → fulfilled` (not `out_the_door`)
- Vessel states: `dirty → caustic_cleaned → ready_for_use → in_use` + `maintenance`
- Batch states: add `archived`
- User profiles: `roles TEXT[]` not `role TEXT`

### 3d: Reports Hub
Add Projections and COGS cards to `src/app/(app)/reports/page.tsx` (4 → 6 cards).

### 3e: Query Keys
Add to `src/lib/query-keys.ts`:
- `reportKeys.projections(horizon)` — projections report by time horizon
- `reportKeys.cogs(dateRange)` — COGS report by date range
- `reportKeys.cogsBySku(dateRange)` — COGS by SKU tab
- `reportKeys.cogsByPeriod(granularity, dateRange)` — COGS by period tab
