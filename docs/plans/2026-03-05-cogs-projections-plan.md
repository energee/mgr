# COGS, Projections & Vendor Lead Time Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix vendor lead time bug, add COGS/margin report, and add projections report as a single tabbed page.

**Architecture:** Three SQL migrations (lead time fix, COGS RPCs, projection RPCs) plus one new report page with three tabs. Builds on existing batch-cost report patterns, planning RPCs, and query key factories.

**Tech Stack:** PostgreSQL (RPC functions, views), TypeScript, React, Recharts, shadcn/ui Tabs, React Query

---

### Task 1: Fix vendor lead time cascade in SQL function

**Files:**
- Create: `supabase/migrations/00138_vendor_lead_time_cascade.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00138_vendor_lead_time_cascade
--
-- Fixes hardcoded 7-day lead time fallback in calculate_ingredient_shortfalls.
-- Now cascades: supplier_catalog.lead_time_days -> suppliers.default_lead_time_days -> 7
-- =============================================================================

DROP FUNCTION IF EXISTS calculate_ingredient_shortfalls(INTEGER);
CREATE OR REPLACE FUNCTION calculate_ingredient_shortfalls(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  catalog_type TEXT,
  catalog_id UUID,
  catalog_name TEXT,
  total_required DECIMAL(12,4),
  available_qty DECIMAL(12,4),
  on_order_qty DECIMAL(12,4),
  shortfall_qty DECIMAL(12,4),
  unit TEXT,
  required_by_date DATE,
  order_by_date DATE,
  lead_time_days INTEGER,
  preferred_supplier_id UUID,
  preferred_supplier_name TEXT,
  min_order_qty DECIMAL(10,2),
  unit_price DECIMAL(10,4),
  is_urgent BOOLEAN,
  batch_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH demand AS (
    SELECT * FROM calculate_ingredient_demand(p_horizon_weeks, true, true)
  ),
  inventory_available AS (
    SELECT
      CASE ii.category
        WHEN 'grain' THEN 'malt'
        WHEN 'hops' THEN 'hop'
        WHEN 'yeast' THEN 'yeast'
        WHEN 'adjunct' THEN 'adjunct'
        ELSE ii.category
      END as inferred_catalog_type,
      ii.name as item_name,
      COALESCE(SUM(ilq.remaining_quantity), 0) as available_qty
    FROM inventory_items ii
    LEFT JOIN inventory_lots_with_quantities ilq ON ilq.inventory_item_id = ii.id
    WHERE ii.is_active = true
    GROUP BY ii.category, ii.name
  ),
  po_received_summary AS (
    SELECT pr.po_line_item_id, SUM(pr.quantity) as received_qty
    FROM po_receives pr
    GROUP BY pr.po_line_item_id
  ),
  confirmed_po_quantities AS (
    SELECT
      pli.catalog_type,
      pli.catalog_id,
      COALESCE(
        SUM(pli.quantity - COALESCE(prs.received_qty, 0)),
        0
      ) as on_order_qty
    FROM po_line_items pli
    JOIN purchase_orders po ON po.id = pli.po_id
    LEFT JOIN po_received_summary prs ON prs.po_line_item_id = pli.id
    WHERE po.status IN ('confirmed', 'partial', 'fulfilled')
    GROUP BY pli.catalog_type, pli.catalog_id
  ),
  preferred_suppliers AS (
    SELECT DISTINCT ON (sc.catalog_type, sc.catalog_id)
      sc.catalog_type,
      sc.catalog_id,
      sc.supplier_id,
      s.name as supplier_name,
      -- Cascade: catalog-level -> supplier-level -> 7 day fallback
      COALESCE(sc.lead_time_days, s.default_lead_time_days, 7) as lead_time_days,
      sc.min_order_qty,
      sc.price as unit_price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    WHERE sc.is_preferred = true
       OR sc.id IN (
         SELECT sc2.id
         FROM supplier_catalog sc2
         WHERE sc2.catalog_type = sc.catalog_type
           AND sc2.catalog_id = sc.catalog_id
         ORDER BY sc2.price ASC NULLS LAST
         LIMIT 1
       )
    ORDER BY sc.catalog_type, sc.catalog_id, sc.is_preferred DESC, sc.price ASC
  )
  SELECT
    d.catalog_type,
    d.catalog_id,
    d.catalog_name,
    d.total_required,
    COALESCE(ia.available_qty, 0)::DECIMAL(12,4) as available_qty,
    COALESCE(cpq.on_order_qty, 0)::DECIMAL(12,4) as on_order_qty,
    GREATEST(
      d.total_required - COALESCE(ia.available_qty, 0) - COALESCE(cpq.on_order_qty, 0),
      0
    )::DECIMAL(12,4) as shortfall_qty,
    d.unit,
    d.earliest_required_by as required_by_date,
    (d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3)::DATE as order_by_date,
    COALESCE(ps.lead_time_days, 7)::INTEGER as lead_time_days,
    ps.supplier_id as preferred_supplier_id,
    ps.supplier_name as preferred_supplier_name,
    ps.min_order_qty,
    ps.unit_price,
    ((d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3) <= (CURRENT_DATE + 3))::BOOLEAN as is_urgent,
    d.batch_count
  FROM demand d
  LEFT JOIN inventory_available ia
    ON ia.item_name ILIKE d.catalog_name
    AND ia.inferred_catalog_type = d.catalog_type
  LEFT JOIN confirmed_po_quantities cpq
    ON cpq.catalog_type = d.catalog_type
    AND cpq.catalog_id = d.catalog_id
  LEFT JOIN preferred_suppliers ps
    ON ps.catalog_type = d.catalog_type
    AND ps.catalog_id = d.catalog_id
  WHERE d.total_required > (COALESCE(ia.available_qty, 0) + COALESCE(cpq.on_order_qty, 0))
  ORDER BY is_urgent DESC, order_by_date ASC, d.catalog_type, d.total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_shortfalls IS 'Calculates ingredient shortfalls with lead time cascade: supplier_catalog -> supplier default -> 7 day fallback. Subtracts confirmed PO quantities.';
```

