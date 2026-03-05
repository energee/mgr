# Deferred Gaps — Phase 2 Production Workflows

> Identified during the comprehensive implementation roadmap (2026-02-26).
> These gaps require design decisions before implementation.

## PO Demand System

### ~~Yeast Missing from Demand Calculation~~ RESOLVED
- **Severity:** Medium
- **Status:** Resolved (migration 00110)
- **Resolution:** Added yeast to `recipe_ingredients_normalized` view using simplified pack-based counting (1 pack per recipe addition, scaled by batch volume ratio). Uses 'pk' unit. Full pitch-rate-based calculation deferred as a future enhancement.

### ~~Shortfalls Don't Account for Existing POs~~ RESOLVED
- **Severity:** Medium
- **Status:** Resolved (migration 00110)
- **Resolution:** Modified `calculate_ingredient_shortfalls` to subtract outstanding quantities from confirmed POs (status IN 'confirmed', 'partial', 'fulfilled'). Outstanding = ordered - received per line item. Returns new `on_order_qty` column displayed in the demand UI between "Available" and "Shortfall". Draft/submitted POs are intentionally excluded per design decision.

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

### ~~PO Receiving Does Not Create Inventory Lots (Critical Pipeline Break)~~ RESOLVED
- **Severity:** Critical
- **Status:** Resolved (migration 00107, `POAcceptInventoryDialog`)
- **Resolution:** Added "Accept into Inventory" dialog that creates `inventory_lots` from `po_receives` with `po_receive_id` FK set. Uses `get_unaccepted_po_receives()` SQL function to find receives needing acceptance. Action button appears on PO detail page for `partial`/`fulfilled` states.

### No Landed Cost Breakdown Display
- **Severity:** Medium
- **Location:** PO detail page (`src/app/(app)/purchasing/pos/[id]/page.tsx`)
- **Problem:** After clicking "Calculate Landed Cost", user sees only a toast. There is no UI showing per-line-item breakdown (allocated shipping, landed cost per unit, markup). `getLandedCostSummary`, `formatLandedCost`, `landedCostMarkup` are never called from UI.
- **Fix:** Create `LandedCostBreakdown` component using `getLandedCostSummary` with `useQuery` keyed on `purchaseOrderKeys.landedCost(poId)`.
- **Blocked by:** ~~PO receiving → inventory lots pipeline must work first.~~ Unblocked (resolved by migration 00107).

### Landed Cost Not Visible in Inventory Lots List View
- **Severity:** Low
- **Location:** `src/entities/inventory-lot.tsx:51-86`
- **Problem:** `listColumns` doesn't include `landed_cost` or `unit_cost`. Only visible in individual lot detail.
- **Fix:** Add `landed_cost` column to `listColumns`.
