# Code Review Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues found during comprehensive code review: hardcoded query keys, duplicated hooks, DEC-008 violations, broken entity relations, unused code, N+1 query, and minor issues.

**Architecture:** Mechanical refactoring with no behavior changes. Each task is independent and commits separately. Query key centralization is the largest task; the rest are surgical fixes.

**Tech Stack:** TypeScript, React Query, Supabase, Next.js App Router

**Worktree:** `/Users/tedslesinski/Repos/mgr/.worktrees/cleanup` on branch `fix/code-review-cleanup`

**Test baseline:** 262 tests passing (run `npx vitest run` to verify)

---

## Task 1: Remove Unused Dependencies and Dead Code

**Files:**
- Delete: `src/lib/retry.ts`
- Modify: `package.json`

**Step 1: Delete retry.ts**

```bash
rm src/lib/retry.ts
```

**Step 2: Remove unused tanstack packages**

```bash
npm uninstall @tanstack/react-form @tanstack/react-virtual @tanstack/zod-form-adapter
```

**Step 3: Run tests**

```bash
npx vitest run
```

Expected: 262 tests passing (retry.ts had no tests, no imports)

**Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove unused retry.ts and tanstack form/virtual packages"
```

---

## Task 2: Fix DEC-008 Violations (Empty String Select Values)

**Files:**
- Modify: `src/entities/package-type.tsx`
- Modify: `src/entities/user-profile.tsx`
- Modify: `src/entities/yeast-pitch.tsx`
- Modify: `src/entities/keg-transaction.tsx`

For list filters, remove the `{ value: "", label: "All..." }` entries entirely -- `entity-list.tsx` adds "All" automatically.

For form fields (keg-transaction), change `""` to `"_none"` sentinel.

**Step 1: Fix package-type.tsx**

In `src/entities/package-type.tsx`, find the filter options (around line 120):
```typescript
options: [{ value: "", label: "All" }, ...CONTAINER_TYPE_OPTIONS],
```
Replace with:
```typescript
options: CONTAINER_TYPE_OPTIONS,
```

**Step 2: Fix user-profile.tsx**

In `src/entities/user-profile.tsx`, find the filter options (around lines 173, 179):
```typescript
options: [{ value: "", label: "All Roles" }, ...ROLE_OPTIONS],
```
Replace with:
```typescript
options: ROLE_OPTIONS,
```
And:
```typescript
options: [{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS],
```
Replace with:
```typescript
options: STATUS_OPTIONS,
```

**Step 3: Fix yeast-pitch.tsx**

In `src/entities/yeast-pitch.tsx`, find the filter options (around lines 167, 173):
```typescript
options: [{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS],
```
Replace with:
```typescript
options: STATUS_OPTIONS,
```
And:
```typescript
options: [{ value: "", label: "All Sources" }, ...SOURCE_TYPE_OPTIONS],
```
Replace with:
```typescript
options: SOURCE_TYPE_OPTIONS,
```

**Step 4: Fix keg-transaction.tsx**

In `src/entities/keg-transaction.tsx`, find the form field option (around line 340):
```typescript
{ value: "", label: "None (New Kegs)" },
```
Replace with:
```typescript
{ value: "_none", label: "None (New Kegs)" },
```

**Step 5: Run tests**

```bash
npx vitest run
```

Expected: 262 tests passing

**Step 6: Commit**

```bash
git add src/entities/package-type.tsx src/entities/user-profile.tsx src/entities/yeast-pitch.tsx src/entities/keg-transaction.tsx
git commit -m "fix: remove empty string select values per DEC-008"
```

---

## Task 3: Fix Broken Entity Relations

**Files to modify:** 11 entity config files

The approach: remove relations that reference unregistered entities. These relations are dead code -- the universal detail component silently ignores relations it can't resolve, but they clutter the configs and could cause errors if the resolution logic changes. Do NOT create new entity configs for junction tables -- these are rendered by custom domain components (grain-bill-editor, etc.), not by the universal detail component.

**Step 1: Fix brew-log.tsx**

In `src/entities/brew-log.tsx`, in the `relations` array:
- Change `entity: "user"` to `entity: "user_profile"` (the brewer relation)
- Remove the entire `brew_log_batch` relation object (it's a junction table rendered by `brew-log-batches.tsx` custom component)

**Step 2: Fix batch.tsx**

In `src/entities/batch.tsx`, in the `relations` array:
- Remove the `batch_log` relation (audit logs rendered by custom component)
- Remove the `batch_blend` relation (blends rendered by custom component)

**Step 3: Fix recipe.tsx**

In `src/entities/recipe.tsx`, in the `relations` array, remove ALL of:
- `recipe_malt` relation (rendered by grain-bill-editor)
- `recipe_hop` relation (rendered by hop-schedule-editor)
- `beer_style` relation (not a has-many, rendered inline)
- `yeast` relation (rendered by yeast-selector)
- `water_profile` relation (rendered inline)

**Step 4: Fix vessel.tsx**

In `src/entities/vessel.tsx`, in the `relations` array:
- Remove the `vessel_cleaning` relation

**Step 5: Fix supplier.tsx**

In `src/entities/supplier.tsx`, in the `relations` array:
- Remove the `supplier_catalog` relation

**Step 6: Fix inventory-item.tsx**

In `src/entities/inventory-item.tsx`, in the `relations` array:
- Remove the `allocation` relation

**Step 7: Fix finished-good.tsx**

In `src/entities/finished-good.tsx`, in the `relations` array:
- Remove the `allocation` relation

**Step 8: Fix order-item.tsx**

In `src/entities/order-item.tsx`, in the `relations` array:
- Remove the `brand` relation

**Step 9: Fix session-line-item.tsx**

In `src/entities/session-line-item.tsx`, in the `relations` array:
- Remove the `brand` relation

**Step 10: Fix tier-price.tsx**

In `src/entities/tier-price.tsx`, in the `relations` array:
- Remove the `brand` relation
- Remove the `beer_style` relation

**Step 11: Fix pick-list.tsx**

In `src/entities/pick-list.tsx`, in the `relations` array:
- Remove the `pick_list_item` relation

**Step 12: Run tests**

```bash
npx vitest run
```

Expected: 262 tests passing

**Step 13: Commit**

```bash
git add src/entities/
git commit -m "fix: remove broken entity relations referencing unregistered entities"
```

---

## Task 4: Add Missing Query Key Factories

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `src/lib/__tests__/query-keys.test.ts`

**Step 1: Add missing key factories to query-keys.ts**

Add the following new factory sections. Place each near related existing factories:

```typescript
// =============================================================================
// Catalog Keys - add missing entries
// =============================================================================

// Add to existing catalogKeys object:
  spices: () => ["spices-catalog"] as const,
  sugars: () => ["sugars-catalog"] as const,
  additives: () => ["additives-catalog"] as const,

// =============================================================================
// Brands/Package Types Keys (shared lookup data)
// =============================================================================

export const brandKeys = {
  all: () => ["brands"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["brands", "list", filters] as const) : (["brands", "list"] as const),
};

export const packageTypeKeys = {
  all: () => ["package-types"] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? (["package-types", "list", filters] as const) : (["package-types", "list"] as const),
};

// =============================================================================
// Keg Report Keys
// =============================================================================

export const kegKeys = {
  fleetSummary: () => ["keg_fleet_summary"] as const,
  turnoverMetrics: () => ["keg_turnover_metrics"] as const,
  agingReport: () => ["keg_aging_report"] as const,
  customerBalances: (customerId?: string) =>
    customerId
      ? (["customer_keg_balances", customerId] as const)
      : (["customer_keg_balances"] as const),
};

// =============================================================================
// Batch Sub-resource Keys (additions, readings, insights)
// =============================================================================

// Add to existing batchKeys object:
  additions: (id: string) => ["batch-additions", id] as const,
  performance: (id: string) => ["batch-performance", id] as const,
  brewLogs: (id: string) => ["batch-brew-logs", id] as const,
  availableBrewLogs: (id: string) => ["available-brew-logs", id] as const,

// =============================================================================
// Recipe Sub-resource Keys
// =============================================================================

// Add to existing recipeKeys object:
  styleCompliance: (id: string) => ["recipe-style-compliance", id] as const,
  suggestions: (id: string) => ["recipe-suggestions", id] as const,
  cogs: (id: string) => ["recipe-cogs", id] as const,
  fermentationAdditions: (id: string) => ["recipe-fermentation-additions", id] as const,

// =============================================================================
// Brew Log Keys
// =============================================================================

export const brewLogKeys = {
  all: () => ["brew_logs"] as const,
  detail: (id: string) => ["brew_logs", id] as const,
  batches: (id: string) => ["brew_log_batches", id] as const,
};

// =============================================================================
// Settings Sub-keys
// =============================================================================

// Add to existing settingsKeys object:
  system: () => ["system-settings"] as const,
  pricingStats: () => ["pricing-stats"] as const,
  notificationPreferences: () => ["notification-preferences"] as const,

// =============================================================================
// Session Line Item Keys
// =============================================================================

export const sessionLineItemKeys = {
  all: (sessionId: string) => ["session-line-items", sessionId] as const,
};

// =============================================================================
// Order Sub-resource Keys
// =============================================================================

// Add to existing orderKeys object:
  allocations: (id: string) => ["order-allocations", id] as const,
  pickList: (id: string, subKey?: string) =>
    subKey
      ? (["order-pick-list", id, subKey] as const)
      : (["order-pick-list", id] as const),

// =============================================================================
// Vessel Keys
// =============================================================================

export const vesselKeys = {
  all: () => ["vessels"] as const,
  available: () => ["vessels", "available"] as const,
  transfers: () => ["vessel_transfers"] as const,
};

// =============================================================================
// Inventory Sub-keys
// =============================================================================

// Add to existing inventoryKeys:
  overview: () => ["inventory-overview"] as const,
  finishedGoods: () => ["finished-goods"] as const,
  finishedGoodsAvailable: () => ["finished-goods-available"] as const,

// =============================================================================
// User Keys - consolidate with useUnitPreferences
// =============================================================================

// Update existing userKeys to include unit preference keys:
  units: () => ["user", "preferences", "units"] as const,
  full: () => ["user", "preferences", "full"] as const,

// =============================================================================
// TTB Report Keys
// =============================================================================

// Add to existing reportKeys:
  ttbBatches: (year: number, month: number) => ["ttb-batches", year, month] as const,
```

IMPORTANT: When implementing, integrate these into the existing factory objects where noted (e.g., add `additions` to `batchKeys`, not as a separate export). Only create new exports for genuinely new groups.

**Step 2: Update query-keys tests**

Add tests for each new factory in `src/lib/__tests__/query-keys.test.ts`. Follow the existing test pattern -- each factory gets a `describe` block with tests verifying the returned array structure.

**Step 3: Run tests**

```bash
npx vitest run
```

Expected: All existing tests pass + new tests pass

**Step 4: Commit**

```bash
git add src/lib/query-keys.ts src/lib/__tests__/query-keys.test.ts
git commit -m "feat: add missing query key factories for all hardcoded keys"
```

---

## Task 5: Replace All Hardcoded Query Keys with Factory Calls

**Files:** ~30 files across `src/components/domain/` and `src/app/`

This is the largest task. Work through each file systematically, replacing hardcoded `queryKey: [...]` with the appropriate factory import. Group by area.

**Important pattern:** For each file:
1. Add the import for the relevant key factory at the top
2. Replace the hardcoded array with the factory call
3. Also replace hardcoded keys used in `queryClient.invalidateQueries()` calls

**Step 1: Fix catalog editors (8 files)**

These files already have the correct key _values_ (e.g., `["malts-catalog"]`), just need to use the factory:

| File | Old | New |
|------|-----|-----|
| `src/components/domain/grain-bill-editor.tsx:94` | `["malts-catalog"]` | `catalogKeys.malts()` |
| `src/components/domain/hop-schedule-editor.tsx:117` | `["hops-catalog"]` | `catalogKeys.hops()` |
| `src/components/domain/yeast-selector.tsx:96` | `["yeasts-catalog"]` | `catalogKeys.yeasts()` |
| `src/components/domain/adjunct-editor.tsx:107` | `["adjuncts-catalog"]` | `catalogKeys.adjuncts()` |
| `src/components/domain/fruit-editor.tsx:125` | `["fruits-catalog"]` | `catalogKeys.fruits()` |
| `src/components/domain/spice-editor.tsx:117` | `["spices-catalog"]` | `catalogKeys.spices()` |
| `src/components/domain/sugar-editor.tsx:110` | `["sugars-catalog"]` | `catalogKeys.sugars()` |
| `src/components/domain/additions-editor.tsx:134` | `["additives-catalog"]` | `catalogKeys.additives()` |

Add `import { catalogKeys } from "@/lib/query-keys";` to each file.

**Step 2: Fix brands/package-types fetching (4 files)**

| File | Old | New |
|------|-----|-----|
| `src/components/domain/session-line-items-editor.tsx:116` | `["brands"]` | `brandKeys.all()` |
| `src/components/domain/session-line-items-editor.tsx:130` | `["package-types"]` | `packageTypeKeys.all()` |
| `src/components/domain/order-items-editor.tsx:190` | `["brands"]` | `brandKeys.all()` |
| `src/components/domain/order-items-editor.tsx:204` | `["package-types"]` | `packageTypeKeys.all()` |
| `src/components/domain/order-allocation.tsx:120` | `["brands"]` | `brandKeys.all()` |
| `src/components/domain/order-allocation.tsx:133` | `["package-types"]` | `packageTypeKeys.all()` |
| `src/components/domain/recipe-clone-dialog.tsx:75` | `["brands"]` | `brandKeys.all()` |

**Step 3: Fix batch-related pages and components**

| File | Old | New |
|------|-----|-----|
| `src/app/(app)/production/batches/[id]/page.tsx:33,64` | `["batches", id]` | `batchKeys.detail(id)` |
| `src/app/(app)/production/batches/[id]/additions/page.tsx:54` | `["batch", id]` | `batchKeys.detail(id)` |
| `src/app/(app)/production/batches/[id]/additions/page.tsx:68,97` | `["batch-additions", id]` | `batchKeys.additions(id)` |
| `src/app/(app)/production/batches/[id]/readings/page.tsx:55` | `["batch", id]` | `batchKeys.detail(id)` |
| `src/app/(app)/production/batches/[id]/readings/page.tsx:69,98` | `["batch-readings", id]` | `batchKeys.readings(id)` |
| `src/components/domain/batch-insights.tsx:208` | `["batch-performance", batchId]` | `batchKeys.performance(batchId)` |
| `src/components/domain/batch-addition-form.tsx:148` | `["catalog", config.catalogTable]` | `catalogKeys.table(config.catalogTable)` |
| `src/components/domain/brew-log-linker.tsx:76,141` | `["batch-brew-logs", batchId]` | `batchKeys.brewLogs(batchId)` |
| `src/components/domain/brew-log-linker.tsx:102` | `["available-brew-logs", batchId]` | `batchKeys.availableBrewLogs(batchId)` |
| `src/components/domain/brew-log-linker.tsx:142,165` | `["batch", batchId]` | `batchKeys.detail(batchId)` |
| `src/components/domain/start-fermentation-dialog.tsx:78` | `["vessels", "available"]` | `vesselKeys.available()` |
| `src/components/domain/start-fermentation-dialog.tsx:124` | `["batches"]` | `batchKeys.all()` |
| `src/components/domain/start-fermentation-dialog.tsx:125` | `["vessels"]` | `vesselKeys.all()` |
| `src/components/domain/start-fermentation-dialog.tsx:126` | `["vessel_transfers"]` | `vesselKeys.transfers()` |
| `src/components/domain/planned-additions.tsx:60` | `["recipe-fermentation-additions", recipeId]` | `recipeKeys.fermentationAdditions(recipeId)` |

**Step 4: Fix recipe-related pages and components**

| File | Old | New |
|------|-----|-----|
| `src/app/(app)/production/recipes/[id]/page.tsx:24` | `["recipes", id]` | `recipeKeys.detail(id)` |
| `src/app/(app)/production/recipes/[id]/additions/page.tsx:35,133` | `["recipe", id]` | `recipeKeys.detail(id)` |
| `src/app/(app)/production/recipes/[id]/additions/page.tsx:49,132` | `["recipe-additions", id]` | `recipeKeys.additions(id)` |
| `src/components/domain/recipe-analysis.tsx:152` | `["recipe-style-compliance", recipeId]` | `recipeKeys.styleCompliance(recipeId)` |
| `src/components/domain/recipe-analysis.tsx:168` | `["recipe-suggestions", recipeId]` | `recipeKeys.suggestions(recipeId)` |
| `src/components/domain/recipe-cogs-display.tsx:99` | `["recipe-cogs", recipeId]` | `recipeKeys.cogs(recipeId)` |
| `src/components/domain/recipe-additions-display.tsx:89` | `["recipe-additions", recipeId]` | `recipeKeys.additions(recipeId)` |
| `src/components/domain/recipe-clone-dialog.tsx:140` | `["recipes"]` | `recipeKeys.all()` |

**Step 5: Fix order/sales components**

| File | Old | New |
|------|-----|-----|
| `src/app/(app)/sales/orders/[id]/allocations/page.tsx:72` | `["order", id]` | `orderKeys.detail(id)` |
| `src/app/(app)/sales/orders/[id]/allocations/page.tsx:86,150,285` | `["order-allocations", id]` | `orderKeys.allocations(id)` |
| `src/app/(app)/sales/orders/[id]/allocations/page.tsx:151` | `["finished-goods"]` | `inventoryKeys.finishedGoods()` |
| `src/components/domain/order-items-editor.tsx:104,228,270,284` | `["order-items", orderId]` | `orderKeys.items(orderId)` |
| `src/components/domain/order-items-editor.tsx:121` | `["order", orderId]` | `orderKeys.detail(orderId)` |
| `src/components/domain/order-allocation.tsx:81,169` | `["order", orderId]` | `orderKeys.detail(orderId)` |
| `src/components/domain/order-allocation.tsx:96` | `["finished-goods-available"]` | `inventoryKeys.finishedGoodsAvailable()` |
| `src/components/domain/order-allocation.tsx:170` | `["finished-goods"]` | `inventoryKeys.finishedGoods()` |
| `src/components/domain/order-allocation.tsx:171` | `["allocations"]` | `inventoryKeys.allocations()` |
| `src/components/domain/order-pick-list.tsx:79` | `["order-pick-list", orderId, "order"]` | `orderKeys.pickList(orderId, "order")` |
| `src/components/domain/order-pick-list.tsx:109` | `["order-pick-list", orderId, "items"]` | `orderKeys.pickList(orderId, "items")` |
| `src/components/domain/session-line-items-editor.tsx:92,155,188,205` | `["session-line-items", sessionId]` | `sessionLineItemKeys.all(sessionId)` |

**Step 6: Fix PO components**

| File | Old | New |
|------|-----|-----|
| `src/components/domain/po-line-items-editor.tsx:92,176,196,210` | `["po-line-items", poId]` | `purchaseOrderKeys.lineItems(poId)` |
| `src/components/domain/po-line-items-editor.tsx:145` | `["catalog-items", newItem.catalog_type]` | `catalogKeys.items(newItem.catalog_type)` |
| `src/components/domain/po-receiving.tsx:107,280` | `["po-line-items-for-receive", poId]` | `purchaseOrderKeys.lineItemsForReceive(poId)` |
| `src/components/domain/po-receiving.tsx:279` | `["po-line-items", poId]` | `purchaseOrderKeys.lineItems(poId)` |
| `src/components/domain/po-receiving.tsx:281` | `["purchase-order", poId]` | `purchaseOrderKeys.detail(poId)` |

**Step 7: Fix yeast, brew-log, revision, and misc components**

| File | Old | New |
|------|-----|-----|
| `src/components/domain/yeast-lineage-display.tsx:43` | `["yeast-lineage-root", pitchId]` | `yeastKeys.lineageRoot(pitchId)` |
| `src/components/domain/yeast-lineage-display.tsx:81` | `["yeast-lineage", root?.id]` | `yeastKeys.lineage(root?.id)` |
| `src/components/domain/yeast-lineage-display.tsx:120` | `["yeast-lineage-summary", root?.id]` | `yeastKeys.lineageSummary(root?.id)` |
| `src/app/(app)/production/brew-logs/[id]/events/page.tsx:30,54` | `["brew_logs", id]` | `brewLogKeys.detail(id)` |
| `src/components/domain/brew-log-batches.tsx:50` | `["brew_log_batches", data.id]` | `brewLogKeys.batches(data.id)` |
| `src/components/domain/brew-log-timeline.tsx:43` | `["brew_logs", data.id]` | `brewLogKeys.detail(data.id)` |
| `src/components/domain/revision-history.tsx:308,393` | `["entity_revisions", entityType, entityId]` | `revisionKeys.forEntity(entityType, entityId)` |
| `src/app/(app)/production/yeast-pitches/[id]/page.tsx:36` | `["locations"]` | `entityKeys.all("locations")` |
| `src/components/domain/inventory-alerts.tsx:233` | `["inventory-overview"]` | `inventoryKeys.overview()` |
| `src/components/domain/customer-keg-balances.tsx:54` | `["customer_keg_balances", customerId]` | `kegKeys.customerBalances(customerId)` |

**Step 8: Fix settings and report pages**

| File | Old | New |
|------|-----|-----|
| `src/app/(app)/settings/system/page.tsx:114,160` | `["system-settings"]` | `settingsKeys.system()` |
| `src/app/(app)/settings/pricing/page.tsx:27` | `["pricing-stats"]` | `settingsKeys.pricingStats()` |
| `src/app/(app)/settings/notifications/page.tsx:79,146` | `["notification-preferences"]` | `settingsKeys.notificationPreferences()` |
| `src/app/(app)/reports/ttb/page.tsx:142` | `["ttb-report", year, month]` | `reportKeys.ttb({ year, month })` |
| `src/app/(app)/reports/ttb/page.tsx:165` | `["ttb-batches", year, month]` | `reportKeys.ttbBatches(year, month)` |
| `src/app/(app)/inventory/kegs/reports/page.tsx:104` | `["keg_fleet_summary"]` | `kegKeys.fleetSummary()` |
| `src/app/(app)/inventory/kegs/reports/page.tsx:117` | `["keg_turnover_metrics"]` | `kegKeys.turnoverMetrics()` |
| `src/app/(app)/inventory/kegs/reports/page.tsx:130` | `["keg_aging_report"]` | `kegKeys.agingReport()` |
| `src/app/(app)/inventory/kegs/reports/page.tsx:145` | `["customer_keg_balances"]` | `kegKeys.customerBalances()` |

**Step 9: Fix notification page**

| File | Old | New |
|------|-----|-----|
| `src/app/(app)/notifications/page.tsx:126` | `["notifications", "all", page, ...]` | `notificationKeys.list({ page, ... })` |
| `src/app/(app)/notifications/page.tsx:183,207` | `["notifications"]` | `notificationKeys.all()` |

**Step 10: Consolidate useUnitPreferences query keys**

In `src/hooks/useUnitPreferences.ts`:
- Remove the local `userPreferencesKeys` export (lines 59-63)
- Import `userKeys` from `@/lib/query-keys`
- Replace `userPreferencesKeys.units()` with `userKeys.units()`
- Replace `userPreferencesKeys.full()` with `userKeys.full()`
- Search for any other files importing `userPreferencesKeys` and update them too

**Step 11: Run tests**

```bash
npx vitest run
```

Expected: All tests pass. The query-keys tests should still pass since the factory values haven't changed, only the consuming code.

**Step 12: Verify no remaining hardcoded keys**

```bash
grep -rn 'queryKey: \[' src/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules' | grep -v 'query-keys'
```

Expected: Zero results (or only the timeline page if it uses a composed key with spread).

**Step 13: Commit**

```bash
git add -A
git commit -m "refactor: replace all hardcoded query keys with centralized factories"
```

---

## Task 6: Extract Shared Catalog Hook

**Files:**
- Create: `src/hooks/use-catalog.ts`
- Modify: 8 catalog editor files
- Modify: `src/components/domain/session-line-items-editor.tsx`
- Modify: `src/components/domain/order-items-editor.tsx`
- Modify: `src/components/domain/order-allocation.tsx`
- Modify: `src/components/domain/recipe-clone-dialog.tsx`

**Step 1: Create the shared hook**

Create `src/hooks/use-catalog.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brandKeys, packageTypeKeys, catalogKeys } from "@/lib/query-keys";

/**
 * Generic hook for fetching active catalog items from a Supabase table.
 *
 * @param queryKey - The React Query cache key (use a factory from query-keys.ts)
 * @param table - The Supabase table name
 * @param select - The fields to select
 * @param orderBy - Fields to order by (applied in order)
 */
export function useCatalog<T>(
  queryKey: readonly unknown[],
  table: string,
  select: string,
  orderBy: string[] = ["name"]
) {
  const supabase = createClient();

  return useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from(table)
        .select(select)
        .eq("is_active", true);

      for (const field of orderBy) {
        query = query.order(field);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as T[];
    },
  });
}

