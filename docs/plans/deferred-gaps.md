# Deferred Gaps — Phase 2 Production Workflows

> Identified during the comprehensive implementation roadmap (2026-02-26).
> These gaps require design decisions before implementation.

## PO Demand System

### Yeast Missing from Demand Calculation
- **Severity:** Medium
- **Location:** `supabase/migrations/00053_ingredient_demand.sql` — `recipe_ingredients_normalized` view
- **Problem:** The normalized view includes malts, hops, adjuncts, sugars, spices, and fruits but NOT yeast from `recipe_yeasts`. The shortfall function maps the 'yeast' category for inventory matching, but no demand is ever generated.
- **Why deferred:** Yeast doesn't have simple weight-based quantities. It uses `pitch_rate` (million cells/mL/degP) which needs conversion to packs/vials based on batch volume and OG. This is a non-trivial calculation.
- **Options:**
  1. Add simplified "packs needed" calculation based on batch volume
  2. Track yeast as a count-based ingredient with `quantity = 1` per recipe addition

### Shortfalls Don't Account for Existing POs
- **Severity:** Medium
- **Location:** `supabase/migrations/00053_ingredient_demand.sql:216-288` — `calculate_ingredient_shortfalls` function
- **Problem:** Compares demand against current inventory but does NOT subtract quantities already on draft/submitted/confirmed POs. Refreshing the demand page after generating POs shows the same shortfalls, enabling duplicate PO generation.
- **Options:**
  1. Modify `calculate_ingredient_shortfalls` SQL to join against `po_line_items` where PO status is in `('draft', 'submitted', 'confirmed')` and subtract ordered quantities
  2. Add a visual indicator on the demand page showing "X units already on PO-YYYY-NNN" per ingredient

### Hardcoded 7-Day Lead Time
- **Severity:** Low
- **Location:** `src/lib/purchasing/po-generator.ts:215`
- **Problem:** `createDraftPO()` uses `+ 7` day lead time. Could use `Math.max(...leadTimes)` from shortfall data instead.

## Pick List System

### No Bin-Level Detail in Formal Pick List
- **Severity:** Medium
- **Location:** `supabase/migrations/00057_pick_list_tables.sql` — `pick_list_items` table, `src/components/domain/pick-list-items.tsx`
- **Problem:** `pick_list_items` only stores `location_id` (not `bin_id`). The formal pick list UI shows only location name. The legacy `OrderPickList` shows both bin name and location name, which is essential for warehouse travel optimization.
- **Fix:** Migration to add `bin_id UUID REFERENCES bins(id)`, update `generate_pick_list` to store bin, update `PickListItems` to display bin name.

### No Location-Based Sort in Formal Pick List
- **Severity:** Low-Medium
- **Location:** `src/components/domain/pick-list-items.tsx`
- **Problem:** Items are sorted by `sort_order` (incrementing integer from generation order). The `generate_pick_list` function iterates by order item then by FIFO date, not by warehouse location. The legacy system sorts by `location_name → bin_name → lot_number`.
- **Fix:** Update `generate_pick_list` to set `sort_order` based on location/bin, or sort client-side.

### Pick List Does Not Create Allocations
- **Severity:** Low-Medium
- **Location:** `supabase/migrations/00057_pick_list_tables.sql:140-232`
- **Problem:** `generate_pick_list` only writes to `pick_list_items` but does not create corresponding `allocations` records. Finished goods referenced by pick list items are not reserved and could be allocated elsewhere.
- **Design decision:** Should the pick list create allocations (reservation model), or should allocations be a prerequisite?

### Timestamps Not Auto-Populated on State Transitions
- **Severity:** Low
- **Location:** `src/components/universal/entity-detail-unified.tsx:465-474`
- **Problem:** Universal state transition mutation only updates `status`. The `started_at` and `completed_at` timestamps on `pick_lists` are never set.
- **Fix:** Database trigger or entity config `onTransition` callback.

## Landed Cost System

### PO Receiving Does Not Create Inventory Lots (Critical Pipeline Break)
- **Severity:** Critical
- **Location:** `src/components/domain/po-receiving.tsx:215-221`
- **Problem:** PO receiving explicitly does NOT create `inventory_lots` (comment says "A separate inventory receiving workflow should create inventory_lots..."). The `calculate_landed_cost` function joins `inventory_lots` via `po_receive_id` to find lots to update. Without this link, the calculation runs but updates zero rows.
- **Options:**
  1. Add an "Accept into Inventory" step that creates `inventory_lots` from `po_receives` with `po_receive_id` FK set (aligns with QA/inspection step)
  2. Auto-create `inventory_lots` when recording a PO receive (simpler, skips QA)

### No Landed Cost Breakdown Display
- **Severity:** Medium
- **Location:** PO detail page (`src/app/(app)/purchasing/pos/[id]/page.tsx`)
- **Problem:** After clicking "Calculate Landed Cost", user sees only a toast. There is no UI showing per-line-item breakdown (allocated shipping, landed cost per unit, markup). `getLandedCostSummary`, `formatLandedCost`, `landedCostMarkup` are never called from UI.
- **Fix:** Create `LandedCostBreakdown` component using `getLandedCostSummary` with `useQuery` keyed on `purchaseOrderKeys.landedCost(poId)`.
- **Blocked by:** PO receiving → inventory lots pipeline must work first.

### Landed Cost Not Visible in Inventory Lots List View
- **Severity:** Low
- **Location:** `src/entities/inventory-lot.tsx:51-86`
- **Problem:** `listColumns` doesn't include `landed_cost` or `unit_cost`. Only visible in individual lot detail.
- **Fix:** Add `landed_cost` column to `listColumns`.
