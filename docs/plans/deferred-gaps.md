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

### ~~Pick List Does Not Create Allocations~~ RESOLVED
- **Severity:** Low-Medium
- **Status:** Resolved (migration 00108, WS5)
- **Resolution:** `generate_pick_list` now creates `planned` allocations alongside pick list items. When a pick list is completed, allocations transition to `completed`. Cancellation releases planned allocations.

### ~~Timestamps Not Auto-Populated on State Transitions~~ RESOLVED
- **Severity:** Low
- **Status:** Resolved (migration 00106, WS2)
- **Resolution:** Added database trigger `pick_list_timestamp_trigger` that automatically sets `started_at` on transition to `in_progress` and `completed_at` on transition to `completed`.

## Landed Cost System

### ~~PO Receiving Does Not Create Inventory Lots (Critical Pipeline Break)~~ RESOLVED
- **Severity:** Critical
- **Status:** Resolved (migration 00107, `POAcceptInventoryDialog`)
- **Resolution:** Added "Accept into Inventory" dialog that creates `inventory_lots` from `po_receives` with `po_receive_id` FK set. Uses `get_unaccepted_po_receives()` SQL function to find receives needing acceptance. Action button appears on PO detail page for `partial`/`fulfilled` states.

### ~~No Landed Cost Breakdown Display~~ RESOLVED
- **Severity:** Medium
- **Status:** Resolved (WS4)
- **Resolution:** Created `POLandedCostBreakdown` component (`src/components/domain/po-landed-cost-breakdown.tsx`) that displays per-line-item breakdown with allocated shipping, landed cost per unit, and markup. Integrated into PO detail page.

### ~~Landed Cost Not Visible in Inventory Lots List View~~ RESOLVED
- **Severity:** Low
- **Status:** Resolved (WS4)
- **Resolution:** Added `landed_cost` column to `inventory-lot.tsx` `listColumns`. Inventory lots list view now shows landed cost alongside other columns.
