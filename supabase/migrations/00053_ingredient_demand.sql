-- =============================================================================
-- Migration: 00053_ingredient_demand
--
-- Phase 14: PO Generation from Ingredient Demand
-- Creates views and functions to calculate ingredient demand from planned/
-- fermenting batches and identify shortfalls requiring purchase orders.
-- =============================================================================

-- =============================================================================
-- RECIPE INGREDIENTS NORMALIZED VIEW
-- Unifies all ingredient types into a single view for demand calculation
-- =============================================================================

DROP VIEW IF EXISTS recipe_ingredients_normalized CASCADE;
CREATE VIEW recipe_ingredients_normalized
WITH (security_invoker = true)
AS
-- Malts (weight in lbs)
SELECT
  rm.recipe_id,
  'malt' as catalog_type,
  rm.malt_id as catalog_id,
  m.name as catalog_name,
  rm.weight_lbs as quantity,
  'lb' as unit
FROM recipe_malts rm
JOIN malts m ON m.id = rm.malt_id

UNION ALL

-- Hops (convert oz to lb for consistency)
SELECT
  rh.recipe_id,
  'hop' as catalog_type,
  rh.hop_id as catalog_id,
  h.name as catalog_name,
  rh.weight_oz / 16.0 as quantity,
  'lb' as unit
FROM recipe_hops rh
JOIN hops h ON h.id = rh.hop_id

UNION ALL

-- Adjuncts (weight in lbs)
SELECT
  ra.recipe_id,
  'adjunct' as catalog_type,
  ra.adjunct_id as catalog_id,
  a.name as catalog_name,
  ra.weight_lbs as quantity,
  'lb' as unit
FROM recipe_adjuncts ra
JOIN adjuncts a ON a.id = ra.adjunct_id

UNION ALL

-- Sugars (weight in lbs)
SELECT
  rs.recipe_id,
  'sugar' as catalog_type,
  rs.sugar_id as catalog_id,
  s.name as catalog_name,
  rs.weight_lbs as quantity,
  'lb' as unit
FROM recipe_sugars rs
JOIN sugars s ON s.id = rs.sugar_id

UNION ALL

-- Spices (convert to oz for standard unit)
SELECT
  rsp.recipe_id,
  'spice' as catalog_type,
  rsp.spice_id as catalog_id,
  sp.name as catalog_name,
  CASE rsp.unit
    WHEN 'oz' THEN rsp.amount
    WHEN 'g' THEN rsp.amount / 28.35
    WHEN 'tsp' THEN rsp.amount * 0.17  -- ~0.17 oz per tsp
    WHEN 'tbsp' THEN rsp.amount * 0.5  -- ~0.5 oz per tbsp
    ELSE rsp.amount
  END as quantity,
  'oz' as unit
FROM recipe_spices rsp
JOIN spices sp ON sp.id = rsp.spice_id

UNION ALL

-- Fruits (convert to lb)
SELECT
  rf.recipe_id,
  'fruit' as catalog_type,
  rf.fruit_id as catalog_id,
  f.name as catalog_name,
  CASE rf.unit
    WHEN 'lb' THEN rf.amount
    WHEN 'oz' THEN rf.amount / 16.0
    WHEN 'kg' THEN rf.amount * 2.205
    ELSE rf.amount
  END as quantity,
  'lb' as unit
FROM recipe_fruits rf
JOIN fruits f ON f.id = rf.fruit_id;

COMMENT ON VIEW recipe_ingredients_normalized IS 'Normalized view of all recipe ingredients across all types (malts, hops, adjuncts, etc.) with consistent units.';

-- =============================================================================
-- CALCULATE INGREDIENT DEMAND FUNCTION
-- Returns total ingredient demand from planned and fermenting batches
-- =============================================================================

