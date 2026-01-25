-- =============================================================================
-- Migration: Backward Production Planning
-- =============================================================================
-- Implements demand aggregation, supply tracking, and shortfall calculation
-- for production planning from order due dates.
--
-- Features:
--   1. Add cases_per_bbl to package_types for yield conversion
--   2. order_demand_by_product view - aggregates order demand by brand/package/week
--   3. finished_goods_supply_by_product view - aggregates available inventory
--   4. batches_in_production_by_brand view - shows active batches with ready dates
--   5. calculate_production_shortfalls() function - identifies shortfalls
--   6. Performance indexes
-- =============================================================================

-- =============================================================================
-- 1. YIELD CONVERSION HELPER FUNCTION
-- =============================================================================
-- Calculates units per BBL from package_type dimensions.
-- Works for any package type: cans, bottles, kegs, growlers.
--
-- 1 BBL = 31 gallons = 3968 oz
--
-- For cans/bottles (units_per_case is set):
--   yield = (3968 / volume_oz) / units_per_case = cases per BBL
--
-- For kegs (units_per_case is null):
--   yield = 3968 / volume_oz = kegs per BBL
--
-- Examples:
--   16oz can, 24/case: (3968/16)/24 = 10.3 cases/BBL
--   Half barrel (1984 oz): 3968/1984 = 2 kegs/BBL
--   Sixtel (661 oz): 3968/661 = 6 sixtels/BBL

CREATE OR REPLACE FUNCTION calculate_units_per_bbl(
  p_volume_oz DECIMAL,
  p_units_per_case INTEGER
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_oz_per_bbl CONSTANT DECIMAL := 3968;  -- 31 gallons * 128 oz/gallon
BEGIN
  IF p_volume_oz IS NULL OR p_volume_oz <= 0 THEN
    RETURN NULL;
  END IF;

  IF p_units_per_case IS NOT NULL AND p_units_per_case > 0 THEN
    -- Cans/bottles: return cases per BBL
    RETURN (v_oz_per_bbl / p_volume_oz) / p_units_per_case;
  ELSE
    -- Kegs/growlers: return units per BBL
    RETURN v_oz_per_bbl / p_volume_oz;
  END IF;
END;
$$;

COMMENT ON FUNCTION calculate_units_per_bbl IS 'Calculates yield (units or cases) per BBL from package dimensions. Automatically handles cans/bottles (cases) vs kegs (individual units).';

-- Add optional override column for manual yield adjustment
ALTER TABLE package_types
  ADD COLUMN IF NOT EXISTS units_per_bbl_override DECIMAL(6,2);

COMMENT ON COLUMN package_types.units_per_bbl_override IS 'Optional manual override for units per BBL. If set, used instead of calculated value. Useful for accounting for packaging losses.';

-- =============================================================================
-- 2. ORDER DEMAND BY PRODUCT VIEW
-- =============================================================================
-- Aggregates demand from orders by brand + package type + week.
-- Includes draft orders for forward planning.

CREATE VIEW order_demand_by_product
WITH (security_invoker = true)
AS
SELECT
  oi.brand_id,
  oi.package_type_id,
  DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::date AS demand_week,
  SUM(oi.quantity)::integer AS total_quantity,
  COUNT(DISTINCT o.id)::integer AS order_count,
  MIN(COALESCE(o.scheduled_date, o.requested_date)) AS earliest_due_date,
  MAX(COALESCE(o.scheduled_date, o.requested_date)) AS latest_due_date,
  ARRAY_AGG(DISTINCT o.id) AS order_ids,
  -- Include status info for filtering
  ARRAY_AGG(DISTINCT o.status) AS order_statuses
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status NOT IN ('fulfilled', 'cancelled')
  AND oi.brand_id IS NOT NULL
  AND oi.package_type_id IS NOT NULL
  AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
GROUP BY oi.brand_id, oi.package_type_id, DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date));

COMMENT ON VIEW order_demand_by_product IS 'Aggregated order demand by brand, package type, and week. Used for production planning.';

-- =============================================================================
-- 3. FINISHED GOODS SUPPLY BY PRODUCT VIEW
-- =============================================================================
-- Aggregates available finished goods inventory by brand + package type.

CREATE VIEW finished_goods_supply_by_product
WITH (security_invoker = true)
AS
SELECT
  fg.brand_id,
  fg.package_type_id,
  SUM(fg.quantity)::integer AS total_quantity,
  SUM(fga.available_quantity)::integer AS available_quantity,
  SUM(fga.allocated_quantity)::integer AS allocated_quantity,
  SUM(fga.reserved_quantity)::integer AS reserved_quantity
FROM finished_goods fg
JOIN finished_goods_with_availability fga ON fga.id = fg.id
WHERE fg.brand_id IS NOT NULL AND fg.package_type_id IS NOT NULL
GROUP BY fg.brand_id, fg.package_type_id;