/** Fetch active brands (id, name) */
export function useBrands() {
  return useCatalog<{ id: string; name: string }>(
    brandKeys.all(),
    "brands",
    "id, name"
  );
}

/** Fetch active package types (id, name) */
export function usePackageTypes() {
  return useCatalog<{ id: string; name: string }>(
    packageTypeKeys.all(),
    "package_types",
    "id, name"
  );
}
```

**Step 2: Update each catalog editor to use the shared hook**

For each of the 8 catalog editors, replace the inline `useQuery` + `createClient` pattern with the `useCatalog` hook. Example for `grain-bill-editor.tsx`:

Before:
```typescript
const supabase = createClient();
const { data: catalog = [], isLoading } = useQuery({
  queryKey: catalogKeys.malts(),
  queryFn: async () => {
    const { data, error } = await supabase
      .from("malts")
      .select("id, name, maltster, type, color_lovibond, potential_ppg")
      .eq("is_active", true)
      .order("type")
      .order("name");
    if (error) throw error;
    return data as MaltCatalogItem[];
  },
});
```

After:
```typescript
const { data: catalog = [], isLoading } = useCatalog<MaltCatalogItem>(
  catalogKeys.malts(),
  "malts",
  "id, name, maltster, type, color_lovibond, potential_ppg",
  ["type", "name"]
);
```

Remove the `createClient` import and `const supabase = createClient()` line if they're no longer used by anything else in the file (check for mutation calls that still need supabase).

Apply same pattern to all 8 editors:
- `grain-bill-editor.tsx` - table: `malts`, fields: `id, name, maltster, type, color_lovibond, potential_ppg`, order: `["type", "name"]`
- `hop-schedule-editor.tsx` - table: `hops`, fields: `id, name, origin, type, alpha_acid_typical, flavor_profile`, order: `["type", "name"]`
- `yeast-selector.tsx` - table: `yeasts`, fields: `id, name, manufacturer, product_code, type, form, attenuation_typical, temp_min_f, temp_max_f, flocculation`, order: `["manufacturer", "name"]`
- `adjunct-editor.tsx` - table: `adjuncts`, fields: `id, name, type, color_lovibond, potential_ppg, requires_mash`, order: `["type", "name"]`
- `fruit-editor.tsx` - table: `fruits`, fields: `id, name, type, form, sugar_content`, order: `["type", "name"]`
- `spice-editor.tsx` - table: `spices`, fields: `id, name, type, typical_amount, typical_unit`, order: `["type", "name"]`
- `sugar-editor.tsx` - table: `sugars`, fields: `id, name, type, color_lovibond, potential_ppg, fermentability`, order: `["type", "name"]`
- `additions-editor.tsx` - table: `additives`, fields: `id, name, type, description, typical_amount, typical_unit`, order: `["type", "name"]`

**Step 3: Update brands/package-types consumers**

Replace inline brands/packageTypes queries in these files with `useBrands()` and `usePackageTypes()`:
- `src/components/domain/session-line-items-editor.tsx`
- `src/components/domain/order-items-editor.tsx`
- `src/components/domain/order-allocation.tsx`
- `src/components/domain/recipe-clone-dialog.tsx` (brands only)

**Step 4: Run tests**

```bash
npx vitest run
```

Expected: 262+ tests passing

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract shared useCatalog, useBrands, usePackageTypes hooks"
```