DROP FUNCTION IF EXISTS calculate_ingredient_demand(INTEGER, BOOLEAN, BOOLEAN);
CREATE OR REPLACE FUNCTION calculate_ingredient_demand(
  p_horizon_weeks INTEGER DEFAULT 8,
  p_include_planned BOOLEAN DEFAULT true,
  p_include_fermenting BOOLEAN DEFAULT true
)
RETURNS TABLE (
  catalog_type TEXT,
  catalog_id UUID,
  catalog_name TEXT,
  total_required DECIMAL(12,4),
  unit TEXT,
  earliest_required_by DATE,
  batch_count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch_statuses AS (
    SELECT UNNEST(
      ARRAY[]::TEXT[] ||
      CASE WHEN p_include_planned THEN ARRAY['planned'] ELSE ARRAY[]::TEXT[] END ||
      CASE WHEN p_include_fermenting THEN ARRAY['fermenting'] ELSE ARRAY[]::TEXT[] END
    ) as status
  ),
  eligible_batches AS (
    SELECT
      b.id as batch_id,
      b.recipe_id,
      b.volume_bbl,
      b.planned_start_date,
      r.batch_size_bbl as recipe_batch_size
    FROM batches b
    JOIN recipes r ON r.id = b.recipe_id
    CROSS JOIN batch_statuses bs
    WHERE b.status = bs.status
      AND b.recipe_id IS NOT NULL
      AND b.planned_start_date IS NOT NULL
      AND b.planned_start_date <= (CURRENT_DATE + (p_horizon_weeks * 7))
  ),
  scaled_ingredients AS (
    SELECT
      rin.catalog_type,
      rin.catalog_id,
      rin.catalog_name,
      rin.unit,
      eb.planned_start_date,
      -- Scale ingredient quantity by batch volume / recipe batch size
      rin.quantity * COALESCE(eb.volume_bbl / NULLIF(eb.recipe_batch_size, 0), 1) as scaled_quantity
    FROM recipe_ingredients_normalized rin
    JOIN eligible_batches eb ON eb.recipe_id = rin.recipe_id
  )
  SELECT
    si.catalog_type,
    si.catalog_id,
    si.catalog_name,
    SUM(si.scaled_quantity)::DECIMAL(12,4) as total_required,
    si.unit,
    MIN(si.planned_start_date)::DATE as earliest_required_by,
    COUNT(DISTINCT si.planned_start_date)::INTEGER as batch_count
  FROM scaled_ingredients si
  GROUP BY si.catalog_type, si.catalog_id, si.catalog_name, si.unit
  ORDER BY si.catalog_type, total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_demand IS 'Calculates total ingredient demand from planned/fermenting batches within horizon, scaling by batch volume.';

-- =============================================================================
-- CALCULATE INGREDIENT SHORTFALLS FUNCTION
-- Compares demand against inventory and returns items needing ordering
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
  -- Get available inventory by matching catalog items to inventory_items by name
  -- This is a best-effort match since inventory_items don't have direct catalog FK
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
  -- Get preferred supplier info from supplier_catalog
  preferred_suppliers AS (
    SELECT DISTINCT ON (sc.catalog_type, sc.catalog_id)
      sc.catalog_type,
      sc.catalog_id,
      sc.supplier_id,
      s.name as supplier_name,
      sc.lead_time_days,
      sc.min_order_qty,
      sc.price as unit_price
    FROM supplier_catalog sc
    JOIN suppliers s ON s.id = sc.supplier_id
    WHERE sc.is_preferred = true
       OR sc.id IN (
         -- If no preferred, get the one with lowest price
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
    GREATEST(d.total_required - COALESCE(ia.available_qty, 0), 0)::DECIMAL(12,4) as shortfall_qty,
    d.unit,
    d.earliest_required_by as required_by_date,
    -- Order by date = required date - lead time - 3 day buffer
    (d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3)::DATE as order_by_date,
    COALESCE(ps.lead_time_days, 7)::INTEGER as lead_time_days,
    ps.supplier_id as preferred_supplier_id,
    ps.supplier_name as preferred_supplier_name,
    ps.min_order_qty,
    ps.unit_price,
    -- Urgent if order_by_date is within 3 days or past
    ((d.earliest_required_by - COALESCE(ps.lead_time_days, 7) - 3) <= (CURRENT_DATE + 3))::BOOLEAN as is_urgent,
    d.batch_count
  FROM demand d
  LEFT JOIN inventory_available ia
    ON ia.item_name ILIKE d.catalog_name
    AND ia.inferred_catalog_type = d.catalog_type
  LEFT JOIN preferred_suppliers ps
    ON ps.catalog_type = d.catalog_type
    AND ps.catalog_id = d.catalog_id
  WHERE d.total_required > COALESCE(ia.available_qty, 0)
  ORDER BY is_urgent DESC, order_by_date ASC, d.catalog_type, d.total_required DESC;
END;
$$;

COMMENT ON FUNCTION calculate_ingredient_shortfalls IS 'Calculates ingredient shortfalls by comparing demand against inventory, with supplier info.';

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Index on recipe_* tables for recipe_id (most already exist)
-- Adding any missing ones
CREATE INDEX IF NOT EXISTS idx_recipe_malts_recipe_id ON recipe_malts(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_hops_recipe_id ON recipe_hops(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_adjuncts_recipe_id ON recipe_adjuncts(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_sugars_recipe_id ON recipe_sugars(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_spices_recipe_id ON recipe_spices(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_fruits_recipe_id ON recipe_fruits(recipe_id);

-- Index on supplier_catalog for preferred supplier lookup
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_preferred
  ON supplier_catalog(catalog_type, catalog_id, is_preferred DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_catalog_lookup
  ON supplier_catalog(catalog_type, catalog_id);

-- Index on inventory_items for name matching
CREATE INDEX IF NOT EXISTS idx_inventory_items_name_lower
  ON inventory_items(LOWER(name));

-- =============================================================================
-- SCHEMA REGISTRY ENTRY
-- =============================================================================

INSERT INTO _schema_registry (table_name, description, domain, relationships)
VALUES
  ('recipe_ingredients_normalized', 'Normalized view combining all recipe ingredient types (malts, hops, adjuncts, sugars, spices, fruits) with consistent units', 'production', '{"view_of": ["recipe_malts", "recipe_hops", "recipe_adjuncts", "recipe_sugars", "recipe_spices", "recipe_fruits"]}')
ON CONFLICT (table_name) DO UPDATE
SET description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    relationships = EXCLUDED.relationships;