COMMENT ON VIEW finished_goods_supply_by_product IS 'Aggregated finished goods inventory by brand and package type. Shows total, available, allocated, and reserved quantities.';

-- =============================================================================
-- 4. BATCHES IN PRODUCTION BY BRAND VIEW
-- =============================================================================
-- Shows active batches that will produce finished goods, with estimated ready dates.

CREATE VIEW batches_in_production_by_brand
WITH (security_invoker = true)
AS
SELECT
  r.brand_id,
  b.id AS batch_id,
  b.batch_number,
  b.name AS batch_name,
  b.status,
  b.planned_start_date,
  b.volume_bbl,
  r.id AS recipe_id,
  r.name AS recipe_name,
  r.fermentation_days,
  r.conditioning_days,
  -- Estimated ready date (when batch can be packaged)
  CASE
    WHEN b.planned_start_date IS NOT NULL
    THEN (b.planned_start_date + INTERVAL '1 day' * (
      COALESCE(r.fermentation_days, 14) + COALESCE(r.conditioning_days, 7)
    ))::date
    ELSE NULL
  END AS estimated_ready_date
FROM batches b
JOIN recipes r ON r.id = b.recipe_id
WHERE b.status IN ('planned', 'fermenting', 'conditioning')
  AND r.brand_id IS NOT NULL;

COMMENT ON VIEW batches_in_production_by_brand IS 'Active batches with estimated packaging-ready dates based on recipe lead times.';

-- =============================================================================
-- 5. PRODUCTION SHORTFALL CALCULATION FUNCTION
-- =============================================================================
-- Calculates demand vs supply shortfalls with recommended brew start dates.

CREATE OR REPLACE FUNCTION calculate_production_shortfalls(
  p_include_drafts BOOLEAN DEFAULT true,
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE (
  brand_id UUID,
  brand_name TEXT,
  package_type_id UUID,
  package_type_name TEXT,
  demand_week DATE,
  demand_quantity INTEGER,
  available_quantity INTEGER,
  in_production_bbl NUMERIC,
  in_production_cases INTEGER,
  shortfall_quantity INTEGER,
  recommended_brew_start DATE,
  lead_time_days INTEGER,
  recipe_id UUID,
  recipe_name TEXT,
  is_urgent BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_packaging_buffer INTEGER := 2;  -- Default packaging buffer days
BEGIN
  RETURN QUERY
  WITH demand AS (
    -- Aggregate demand from orders
    SELECT
      oi.brand_id,
      oi.package_type_id,
      DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))::date AS demand_week,
      SUM(oi.quantity)::integer AS quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE (
      CASE
        WHEN p_include_drafts THEN o.status NOT IN ('fulfilled', 'cancelled')
        ELSE o.status IN ('confirmed', 'scheduled', 'picking', 'packed')
      END
    )
      AND oi.brand_id IS NOT NULL
      AND oi.package_type_id IS NOT NULL
      AND COALESCE(o.scheduled_date, o.requested_date) IS NOT NULL
      AND COALESCE(o.scheduled_date, o.requested_date) <= CURRENT_DATE + (p_horizon_weeks * 7)
    GROUP BY oi.brand_id, oi.package_type_id, DATE_TRUNC('week', COALESCE(o.scheduled_date, o.requested_date))
  ),
  supply AS (
    -- Get available finished goods supply
    SELECT
      fgsp.brand_id,
      fgsp.package_type_id,
      COALESCE(fgsp.available_quantity, 0)::integer AS available_qty
    FROM finished_goods_supply_by_product fgsp
  ),
  in_production AS (
    -- Get batches in production with yield estimates
    -- Uses calculate_units_per_bbl() for automatic yield calculation
    SELECT
      bip.brand_id,
      d_inner.package_type_id,
      SUM(bip.volume_bbl) AS volume_bbl,
      -- Estimate units using calculated yield or override
      SUM(bip.volume_bbl * COALESCE(
        pt.units_per_bbl_override,
        calculate_units_per_bbl(pt.volume_oz, pt.units_per_case),
        10.0  -- Fallback default if package_type missing dimensions
      ))::integer AS estimated_units
    FROM batches_in_production_by_brand bip
    -- Need to know which package type for yield calc
    CROSS JOIN LATERAL (
      SELECT DISTINCT d.package_type_id
      FROM demand d
      WHERE d.brand_id = bip.brand_id
    ) d_inner
    LEFT JOIN package_types pt ON pt.id = d_inner.package_type_id
    GROUP BY bip.brand_id, d_inner.package_type_id
  ),
  preferred_recipe AS (
    -- Get the most recently updated active recipe per brand
    SELECT DISTINCT ON (r.brand_id)
      r.brand_id,
      r.id AS recipe_id,
      r.name AS recipe_name,
      COALESCE(r.fermentation_days, 14) AS fermentation_days,
      COALESCE(r.conditioning_days, 7) AS conditioning_days
    FROM recipes r
    WHERE r.is_active = true
      AND r.brand_id IS NOT NULL
    ORDER BY r.brand_id, r.updated_at DESC
  )
  SELECT
    d.brand_id,
    b.name AS brand_name,
    d.package_type_id,
    pt.name AS package_type_name,
    d.demand_week,
    d.quantity AS demand_quantity,
    COALESCE(s.available_qty, 0) AS available_quantity,
    COALESCE(ip.volume_bbl, 0) AS in_production_bbl,
    COALESCE(ip.estimated_units, 0) AS in_production_cases,  -- "cases" for backwards compat, actually units
    GREATEST(d.quantity - COALESCE(s.available_qty, 0) - COALESCE(ip.estimated_units, 0), 0)::integer AS shortfall_quantity,
    -- Recommended brew start: demand_week - lead_time - packaging_buffer
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date AS recommended_brew_start,
    (COALESCE(pr.fermentation_days, 14) +
     COALESCE(pr.conditioning_days, 7) +
     v_packaging_buffer) AS lead_time_days,
    pr.recipe_id,
    pr.recipe_name,
    -- Urgent if brew should have started already or within 7 days
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date <= CURRENT_DATE + 7 AS is_urgent
  FROM demand d
  JOIN brands b ON b.id = d.brand_id
  JOIN package_types pt ON pt.id = d.package_type_id
  LEFT JOIN supply s ON s.brand_id = d.brand_id AND s.package_type_id = d.package_type_id
  LEFT JOIN in_production ip ON ip.brand_id = d.brand_id AND ip.package_type_id = d.package_type_id
  LEFT JOIN preferred_recipe pr ON pr.brand_id = d.brand_id
  WHERE d.quantity > COALESCE(s.available_qty, 0) + COALESCE(ip.estimated_units, 0)
  ORDER BY
    -- Urgent items first, then by recommended brew start
    (d.demand_week - (
      COALESCE(pr.fermentation_days, 14) +
      COALESCE(pr.conditioning_days, 7) +
      v_packaging_buffer
    ))::date <= CURRENT_DATE + 7 DESC,
    d.demand_week,
    d.brand_id;