**Step 2: Verify migration file exists**

Run: `ls supabase/migrations/00138_vendor_lead_time_cascade.sql`
Expected: file exists

**Step 3: Commit**

```bash
git add supabase/migrations/00138_vendor_lead_time_cascade.sql
git commit -m "fix: cascade vendor lead time in ingredient shortfall calculation

Lead time now falls back: supplier_catalog.lead_time_days ->
suppliers.default_lead_time_days -> 7 day default"
```

---

### Task 2: Fix hardcoded lead time in po-generator.ts

**Files:**
- Modify: `src/lib/purchasing/po-generator.ts:208-217`

**Step 1: Write the failing test**

Create test file `src/lib/purchasing/__tests__/po-generator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { groupShortfallsBySupplier, type PODraft } from "../po-generator";
import type { IngredientShortfall } from "../demand-calculator";

describe("groupShortfallsBySupplier", () => {
  it("uses earliest order_by_date from shortfalls", () => {
    const shortfalls: IngredientShortfall[] = [
      {
        catalog_type: "malt",
        catalog_id: "id-1",
        catalog_name: "Pale Malt",
        total_required: 100,
        available_qty: 50,
        on_order_qty: 0,
        shortfall_qty: 50,
        unit: "lb",
        required_by_date: "2026-04-01",
        order_by_date: "2026-03-15",
        lead_time_days: 14,
        preferred_supplier_id: "supplier-1",
        preferred_supplier_name: "Supplier A",
        min_order_qty: null,
        unit_price: 1.5,
        is_urgent: false,
        batch_count: 1,
      },
      {
        catalog_type: "hop",
        catalog_id: "id-2",
        catalog_name: "Cascade",
        total_required: 10,
        available_qty: 5,
        on_order_qty: 0,
        shortfall_qty: 5,
        unit: "lb",
        required_by_date: "2026-03-25",
        order_by_date: "2026-03-10",
        lead_time_days: 10,
        preferred_supplier_id: "supplier-1",
        preferred_supplier_name: "Supplier A",
        min_order_qty: null,
        unit_price: 12.0,
        is_urgent: false,
        batch_count: 1,
      },
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("supplier-1");
    // Should use earliest order_by_date
    expect(result[0].order_by_date).toBe("2026-03-10");
    expect(result[0].line_items).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it passes (this tests existing logic)**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm vitest run src/lib/purchasing/__tests__/po-generator.test.ts`