---

## Task 7: Fix DEC-007 Violation (Hardcoded Status Labels)

**Files:**
- Modify: `src/components/domain/brew-log-batches.tsx`

**Step 1: Replace hardcoded status labels**

In `src/components/domain/brew-log-batches.tsx`, remove the `batchStateDisplay` constant (lines 32-45).

Import `batchEntity` from `@/entities/batch` and `getStateLabel` from `@/types/entity` (or wherever the helper lives).

Replace usage like:
```typescript
batchStateDisplay[status]?.label || status
```
With:
```typescript
getStateLabel(batchEntity, status)
```

And for color, use the entity config's `stateDisplay` if available. Check how other components access state colors from entity configs and follow the same pattern.

**Step 2: Run tests**

```bash
npx vitest run
```

**Step 3: Commit**

```bash
git add src/components/domain/brew-log-batches.tsx
git commit -m "fix: use entity config for batch status labels per DEC-007"
```

---

## Task 8: Fix N+1 Query in Yeast Lineage Display

**Files:**
- Modify: `src/components/domain/yeast-lineage-display.tsx`

**Step 1: Replace recursive queries with single fetch + in-memory tree build**

In `src/components/domain/yeast-lineage-display.tsx`, replace the `getDescendants` recursive function (lines ~91-112) with a single query that fetches all pitches sharing the same `root_strain_id` (or lineage root), then build the tree in JavaScript.

