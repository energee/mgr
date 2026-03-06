-- =============================================================================
-- Migration: COGS and Projection SQL RPCs
-- =============================================================================
-- Four RPC functions for the reports/projections dashboard:
--   1. cogs_by_period      - Per-batch cost breakdown by ingredient category
--   2. margin_by_channel   - Revenue vs COGS by sales channel
--   3. project_finished_goods - Expected FG output from pipeline
--   4. project_revenue     - Revenue projections by week and channel
-- =============================================================================

-- =============================================================================
-- 1. cogs_by_period(p_start_date, p_end_date)
-- =============================================================================
-- Returns per-batch cost breakdown using allocation data from inventory lots.
-- Joins batches -> recipes -> brands and allocations -> inventory_lots -> inventory_items
-- to pivot costs by inventory_items.category.

CREATE OR REPLACE FUNCTION cogs_by_period(
  p_start_date DATE,
  p_end_date DATE
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
  malt_cost DECIMAL,
  hop_cost DECIMAL,
  yeast_cost DECIMAL,
  adjunct_cost DECIMAL,
  other_cost DECIMAL,
  total_ingredient_cost DECIMAL,
  total_landed_cost DECIMAL,
  cost_per_bbl DECIMAL,
  has_allocation_data BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_allocations AS (
    -- Get all allocations going INTO batches from inventory lots
    SELECT
      a.destination_id AS batch_id,
      ii.category,
      SUM(a.quantity * COALESCE(a.unit_cost, il.unit_cost, 0)) AS ingredient_cost,
      SUM(a.quantity * COALESCE(il.landed_cost, 0)) AS landed_cost
    FROM allocations a
    JOIN inventory_lots il ON il.id = a.source_id
    JOIN inventory_items ii ON ii.id = il.inventory_item_id
    WHERE a.destination_type = 'batch'
      AND a.source_type = 'inventory_lot'
      AND a.status IN ('completed', 'planned')
    GROUP BY a.destination_id, ii.category
  ),
  pivoted AS (
    -- Pivot costs by category per batch
    SELECT
      ba.batch_id,
      COALESCE(SUM(CASE WHEN ba.category = 'grain' THEN ba.ingredient_cost END), 0) AS malt_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'hops' THEN ba.ingredient_cost END), 0) AS hop_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'yeast' THEN ba.ingredient_cost END), 0) AS yeast_cost,
      COALESCE(SUM(CASE WHEN ba.category = 'adjunct' THEN ba.ingredient_cost END), 0) AS adjunct_cost,
      COALESCE(SUM(CASE WHEN ba.category NOT IN ('grain', 'hops', 'yeast', 'adjunct') THEN ba.ingredient_cost END), 0) AS other_cost,
      COALESCE(SUM(ba.ingredient_cost), 0) AS total_ingredient_cost,
      COALESCE(SUM(ba.landed_cost), 0) AS total_landed_cost,
      TRUE AS has_allocation_data
    FROM batch_allocations ba
    GROUP BY ba.batch_id
  )
  SELECT
    b.id AS batch_id,
    b.batch_number,
    b.name AS batch_name,
    r.name AS recipe_name,
    br.name AS brand_name,
    r.brand_id,
    b.volume_bbl,
    b.status,
    b.created_at,
    ROUND(COALESCE(p.malt_cost, 0)::numeric, 2) AS malt_cost,
    ROUND(COALESCE(p.hop_cost, 0)::numeric, 2) AS hop_cost,
    ROUND(COALESCE(p.yeast_cost, 0)::numeric, 2) AS yeast_cost,
    ROUND(COALESCE(p.adjunct_cost, 0)::numeric, 2) AS adjunct_cost,
    ROUND(COALESCE(p.other_cost, 0)::numeric, 2) AS other_cost,
    ROUND(COALESCE(p.total_ingredient_cost, 0)::numeric, 2) AS total_ingredient_cost,
    ROUND(COALESCE(p.total_landed_cost, 0)::numeric, 2) AS total_landed_cost,
    CASE
      WHEN COALESCE(b.volume_bbl, 0) > 0
      THEN ROUND((COALESCE(p.total_ingredient_cost, 0) / b.volume_bbl)::numeric, 2)
      ELSE NULL
    END AS cost_per_bbl,
    COALESCE(p.has_allocation_data, FALSE) AS has_allocation_data
  FROM batches b
  LEFT JOIN recipes r ON r.id = b.recipe_id
  LEFT JOIN brands br ON br.id = r.brand_id
  LEFT JOIN pivoted p ON p.batch_id = b.id
  WHERE b.created_at >= p_start_date
    AND b.created_at < (p_end_date + INTERVAL '1 day')
    AND b.status NOT IN ('cancelled', 'archived')
  ORDER BY b.created_at DESC;
