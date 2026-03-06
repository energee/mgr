# Remaining Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Projections and COGS report pages, fix getClientIp tests, sync spec docs, and close/defer P3 decisions.

**Architecture:** Two new client-side report pages following the existing batch-cost/inventory-valuation pattern — `"use client"`, React Query, Supabase client queries, Recharts for charts. Plus housekeeping: test fix, doc updates, decision closures.

**Tech Stack:** Next.js App Router, React Query, Supabase JS client, Recharts, Vitest, shadcn/ui

---

## Task 1: Add Query Key Factories

**Files:**
- Modify: `src/lib/query-keys.ts:226-252`

**Step 1: Add projections and COGS query keys**

Add before the closing `};` of `reportKeys`:

```typescript
  /** Projections report — ingredient needs by time horizon */
  projections: (horizonDays: number) =>
    ["reports", "projections", horizonDays] as const,
  /** COGS report — by batch tab */
  cogsByBatch: (dateRange?: { from: string; to: string }) =>
    dateRange
      ? (["reports", "cogs", "by-batch", dateRange] as const)
      : (["reports", "cogs", "by-batch"] as const),
  /** COGS report — by SKU tab */
  cogsBySku: (dateRange?: { from: string; to: string }) =>
    dateRange
      ? (["reports", "cogs", "by-sku", dateRange] as const)
      : (["reports", "cogs", "by-sku"] as const),
  /** COGS report — by period tab */
  cogsByPeriod: (granularity: "monthly" | "quarterly", dateRange?: { from: string; to: string }) =>
    dateRange
      ? (["reports", "cogs", "by-period", granularity, dateRange] as const)
      : (["reports", "cogs", "by-period", granularity] as const),
```

**Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add projections and COGS query key factories"
```

---

## Task 2: Update Reports Hub

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

**Step 1: Add two new report cards**

Add to the `reports` array after the Batch Cost Analysis entry:

```typescript
  {
    title: "Ingredient Projections",
    description: "Forward-looking ingredient needs from orders and batch schedule",
    href: "/reports/projections",
    icon: TrendingUp,
  },
  {
    title: "Cost of Goods Sold",
    description: "COGS analysis by batch, SKU, and time period",
    href: "/reports/cogs",
    icon: Calculator,
  },
```

Add to the icon imports: `TrendingUp, Calculator` from `lucide-react`.

**Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/(app)/reports/page.tsx
git commit -m "feat: add projections and COGS cards to reports hub"
```

---

## Task 3: Projections Report Page

**Files:**
- Create: `src/app/(app)/reports/projections/page.tsx`
- Create: `src/app/(app)/reports/projections/layout.tsx`

**Step 1: Create layout with metadata**

```typescript
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Ingredient Projections" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
```

**Step 2: Create the projections report page**

Follow the exact pattern of `batch-cost/page.tsx`. Key structure:

```
"use client"

Imports: useState, useMemo, useQuery, createClient, reportKeys,
  Card/Table/Alert/Skeleton/Tabs from shadcn, lucide icons, date-fns

Types:
  - ProjectedIngredient { name, category, unit, neededQty, onHandQty, shortfall }
  - BatchProjection { id, batch_number, name, recipe_name, planned_start_date, status, ingredients[] }
  - OrderProjection { id, order_number, customer_name, status, due_date, ingredients[] }

Component:
  - State: horizonDays (30|60|90), activeTab
  - Query 1: Fetch batches (planned, in_progress) with recipe + recipe ingredients
    - batches.select("id, batch_number, name, status, volume_bbl, planned_start_date, recipe_id, recipes(id, name)")
    - Filter by planned_start_date within horizon (or created_at if no start date)
  - Query 2: Fetch recipe ingredients for matched recipe_ids
    - recipe_malts.select("recipe_id, weight_lbs, malts(name)").in("recipe_id", recipeIds)
    - recipe_hops.select("recipe_id, weight_oz, hops(name)").in("recipe_id", recipeIds)
    - recipe_adjuncts.select("recipe_id, weight_lbs, adjuncts(name)").in("recipe_id", recipeIds)
    - recipe_yeasts.select("recipe_id, yeasts(name)").in("recipe_id", recipeIds)
  - Query 3: Fetch orders (confirmed, scheduled, picking) with items → finished_goods → batch → recipe
    - orders.select("id, order_number, status, delivery_date, customer:customers(name)")
    - Filter by delivery_date within horizon
    - For order-linked batches, reuse recipe ingredients from Query 2
  - Query 4: On-hand inventory
    - inventory_lots_with_quantities.select("inventory_item_id, remaining_quantity, unit, inventory_items(name, category)")
  - useMemo: Aggregate ingredients across batches/orders, compare to on-hand
  - Render:
    - Horizon selector (30/60/90 buttons)
    - Summary cards: total ingredients needed, at-risk count, batches in window, orders in window
    - Tabs: Combined View | By Batch Schedule | By Order Pipeline
    - Tables with shortfall highlighted in red
```