Expected: PASS

**Step 3: Update createDraftPO to use supplier lead time**

In `src/lib/purchasing/po-generator.ts`, modify the `createDraftPO` function. Add `lead_time_days` to the `POLineItemDraft` interface and `PODraft` interface, then use `Math.max` of line item lead times:

Add to `POLineItemDraft` interface:
```typescript
lead_time_days: number;
```

In `groupShortfallsBySupplier`, add to the item push:
```typescript
lead_time_days: shortfall.lead_time_days,
```

Add to `PODraft` type computation, after `item_count`:
```typescript
max_lead_time_days: Math.max(...group.items.map(i => i.lead_time_days), 7),
```

In `createDraftPO`, replace line 217:
```typescript
// OLD: expectedDate.setDate(expectedDate.getDate() + 7);
// NEW: Use max lead time from line items, with 7-day minimum
expectedDate.setDate(expectedDate.getDate() + (draft.max_lead_time_days ?? 7));
```

**Step 4: Run tests**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm vitest run src/lib/purchasing/__tests__/po-generator.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/purchasing/po-generator.ts src/lib/purchasing/__tests__/po-generator.test.ts
git commit -m "fix: use vendor lead times instead of hardcoded 7 days in PO generator

createDraftPO now uses Math.max of line item lead times from
supplier_catalog/supplier defaults. groupShortfallsBySupplier
passes lead_time_days through to PODraft."
```

---

### Task 3: Add COGS and projection SQL RPCs

**Files:**
- Create: `supabase/migrations/00139_cogs_and_projection_rpcs.sql`

**Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration: 00139_cogs_and_projection_rpcs
--
-- Adds RPC functions for COGS reporting and production projections:
-- 1. cogs_by_period - batch costs aggregated by category for a date range
-- 2. margin_by_channel - revenue vs COGS grouped by sales channel
-- 3. project_finished_goods - expected FG output from batches in pipeline
-- 4. project_revenue - order book revenue projections by week
-- =============================================================================

-- =============================================================================
-- 1. COGS BY PERIOD
-- Returns per-batch cost breakdown by ingredient category for completed batches
-- =============================================================================

CREATE OR REPLACE FUNCTION cogs_by_period(
  p_start_date DATE DEFAULT (CURRENT_DATE - INTERVAL '1 month')::DATE,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  batch_id UUID,
  batch_number TEXT,
  batch_name TEXT,
  recipe_name TEXT,
  brand_name TEXT,
  brand_id UUID,
  volume_bbl DECIMAL,
  status TEXT,
  created_at TIMESTAMPTZ,
  -- Cost categories
  malt_cost DECIMAL(12,2),
  hop_cost DECIMAL(12,2),
  yeast_cost DECIMAL(12,2),
  adjunct_cost DECIMAL(12,2),
  other_cost DECIMAL(12,2),
  total_ingredient_cost DECIMAL(12,2),
  -- Landed cost from lots
  total_landed_cost DECIMAL(12,2),
  cost_per_bbl DECIMAL(12,2),
  has_allocation_data BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_allocations AS (
    SELECT
      a.destination_id as batch_id,
      -- Categorize by inventory item category
      COALESCE(ii.category, 'other') as category,
      SUM(a.quantity * COALESCE(a.unit_cost, 0)) as cost,
      -- Landed cost: use lot landed_cost if available, else unit_cost
      SUM(a.quantity * COALESCE(il.landed_cost, a.unit_cost, 0)) as landed_cost,
      bool_or(true) as has_data
    FROM allocations a
    LEFT JOIN inventory_lots il ON il.id = a.source_id AND a.source_type = 'inventory_lot'
    LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id
    WHERE a.destination_type = 'batch'
      AND a.status IN ('completed', 'planned')
    GROUP BY a.destination_id, ii.category
  ),
  batch_costs_pivoted AS (
    SELECT
      ba.batch_id,
      COALESCE(SUM(ba.cost) FILTER (WHERE ba.category = 'grain'), 0) as malt_cost,
      COALESCE(SUM(ba.cost) FILTER (WHERE ba.category = 'hops'), 0) as hop_cost,
      COALESCE(SUM(ba.cost) FILTER (WHERE ba.category = 'yeast'), 0) as yeast_cost,
      COALESCE(SUM(ba.cost) FILTER (WHERE ba.category = 'adjunct'), 0) as adjunct_cost,
      COALESCE(SUM(ba.cost) FILTER (WHERE ba.category NOT IN ('grain', 'hops', 'yeast', 'adjunct')), 0) as other_cost,
      COALESCE(SUM(ba.cost), 0) as total_ingredient_cost,
      COALESCE(SUM(ba.landed_cost), 0) as total_landed_cost,
      bool_or(ba.has_data) as has_allocation_data
    FROM batch_allocations ba
    GROUP BY ba.batch_id
  )
  SELECT
    b.id as batch_id,
    b.batch_number,
    b.name as batch_name,
    r.name as recipe_name,
    br.name as brand_name,
    r.brand_id,
    b.volume_bbl,
    b.status,
    b.created_at,
    COALESCE(bcp.malt_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.hop_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.yeast_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.adjunct_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.other_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.total_ingredient_cost, 0)::DECIMAL(12,2),
    COALESCE(bcp.total_landed_cost, 0)::DECIMAL(12,2),
    CASE WHEN b.volume_bbl > 0
      THEN (COALESCE(bcp.total_ingredient_cost, 0) / b.volume_bbl)::DECIMAL(12,2)
      ELSE 0
    END as cost_per_bbl,
    COALESCE(bcp.has_allocation_data, false) as has_allocation_data
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN brands br ON br.id = r.brand_id
  LEFT JOIN batch_costs_pivoted bcp ON bcp.batch_id = b.id
  WHERE b.created_at >= p_start_date
    AND b.created_at < (p_end_date + INTERVAL '1 day')
    AND b.status NOT IN ('cancelled', 'archived')
  ORDER BY b.batch_number;
END;
$$;

COMMENT ON FUNCTION cogs_by_period IS 'Returns per-batch COGS breakdown by ingredient category (malt, hop, yeast, adjunct, other) with landed costs, for batches in a date range.';

-- =============================================================================
-- 2. MARGIN BY CHANNEL
-- Revenue vs COGS grouped by sales channel
-- =============================================================================

CREATE OR REPLACE FUNCTION margin_by_channel(
  p_start_date DATE DEFAULT (CURRENT_DATE - INTERVAL '1 month')::DATE,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  channel_id UUID,
  channel_name TEXT,
  order_count INTEGER,
  total_units INTEGER,
  total_revenue DECIMAL(12,2),
  total_cogs DECIMAL(12,2),
  gross_margin DECIMAL(12,2),
  margin_pct DECIMAL(5,2)
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH order_revenue AS (
    SELECT
      c.sales_channel_id,
      o.id as order_id,
      SUM(oi.quantity * COALESCE(oi.unit_price, 0))::DECIMAL(12,2) as revenue,
      SUM(oi.quantity)::INTEGER as units
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status NOT IN ('draft', 'cancelled')
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
    GROUP BY c.sales_channel_id, o.id
  ),
  -- Estimate COGS per order from batch allocations
  -- order_items -> finished_goods (via allocations source_type=finished_good)
  -- finished_goods -> batch (via batch_id FK)
  -- batch -> allocations (destination_type=batch) for ingredient costs
  order_cogs AS (
    SELECT
      c.sales_channel_id,
      o.id as order_id,
      -- Approximate COGS: use recipe-based cost per unit
      COALESCE(SUM(
        oi.quantity * COALESCE(rwc.cogs_per_bbl, 0) /
        NULLIF(COALESCE(
          pt.units_per_bbl_override,
          calculate_units_per_bbl(pt.volume_oz, pt.units_per_case)
        ), 0)
      ), 0)::DECIMAL(12,2) as estimated_cogs
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN brands br ON br.id = oi.brand_id
    LEFT JOIN recipes r ON r.brand_id = br.id AND r.is_active = true
    LEFT JOIN recipes_with_cogs rwc ON rwc.id = r.id
    LEFT JOIN selling_formats sf ON sf.id = oi.selling_format_id
    LEFT JOIN package_types pt ON pt.id = sf.package_type_id
    WHERE o.status NOT IN ('draft', 'cancelled')
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
    GROUP BY c.sales_channel_id, o.id
  )
  SELECT
    sc.id as channel_id,
    sc.name as channel_name,
    COUNT(DISTINCT orv.order_id)::INTEGER as order_count,
    COALESCE(SUM(orv.units), 0)::INTEGER as total_units,
    COALESCE(SUM(orv.revenue), 0)::DECIMAL(12,2) as total_revenue,
    COALESCE(SUM(oc.estimated_cogs), 0)::DECIMAL(12,2) as total_cogs,
    (COALESCE(SUM(orv.revenue), 0) - COALESCE(SUM(oc.estimated_cogs), 0))::DECIMAL(12,2) as gross_margin,
    CASE WHEN SUM(orv.revenue) > 0
      THEN ((SUM(orv.revenue) - SUM(COALESCE(oc.estimated_cogs, 0))) / SUM(orv.revenue) * 100)::DECIMAL(5,2)
      ELSE 0
    END as margin_pct
  FROM sales_channels sc
  LEFT JOIN order_revenue orv ON orv.sales_channel_id = sc.id
  LEFT JOIN order_cogs oc ON oc.order_id = orv.order_id
  WHERE sc.is_active = true
  GROUP BY sc.id, sc.name
  ORDER BY total_revenue DESC;
END;
$$;

COMMENT ON FUNCTION margin_by_channel IS 'Revenue vs estimated COGS grouped by sales channel. COGS estimated from recipe costs and package type yield.';

-- =============================================================================
-- 3. PROJECT FINISHED GOODS
-- Expected FG output from batches in pipeline by week
-- =============================================================================

CREATE OR REPLACE FUNCTION project_finished_goods(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  brand_id UUID,
  brand_name TEXT,
  batch_id UUID,
  batch_number TEXT,
  batch_status TEXT,
  volume_bbl DECIMAL,
  estimated_ready_date DATE,
  projection_week DATE,
  -- Confidence based on batch status
  confidence TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bip.brand_id,
    br.name as brand_name,
    bip.batch_id,
    bip.batch_number,
    bip.status as batch_status,
    bip.volume_bbl,
    bip.estimated_ready_date,
    DATE_TRUNC('week', bip.estimated_ready_date)::DATE as projection_week,
    CASE bip.status
      WHEN 'conditioning' THEN 'high'
      WHEN 'fermenting' THEN 'medium'
      WHEN 'planned' THEN 'low'
      ELSE 'unknown'
    END as confidence
  FROM batches_in_production_by_brand bip
  JOIN brands br ON br.id = bip.brand_id
  WHERE bip.estimated_ready_date IS NOT NULL
    AND bip.estimated_ready_date <= CURRENT_DATE + (p_horizon_weeks * 7)
  ORDER BY bip.estimated_ready_date, br.name;
END;
$$;

COMMENT ON FUNCTION project_finished_goods IS 'Projects expected finished goods output from batches in pipeline, with confidence level based on batch status.';

-- =============================================================================
-- 4. PROJECT REVENUE
-- Order book revenue projections by week
-- =============================================================================

CREATE OR REPLACE FUNCTION project_revenue(
  p_horizon_weeks INTEGER DEFAULT 8,
  p_include_drafts BOOLEAN DEFAULT false
)
RETURNS TABLE (
  projection_week DATE,
  channel_id UUID,
  channel_name TEXT,
  order_count INTEGER,
  total_units INTEGER,
  total_revenue DECIMAL(12,2),
  includes_drafts BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::DATE as projection_week,
    sc.id as channel_id,
    sc.name as channel_name,
    COUNT(DISTINCT o.id)::INTEGER as order_count,
    COALESCE(SUM(oi.quantity), 0)::INTEGER as total_units,
    COALESCE(SUM(oi.quantity * COALESCE(oi.unit_price, 0)), 0)::DECIMAL(12,2) as total_revenue,
    bool_or(o.status = 'draft') as includes_drafts
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN sales_channels sc ON sc.id = c.sales_channel_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE (
    CASE
      WHEN p_include_drafts THEN o.status NOT IN ('fulfilled', 'cancelled')
      ELSE o.status IN ('confirmed', 'scheduled', 'picking', 'packed')
    END
  )
    AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
    AND COALESCE(o.scheduled_date, o.requested_date) >= CURRENT_DATE
    AND COALESCE(o.scheduled_date, o.requested_date) <= CURRENT_DATE + (p_horizon_weeks * 7)
  GROUP BY DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date)), sc.id, sc.name
  ORDER BY projection_week, channel_name;
END;
$$;

COMMENT ON FUNCTION project_revenue IS 'Projects revenue from open orders by week and sales channel. Optionally includes draft orders.';

-- =============================================================================
-- SCHEMA REGISTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples) VALUES
('cogs_by_period', 'RPC function returning per-batch COGS breakdown by ingredient category for a date range.', 'reports',
 '["aggregates: allocations", "joins: batches, recipes, brands, inventory_lots, inventory_items"]',
 '["batch_id", "malt_cost", "hop_cost", "yeast_cost", "total_ingredient_cost", "total_landed_cost"]',
 '["Get batch costs for last month", "Analyze cost per BBL trends"]'),

('margin_by_channel', 'RPC function returning revenue vs COGS by sales channel for a date range.', 'reports',
 '["aggregates: orders, order_items", "joins: customers, sales_channels, recipes_with_cogs"]',
 '["channel_name", "total_revenue", "total_cogs", "gross_margin", "margin_pct"]',
 '["Compare margins across channels", "Find highest-margin sales channel"]'),

('project_finished_goods', 'RPC function projecting expected finished goods from batches in pipeline.', 'planning',
 '["uses: batches_in_production_by_brand", "joins: brands"]',
 '["brand_name", "batch_number", "estimated_ready_date", "confidence"]',
 '["What is ready this week?", "Production forecast for next month"]'),

('project_revenue', 'RPC function projecting order book revenue by week and sales channel.', 'planning',
 '["aggregates: orders, order_items", "joins: customers, sales_channels"]',
 '["projection_week", "channel_name", "total_revenue", "order_count"]',
 '["Revenue forecast for next 8 weeks", "Expected revenue by channel"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  updated_at = NOW();
```