END;
$$;

COMMENT ON FUNCTION cogs_by_period(DATE, DATE) IS 'Returns per-batch cost breakdown by ingredient category for batches created within the given date range. Uses allocation data from inventory lots.';

-- =============================================================================
-- 2. margin_by_channel(p_start_date, p_end_date)
-- =============================================================================
-- Returns revenue vs COGS by sales channel.
-- Revenue from order_items, COGS estimated from recipes_with_cogs.

CREATE OR REPLACE FUNCTION margin_by_channel(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  channel_id UUID,
  channel_name TEXT,
  order_count INTEGER,
  total_units BIGINT,
  total_revenue DECIMAL,
  total_cogs DECIMAL,
  gross_margin DECIMAL,
  margin_pct DECIMAL
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH order_data AS (
    SELECT
      COALESCE(sc.id, '00000000-0000-0000-0000-000000000000'::uuid) AS channel_id,
      COALESCE(sc.name, 'Uncategorized') AS channel_name,
      o.id AS order_id,
      oi.quantity,
      oi.unit_price,
      oi.brand_id,
      oi.selling_format_id
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN sales_channels sc ON sc.id = c.sales_channel_id
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status NOT IN ('draft', 'cancelled')
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
  ),
  cogs_per_unit AS (
    -- Estimate COGS per unit: cogs_per_bbl / units_per_bbl
    -- Join through selling_formats -> containers for volume_oz
    SELECT
      od.channel_id,
      od.channel_name,
      od.order_id,
      od.quantity,
      od.unit_price,
      CASE
        WHEN COALESCE(
          calculate_units_per_bbl(ct.volume_oz, sf.unit_count),
          0
        ) > 0
        THEN COALESCE(rwc.cogs_per_bbl, 0) / calculate_units_per_bbl(ct.volume_oz, sf.unit_count)
        ELSE 0
      END AS unit_cogs
    FROM order_data od
    LEFT JOIN brands b ON b.id = od.brand_id
    LEFT JOIN LATERAL (
      SELECT r.id
      FROM recipes r
      WHERE r.brand_id = b.id AND r.is_active = true
      ORDER BY r.updated_at DESC
      LIMIT 1
    ) r_active ON true
    LEFT JOIN recipes_with_cogs rwc ON rwc.id = r_active.id
    LEFT JOIN selling_formats sf ON sf.id = od.selling_format_id
    LEFT JOIN containers ct ON ct.id = sf.container_id
  )
  SELECT
    cpu.channel_id,
    cpu.channel_name,
    COUNT(DISTINCT cpu.order_id)::integer AS order_count,
    SUM(cpu.quantity)::bigint AS total_units,
    ROUND(SUM(cpu.quantity * COALESCE(cpu.unit_price, 0))::numeric, 2) AS total_revenue,
    ROUND(SUM(cpu.quantity * cpu.unit_cogs)::numeric, 2) AS total_cogs,
    ROUND((SUM(cpu.quantity * COALESCE(cpu.unit_price, 0)) - SUM(cpu.quantity * cpu.unit_cogs))::numeric, 2) AS gross_margin,
    CASE
      WHEN SUM(cpu.quantity * COALESCE(cpu.unit_price, 0)) > 0
      THEN ROUND(
        ((SUM(cpu.quantity * COALESCE(cpu.unit_price, 0)) - SUM(cpu.quantity * cpu.unit_cogs))
         / SUM(cpu.quantity * COALESCE(cpu.unit_price, 0)) * 100)::numeric, 1)
      ELSE 0
    END AS margin_pct
  FROM cogs_per_unit cpu
  GROUP BY cpu.channel_id, cpu.channel_name
  ORDER BY total_revenue DESC;
END;
$$;

COMMENT ON FUNCTION margin_by_channel(DATE, DATE) IS 'Returns revenue vs estimated COGS by sales channel for orders within the given date range. COGS estimated from active recipe costs.';

-- =============================================================================
-- 3. project_finished_goods(p_horizon_weeks)
-- =============================================================================
-- Returns expected finished goods output from production pipeline.
-- Uses batches_in_production_by_brand view with confidence levels.

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
    br.name AS brand_name,
    bip.batch_id,
    bip.batch_number,
    bip.status AS batch_status,
    bip.volume_bbl,
    bip.estimated_ready_date,
    DATE_TRUNC('week', bip.estimated_ready_date)::date AS projection_week,
    CASE bip.status
      WHEN 'conditioning' THEN 'high'
      WHEN 'fermenting' THEN 'medium'
      WHEN 'planned' THEN 'low'
      ELSE 'low'
    END AS confidence
  FROM batches_in_production_by_brand bip
  JOIN brands br ON br.id = bip.brand_id
  WHERE bip.estimated_ready_date IS NOT NULL
    AND bip.estimated_ready_date <= CURRENT_DATE + (p_horizon_weeks * 7)
  ORDER BY bip.estimated_ready_date, br.name;
END;
$$;

COMMENT ON FUNCTION project_finished_goods(INTEGER) IS 'Returns expected finished goods output from production pipeline with confidence levels based on batch status. Conditioning=high, fermenting=medium, planned=low.';

-- =============================================================================
-- 4. project_revenue(p_horizon_weeks, p_include_drafts)
-- =============================================================================
-- Returns revenue projections by week and sales channel from future orders.

CREATE OR REPLACE FUNCTION project_revenue(
  p_horizon_weeks INTEGER DEFAULT 8,
  p_include_drafts BOOLEAN DEFAULT false
)
RETURNS TABLE (
  projection_week DATE,
  channel_id UUID,
  channel_name TEXT,
  order_count INTEGER,
  total_units BIGINT,
  total_revenue DECIMAL,
  includes_drafts BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::date AS projection_week,
    COALESCE(sc.id, '00000000-0000-0000-0000-000000000000'::uuid) AS channel_id,
    COALESCE(sc.name, 'Uncategorized') AS channel_name,
    COUNT(DISTINCT o.id)::integer AS order_count,
    SUM(oi.quantity)::bigint AS total_units,
    ROUND(SUM(oi.quantity * COALESCE(oi.unit_price, 0))::numeric, 2) AS total_revenue,
    p_include_drafts AS includes_drafts
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN sales_channels sc ON sc.id = c.sales_channel_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE COALESCE(o.scheduled_date, o.requested_date) >= CURRENT_DATE
    AND COALESCE(o.scheduled_date, o.requested_date) <= CURRENT_DATE + (p_horizon_weeks * 7)
    AND (
      CASE
        WHEN p_include_drafts THEN o.status NOT IN ('fulfilled', 'cancelled')
        ELSE o.status NOT IN ('draft', 'fulfilled', 'cancelled')
      END
    )
  GROUP BY
    DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date)),
    COALESCE(sc.id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(sc.name, 'Uncategorized')
  ORDER BY projection_week, total_revenue DESC;
END;
$$;

COMMENT ON FUNCTION project_revenue(INTEGER, BOOLEAN) IS 'Returns revenue projections by week and sales channel from future orders. Optionally includes draft orders for forward planning.';

-- =============================================================================
-- 5. Schema Registry Entries
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples) VALUES
('cogs_by_period', 'RPC function returning per-batch cost breakdown by ingredient category within a date range.', 'reports',
 '["joins: batches", "joins: recipes", "joins: brands", "joins: allocations", "joins: inventory_lots", "joins: inventory_items"]',
 '["batch_id", "malt_cost", "hop_cost", "yeast_cost", "total_ingredient_cost", "cost_per_bbl"]',
 '["Get COGS for Q1 2026", "Compare ingredient costs across batches", "Find highest cost-per-BBL batches"]'),

