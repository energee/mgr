# COGS, Projections & Vendor Lead Time Design

Date: 2026-03-05
Branch: workstream-1

## Overview

Three related features delivered together:
1. **Vendor lead time fix** — use per-vendor/per-item lead times instead of hardcoded 7 days
2. **COGS report** — period P&L, channel margin analysis, landed cost tracking
3. **Projections report** — weekly (8-week) and monthly (6-month) forecasting for ingredients, finished goods, and revenue

## 1. Vendor Lead Time Fix

### Problem
Two places hardcode a 7-day lead time despite `suppliers.default_lead_time_days` and `supplier_catalog.lead_time_days` already existing in the schema.

### Changes

**`src/lib/purchasing/po-generator.ts:217`**
Replace hardcoded `+ 7` with `Math.max(...lineItems.map(li => li.lead_time_days))`, falling back to supplier's `default_lead_time_days`, then 7 as last resort.

**`calculate_ingredient_shortfalls` SQL function**
Change `COALESCE(ps.lead_time_days, 7)` to `COALESCE(ps.lead_time_days, s.default_lead_time_days, 7)` — cascade: catalog-level -> supplier-level -> fallback.

One migration to update the SQL function. No schema changes needed.

## 2. COGS Report (Tab 1: "COGS & Margins")

### 2a. Period-Based P&L View
- Date range picker (default: current month)
- Cost breakdown by category: malt, hops, yeast, adjuncts, packaging, shipping/landed
- Summary cards: Total COGS, Avg COGS/BBL, Total Revenue, Gross Margin %
- Table: per-batch rows with cost columns, expandable for ingredient detail

### 2b. Margin Analysis by Channel
- Group by sales channel (taproom, wholesale, retail, distribution)
- Per channel: revenue, COGS, gross margin, margin %
- Drill down by brand within each channel
- Source: order_items joined with allocations cost data

### 2c. Landed Cost Tracking
- Cost buildup: ingredient cost -> shipping allocation -> overhead -> landed cost
- Uses existing `inventory_lots.landed_cost` field
- Per-batch view: actual landed cost vs. recipe estimate

### New SQL
- `cogs_by_period(p_start_date, p_end_date)` RPC — batch costs by category for completed batches
- `margin_by_channel(p_start_date, p_end_date)` RPC — order revenue joined with batch COGS, grouped by channel
- `batch_cost_breakdown` view — allocations joined with catalog categories

### New Query Keys
- `reportKeys.cogs(dateRange)`
- `reportKeys.cogsByChannel(dateRange)`
- `reportKeys.marginByChannel(dateRange)`

## 3. Projections Report

### Tab 2: Weekly Forecast (8-week horizon)

**Ingredient Needs**
- Weekly buckets: required ingredients across planned/fermenting batches
- Columns: ingredient, current stock, on order, weekly demand, shortfall
- Extends existing `calculate_ingredient_shortfalls` RPC
- Urgent highlight when order-by date is within 2 weeks

**Expected Finished Goods**
- Weekly buckets: expected output from batches in pipeline
- Columns: brand, format, batches in progress, estimated ready date, expected units
- Source: `batches_in_production_by_brand` + unit conversion
- Color-code by confidence: planned (low) vs fermenting/conditioning (high)

**Expected Revenue**
- Weekly buckets from confirmed/scheduled orders
- Columns: week, order count, total units, expected revenue
- Breakdown by channel
- Source: `order_demand_by_product` joined with order pricing

### Tab 3: Monthly Outlook (6-month horizon)

- Same three sections rolled up to monthly buckets
- Includes draft orders as "potential" (visually distinct)
- Trend sparklines or bar charts for each metric

### New SQL
- `project_finished_goods(p_horizon_weeks)` RPC — batches in pipeline -> estimated units by week
- `project_revenue(p_horizon_weeks, p_include_drafts)` RPC — order book by week
- Ingredient needs: reuse existing `calculate_ingredient_demand` RPC

### New Query Keys
- `reportKeys.projectedGoods(horizon)`
- `reportKeys.projectedRevenue(horizon, includeDrafts)`

## 4. Page Structure & UI

### Route
`/reports/projections` — single page with three tabs

### Tab Layout
```
[COGS & Margins] [Weekly Forecast] [Monthly Outlook]
```

### Shared Controls
- Date range picker at page level
- Channel filter dropdown (applies to COGS margins and revenue projections)

### Component Structure
```
src/app/(app)/reports/projections/
  page.tsx              -> TabContainer with shared filters
  cogs-tab.tsx          -> Period P&L, channel margins, landed costs
  weekly-tab.tsx        -> 8-week ingredient/FG/revenue tables
  monthly-tab.tsx       -> 6-month rollup with charts
```

### Charts (Recharts)
- Stacked bar: COGS breakdown by category over time
- Grouped bar: margin by channel
- Line/bar: projected revenue and FG output by week/month

## Migration Plan

Next available migration: `00138`

- `00138_vendor_lead_time_cascade.sql` — update `calculate_ingredient_shortfalls` function
- `00139_batch_cost_breakdown_view.sql` — base view for COGS
- `00140_cogs_rpcs.sql` — `cogs_by_period` and `margin_by_channel` RPCs
- `00141_projection_rpcs.sql` — `project_finished_goods` and `project_revenue` RPCs

## Reference Files

| Pattern | File |
|---------|------|
| Existing batch-cost report | `src/app/(app)/reports/batch-cost/page.tsx` |
| PO generator (lead time bug) | `src/lib/purchasing/po-generator.ts` |
| Ingredient shortfalls SQL | `supabase/migrations/00110_demand_subtract_confirmed_pos.sql` |
| Recipe COGS view | `supabase/migrations/00021_recipe_cogs.sql` |
| Production planning SQL | `supabase/migrations/00051_production_planning.sql` |
| Ingredient demand SQL | `supabase/migrations/00053_ingredient_demand.sql` |
| Query keys | `src/lib/query-keys.ts` |
| Planning types | `src/types/planning.ts` |