**Step 2: Verify migration file exists**

Run: `ls supabase/migrations/00139_cogs_and_projection_rpcs.sql`
Expected: file exists

**Step 3: Commit**

```bash
git add supabase/migrations/00139_cogs_and_projection_rpcs.sql
git commit -m "feat: add COGS and projection SQL RPCs

Four new functions:
- cogs_by_period: batch costs by ingredient category
- margin_by_channel: revenue vs COGS by sales channel
- project_finished_goods: expected output from pipeline
- project_revenue: order book revenue by week"
```

---

### Task 4: Add query keys for new reports

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add new query key factories**

Add to the `reportKeys` object (after `batchCostDetail`):

```typescript
/** COGS by period — per-batch cost breakdown by ingredient category */
cogs: (dateRange: { from: string; to: string }) =>
  ["reports", "cogs", dateRange] as const,
/** Margin analysis by sales channel */
marginByChannel: (dateRange: { from: string; to: string }) =>
  ["reports", "margin-by-channel", dateRange] as const,
/** Projected finished goods output from pipeline */
projectedGoods: (horizonWeeks: number) =>
  ["reports", "projected-goods", horizonWeeks] as const,
/** Projected revenue from order book */
projectedRevenue: (horizonWeeks: number, includeDrafts: boolean) =>
  ["reports", "projected-revenue", horizonWeeks, includeDrafts] as const,
```

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add query key factories for COGS and projection reports"
```

---

### Task 5: Build the COGS tab component

**Files:**
- Create: `src/app/(app)/reports/projections/cogs-tab.tsx`

**Step 1: Create the COGS tab component**

This component has three sections:
1. Summary cards (Total COGS, Avg COGS/BBL, Total Revenue, Gross Margin %)
2. Period cost table with per-batch rows and category breakdown
3. Channel margin table

Reference `src/app/(app)/reports/batch-cost/page.tsx` for patterns — use same query structure but with `cogs_by_period` RPC.

Key implementation details:
- Accept `dateRange: { from: string; to: string }` and `channelFilter: string | null` props
- Use `dynamicRpc(supabase, "cogs_by_period", { p_start_date, p_end_date })` for batch costs
- Use `dynamicRpc(supabase, "margin_by_channel", { p_start_date, p_end_date })` for channel margins
- Use `reportKeys.cogs(dateRange)` and `reportKeys.marginByChannel(dateRange)` query keys
- Import from `@/services/types` for `dynamicRpc`
- Summary cards: Total COGS, Avg COGS/BBL, Total Revenue (from margin_by_channel sum), Gross Margin %
- Batch cost table: batch #, recipe, brand, volume, malt/hop/yeast/adjunct/other columns, total, landed, cost/BBL
- Channel margin table: channel name, orders, units, revenue, COGS, margin, margin %
- Use Recharts `BarChart` for stacked cost breakdown by category
- Use `formatCurrency` and `formatBbl` from `@/lib/format`

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/(app)/reports/projections/cogs-tab.tsx
git commit -m "feat: add COGS tab with period costs and channel margins"
```