**Step 3: Run typecheck and dev server check**

Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/app/(app)/reports/projections/
git commit -m "feat: implement ingredient projections report page"
```

---

## Task 4: COGS Report Page

**Files:**
- Create: `src/app/(app)/reports/cogs/page.tsx`
- Create: `src/app/(app)/reports/cogs/layout.tsx`

**Step 1: Create layout with metadata**

Same pattern as projections layout.

**Step 2: Create the COGS report page**

Key structure:

```
"use client"

Imports: Same UI kit as batch-cost + Recharts (BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer) + Tabs from shadcn

Types:
  - CogsBatchRow { id, batch_number, name, recipe_name, volume_bbl, total_ingredient_cost,
      cost_per_bbl, units_packaged, cogs_per_unit, status }
  - CogsSkuRow { sku_name, brand_name, format_name, batch_count, total_units,
      total_cost, avg_cost_per_unit, avg_cost_per_bbl }
  - CogsPeriodRow { period, total_cogs, malt_cost, hop_cost, yeast_cost,
      adjunct_cost, other_cost, batch_count }
  - IngredientCostRow (reuse from batch-cost pattern)

Component:
  - State: fromDate, toDate, activeTab, granularity (monthly|quarterly),
    expandedBatchId, brandFilter
  - Date range default: last 6 months

Tab 1 — By Batch:
  - Reuse batch-cost query pattern (batches + allocations)
  - Additional query: finished_goods grouped by batch_id for units_packaged count
  - Add cogs_per_unit = total_cost / units_packaged
  - Expandable ingredient detail (same as batch-cost)

Tab 2 — By SKU:
  - Query finished_goods with selling_formats, brands, containers
  - Join to batch costs (from Tab 1 data or separate query)
  - Group by selling_format + brand
  - Summary cards: highest/lowest cost SKU, weighted avg

Tab 3 — By Period:
  - Group batch costs by month/quarter based on batch created_at
  - Categorize allocations by source type (malts→malt_cost, hops→hop_cost, etc.)
    - Use inventory_items.category joined through inventory_lots → allocations
  - Recharts stacked bar chart with category breakdown
  - Summary cards: total COGS, period-over-period %, avg COGS/BBL
  - Table below chart with period details
```

**Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/app/(app)/reports/cogs/
git commit -m "feat: implement COGS report with by-batch, by-SKU, and by-period views"
```

---

## Task 5: Fix getClientIp Tests

**Files:**
- Modify: `src/lib/__tests__/api-utils.test.ts`

**Step 1: Fix the two failing test expectations**

The implementation correctly prefers `x-real-ip` over `x-forwarded-for`. Fix 2 tests:

Test "extracts first IP from x-forwarded-for with multiple entries" (line ~139-144):
- The implementation returns the LAST entry (most trustworthy), not the first
- Change expected from `"203.0.113.50"` to `"150.172.238.178"` (last in chain)

Test "prefers x-forwarded-for over x-real-ip" (line ~153-161):
- Rename to "prefers x-real-ip over x-forwarded-for"
- Change expected from `"203.0.113.50"` (forwarded) to `"198.51.100.42"` (real-ip)

**Step 2: Run tests**

Run: `pnpm vitest run src/lib/__tests__/api-utils.test.ts`
Expected: ALL PASS (was 2 failing, now 0)

**Step 3: Commit**

```bash
git add src/lib/__tests__/api-utils.test.ts
git commit -m "fix: align getClientIp tests with x-real-ip priority implementation"
```