The current approach:
```typescript
async function getDescendants(parentId: string | null, depth: number = 0) {
  const query = parentId
    ? supabase.from("yeast_pitches_with_details").select("*").eq("parent_pitch_id", parentId)
    : supabase.from("yeast_pitches_with_details").select("*").eq("id", root!.id);
  const { data: pitches } = await query;
  if (pitches) {
    for (const pitch of pitches) {
      result.push(pitch as PitchNode);
      await getDescendants(pitch.id, depth + 1);
    }
  }
}
```

Replace with:
```typescript
// Fetch all pitches in one query using the root's strain
const { data: allPitches } = await supabase
  .from("yeast_pitches_with_details")
  .select("*")
  .eq("yeast_strain_id", root!.yeast_strain_id)
  .order("created_at", { ascending: true });

if (!allPitches) return [];

// Build tree from flat list
const childrenMap = new Map<string | null, typeof allPitches>();
for (const pitch of allPitches) {
  const parentId = pitch.parent_pitch_id;
  if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
  childrenMap.get(parentId)!.push(pitch);
}

// DFS traversal to build ordered result
function traverse(id: string | null) {
  const children = childrenMap.get(id) || [];
  for (const child of children) {
    result.push(child as PitchNode);
    traverse(child.id);
  }
}
traverse(root!.parent_pitch_id); // Start from root's parent to include root
```