---

### Task 6: Build the weekly forecast tab component

**Files:**
- Create: `src/app/(app)/reports/projections/weekly-tab.tsx`

**Step 1: Create the weekly forecast tab component**

Three sections in one tab:
1. Ingredient Needs — reuse existing `calculate_ingredient_shortfalls` RPC
2. Expected Finished Goods — use `project_finished_goods` RPC
3. Expected Revenue — use `project_revenue` RPC

Key implementation details:
- Accept `channelFilter: string | null` prop
- Ingredient Needs section:
  - Use `purchasingKeys.ingredientShortfalls({ horizonWeeks: 8 })` query key
  - Use `dynamicRpc(supabase, "calculate_ingredient_shortfalls", { p_horizon_weeks: 8 })`
  - Table columns: ingredient, type, current stock, on order, required, shortfall, order by date
  - Highlight urgent rows (where `is_urgent` is true) with `bg-destructive/10`
  - Use `getCatalogTypeDisplay` and `formatQuantityWithUnit` from `demand-calculator.ts`
- Expected Finished Goods section:
  - Use `reportKeys.projectedGoods(8)` query key
  - Use `dynamicRpc(supabase, "project_finished_goods", { p_horizon_weeks: 8 })`
  - Table columns: brand, batch #, status, volume BBL, estimated ready, confidence
  - Color-code confidence: high=green, medium=yellow, low=muted