END;
$$;

COMMENT ON FUNCTION calculate_production_shortfalls IS 'Calculates production shortfalls with recommended brew start dates. Returns items where demand exceeds supply + in-production.';

-- =============================================================================
-- 6. PERFORMANCE INDEXES
-- =============================================================================

-- Order items demand queries
CREATE INDEX IF NOT EXISTS idx_order_items_brand_package
ON order_items(brand_id, package_type_id)
WHERE brand_id IS NOT NULL AND package_type_id IS NOT NULL;

-- Orders by status and date for planning
CREATE INDEX IF NOT EXISTS idx_orders_planning
ON orders(status, scheduled_date, requested_date)
WHERE status NOT IN ('fulfilled', 'cancelled');

-- Batches for in-production queries
CREATE INDEX IF NOT EXISTS idx_batches_planning
ON batches(status, recipe_id)
WHERE status IN ('planned', 'fermenting', 'conditioning');

-- Recipes by brand for preferred recipe lookup
CREATE INDEX IF NOT EXISTS idx_recipes_brand_active
ON recipes(brand_id, updated_at DESC)
WHERE brand_id IS NOT NULL AND is_active = true;

-- =============================================================================
-- 7. SCHEMA REGISTRY ENTRIES
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields, query_examples) VALUES
('order_demand_by_product', 'Aggregated order demand by brand, package type, and week. Used for production planning.', 'planning',
 '["belongs_to: brands", "belongs_to: package_types", "aggregates: orders via order_items"]',
 '["brand_id", "package_type_id", "demand_week", "total_quantity"]',
 '["Get demand for next 8 weeks", "Find high-demand products", "Aggregate orders by brand"]'),

('finished_goods_supply_by_product', 'Current finished goods supply aggregated by brand and package type.', 'planning',
 '["aggregates: finished_goods_with_availability"]',
 '["brand_id", "package_type_id", "available_quantity"]',
 '["Get available inventory by product", "Find low-stock products"]'),

('batches_in_production_by_brand', 'Active batches that will produce finished goods, with estimated ready dates.', 'planning',
 '["belongs_to: batches", "belongs_to: recipes", "belongs_to: brands"]',
 '["brand_id", "batch_id", "status", "estimated_ready_date"]',
 '["Get batches producing brand X", "Find batches ready this week"]')

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

SELECT 'Production planning migration complete!' AS message;