Adjust the exact field names and filtering to match the actual data model. The key change is: **one query instead of N recursive queries**.

If the `yeast_strain_id` filter is too broad (multiple lineage trees for the same strain), filter more narrowly or fetch all and filter in memory -- still far better than N+1.

**Step 2: Run tests**

```bash
npx vitest run
```

**Step 3: Commit**

```bash
git add src/components/domain/yeast-lineage-display.tsx
git commit -m "perf: replace N+1 yeast lineage queries with single fetch + in-memory tree"
```

---

## Task 9: Remove "use client" from Static Pages

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`
- Modify: `src/app/(app)/settings/integrations/page.tsx`

**Step 1: Check and remove**

In each file, remove the `"use client";` directive at the top. Verify the file has no hooks (`useState`, `useEffect`, `useRouter`, etc.) or event handlers that require client-side execution.

If either file uses `useRouter` for navigation, replace with `<Link>` from `next/link` (which works in server components).

**Step 2: Run a build check**

```bash
npx next build 2>&1 | tail -20
```

If the build fails because the component actually needs client features, revert and skip.

**Step 3: Commit**

```bash
git add src/app/(app)/reports/page.tsx src/app/(app)/settings/integrations/page.tsx
git commit -m "perf: convert static hub pages to server components"
```

---

## Task 10: Consolidate Duplicated PG Error Code Mappings

**Files:**
- Create: `src/lib/pg-error-codes.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/lib/api/errors.ts`

**Step 1: Extract shared constants**

Create `src/lib/pg-error-codes.ts`:

```typescript
/**
 * PostgreSQL error codes and human-readable descriptions.
 * Shared between client-side error display and API error handling.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export const PG_ERROR_CODES = {
  // Class 23 - Integrity Constraint Violation
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",

  // Class 22 - Data Exception
  NUMERIC_VALUE_OUT_OF_RANGE: "22003",
  STRING_DATA_RIGHT_TRUNCATION: "22001",

  // Class 42 - Syntax Error or Access Rule Violation
  INSUFFICIENT_PRIVILEGE: "42501",
  UNDEFINED_TABLE: "42P01",

  // Class 40 - Transaction Rollback
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",

  // Class 53 - Insufficient Resources
  TOO_MANY_CONNECTIONS: "53300",
} as const;

export const PG_ERROR_MESSAGES: Record<string, string> = {
  [PG_ERROR_CODES.UNIQUE_VIOLATION]: "A record with this value already exists",
  [PG_ERROR_CODES.FOREIGN_KEY_VIOLATION]: "This record is referenced by other data",
  [PG_ERROR_CODES.NOT_NULL_VIOLATION]: "A required field is missing",
  [PG_ERROR_CODES.CHECK_VIOLATION]: "A value does not meet the required constraints",
  [PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE]: "You do not have permission for this action",
  [PG_ERROR_CODES.NUMERIC_VALUE_OUT_OF_RANGE]: "A number is outside the allowed range",
  [PG_ERROR_CODES.STRING_DATA_RIGHT_TRUNCATION]: "Text is too long for the field",
  [PG_ERROR_CODES.SERIALIZATION_FAILURE]: "A concurrent update conflict occurred, please retry",
  [PG_ERROR_CODES.DEADLOCK_DETECTED]: "A database deadlock was detected, please retry",
  [PG_ERROR_CODES.TOO_MANY_CONNECTIONS]: "Too many database connections, please try again later",
};
```

**Step 2: Update src/lib/errors.ts**

Import and use `PG_ERROR_CODES` and `PG_ERROR_MESSAGES` instead of the local `PG_ERROR_MESSAGES` mapping.

**Step 3: Update src/lib/api/errors.ts**

Import `PG_ERROR_CODES` and use it for the `PG_ERROR_MAP` keys instead of hardcoded string literals. Keep the API-specific structure (with `code`, `status`, `message` fields) but reference the shared constants.

**Step 4: Run tests**

```bash
npx vitest run
```

**Step 5: Commit**

```bash
git add src/lib/pg-error-codes.ts src/lib/errors.ts src/lib/api/errors.ts
git commit -m "refactor: consolidate duplicated PG error code mappings"
```

---

## Final Verification

After all tasks are complete:

```bash
# Run full test suite
npx vitest run

# Verify no remaining hardcoded query keys
grep -rn 'queryKey: \[' src/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules' | grep -v 'query-keys'

# Verify no empty string select values
grep -rn 'value: ""' src/entities/ --include='*.tsx'

# TypeScript check
npx tsc --noEmit
```

Expected: All tests pass, zero hardcoded keys, zero empty string values, zero type errors.