- Expected Revenue section:
  - Use `reportKeys.projectedRevenue(8, false)` query key
  - Use `dynamicRpc(supabase, "project_revenue", { p_horizon_weeks: 8, p_include_drafts: false })`
  - Table grouped by week: week, channel, orders, units, revenue
  - Subtotals per week
  - Filter by channelFilter if set

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/(app)/reports/projections/weekly-tab.tsx
git commit -m "feat: add weekly forecast tab with ingredients, FG, and revenue"
```

---

### Task 7: Build the monthly outlook tab component

**Files:**
- Create: `src/app/(app)/reports/projections/monthly-tab.tsx`

**Step 1: Create the monthly outlook tab component**

Same three sections as weekly but with 26-week horizon rolled up to monthly buckets.

Key implementation details:
- Uses same RPCs as weekly but with `p_horizon_weeks: 26`
- Groups data by month instead of week using `date-fns` `startOfMonth`
- Includes draft orders as "potential" revenue (visually distinct with dashed border or muted style)
- For revenue: use `project_revenue` with `p_include_drafts: true`, show drafts separately
- Bar charts using Recharts:
  - `BarChart` for projected revenue by month (stacked by channel)
  - `BarChart` for expected finished goods volume by month
- Use `reportKeys.projectedGoods(26)` and `reportKeys.projectedRevenue(26, true)`

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/(app)/reports/projections/monthly-tab.tsx
git commit -m "feat: add monthly outlook tab with charts and draft order projections"
```