('margin_by_channel', 'RPC function returning revenue vs COGS by sales channel for a date range.', 'reports',
 '["joins: orders", "joins: customers", "joins: sales_channels", "joins: order_items", "joins: recipes_with_cogs"]',
 '["channel_id", "total_revenue", "total_cogs", "gross_margin", "margin_pct"]',
 '["Compare margins across channels", "Find most profitable channel", "Get revenue vs COGS breakdown"]'),

('project_finished_goods', 'RPC function returning expected FG output from production pipeline with confidence levels.', 'reports',
 '["joins: batches_in_production_by_brand", "joins: brands"]',
 '["brand_id", "batch_id", "volume_bbl", "estimated_ready_date", "confidence"]',
 '["Project FG output for next 8 weeks", "Find high-confidence batches ready this week"]'),

('project_revenue', 'RPC function returning revenue projections by week and sales channel from future orders.', 'reports',
 '["joins: orders", "joins: customers", "joins: sales_channels", "joins: order_items"]',
 '["projection_week", "channel_id", "total_revenue", "order_count"]',
 '["Project revenue for next quarter", "Compare channel revenue projections", "Include draft orders in forecast"]')

ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields,
  query_examples = EXCLUDED.query_examples,
  updated_at = NOW();

-- =============================================================================
-- Done
-- =============================================================================

SELECT 'COGS and projection RPCs migration complete!' AS message;