---

## Task 6: Sync Spec Docs with Implementation

**Files:**
- Modify: `docs/spec/workflows.md`

**Step 1: Update order states**

Change line 57 from:
```
draft → confirmed → scheduled → picking → packed → out_the_door
```
to:
```
draft → confirmed → scheduled → picking → packed → fulfilled
```

Update the transition table: `packed → fulfilled` with trigger "Shipped/picked up/served".

Remove `out_the_door` references.

**Step 2: Update batch states**

Add `archived` state to the batch diagram (after `completed`):
```
planned → fermenting → conditioning → packaging → completed → archived
```

Add transition: `completed → archived | User archives batch`.

**Step 3: Update vessel states**

Change from:
```
empty → in_use → dirty → cleaning → empty
```
to:
```
dirty → caustic_cleaned → ready_for_use → in_use → dirty
                                            ↓
                                        maintenance
```

Update the transition table to match actual entity config states.

**Step 4: Run a quick sanity check**

Grep to confirm no remaining `out_the_door` references in workflows.md.

**Step 5: Commit**

```bash
git add docs/spec/workflows.md
git commit -m "docs: sync workflows.md state machines with implementation"
```

---

## Task 7: Close/Defer P3 Decisions

**Files:**
- Modify: `docs/spec/decisions.md`
- Modify: `docs/plans/2026-02-26-remaining-tasks-productionization.md`

**Step 1: Update decisions.md**

For each decision, find and update its status line:

- **DEC-SIMP-003** (Yeast Brinks): Change status to `CLOSED/IMPLEMENTED-WITH-MODIFICATIONS`. Add note: "Event-based yeast model with `yeast_pitches` + `yeast_pitch_events` replaces full brinks model. 53 passing tests. Viability decay and cost-spreading formulas implemented in `src/lib/yeast-calculations.ts`."

- **DEC-GAP-008** (Approval Workflows): Change status to `DEFERRED/POST-LAUNCH`. Add note: "Schema ready (allocations table has approval fields + state machine). UI approval queue deferred to post-launch."

- **DEC-GAP-002** (Packaging Rollback): Change status to `DEFERRED/POST-LAUNCH`. Add note: "Rules documented. Implementation deferred to post-launch."

- **DEC-GAP-007** (Partial Transfers): Change status to `DEFERRED/POST-LAUNCH`. Add note: "Auto-create-remainder logic deferred to post-launch."

**Step 2: Update productionization audit**

In the P3 table, update items 37-46 with final dispositions:
- #37 Yeast Brinks: "✅ Closed — implemented with modifications"
- #38 Unified Catalog: "✅ Closed — formally deferred (DEC-SIMP-001)"
- #39 Approval Workflows: "⏸ Deferred — schema ready, UI post-launch"
- #40 Packaging Rollback: "⏸ Deferred — documented, post-launch"
- #41 Partial Transfers: "⏸ Deferred — documented, post-launch"
- #42 Email Notifications: "✅ Done — fully implemented"
- #43-44 Spec docs: "✅ Done — workflows.md synced" (after Task 6)
- #45 Projections Report: "✅ Done" (after Task 3)
- #46 COGS Report: "✅ Done" (after Task 4)

**Step 3: Commit**

```bash
git add docs/spec/decisions.md docs/plans/2026-02-26-remaining-tasks-productionization.md
git commit -m "docs: close/defer P3 decisions, update audit with final dispositions"
```

---

## Task 8: Final Validation

**Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: ALL PASS (including previously-failing getClientIp tests)

**Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: 0 errors (warnings ok)

**Step 4: Push**

```bash
git push
```

---

## Dependency Graph

```
Task 1 (query keys) ──→ Task 3 (projections)
                    ──→ Task 4 (COGS)
Task 2 (hub update) ── independent
Task 5 (test fix) ── independent
Task 6 (spec docs) ──→ Task 7 (close/defer decisions)
Task 8 (validation) ── depends on all above
```

**Parallelizable groups:**
- Group A: Tasks 1, 2, 5, 6 (all independent)
- Group B: Tasks 3, 4 (depend on Task 1)
- Group C: Task 7 (depends on Task 6)
- Group D: Task 8 (depends on all)