---

### Task 8: Build the projections page with tabs

**Files:**
- Create: `src/app/(app)/reports/projections/page.tsx`
- Modify: `src/app/(app)/reports/page.tsx`

**Step 1: Create the main projections page**

```typescript
"use client";

/**
 * Projections & COGS Report Page
 *
 * Tabbed report combining COGS analysis, weekly forecasting, and monthly outlook.
 * Shared controls: date range picker and sales channel filter.
 */

import React, { useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COGSTab } from "./cogs-tab";
import { WeeklyTab } from "./weekly-tab";
import { MonthlyTab } from "./monthly-tab";

export default function ProjectionsPage() {
  // Shared state
  const defaultFrom = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd");
  const defaultTo = format(endOfMonth(new Date()), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);

  // Fetch sales channels for filter dropdown
  const supabase = createClient();
  const { data: channels } = useQuery({
    queryKey: ["sales-channels-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_channels")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const dateRange = { from: fromDate, to: toDate };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="ghost" size="icon" aria-label="Back to reports">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Projections & COGS
          </h1>
          <p className="text-muted-foreground">
            Cost analysis, margin tracking, and production forecasting
          </p>
        </div>
      </div>

      {/* Shared Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>Date range applies to COGS; projections use forward-looking horizon</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-2">
              <Label>From</Label>
              <DatePicker value={fromDate} onChange={(v) => v && setFromDate(v)} />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <DatePicker value={toDate} onChange={(v) => v && setToDate(v)} />
            </div>
            <div className="space-y-2">
              <Label>Sales Channel</Label>
              <Select
                value={channelFilter ?? "_all"}
                onValueChange={(v) => setChannelFilter(v === "_all" ? null : v)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Channels</SelectItem>
                  {channels?.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="cogs">
        <TabsList>
          <TabsTrigger value="cogs">COGS & Margins</TabsTrigger>
          <TabsTrigger value="weekly">Weekly Forecast</TabsTrigger>
          <TabsTrigger value="monthly">Monthly Outlook</TabsTrigger>
        </TabsList>
        <TabsContent value="cogs" className="mt-4">
          <COGSTab dateRange={dateRange} channelFilter={channelFilter} />
        </TabsContent>
        <TabsContent value="weekly" className="mt-4">
          <WeeklyTab channelFilter={channelFilter} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyTab channelFilter={channelFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 2: Add to reports index page**

In `src/app/(app)/reports/page.tsx`, add to the `reports` array:

```typescript
{
  title: "Projections & COGS",
  description: "Cost analysis, margin tracking, and production forecasting",
  href: "/reports/projections",
  icon: TrendingUp,
},
```

Add `TrendingUp` to the lucide-react import.

**Step 3: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 4: Run lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/app/(app)/reports/projections/page.tsx src/app/(app)/reports/page.tsx
git commit -m "feat: add projections page with tabs and update reports index

New /reports/projections page with COGS & Margins, Weekly Forecast,
and Monthly Outlook tabs. Shared date range and channel filters."
```

---

### Task 9: Final validation

**Step 1: Run full typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm tsc --noEmit`
Expected: No errors

**Step 2: Run lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm lint`
Expected: No new errors

**Step 3: Run tests**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm vitest run`
Expected: All pass

**Step 4: Build**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-1 && pnpm build`
Expected: Success

**Step 5: Verify all files created/modified**

```
supabase/migrations/00138_vendor_lead_time_cascade.sql     (new)
supabase/migrations/00139_cogs_and_projection_rpcs.sql     (new)
src/lib/purchasing/po-generator.ts                          (modified)
src/lib/purchasing/__tests__/po-generator.test.ts           (new)
src/lib/query-keys.ts                                       (modified)
src/app/(app)/reports/page.tsx                              (modified)
src/app/(app)/reports/projections/page.tsx                  (new)
src/app/(app)/reports/projections/cogs-tab.tsx              (new)
src/app/(app)/reports/projections/weekly-tab.tsx            (new)
src/app/(app)/reports/projections/monthly-tab.tsx           (new)
```

---

## Dependency Graph

```
Task 1 (SQL lead time fix)     ──┐
Task 2 (TS lead time fix)      ──┤── independent, can run in parallel
Task 3 (COGS + projection SQL) ──┤
Task 4 (query keys)            ──┘
                                  │
Task 5 (COGS tab)        ←── depends on Task 3, 4
Task 6 (weekly tab)       ←── depends on Task 3, 4
Task 7 (monthly tab)      ←── depends on Task 3, 4
                                  │
Task 8 (page + index)    ←── depends on Tasks 5, 6, 7
Task 9 (final validation) ←── depends on all
```

Tasks 1-4 can run in parallel.
Tasks 5-7 can run in parallel (after 3-4).
Tasks 8-9 are sequential.
